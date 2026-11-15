import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the real store with controllable IPC and dialogs. No timers or Windows
// services are needed to reproduce overlapping requests and out-of-order replies.
const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture() {
  const dialogs = [], errors = [], listeners = new Map();
  let actual = { systemProxy: false, tunMode: false, theme: "light", language: "en" };
  const core = { state: "running", controller: { url: "http://localhost", secret: "" } };
  const backend = {
    getSettings: async () => ({ ...actual }), coreStatus: async () => ({ ...core }),
    appInfo: async () => ({}), listProfiles: async () => [],
  };
  const deps = {
    zustand: require("zustand"),
    "./backend": { backend, errorCode: e => e?.code, errorMessage: e => e?.message,
      listen: async (event, cb) => { listeners.set(event, cb); return () => {}; } },
    "./mihomo": { setController() {} },
    "@/i18n": { t: x => x, systemLang: () => "en", useLang: { getState: () => ({ setLang() {} }) } },
    "@/components/ui": { confirm: () => { const d = deferred(); dialogs.push(d); return d.promise; },
      toast: { error: e => errors.push(e), success() {} } },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, require: name => { assert.ok(name in deps, name); return deps[name]; },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout, clearTimeout },
    document: { documentElement: { dataset: {}, style: {}, classList: { add() {}, remove() {} } } },
    localStorage: { setItem() {} },
  });
  const store = exports.useApp;
  await store.getState().init();
  return { store, backend, dialogs, errors, core,
    settings(value) { actual = { ...actual, ...value }; listeners.get("settings://changed")({ ...actual }); },
    status(value) { listeners.get("core://status")({ ...core, ...value }); },
  };
}

for (const [action, method, key, args] of [
  ["toggleSystemProxy", "setSystemProxy", "sysproxy", [true]],
  ["toggleTun", "setTunMode", "tun", [true]],
  ["stopCore", "coreStop", "core", []],
  ["startCore", "coreStart", "core", []],
  ["restartCore", "coreRestart", "core", []],
]) {
  test(`${action}: repeated calls send one request and remain busy until it settles`, async () => {
    const f = await fixture(), pending = deferred();
    let requests = 0;
    f.backend[method] = () => { requests++; return pending.promise; };
    const first = f.store.getState()[action](...args);
    await Promise.all(Array.from({ length: 20 }, () => f.store.getState()[action](...args)));
    assert.equal(requests, 1);
    assert.equal(f.store.getState().busy[key], true);
    pending.resolve(f.core);
    await first;
    assert.equal(f.store.getState().busy[key], false);
  });
  test(`${action}: failure releases the guard and permits retry`, async () => {
    const f = await fixture();
    let requests = 0;
    f.backend[method] = async () => { requests++; throw new Error("failed"); };
    await f.store.getState()[action](...args);
    assert.equal(f.store.getState().busy[key], false);
    f.backend[method] = async () => { requests++; return f.core; };
    await f.store.getState()[action](...args);
    assert.equal(requests, 2);
    assert.equal(f.errors.length, 1);
  });
}

for (const [action, method, key, args] of [
  ["toggleSystemProxy", "setSystemProxy", "sysproxy", [true]],
  ["toggleTun", "setTunMode", "tun", [true]],
  ["stopCore", "coreStop", "core", []],
]) {
  test(`${action}: confirmation is guarded; cancel sends nothing and permits retry`, async () => {
    const f = await fixture();
    let requests = 0;
    f.backend[method] = async () => { requests++; return f.core; };
    const first = f.store.getState()[action](...args, { confirm: true });
    await f.store.getState()[action](...args, { confirm: true });
    assert.equal(f.dialogs.length, 1);
    assert.equal(requests, 0);
    assert.equal(f.store.getState().busy[key], true);
    f.dialogs[0].resolve(false); await first;
    assert.equal(f.store.getState().busy[key], false);
    const retry = f.store.getState()[action](...args, { confirm: true });
    f.dialogs[1].resolve(true); await retry;
    assert.equal(requests, 1);
  });
}

for (const [action, method, key] of [
  ["toggleSystemProxy", "setSystemProxy", "systemProxy"],
  ["toggleTun", "setTunMode", "tunMode"],
]) {
  test(`${action}: an old command reply does not replace a newer backend setting`, async () => {
    const f = await fixture(), pending = deferred();
    f.backend[method] = () => pending.promise;
    const task = f.store.getState()[action](true);
    f.settings({ [key]: true });
    f.settings({ [key]: false });
    pending.resolve(); await task;
    assert.equal(f.store.getState().settings[key], false);
  });
  test(`${action}: an event during the final settings read wins over its stale snapshot`, async () => {
    const f = await fixture(), pending = deferred(), reading = deferred();
    f.backend[method] = async () => {};
    f.backend.getSettings = () => { reading.resolve(); return pending.promise; };
    const task = f.store.getState()[action](true);
    await reading.promise;
    f.settings({ [key]: false });
    pending.resolve({ [key]: true }); await task;
    assert.equal(f.store.getState().settings[key], false);
  });
}

test("a delayed core reply does not replace a newer status event", async () => {
  const f = await fixture(), pending = deferred();
  f.backend.coreStop = () => pending.promise;
  const task = f.store.getState().stopCore();
  f.status({ state: "running", pid: 200 });
  pending.resolve({ ...f.core, state: "stopped" }); await task;
  assert.equal(f.store.getState().core.state, "running");
  assert.equal(f.store.getState().core.pid, 200);
});

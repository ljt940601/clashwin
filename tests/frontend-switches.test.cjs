const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { createStore } = require("zustand/vanilla");

const root = path.resolve(__dirname, "..");
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const create = (initializer) => {
  const api = createStore(initializer);
  return Object.assign((selector) => selector(api.getState()), api);
};
const react = { ...React, useState: (v) => [v, () => {}] };
function load(relative, mocks) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(filename, "utf8")), {
    module, exports: module.exports,
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  }, { filename });
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture() {
  const ui = load("src/components/ui/modal.tsx", {
    react, zustand: { create }, "./basic": { Button: "button", TextField: "input" },
    "@/i18n": { t: (key) => key },
  });
  const pending = deferred();
  const calls = [];
  const errors = [];
  let confirmations = 0;
  const backend = Object.fromEntries(["setSystemProxy", "setTunMode", "coreStart", "coreStop", "coreRestart", "restartAsAdmin"].map((name) => [name, (...args) => {
    calls.push({ name, args });
    return pending.promise;
  }]));
  const { useApp } = load("src/lib/store.ts", {
    zustand: { create }, "./backend": { backend, errorCode: (e) => e.code, errorMessage: (e) => e.message },
    "./mihomo": { setController: () => {} }, "@/i18n": { t: (key) => key },
    "@/components/ui": { confirm: (opts) => { confirmations++; return ui.confirm(opts); }, toast: { error: (e) => errors.push(e) } },
  });
  useApp.setState({ settings: { systemProxy: true, tunMode: true }, core: { state: "running" } });
  const dialog = () => {
    const view = ui.DialogHost();
    return view.type(view.props);
  };
  const answer = (ok) => dialog().props.footer.props.children[ok ? 1 : 0].props.onClick();
  return { ui, useApp, pending, calls, errors, dialog, answer, confirmations: () => confirmations };
}

for (const [action, key, command] of [
  ["toggleSystemProxy", "sysproxy", "setSystemProxy"],
  ["toggleTun", "tun", "setTunMode"],
  ["stopCore", "core", "coreStop"],
]) {
  test(`${action}: one request from confirmation through completion; confirm button stays usable`, async () => {
    const f = fixture();
    const invoke = () => action === "stopCore" ? f.useApp.getState()[action]({ confirm: true }) : f.useApp.getState()[action](false, { confirm: true });
    const first = invoke();
    assert.equal(f.useApp.getState().busy[key], true);
    await invoke();
    assert.equal(f.confirmations(), 1);
    assert.equal(f.calls.length, 0);
    for (const button of f.dialog().props.footer.props.children) assert.notEqual(button.props.disabled, true);
    f.answer(true);
    await tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].name, command);
    await invoke();
    assert.equal(f.calls.length, 1);
    assert.equal(f.useApp.getState().busy[key], true);
    f.pending.resolve({ state: "stopped" });
    await first;
    assert.equal(f.useApp.getState().busy[key], false);
    assert.equal(f.ui.useDialogOpen(), false);
  });

  test(`${action}: cancelling releases busy without sending a command`, async () => {
    const f = fixture();
    const operation = action === "stopCore" ? f.useApp.getState()[action]({ confirm: true }) : f.useApp.getState()[action](false, { confirm: true });
    f.answer(false);
    await operation;
    assert.equal(f.calls.length, 0);
    assert.equal(f.useApp.getState().busy[key], false);
  });
}

test("start, stop and restart share one core operation lock", async () => {
  const f = fixture();
  const first = f.useApp.getState().startCore();
  await f.useApp.getState().stopCore({ confirm: true });
  await f.useApp.getState().restartCore();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "coreStart");
  assert.equal(f.confirmations(), 0);
  f.pending.resolve({ state: "running" });
  await first;
  assert.equal(f.useApp.getState().busy.core, false);
});

test("failed switch releases busy and reports the failure", async () => {
  const f = fixture();
  const operation = f.useApp.getState().toggleSystemProxy(false);
  f.pending.reject(new Error("switch failed"));
  await operation;
  assert.equal(f.useApp.getState().busy.sysproxy, false);
  assert.deepEqual(f.errors, ["switch failed"]);
});

const trayFile = ts.createSourceFile("TrayPanel.tsx", fs.readFileSync(path.join(root, "src/tray/TrayPanel.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(matches, context) {
  let found;
  function visit(node) {
    if (!found && matches(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(trayFile);
  assert.ok(found, "expected tray callback exists");
  let expression;
  if (ts.isVariableDeclaration(found)) {
    expression = ts.isCallExpression(found.initializer) ? found.initializer.arguments[0] : found.initializer;
  } else expression = found.arguments.find(ts.isArrowFunction);
  return vm.runInNewContext(transpile(`(${expression.getText(trayFile)})`), context);
}
const variable = (name, context) => extract((n) => ts.isVariableDeclaration(n) && n.name.getText(trayFile) === name, context);
const effect = (contains, context) => extract((n) => ts.isCallExpression(n) && n.expression.getText(trayFile) === "React.useEffect" && n.arguments[0].getText(trayFile).includes(contains), context);

test("generic confirmation uses the whole native tray region, then restores the panel region", () => {
  const regions = [];
  const panel = { getBoundingClientRect: () => ({ left: 276, top: 0, width: 320, height: 600 }) };
  const context = {
    isTauri: true, rootRef: { current: { querySelector: () => null } }, panelRef: { current: panel }, zoomRef: { current: 1 },
    ruleOpen: false, dialogOpen: true, backend: { setTrayPanelRegion: (rects) => { regions.push(rects); return Promise.resolve(); } },
  };
  variable("reportRegion", context)();
  assert.equal(regions[0].length, 0);
  context.dialogOpen = false;
  variable("reportRegion", context)();
  assert.equal(regions[1].length, 1);
  assert.equal(regions[1][0].x, 276);
  context.ruleOpen = true;
  variable("reportRegion", context)();
  assert.equal(regions[2].length, 0);
});

test("generic confirmation requests tray keyboard focus", () => {
  let focuses = 0;
  effect("backend.focusTrayPanel", { ruleOpen: false, dialogOpen: true, backend: { focusTrayPanel: () => { focuses++; return Promise.resolve(); } } })();
  assert.equal(focuses, 1);
});

test("Escape and switch shortcuts defer to an open generic confirmation", () => {
  let hidden = 0, toggled = 0;
  const stateRef = { current: { ruleOpen: false, dialogOpen: true, fly: null, settings: { systemProxy: true } } };
  const onKey = variable("onKey", {
    stateRef, backend: { hideTrayPanel: () => { hidden++; return Promise.resolve(); } },
    useApp: { getState: () => ({ toggleSystemProxy: () => toggled++ }) },
  });
  onKey({ key: "Escape" });
  onKey({ key: "s", ctrlKey: true, preventDefault() {} });
  assert.equal(hidden, 0);
  assert.equal(toggled, 0);
  stateRef.current.dialogOpen = false;
  onKey({ key: "s", ctrlKey: true, preventDefault() {} });
  assert.equal(toggled, 1);
  onKey({ key: "Escape" });
  assert.equal(hidden, 1);
});

test("hiding the tray cancels NEED_ADMIN confirmation and releases the TUN operation", async () => {
  const f = fixture();
  const operation = f.useApp.getState().toggleTun(true);
  f.pending.reject({ code: "NEED_ADMIN", message: "admin needed" });
  await tick();
  assert.equal(f.ui.useDialogOpen(), true);
  assert.equal(f.useApp.getState().busy.tun, true);
  const onHidden = extract((n) => ts.isCallExpression(n) && n.expression.getText(trayFile) === "listen" && n.arguments[0]?.text === "tray://hidden", {
    setFly() {}, setRuleOpen() {}, cancelDialogs: f.ui.cancelDialogs,
  });
  onHidden();
  await operation;
  assert.equal(f.ui.useDialogOpen(), false);
  assert.equal(f.useApp.getState().busy.tun, false);
  assert.equal(f.calls.filter((c) => c.name === "restartAsAdmin").length, 0);
});

test("hidden-window cancellation resolves every queued dialog with its cancellation value", async () => {
  const { ui } = fixture();
  const confirmation = ui.confirm({ title: "confirm" });
  const input = ui.prompt({ title: "prompt" });
  ui.cancelDialogs();
  assert.equal(await confirmation, false);
  assert.equal(await input, null);
  assert.equal(ui.useDialogOpen(), false);
});

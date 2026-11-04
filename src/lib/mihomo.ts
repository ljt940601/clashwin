/**
 * Client for the mihomo external controller (REST + WebSocket).
 * The controller address/secret come from CoreStatus (set via setController).
 * In a plain browser (no Tauri) requests are served by the mock core.
 */
import type {
  ConnectionsSnapshot,
  LogEntry,
  LogLevel,
  Memory,
  MihomoConfigs,
  ProxyItem,
  ProxyProvider,
  RuleItem,
  RuleProvider,
  Traffic,
} from "./types";
import { isTauri } from "./backend";
import { mockRest, mockStream } from "./mock/core";

let base = "http://127.0.0.1:9097";
let secret = "";

export function setController(url: string, sec: string) {
  base = url.replace(/\/$/, "");
  secret = sec;
}
export function getController() {
  return { url: base, secret };
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!isTauri) return mockRest<T>(method, path, body);
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.message ?? msg;
    } catch {}
    throw { code: `HTTP_${res.status}`, message: msg };
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const enc = encodeURIComponent;

/** Node name -> proxy-provider name, for nodes that only exist inside a provider (filled by proxies()). */
const providerOf = new Map<string, string>();

export const mihomo = {
  version: () => req<{ version: string; meta?: boolean }>("GET", "/version"),
  configs: () => req<MihomoConfigs>("GET", "/configs"),
  patchConfigs: (patch: Partial<MihomoConfigs> | Record<string, unknown>) => req<void>("PATCH", "/configs", patch),
  /**
   * Proxies & groups keyed by name. mihomo leaves nodes that come from proxy-providers
   * out of /proxies, so they are merged in from /providers/proxies (type, delay history).
   */
  proxies: async () => {
    const [p, pv] = await Promise.all([
      req<{ proxies: Record<string, ProxyItem> }>("GET", "/proxies"),
      req<{ providers: Record<string, ProxyProvider> }>("GET", "/providers/proxies").catch(() => ({ providers: {} })),
    ]);
    providerOf.clear();
    for (const prov of Object.values(pv.providers ?? {})) {
      if (prov.vehicleType === "Compatible") continue; // group-backed pseudo providers
      for (const n of prov.proxies ?? []) {
        if (!p.proxies[n.name]) {
          p.proxies[n.name] = { ...n, "provider-name": prov.name };
          providerOf.set(n.name, prov.name);
        }
      }
    }
    return p;
  },
  selectProxy: (group: string, name: string) => req<void>("PUT", `/proxies/${enc(group)}`, { name }),
  /** Clears a fixed selection on URLTest/Fallback groups */
  unfixProxy: (group: string) => req<void>("DELETE", `/proxies/${enc(group)}`),
  /**
   * Single node latency. Provider nodes aren't reachable through /proxies/{name}/delay
   * (the core answers 404), so they are tested through their provider instead.
   */
  proxyDelay: (name: string, url: string, timeout: number) => {
    const provider = providerOf.get(name);
    const path = provider
      ? `/providers/proxies/${enc(provider)}/${enc(name)}/healthcheck?url=${enc(url)}&timeout=${timeout}`
      : `/proxies/${enc(name)}/delay?url=${enc(url)}&timeout=${timeout}`;
    return req<{ delay: number }>("GET", path);
  },
  /** Tests every member of a group; returns name → delay (missing = timeout) */
  groupDelay: (group: string, url: string, timeout: number) =>
    req<Record<string, number>>("GET", `/group/${enc(group)}/delay?url=${enc(url)}&timeout=${timeout}`),
  proxyProviders: () => req<{ providers: Record<string, ProxyProvider> }>("GET", "/providers/proxies"),
  updateProxyProvider: (name: string) => req<void>("PUT", `/providers/proxies/${enc(name)}`),
  healthcheckProvider: (name: string) => req<void>("GET", `/providers/proxies/${enc(name)}/healthcheck`),
  rules: () => req<{ rules: RuleItem[] }>("GET", "/rules"),
  /** Enable/disable rules at runtime by index: { "3": true } disables rule #3 */
  disableRules: (map: Record<number, boolean>) => req<void>("PATCH", "/rules/disable", map),
  ruleProviders: () => req<{ providers: Record<string, RuleProvider> }>("GET", "/providers/rules"),
  updateRuleProvider: (name: string) => req<void>("PUT", `/providers/rules/${enc(name)}`),
  connections: () => req<ConnectionsSnapshot>("GET", "/connections"),
  closeConnection: (id: string) => req<void>("DELETE", `/connections/${enc(id)}`),
  closeAllConnections: () => req<void>("DELETE", "/connections"),
  flushFakeIp: () => req<void>("POST", "/cache/fakeip/flush"),
  flushDns: () => req<void>("POST", "/cache/dns/flush"),
  updateGeo: () => req<void>("POST", "/configs/geo"),
  dnsQuery: (name: string, type = "A") => req<unknown>("GET", `/dns/query?name=${enc(name)}&type=${type}`),
};

/* ---------------- WebSocket streams ---------------- */

export type StreamPath = "traffic" | "memory" | "connections" | "logs";
type StreamPayload = {
  traffic: Traffic;
  memory: Memory;
  connections: ConnectionsSnapshot;
  logs: LogEntry;
};

/**
 * Subscribe to a controller stream with automatic reconnect.
 * Returns an unsubscribe function.
 */
export function stream<P extends StreamPath>(
  path: P,
  onData: (d: StreamPayload[P]) => void,
  opts: { level?: LogLevel; interval?: number; onStatus?: (connected: boolean) => void } = {},
): () => void {
  if (!isTauri) return mockStream(path, onData as any, opts);
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let timer: number | undefined;

  const open = () => {
    const q = new URLSearchParams();
    if (secret) q.set("token", secret);
    if (path === "logs") q.set("level", opts.level ?? "info");
    if (path === "connections" && opts.interval) q.set("interval", String(opts.interval));
    const url = base.replace(/^http/, "ws") + "/" + path + "?" + q.toString();
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      opts.onStatus?.(true);
    };
    ws.onmessage = (ev) => {
      try {
        onData(JSON.parse(ev.data));
      } catch {}
    };
    ws.onclose = () => {
      opts.onStatus?.(false);
      if (closed) return;
      timer = window.setTimeout(open, Math.min(5000, 500 * 2 ** retry++));
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    ws?.close();
  };
}

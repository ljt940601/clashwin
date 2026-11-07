import type { ProxyItem } from "@/lib/types";
import { detectCountry, flagEmoji, hasFlag } from "@/lib/countries";

export const GROUP_TYPES = new Set(["Selector", "URLTest", "Fallback", "LoadBalance", "Relay", "Smart"]);
export const SELECTABLE = new Set(["Selector", "URLTest", "Fallback", "Smart"]);
const SPECIAL: Record<string, "direct" | "reject" | "pass" | "compatible"> = {
  DIRECT: "direct",
  REJECT: "reject",
  "REJECT-DROP": "reject",
  PASS: "pass",
  COMPATIBLE: "compatible",
};
const SPECIAL_TYPES: Record<string, "direct" | "reject" | "pass" | "compatible"> = {
  Direct: "direct",
  Reject: "reject",
  RejectDrop: "reject",
  Pass: "pass",
  Compatible: "compatible",
};

export const isGroup = (p?: ProxyItem) => !!p && (!!p.all || GROUP_TYPES.has(p.type));

export function specialKind(name: string, item?: ProxyItem) {
  return SPECIAL[name] ?? (item ? SPECIAL_TYPES[item.type] : undefined);
}

/** Last recorded delay; undefined = never tested, 0 = timeout */
export function lastDelay(p: ProxyItem | undefined, url?: string): number | undefined {
  if (!p) return undefined;
  const ex = url ? p.extra?.[url]?.history : undefined;
  const h = ex && ex.length ? ex : p.history;
  if (!h || !h.length) return undefined;
  return h[h.length - 1].delay;
}

/** Follow `now` through nested groups: ["SG1", ...] (excludes the group itself) */
export function resolvePath(name: string, proxies: Record<string, ProxyItem>): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let cur = proxies[name];
  while (cur && cur.now && !seen.has(cur.name) && path.length < 6) {
    seen.add(cur.name);
    path.push(cur.now);
    cur = proxies[cur.now];
  }
  return path;
}

/** Name with a flag prefix when the name has none but a country is detectable */
/**
 * Nodes from subscriptions merged into a profile are named "[subscription] node"
 * (additional-prefix in config.rs). Split that off so the node part can lead.
 */
export function splitSource(name: string): { source?: string; name: string } {
  const m = name.match(/^\[([^\]]{1,48})\]\s*(\S.*)$/);
  return m ? { source: m[1], name: m[2] } : { name };
}

export function displayName(name: string): string {
  if (hasFlag(name) || SPECIAL[name]) return name;
  const cc = detectCountry(name);
  return cc ? `${flagEmoji(cc)} ${name}` : name;
}


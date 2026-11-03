/**
 * Rule parsing / formatting helpers for mihomo rule lines like
 *   DOMAIN-SUFFIX,google.com,Proxy
 *   IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
 *   AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
 *   MATCH,Final
 */

export type RuleCategory = "domain" | "ip" | "process" | "port" | "geo" | "ruleset" | "network" | "logic" | "match" | "other";

export interface RuleTypeMeta {
  type: string;
  category: RuleCategory;
  /** supports the no-resolve option */
  ip?: boolean;
  /** has no payload (MATCH) */
  noPayload?: boolean;
  /** usable inside AND/OR/NOT */
  inLogic?: boolean;
  placeholder?: string;
}

export const RULE_TYPES: RuleTypeMeta[] = [
  { type: "DOMAIN", category: "domain", inLogic: true, placeholder: "www.google.com" },
  { type: "DOMAIN-SUFFIX", category: "domain", inLogic: true, placeholder: "google.com" },
  { type: "DOMAIN-KEYWORD", category: "domain", inLogic: true, placeholder: "google" },
  { type: "DOMAIN-REGEX", category: "domain", inLogic: true, placeholder: "^ad\\..*" },
  { type: "DOMAIN-WILDCARD", category: "domain", inLogic: true, placeholder: "*.google.com" },
  { type: "GEOSITE", category: "geo", inLogic: true, placeholder: "google" },
  { type: "IP-CIDR", category: "ip", ip: true, inLogic: true, placeholder: "192.168.0.0/16" },
  { type: "IP-CIDR6", category: "ip", ip: true, inLogic: true, placeholder: "2001:db8::/32" },
  { type: "IP-SUFFIX", category: "ip", ip: true, inLogic: true, placeholder: "8.8.8.8/24" },
  { type: "IP-ASN", category: "ip", ip: true, inLogic: true, placeholder: "13335" },
  { type: "GEOIP", category: "geo", ip: true, inLogic: true, placeholder: "CN" },
  { type: "SRC-IP-CIDR", category: "ip", inLogic: true, placeholder: "192.168.1.201/32" },
  { type: "SRC-IP-SUFFIX", category: "ip", inLogic: true, placeholder: "192.168.1.201/8" },
  { type: "SRC-GEOIP", category: "geo", inLogic: true, placeholder: "CN" },
  { type: "SRC-IP-ASN", category: "ip", inLogic: true, placeholder: "9808" },
  { type: "DST-PORT", category: "port", inLogic: true, placeholder: "443" },
  { type: "SRC-PORT", category: "port", inLogic: true, placeholder: "7777" },
  { type: "IN-PORT", category: "port", inLogic: true, placeholder: "7890" },
  { type: "IN-TYPE", category: "network", inLogic: true, placeholder: "SOCKS/HTTP" },
  { type: "IN-NAME", category: "network", inLogic: true, placeholder: "ss" },
  { type: "IN-USER", category: "network", inLogic: true, placeholder: "user" },
  { type: "NETWORK", category: "network", inLogic: true, placeholder: "UDP" },
  { type: "DSCP", category: "network", inLogic: true, placeholder: "4" },
  { type: "PROCESS-NAME", category: "process", inLogic: true, placeholder: "chrome.exe" },
  { type: "PROCESS-PATH", category: "process", inLogic: true, placeholder: "C:\\Program Files\\App\\app.exe" },
  { type: "PROCESS-NAME-REGEX", category: "process", inLogic: true, placeholder: "(?i)telegram.*" },
  { type: "PROCESS-PATH-REGEX", category: "process", inLogic: true, placeholder: ".*\\\\Steam\\\\.*" },
  { type: "RULE-SET", category: "ruleset", inLogic: true, placeholder: "provider" },
  { type: "SUB-RULE", category: "other", placeholder: "(NETWORK,TCP)" },
  { type: "MATCH", category: "match", noPayload: true },
];

export const LOGIC_TYPES = ["AND", "OR", "NOT"] as const;
export type LogicOp = (typeof LOGIC_TYPES)[number];

const META = new Map(RULE_TYPES.map((m) => [m.type, m]));

export function ruleMeta(type: string): RuleTypeMeta {
  const t = type.toUpperCase();
  if ((LOGIC_TYPES as readonly string[]).includes(t)) return { type: t, category: "logic" };
  return META.get(t) ?? { type: t, category: "other" };
}

/** mihomo API rule type names (CamelCase) → config keywords */
const RUNTIME_MAP: Record<string, string> = {
  Domain: "DOMAIN",
  DomainSuffix: "DOMAIN-SUFFIX",
  DomainKeyword: "DOMAIN-KEYWORD",
  DomainRegex: "DOMAIN-REGEX",
  DomainWildcard: "DOMAIN-WILDCARD",
  GeoSite: "GEOSITE",
  GeoIP: "GEOIP",
  SrcGeoIP: "SRC-GEOIP",
  IPASN: "IP-ASN",
  SrcIPASN: "SRC-IP-ASN",
  IPCIDR: "IP-CIDR",
  IPCIDR6: "IP-CIDR6",
  SrcIPCIDR: "SRC-IP-CIDR",
  IPSuffix: "IP-SUFFIX",
  SrcIPSuffix: "SRC-IP-SUFFIX",
  SrcPort: "SRC-PORT",
  DstPort: "DST-PORT",
  InPort: "IN-PORT",
  InUser: "IN-USER",
  InName: "IN-NAME",
  InType: "IN-TYPE",
  ProcessName: "PROCESS-NAME",
  ProcessPath: "PROCESS-PATH",
  ProcessNameRegex: "PROCESS-NAME-REGEX",
  ProcessPathRegex: "PROCESS-PATH-REGEX",
  ProcessNameWildcard: "PROCESS-NAME-WILDCARD",
  ProcessPathWildcard: "PROCESS-PATH-WILDCARD",
  RuleSet: "RULE-SET",
  Network: "NETWORK",
  DSCP: "DSCP",
  Uid: "UID",
  SubRules: "SUB-RULE",
  Match: "MATCH",
  AND: "AND",
  OR: "OR",
  NOT: "NOT",
};

export function canonicalType(runtimeType: string): string {
  if (RUNTIME_MAP[runtimeType]) return RUNTIME_MAP[runtimeType];
  if (/^[A-Z0-9-]+$/.test(runtimeType)) return runtimeType;
  // CamelCase → KEBAB-UPPER fallback
  return runtimeType.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toUpperCase();
}

/** Split by `sep` at paren depth 0 */
export function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

export interface ParsedRule {
  type: string;
  payload: string;
  policy: string;
  options: string[]; // e.g. ["no-resolve"]
}

export function parseRuleLine(line: string): ParsedRule {
  const parts = splitTop(line.trim());
  const type = (parts[0] ?? "").toUpperCase();
  if (type === "MATCH") return { type, payload: "", policy: parts[1] ?? "", options: parts.slice(2) };
  return { type, payload: parts[1] ?? "", policy: parts[2] ?? "", options: parts.slice(3) };
}

export function buildRuleLine(r: { type: string; payload: string; policy: string; noResolve?: boolean; options?: string[] }): string {
  const type = r.type.toUpperCase();
  if (type === "MATCH") return `MATCH,${r.policy}`;
  const opts = (r.options ?? []).filter((o) => o && o !== "no-resolve");
  if (r.noResolve) opts.push("no-resolve");
  return [type, r.payload.trim(), r.policy, ...opts].join(",");
}

/* ---------------- logic tree ---------------- */

let nodeSeq = 0;
export const nid = () => `n${++nodeSeq}`;

export type LNode =
  | { id: string; kind: "logic"; op: LogicOp; children: LNode[] }
  | { id: string; kind: "cond"; type: string; payload: string };

function stripParens(s: string): string {
  s = s.trim();
  if (s.startsWith("(") && s.endsWith(")")) {
    // only strip when the outer parens wrap the whole string
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      if (depth === 0 && i < s.length - 1) return s;
    }
    return s.slice(1, -1).trim();
  }
  return s;
}

/** Parse "AND" + "((NETWORK,UDP),(DST-PORT,443))" into a tree */
export function parseLogic(op: string, payload: string): LNode {
  const inner = stripParens(payload);
  const items = inner ? splitTop(inner) : [];
  const children: LNode[] = items.map((it) => {
    const body = stripParens(it);
    const [head, ...rest] = splitTop(body);
    const t = (head ?? "").toUpperCase();
    if ((LOGIC_TYPES as readonly string[]).includes(t)) return parseLogic(t, rest.join(","));
    return { id: nid(), kind: "cond" as const, type: t, payload: rest.join(",") };
  });
  return { id: nid(), kind: "logic", op: (op.toUpperCase() as LogicOp) ?? "AND", children };
}

/** Compile a node to "AND,((A,B),(C,D))" / "DST-PORT,443" (no policy) */
export function compileLogic(node: LNode): string {
  if (node.kind === "cond") return `${node.type},${node.payload.trim()}`;
  return `${node.op},(${node.children.map((c) => `(${compileLogic(c)})`).join(",")})`;
}

/** Returns an i18n error key, or null when the tree is valid */
export function validateLogic(node: LNode): string | null {
  if (node.kind === "cond") return node.type && node.payload.trim() ? null : "rules.conditionIncomplete";
  if (!node.children.length) return "rules.logicNeedsChildren";
  if (node.op === "NOT" && node.children.length !== 1) return "rules.notOneChild";
  if (node.op !== "NOT" && node.children.length < 2) return "rules.logicNeedsTwo";
  for (const c of node.children) {
    const e = validateLogic(c);
    if (e) return e;
  }
  return null;
}

/* ---------------- presets (globe button) ---------------- */

export interface Preset {
  labelKey: string;
  value: string;
}

export const GEOIP_PRESETS: Preset[] = [
  { labelKey: "rules.presetCN", value: "CN" },
  { labelKey: "rules.presetLAN", value: "LAN" },
  { labelKey: "rules.presetPrivate", value: "private" },
  { labelKey: "rules.presetTelegram", value: "telegram" },
  { labelKey: "rules.presetGoogle", value: "google" },
  { labelKey: "rules.presetNetflix", value: "netflix" },
];

export const GEOSITE_PRESETS: Preset[] = [
  { labelKey: "rules.presetCN", value: "cn" },
  { labelKey: "rules.presetNotCN", value: "geolocation-!cn" },
  { labelKey: "rules.presetPrivate", value: "private" },
  { labelKey: "rules.presetGoogle", value: "google" },
  { labelKey: "rules.presetYoutube", value: "youtube" },
  { labelKey: "rules.presetNetflix", value: "netflix" },
  { labelKey: "rules.presetTelegram", value: "telegram" },
  { labelKey: "rules.presetApple", value: "apple" },
  { labelKey: "rules.presetMicrosoft", value: "microsoft" },
  { labelKey: "rules.presetGithub", value: "github" },
  { labelKey: "rules.presetOpenai", value: "openai" },
  { labelKey: "rules.presetCategoryAds", value: "category-ads-all" },
];

export const CIDR_PRESETS: Preset[] = [
  { labelKey: "rules.presetLAN", value: "192.168.0.0/16" },
  { labelKey: "rules.presetLAN", value: "10.0.0.0/8" },
  { labelKey: "rules.presetLAN", value: "172.16.0.0/12" },
  { labelKey: "rules.presetPrivate", value: "127.0.0.0/8" },
  { labelKey: "rules.presetPrivate", value: "100.64.0.0/10" },
];

export function presetsFor(type: string): Preset[] | null {
  switch (type) {
    case "GEOIP":
    case "SRC-GEOIP":
      return GEOIP_PRESETS;
    case "GEOSITE":
      return GEOSITE_PRESETS;
    case "IP-CIDR":
    case "SRC-IP-CIDR":
      return CIDR_PRESETS;
    default:
      return null;
  }
}

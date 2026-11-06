/**
 * Fake mihomo controller for browser previews (no Tauri, no core).
 * Produces plausible, slowly changing data.
 */
import type { Connection, ConnectionsSnapshot, LogEntry, ProxyItem, RuleItem } from "../types";

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const hist = (delay: number) => [{ time: new Date().toISOString(), delay }];

/* ---------------- Proxies ---------------- */
const NODES: [string, string, number][] = [
  ["🇺🇸 GCP US-anytls", "AnyTLS", 182],
  ["🇺🇸 GCP US-trojan", "Trojan", 196],
  ["🇺🇸 GCP US-tuic", "Tuic", 171],
  ["🇸🇬 OC SG1-anytls", "AnyTLS", 64],
  ["🇸🇬 OC SG2-hy2", "Hysteria2", 71],
  ["🇯🇵 OC JP1-anytls", "AnyTLS", 48],
  ["🇯🇵 OC JP2-vless", "Vless", 55],
  ["🇭🇰 HK 01", "Shadowsocks", 32],
  ["🇭🇰 HK 02", "Shadowsocks", 0],
  ["🇭🇰 HK 03", "Vmess", 41],
  ["🇹🇼 TW 01", "Trojan", 77],
  ["🇰🇷 KR 01", "Shadowsocks", 92],
  ["🇬🇧 UK London", "Vless", 412],
  ["🇩🇪 DE Frankfurt", "Hysteria2", 365],
  ["🇨🇦 CA Toronto", "Trojan", 980],
];

const proxies: Record<string, ProxyItem> = {};
for (const [name, type, d] of NODES) proxies[name] = { name, type, udp: true, history: d ? hist(d) : [], alive: d > 0, "provider-name": "Mini_en" };
proxies["DIRECT"] = { name: "DIRECT", type: "Direct", udp: true, history: [] };
proxies["REJECT"] = { name: "REJECT", type: "Reject", udp: true, history: [] };
proxies["REJECT-DROP"] = { name: "REJECT-DROP", type: "RejectDrop", udp: true, history: [] };
const group = (name: string, type: string, all: string[], now: string, hidden = false): ProxyItem => ({
  name,
  type,
  all,
  now,
  hidden,
  history: [],
  udp: true,
  testUrl: "https://www.gstatic.com/generate_204",
});
const nodeNames = NODES.map((n) => n[0]);
proxies["OUTCN"] = group("OUTCN", "Selector", ["Auto", ...nodeNames, "DIRECT"], "🇸🇬 OC SG1-anytls");
proxies["Auto"] = group("Auto", "URLTest", nodeNames, "🇭🇰 HK 01");
proxies["Streaming"] = group("Streaming", "Selector", ["OUTCN", ...nodeNames.slice(0, 7)], "🇺🇸 GCP US-anytls");
proxies["CN"] = group("CN", "Selector", ["DIRECT", "OUTCN"], "DIRECT");
proxies["MATCH"] = group("MATCH", "Selector", ["OUTCN", "DIRECT", ...nodeNames], "🇯🇵 OC JP1-anytls");
proxies["AdBlock"] = group("AdBlock", "Selector", ["REJECT", "REJECT-DROP", "DIRECT"], "REJECT");
proxies["Fallback"] = group("Fallback", "Fallback", nodeNames.slice(3, 9), "🇸🇬 OC SG1-anytls", true);
// the app's hidden node speed-test group (filtered out by mihomo.proxies())
proxies["ClashWin-SpeedTest"] = { ...group("ClashWin-SpeedTest", "Selector", ["DIRECT", ...nodeNames], "DIRECT"), hidden: true };
proxies["GLOBAL"] = group("GLOBAL", "Selector", ["DIRECT", "REJECT", "OUTCN", "Auto", "Streaming", "CN", "MATCH", "AdBlock", "ClashWin-SpeedTest", ...nodeNames], "OUTCN");

/* ---------------- Rules ---------------- */
const RULES: [string, string, string, number][] = [
  ["RuleSet", "Private", "DIRECT", 0],
  ["RuleSet", "Reject", "AdBlock", 0],
  ["DomainSuffix", "googleapis.com", "OUTCN", -1],
  ["DomainSuffix", "github.com", "OUTCN", -1],
  ["DomainKeyword", "openai", "MATCH", -1],
  ["Domain", "claude.ai", "MATCH", -1],
  ["ProcessName", "Telegram.exe", "OUTCN", -1],
  ["ProcessName", "WeChat.exe", "DIRECT", -1],
  ["GeoSite", "youtube", "Streaming", -1],
  ["GeoSite", "netflix", "Streaming", -1],
  ["RuleSet", "Proxy", "OUTCN", 0],
  ["RuleSet", "ProxyIP", "OUTCN", 0],
  ["RuleSet", "Apple", "DIRECT", 0],
  ["RuleSet", "China", "CN", 0],
  ["IPCIDR", "192.168.0.0/16", "DIRECT", -1],
  ["IPCIDR", "10.0.0.0/8", "DIRECT", -1],
  ["GeoIP", "CN", "CN", -1],
  ["AND", "((NETWORK,UDP),(DST-PORT,443))", "REJECT", -1],
  ["Match", "", "MATCH", -1],
];
const ruleSizes: Record<string, number> = { Private: 312, Reject: 98211, Proxy: 4995, ProxyIP: 2681, Apple: 1874, China: 76510 };
const rules: RuleItem[] = RULES.map(([type, payload, proxy, size], index) => ({
  index,
  type,
  payload,
  proxy,
  size: size === 0 ? ruleSizes[payload] ?? 100 : -1,
  extra: { disabled: false, hitCount: Math.floor(rnd(0, 5000)), hitAt: new Date().toISOString(), missCount: 0, missAt: "" },
}));

// Rule-line round trip so edits on the Rules page show up in previews.
const TO_LINE: Record<string, string> = { RuleSet: "RULE-SET", DomainSuffix: "DOMAIN-SUFFIX", DomainKeyword: "DOMAIN-KEYWORD", Domain: "DOMAIN", ProcessName: "PROCESS-NAME", GeoSite: "GEOSITE", IPCIDR: "IP-CIDR", GeoIP: "GEOIP", Match: "MATCH" };
const FROM_LINE: Record<string, string> = Object.fromEntries(Object.entries(TO_LINE).map(([a, b]) => [b, a]));
const ORIGINAL_RULE_LINES = rules.map((r) => (r.type === "Match" ? `MATCH,${r.proxy}` : `${TO_LINE[r.type] ?? r.type},${r.payload},${r.proxy}`));
export function mockRuleLines(): string[] {
  return rules.map((r) => (r.type === "Match" ? `MATCH,${r.proxy}` : `${TO_LINE[r.type] ?? r.type},${r.payload},${r.proxy}`));
}
export function mockSetRuleLines(lines: string[] | null) {
  const src = lines ?? ORIGINAL_RULE_LINES;
  const next: RuleItem[] = src.map((line, index) => {
    const parts = line.split(",");
    const t = parts[0].toUpperCase();
    const logic = ["AND", "OR", "NOT"].includes(t);
    const payload = t === "MATCH" ? "" : logic ? line.slice(t.length + 1, line.lastIndexOf(",")) : parts[1] ?? "";
    const proxy = t === "MATCH" ? parts[1] : logic ? line.slice(line.lastIndexOf(",") + 1) : parts[2] ?? "";
    const type = FROM_LINE[t] ?? t;
    const old = rules.find((r) => r.type === type && r.payload === payload);
    return { index, type, payload, proxy, size: type === "RuleSet" ? ruleSizes[payload] ?? 100 : -1, extra: old?.extra ?? { disabled: false, hitCount: 0, hitAt: "", missCount: 0, missAt: "" } };
  });
  rules.splice(0, rules.length, ...next);
}

/* ---------------- Connections ---------------- */
const PROCS = [
  ["chrome.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
  ["msedge.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
  ["Code.exe", "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"],
  ["Telegram.exe", "C:\\Users\\me\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe"],
  ["Spotify.exe", "C:\\Users\\me\\AppData\\Roaming\\Spotify\\Spotify.exe"],
  ["svchost.exe", "C:\\Windows\\System32\\svchost.exe"],
  ["git-remote-https.exe", "C:\\Program Files\\Git\\mingw64\\libexec\\git-core\\git-remote-https.exe"],
];
const HOSTS: [string, string, string[], string][] = [
  ["daily-cloudcode-pa.googleapis.com", "DomainSuffix(googleapis.com)", ["🇸🇬 OC SG1-anytls", "OUTCN"], "142.250.70.10"],
  ["play.googleapis.com", "DomainSuffix(googleapis.com)", ["🇸🇬 OC SG1-anytls", "OUTCN"], "142.250.70.42"],
  ["github.com", "DomainSuffix(github.com)", ["🇸🇬 OC SG1-anytls", "OUTCN"], "20.205.243.166"],
  ["api.github.com", "DomainSuffix(github.com)", ["🇸🇬 OC SG1-anytls", "OUTCN"], "20.205.243.168"],
  ["claude.ai", "Domain(claude.ai)", ["🇯🇵 OC JP1-anytls", "MATCH"], "160.79.104.10"],
  ["www.youtube.com", "GeoSite(youtube)", ["🇺🇸 GCP US-anytls", "Streaming"], "142.250.199.78"],
  ["rr3---sn-i3b7kn6s.googlevideo.com", "GeoSite(youtube)", ["🇺🇸 GCP US-anytls", "Streaming"], "173.194.55.8"],
  ["video.twimg.com", "RuleSet(Proxy)", ["🇺🇸 GCP US-trojan", "OUTCN"], "151.101.40.158"],
  ["www.baidu.com", "RuleSet(China)", ["DIRECT", "CN"], "110.242.68.66"],
  ["dl.devmate.com", "RuleSet(Proxy)", ["🇺🇸 GCP US-tuic", "OUTCN"], "104.18.12.34"],
  ["iosapps.itunes.apple.com", "RuleSet(Apple)", ["DIRECT"], "17.253.144.10"],
  ["ad.doubleclick.net", "RuleSet(Reject)", ["REJECT", "AdBlock"], "0.0.0.0"],
  ["api.telegram.org", "ProcessName(Telegram.exe)", ["🇸🇬 OC SG2-hy2", "OUTCN"], "149.154.167.220"],
  ["spclient.wg.spotify.com", "Match", ["🇯🇵 OC JP1-anytls", "MATCH"], "35.186.224.25"],
];
let connSeq = 0;
function newConn(): Connection {
  const [host, ruleStr, chains, ip] = pick(HOSTS);
  const [proc, path] = host.includes("telegram") ? PROCS[3] : host.includes("spotify") ? PROCS[4] : host.includes("github") && Math.random() < 0.5 ? PROCS[6] : pick(PROCS.slice(0, 3));
  const m = ruleStr.match(/^(\w+)\((.*)\)$/);
  const udp = Math.random() < 0.15;
  return {
    id: `mock-${++connSeq}-${Math.random().toString(36).slice(2, 8)}`,
    metadata: {
      network: udp ? "udp" : "tcp",
      type: pick(["HTTP", "HTTPS", "Tun", "Socks5", "Mixed"]),
      sourceIP: "192.168.1." + Math.floor(rnd(2, 40)),
      destinationIP: ip,
      sourcePort: String(Math.floor(rnd(50000, 65000))),
      destinationPort: udp ? "443" : pick(["443", "443", "80"]),
      host,
      dnsMode: "fake-ip",
      process: proc,
      processPath: path,
      sniffHost: "",
    },
    upload: Math.floor(rnd(500, 50000)),
    download: Math.floor(rnd(2000, 400000)),
    start: new Date(Date.now() - rnd(0, 600000)).toISOString(),
    chains,
    rule: m ? m[1] : ruleStr,
    rulePayload: m ? m[2] : "",
  };
}
let conns: Connection[] = Array.from({ length: 26 }, newConn);
let upTotal = 892 * 1024 * 1024;
let downTotal = 189 * 1024 * 1024;

function tickConnections(): ConnectionsSnapshot {
  conns = conns.filter(() => Math.random() > 0.04);
  while (conns.length < 22 || Math.random() < 0.3) conns.push(newConn());
  for (const c of conns) {
    const du = Math.random() < 0.6 ? Math.floor(rnd(0, 3000)) : 0;
    const dd = Math.random() < 0.6 ? Math.floor(rnd(0, c.metadata.host.includes("video") ? 900000 : 40000)) : 0;
    c.upload += du;
    c.download += dd;
    upTotal += du;
    downTotal += dd;
  }
  return { uploadTotal: upTotal, downloadTotal: downTotal, connections: conns.map((c) => ({ ...c })), memory: 0 };
}

/* ---------------- Logs ---------------- */
function randomLog(): LogEntry {
  const c = pick(conns.length ? conns : [newConn()]);
  const r = Math.random();
  if (r < 0.62)
    return {
      type: "info",
      payload: `[${c.metadata.network.toUpperCase()}] ${c.metadata.sourceIP}:${c.metadata.sourcePort}(${c.metadata.process}) --> ${c.metadata.host}:${c.metadata.destinationPort} match ${c.rule}(${c.rulePayload}) using ${[...c.chains].reverse().join("[")}${"]".repeat(Math.max(0, c.chains.length - 1))}`,
    };
  if (r < 0.8) return { type: "debug", payload: `[DNS] ${c.metadata.host} --> [${c.metadata.destinationIP}] A from https://doh.pub/dns-query` };
  if (r < 0.88) return { type: "debug", payload: `[Sniffer] Sniff TCP [${c.metadata.sourceIP}:${c.metadata.sourcePort}] --> [${c.metadata.destinationIP}:443] success, replace domain [${c.metadata.host}]` };
  if (r < 0.96) return { type: "warning", payload: `[TCP] dial ${pick(nodeNames)} (match RuleSet/Proxy) ${c.metadata.sourceIP}:${c.metadata.sourcePort} --> ${c.metadata.host}:443 error: i/o timeout` };
  return { type: "error", payload: `[Provider] Mini_en pull error: Get "https://sub.example.com/api": context deadline exceeded` };
}

/* ---------------- REST ---------------- */
let mode = "rule";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockRest<T>(method: string, path: string, body?: any): Promise<T> {
  await delay(40);
  const url = new URL(path, "http://mock");
  const p = decodeURIComponent(url.pathname);
  const r = (x: unknown) => x as T;

  if (p === "/version") return r({ version: "v1.19.27", meta: true });
  if (p === "/configs" && method === "GET")
    return r({ port: 0, "socks-port": 0, "redir-port": 0, "tproxy-port": 0, "mixed-port": 7890, "allow-lan": false, "bind-address": "*", mode, "log-level": "info", ipv6: false });
  if (p === "/configs" && method === "PATCH") {
    if (body?.mode) mode = body.mode;
    return r(undefined);
  }
  if (p === "/proxies") return r({ proxies });
  let m = p.match(/^\/proxies\/(.+)\/delay$/);
  if (m) {
    await delay(rnd(200, 900));
    const d = Math.random() < 0.1 ? 0 : Math.floor(rnd(30, 1100));
    if (proxies[m[1]]) proxies[m[1]].history = d ? hist(d) : [{ time: new Date().toISOString(), delay: 0 }];
    if (!d) throw { code: "HTTP_504", message: "Timeout" };
    return r({ delay: d });
  }
  m = p.match(/^\/group\/(.+)\/delay$/);
  if (m) {
    await delay(rnd(800, 1600));
    const out: Record<string, number> = {};
    for (const n of proxies[m[1]]?.all ?? []) {
      if (proxies[n]?.all || ["DIRECT", "REJECT", "REJECT-DROP"].includes(n)) continue;
      const d = Math.random() < 0.08 ? 0 : Math.floor(rnd(30, 1100));
      proxies[n].history = hist(d);
      if (d) out[n] = d;
    }
    return r(out);
  }
  m = p.match(/^\/proxies\/(.+)$/);
  if (m && method === "PUT") {
    proxies[m[1]].now = body.name;
    return r(undefined);
  }
  if (p === "/providers/proxies")
    return r({
      providers: {
        Mini_en: {
          name: "Mini_en",
          type: "Proxy",
          vehicleType: "HTTP",
          proxies: nodeNames.map((n) => proxies[n]),
          updatedAt: new Date(Date.now() - 3600e3).toISOString(),
          subscriptionInfo: { Upload: 12e9, Download: 86e9, Total: 200e9, Expire: Math.floor(Date.now() / 1000) + 128 * 86400 },
        },
        default: { name: "default", type: "Proxy", vehicleType: "Compatible", proxies: [proxies["DIRECT"], proxies["REJECT"]] },
      },
    });
  if (p === "/rules") {
    for (const ru of rules) if (ru.extra && Math.random() < 0.3) ru.extra.hitCount += Math.floor(rnd(0, 5));
    return r({ rules });
  }
  if (p === "/rules/disable") {
    for (const [i, v] of Object.entries(body ?? {})) if (rules[+i]?.extra) rules[+i].extra!.disabled = !!v;
    return r(undefined);
  }
  if (p === "/providers/rules")
    return r({
      providers: Object.fromEntries(
        Object.entries(ruleSizes).map(([name, ruleCount]) => [
          name,
          { name, type: "Rule", vehicleType: "HTTP", behavior: name === "ProxyIP" ? "ipcidr" : "domain", format: "mrs", ruleCount, updatedAt: new Date(Date.now() - rnd(0, 86400e3 * 3)).toISOString() },
        ]),
      ),
    });
  if (p === "/connections" && method === "GET") return r(tickConnections());
  if (p === "/connections" && method === "DELETE") {
    conns = [];
    return r(undefined);
  }
  m = p.match(/^\/connections\/(.+)$/);
  if (m && method === "DELETE") {
    conns = conns.filter((c) => c.id !== m![1]);
    return r(undefined);
  }
  return r(undefined);
}

/* ---------------- Streams ---------------- */
let phase = 0;
export function mockStream(path: string, onData: (d: any) => void, opts: { onStatus?: (c: boolean) => void } = {}): () => void {
  const timers: number[] = [];
  setTimeout(() => opts.onStatus?.(true), 0);
  if (path === "traffic") {
    timers.push(
      window.setInterval(() => {
        phase += 1;
        const spike = Math.random() < 0.06 ? rnd(20000, 60000) : 0;
        const down = Math.max(0, 2500 + Math.sin(phase / 5) * 1500 + rnd(0, 3000) + spike);
        const up = Math.max(0, 1500 + Math.cos(phase / 7) * 900 + rnd(0, 1500) + spike * 0.5);
        onData({ up: Math.floor(up), down: Math.floor(down) });
      }, 1000),
    );
  } else if (path === "memory") {
    timers.push(window.setInterval(() => onData({ inuse: Math.floor(85 * 1048576 + rnd(-2, 2) * 1048576), oslimit: 0 }), 1000));
  } else if (path === "connections") {
    const fire = () => onData(tickConnections());
    fire();
    timers.push(window.setInterval(fire, 1000));
  } else if (path === "logs") {
    timers.push(window.setInterval(() => onData(randomLog()), 350));
  }
  return () => timers.forEach((t) => clearInterval(t));
}

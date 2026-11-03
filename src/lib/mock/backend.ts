/**
 * Fake backend for browser previews. Mirrors the Tauri command contract in ../backend.ts.
 */
import { DEFAULT_SETTINGS } from "../defaults";
import { mockRuleLines, mockSetRuleLines } from "./core";
import type { AppSettings, CoreStatus, Profile, RouteAgg, StatsPeriod } from "../types";

type Cb = (p: any) => void;
const listeners = new Map<string, Set<Cb>>();
function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((cb) => cb(payload));
}
export async function mockListen<T>(event: string, cb: (p: T) => void): Promise<() => void> {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(cb as Cb);
  return () => listeners.get(event)?.delete(cb as Cb);
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const GB = 1024 ** 3;
const MB = 1024 ** 2;

function deepMerge<T>(base: T, patch: any): T {
  if (patch === undefined) return base;
  if (Array.isArray(patch) || typeof patch !== "object" || patch === null) return patch;
  const out: any = { ...(base as any) };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge((base as any)?.[k], v);
  return out;
}

let settings: AppSettings = deepMerge(DEFAULT_SETTINGS, {
  activeProfileId: "p1",
  tunMode: true,
  controller: { secret: "mock-secret" },
});

let core: CoreStatus = {
  state: "running",
  version: "v1.19.27",
  pid: 4242,
  startedAt: Date.now() - 3600e3,
  controller: { url: "http://127.0.0.1:9097", secret: "mock-secret" },
};

let profiles: Profile[] = [
  {
    id: "p1",
    name: "Mini_en",
    type: "remote",
    url: "https://sub.example.com/api/v1/client/subscribe?token=abc",
    file: "C:\\Users\\me\\AppData\\Roaming\\ClashWin\\profiles\\p1.yaml",
    updatedAt: Date.now() - 3 * 3600e3,
    autoUpdateMinutes: 720,
    subscription: { upload: 12 * GB, download: 86 * GB, total: 200 * GB, expire: Math.floor(Date.now() / 1000) + 128 * 86400 },
  },
  {
    id: "p2",
    name: "Backup Airport",
    type: "remote",
    url: "https://backup.example.net/sub?id=42",
    file: "C:\\Users\\me\\AppData\\Roaming\\ClashWin\\profiles\\p2.yaml",
    updatedAt: Date.now() - 2 * 86400e3,
    autoUpdateMinutes: 1440,
    subscription: { upload: 40 * GB, download: 141 * GB, total: 200 * GB, expire: Math.floor(Date.now() / 1000) + 9 * 86400 },
  },
  {
    id: "p3",
    name: "Work",
    type: "local",
    file: "C:\\Users\\me\\AppData\\Roaming\\ClashWin\\profiles\\p3.yaml",
    updatedAt: Date.now() - 12 * 86400e3,
  },
];

function rank(names: string[], max: number, decay = 0.55): { name: string; value: number }[] {
  let v = max;
  return names.map((name) => {
    const r = { name, value: Math.floor(v) };
    v *= decay + Math.random() * 0.25;
    return r;
  });
}

function statsPeriod(period: "today" | "month"): StatsPeriod {
  const now = new Date();
  const timeline =
    period === "today"
      ? Array.from({ length: 24 }, (_, h) => ({
          label: String(h).padStart(2, "0"),
          value: h <= now.getHours() && h >= 9 ? Math.floor(rnd(20, 290) * MB) : h <= now.getHours() && h > 6 ? Math.floor(rnd(1, 30) * MB) : 0,
        }))
      : Array.from({ length: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() }, (_, d) => ({
          label: String(d + 1),
          value: d + 1 <= now.getDate() ? Math.floor(rnd(0.3, 2.4) * GB) : 0,
        }));
  const total = timeline.reduce((a, b) => a + b.value, 0);
  return {
    period,
    total,
    prevTotal: Math.floor(total / 1.01),
    split: { direct: Math.floor(total * 0.0045), proxy: Math.floor(total * 0.995), reject: 2243 },
    timeline,
    topRules: [
      { name: "Proxy", value: 4995 },
      { name: "ProxyIP", value: 2681 },
      { name: "Match", value: 1284 },
      { name: "China", value: 317 },
      { name: "Private", value: 206 },
    ],
    topDomains: rank(["daily-cloudcode-pa.googleapis.com", "play.googleapis.com", "iosapps.itunes.apple.com", "dl.devmate.com", "video.twimg.com"], 904 * MB, 0.45),
    topNodes: [
      { name: "🇺🇸 GCP US-anytls", value: 1.51 * GB },
      { name: "🇺🇸 GCP US-trojan", value: 945.16 * MB },
      { name: "🇺🇸 GCP US-tuic", value: 214.17 * MB },
      { name: "DIRECT", value: 8.5 * MB },
      { name: "REJECT", value: 4.37 * 1024 },
    ],
    topPolicies: [
      { name: "OUTCN", value: 852.03 * MB },
      { name: "MATCH", value: 259.08 * MB },
      { name: "CN", value: 6.75 * MB },
    ],
    topProcesses: rank(["chrome.exe", "Code.exe", "Telegram.exe", "msedge.exe", "svchost.exe"], 700 * MB),
    topCountries: rank(["US", "SG", "JP", "HK", "CN"], 1.2 * GB),
  };
}

function routes(range: string): RouteAgg[] {
  const base: RouteAgg[] = [
    { proxyCountry: "SG", targetCountry: "US", node: "🇸🇬 OC SG1-anytls", bytes: 820 * MB, count: 412 },
    { proxyCountry: "JP", targetCountry: "JP", node: "🇯🇵 OC JP1-anytls", bytes: 259 * MB, count: 128 },
    { proxyCountry: "US", targetCountry: "US", node: "🇺🇸 GCP US-anytls", bytes: 1.5 * GB, count: 210 },
  ];
  if (range === "realtime") return base.slice(0, 2);
  return [...base, { proxyCountry: "HK", targetCountry: "SG", node: "🇭🇰 HK 01", bytes: 120 * MB, count: 51 }, { proxyCountry: "DE", targetCountry: "NL", node: "🇩🇪 DE Frankfurt", bytes: 40 * MB, count: 9 }];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockInvoke<T>(cmd: string, args: any = {}): Promise<T> {
  await delay(60);
  const r = (x: unknown) => x as T;
  switch (cmd) {
    case "app_info":
      return r({ name: "ClashWin", version: "0.1.0", build: "1", isAdmin: false, os: "Windows 11", arch: "x86_64", dataDir: "C:\\Users\\me\\AppData\\Roaming\\ClashWin" });
    case "app_memory":
      return r(Math.floor(159.5 * MB + rnd(-3, 3) * MB));
    case "get_settings":
      return r(settings);
    case "save_settings":
      settings = deepMerge(settings, args.patch);
      emit("settings://changed", settings);
      return r(settings);
    case "reset_engine":
      settings = { ...settings, engine: { ...settings.engine, [args.section]: (DEFAULT_SETTINGS.engine as any)[args.section] } };
      emit("settings://changed", settings);
      return r(settings);
    case "set_system_proxy":
      settings = { ...settings, systemProxy: args.enable };
      emit("settings://changed", settings);
      return r(undefined);
    case "set_tun_mode":
      settings = { ...settings, tunMode: args.enable };
      emit("settings://changed", settings);
      return r(undefined);
    case "set_outbound_mode":
      settings = { ...settings, outboundMode: args.mode };
      emit("settings://changed", settings);
      return r(undefined);
    case "core_status":
      return r(core);
    case "core_start":
    case "core_restart":
      core = { ...core, state: "running", pid: 4243, startedAt: Date.now() };
      emit("core://status", core);
      return r(core);
    case "core_stop":
      core = { ...core, state: "stopped", pid: undefined };
      emit("core://status", core);
      return r(core);
    case "core_check_update":
      return r({ channel: args.channel, current: "v1.19.27", latest: "v1.19.28", hasUpdate: true, notes: "- Fix: DNS cache\n- New: smart group tweaks" });
    case "core_install":
      for (let i = 0; i <= 10; i++) {
        emit("core://download-progress", { stage: i < 10 ? "downloading" : "done", downloaded: i * 1.5e6, total: 15e6 });
        await delay(120);
      }
      return r(core);
    case "core_cached_versions":
      return r(["v1.19.27", "v1.19.26", "v1.19.24"]);
    case "core_log_tail":
      return r(["time=... level=info msg=\"Start initial configuration in progress\"", "time=... level=info msg=\"Mixed(http+socks) proxy listening at: 127.0.0.1:7890\""]);
    case "helper_status":
      return r({ installed: false, running: false, latestVersion: "1.0.0" });
    case "helper_install":
      return r({ installed: true, running: true, version: "1.0.0", latestVersion: "1.0.0" });
    case "helper_uninstall":
      return r({ installed: false, running: false, latestVersion: "1.0.0" });
    case "list_profiles":
      return r(profiles);
    case "import_profile_url": {
      const p: Profile = { id: "p" + Date.now(), name: args.name || new URL(args.url).hostname, type: "remote", url: args.url, file: "", updatedAt: Date.now(), autoUpdateMinutes: 1440 };
      profiles = [...profiles, p];
      emit("profiles://changed", profiles);
      return r(p);
    }
    case "import_profile_file":
    case "create_profile": {
      const p: Profile = { id: "p" + Date.now(), name: args.name || "Local", type: "local", file: "", updatedAt: Date.now() };
      profiles = [...profiles, p];
      emit("profiles://changed", profiles);
      return r(p);
    }
    case "update_profile": {
      await delay(700);
      profiles = profiles.map((p) => (p.id === args.id ? { ...p, updatedAt: Date.now() } : p));
      emit("profiles://changed", profiles);
      return r(profiles.find((p) => p.id === args.id));
    }
    case "update_all_profiles":
      await delay(900);
      profiles = profiles.map((p) => (p.type === "remote" ? { ...p, updatedAt: Date.now() } : p));
      emit("profiles://changed", profiles);
      return r(profiles);
    case "delete_profile":
      profiles = profiles.filter((p) => p.id !== args.id);
      emit("profiles://changed", profiles);
      return r(undefined);
    case "edit_profile_meta":
      profiles = profiles.map((p) => (p.id === args.id ? { ...p, ...args.patch } : p));
      emit("profiles://changed", profiles);
      return r(profiles.find((p) => p.id === args.id));
    case "set_active_profile":
      settings = { ...settings, activeProfileId: args.id };
      emit("settings://changed", settings);
      return r(undefined);
    case "read_profile":
      return r("mixed-port: 7890\nmode: rule\nproxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n");
    case "set_profile_providers":
      profiles = profiles.map((p) => (p.id === args.id ? { ...p, providers: args.providerIds } : p));
      emit("profiles://changed", profiles);
      return r(profiles.find((p) => p.id === args.id));
    case "external_resources":
      return r([
        { kind: "proxy", name: "Mini_en", vehicleType: "HTTP", count: 12, alive: 9, updatedAt: new Date(Date.now() - 3600e3).toISOString() },
        { kind: "rule", name: "Proxy", vehicleType: "HTTP", behavior: "domain", count: 4995, updatedAt: new Date(Date.now() - 86400e3).toISOString() },
        { kind: "rule", name: "China", vehicleType: "HTTP", behavior: "domain", count: 76510, updatedAt: new Date(Date.now() - 2 * 86400e3).toISOString() },
        { kind: "rule", name: "ProxyIP", vehicleType: "HTTP", behavior: "ipcidr", count: 2681, updatedAt: new Date(Date.now() - 4 * 86400e3).toISOString() },
      ]);
    case "get_rules":
      return r(mockRuleLines());
    case "set_rules":
      mockSetRuleLines(args.rules);
      return r(undefined);
    case "add_rule":
      mockSetRuleLines([args.rule, ...mockRuleLines()]);
      return r(undefined);
    case "reset_rules":
      mockSetRuleLines(null);
      return r(undefined);
    case "rule_targets":
      return r(["DIRECT", "REJECT", "REJECT-DROP", "OUTCN", "Auto", "Streaming", "CN", "MATCH", "AdBlock"]);
    case "stats_summary":
      return r({ download: 1.09 * GB, upload: 1.56 * GB, connections: 9509, destinations: 394 });
    case "stats_period":
      return r(statsPeriod(args.period));
    case "stats_routes":
      return r(routes(args.range));
    case "history_info":
      return r({ records: 18234, bytes: 6.2 * MB });
    case "wifi_ssid":
      return r("Home_Mesh");
    case "list_interfaces":
      return r(["以太网", "WLAN", "vEthernet (WSL)"]);
    case "node_countries":
      return r({});
    case "lan_address":
      return r("192.168.1.23");
    case "geo_db_status":
      return r({
        mode: "mmdb",
        files: [
          { name: "Country.mmdb", exists: true, size: 8.4 * MB, modified: Date.now() - 5 * 3600e3 },
          { name: "GeoSite.dat", exists: true, size: 4.1 * MB, modified: Date.now() - 5 * 3600e3 },
          { name: "GeoIP.dat", exists: false, size: 0 },
          { name: "GeoLite2-ASN.mmdb", exists: false, size: 0 },
        ],
      });
    case "geoip_lookup":
      return r((args.ips as string[]).map((ip) => (ip.startsWith("110.") ? "CN" : ip.startsWith("160.") ? "JP" : "US")));
    case "local_location":
      return r({ country: "CN", city: "Shanghai", lat: 31.23, lon: 121.47 });
    case "check_app_update":
      return r({ hasUpdate: false, latest: "0.1.0", url: "https://github.com" });
    case "process_icon":
      return r(null);
    case "install_cli":
      return r("C:\\Users\\me\\AppData\\Local\\ClashWin\\bin");
    case "open_dashboard":
    case "open_settings":
    case "hide_tray_panel":
    case "open_url":
    case "reveal_path":
    case "quit_app":
    case "restart_as_admin":
    case "core_reload":
    case "write_profile":
    case "open_profile_in_editor":
    case "update_external_resources":
    case "history_clear":
    case "core_rollback":
    case "write_text_file":
    case "set_tray_panel_size":
      if (cmd === "open_url") window.open(args.url, "_blank");
      return r(undefined);
    default:
      console.warn("[mock] unhandled command", cmd, args);
      return r(undefined);
  }
}

/* ===================== mihomo controller API types ===================== */

export interface DelayHistory {
  time: string;
  delay: number;
}

export interface ProxyItem {
  name: string;
  type: string; // Selector | URLTest | Fallback | LoadBalance | Relay | Smart | Direct | Reject | RejectDrop | Pass | Compatible | Shadowsocks | Vmess | Vless | Trojan | Hysteria2 | Tuic | AnyTLS | WireGuard ...
  udp?: boolean;
  xudp?: boolean;
  tfo?: boolean;
  alive?: boolean;
  history: DelayHistory[];
  extra?: Record<string, { alive?: boolean; history: DelayHistory[] }>;
  now?: string; // groups: currently selected member
  all?: string[]; // groups: members
  hidden?: boolean;
  icon?: string;
  testUrl?: string;
  fixed?: string;
  "provider-name"?: string;
}

export interface ProxyProvider {
  name: string;
  type: "Proxy";
  vehicleType: "HTTP" | "File" | "Compatible" | "Inline" | string;
  proxies: ProxyItem[];
  testUrl?: string;
  updatedAt?: string;
  subscriptionInfo?: { Upload: number; Download: number; Total: number; Expire: number };
}

export interface RuleItem {
  index?: number;
  type: string; // DOMAIN-SUFFIX, IP-CIDR, RuleSet, GeoSite, Match, ProcessName, AND ...
  payload: string;
  proxy: string;
  size: number; // -1 for non rule-set rules
  extra?: {
    disabled: boolean;
    hitCount: number;
    hitAt: string;
    missCount: number;
    missAt: string;
  };
}

export interface RuleProvider {
  name: string;
  type: "Rule";
  vehicleType: string;
  behavior: "domain" | "ipcidr" | "classical" | string;
  format: string;
  ruleCount: number;
  updatedAt: string;
}

export interface ConnMetadata {
  network: "tcp" | "udp" | string;
  type: string; // HTTP | HTTPS | Socks5 | Tun | Mixed ...
  sourceIP: string;
  destinationIP: string;
  sourcePort: string;
  destinationPort: string;
  inboundIP?: string;
  inboundPort?: string;
  inboundName?: string;
  inboundUser?: string;
  host: string;
  dnsMode: string;
  uid?: number;
  process: string;
  processPath: string;
  specialProxy?: string;
  specialRules?: string;
  remoteDestination?: string;
  dscp?: number;
  sniffHost?: string;
}

export interface Connection {
  id: string;
  metadata: ConnMetadata;
  upload: number;
  download: number;
  start: string; // ISO time
  chains: string[]; // [finalNode, ..., firstGroup]
  rule: string;
  rulePayload: string;
  providerChains?: string[];
}

export interface ConnectionsSnapshot {
  downloadTotal: number;
  uploadTotal: number;
  connections: Connection[] | null;
  memory?: number;
}

/** Connection plus per-second speed derived on the client. */
export interface ConnectionView extends Connection {
  upSpeed: number;
  downSpeed: number;
  closedAt?: number; // ms epoch, set for closed connections
}

export interface Traffic {
  up: number;
  down: number;
}

export interface Memory {
  inuse: number;
  oslimit: number;
}

export type LogLevel = "debug" | "info" | "warning" | "error" | "silent";

export interface LogEntry {
  type: LogLevel;
  payload: string;
}

export interface LogRow extends LogEntry {
  id: number;
  time: number; // ms epoch
}

export type OutboundMode = "rule" | "global" | "direct";

export interface MihomoConfigs {
  port: number;
  "socks-port": number;
  "redir-port": number;
  "tproxy-port": number;
  "mixed-port": number;
  "allow-lan": boolean;
  "bind-address": string;
  mode: OutboundMode;
  "log-level": LogLevel;
  ipv6: boolean;
  tun?: { enable: boolean; stack: string; device?: string; "auto-route"?: boolean };
  [k: string]: unknown;
}

/* ===================== ClashWin backend (Tauri) types ===================== */

export type CoreState = "running" | "stopped" | "starting" | "not_installed" | "downloading" | "error";

export interface CoreStatus {
  state: CoreState;
  version?: string;
  pid?: number;
  startedAt?: number; // ms epoch
  controller: { url: string; secret: string }; // e.g. http://127.0.0.1:9097
  error?: string;
}

export interface AppInfo {
  name: string;
  version: string;
  build: string;
  isAdmin: boolean;
  os: string;
  arch: string;
  dataDir: string;
}

export interface SubscriptionInfo {
  upload: number;
  download: number;
  total: number;
  expire: number; // unix seconds, 0 = never
}

export interface Profile {
  id: string;
  name: string;
  type: "local" | "remote";
  url?: string;
  file: string; // absolute path of the YAML file
  updatedAt: number; // ms epoch
  autoUpdateMinutes?: number; // remote only, 0 = off
  subscription?: SubscriptionInfo;
  providers?: string[]; // ids of other remote profiles mounted as proxy-providers
  hasRuleOverride?: boolean;
}

export interface ExternalResource {
  kind: "proxy" | "rule";
  name: string;
  vehicleType: string;
  behavior?: string;
  count: number; // nodes or rules
  alive?: number; // proxy providers: alive nodes
  updatedAt?: string;
}

export interface StatsSummary {
  download: number;
  upload: number;
  connections: number;
  destinations: number;
}

export interface Rank {
  name: string;
  value: number; // bytes, or hit count for rules
  count?: number;
}

export interface StatsPeriod {
  period: "today" | "month";
  total: number;
  prevTotal: number; // same span of the previous period
  split: { direct: number; proxy: number; reject: number };
  timeline: { label: string; value: number }[]; // 24 hourly buckets or per-day buckets
  topRules: Rank[]; // value = connection count
  topDomains: Rank[];
  topNodes: Rank[];
  topPolicies: Rank[];
  topProcesses: Rank[];
  topCountries: Rank[];
}

export interface RouteAgg {
  proxyCountry: string; // ISO-3166 alpha-2 (or "" when unknown)
  targetCountry?: string;
  node?: string;
  bytes: number;
  count: number;
}

export interface HistoryInfo {
  records: number;
  bytes: number;
}

export interface DownloadProgress {
  stage: "checking" | "downloading" | "extracting" | "done" | "error";
  downloaded: number;
  total: number;
  message?: string;
}

export interface CoreUpdateInfo {
  channel: CoreChannel;
  current?: string;
  latest: string;
  hasUpdate: boolean;
  notes?: string;
}

export type CoreChannel = "stable" | "alpha" | "smart";

export interface AppRelease {
  version: string; // "0.2.0"
  name: string;
  notes: string; // markdown
  publishedAt?: string; // ISO time
  prerelease: boolean;
  url: string;
  size: number; // installer bytes, 0 = no installer for this CPU
}

export interface AppUpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  url: string;
  notes?: string;
  publishedAt?: string;
  size: number;
  releases: AppRelease[]; // newest first
}

export interface DownloadSource {
  url: string; // mirror prefix, "" = direct
  kind: "direct" | "preset" | "custom";
}

export interface SourceProbe {
  url: string;
  latencyMs?: number;
  error?: string; // "timeout" | "dns" | "unreachable" | "HTTP 404" ...
}

export interface HelperStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  latestVersion?: string;
}

/* ===================== Settings ===================== */

export interface EngineGeneral {
  logLevel: LogLevel;
  tcpConcurrent: boolean;
  unifiedDelay: boolean;
  interfaceName: string; // "" = auto
  findProcessMode: "always" | "strict" | "off";
  geodataMode: boolean; // true = dat (geosite/geoip.dat), false = mmdb
  geodataLoader: "memconservative" | "standard";
  geoAutoUpdate: boolean;
  geoUpdateInterval: number; // hours
  geoxUrl: { geoip: string; geosite: string; mmdb: string; asn: string };
  smartModel: "standard" | "middle" | "large"; // smart core only
  storeSelected: boolean;
  storeFakeIp: boolean;
  quicGsoDisable: boolean;
  dialerIp4pConvert: boolean;
  keepAliveInterval: number;
}

export interface EngineNetwork {
  mixedPort: number;
  httpPort: number;
  socksPort: number;
  ipv6: boolean;
  tcpFastOpen: boolean;
  mptcp: boolean;
  quicBlock: "off" | "all" | "overseas";
  allowLan: boolean;
  bindAddress: string;
  lanAllowedIps: string[];
  lanDisallowedIps: string[];
  authentication: string[]; // "user:pass"
  skipAuthPrefixes: string[];
  bypass: string[]; // system proxy bypass list
}

export interface EngineDns {
  enable: boolean;
  listen: string;
  enhancedMode: "fake-ip" | "redir-host" | "normal";
  fakeIpRange: string;
  fakeIpFilter: string[];
  defaultNameserver: string[];
  nameserver: string[];
  fallback: string[];
  fallbackFilter: { geoip: boolean; geoipCode: string; ipcidr: string[]; domain: string[] };
  nameserverPolicy: { key: string; value: string }[];
  proxyServerNameserver: string[];
  directNameserver: string[];
  useHosts: boolean;
  useSystemHosts: boolean;
  respectRules: boolean;
  preferH3: boolean;
  ipv6: boolean;
  cacheAlgorithm: "lru" | "arc";
}

export interface EngineTun {
  stack: "mixed" | "gvisor" | "system";
  device: string;
  autoRoute: boolean;
  strictRoute: boolean;
  autoDetectInterface: boolean;
  dnsHijack: string[];
  mtu: number;
  endpointIndependentNat: boolean;
  excludeInterface: string[];
  excludePorts: string[]; // route-exclude ports (as "22", "3389")
  routeIncludeAddress: string[];
  routeExcludeAddress: string[];
}

export interface SnifferProto {
  enable: boolean;
  ports: string; // "80, 8080-8880"
  override: boolean;
}

export interface EngineSniffer {
  enable: boolean;
  overrideDestination: boolean;
  forceDnsMapping: boolean;
  parsePureIp: boolean;
  http: SnifferProto;
  tls: SnifferProto;
  quic: SnifferProto;
  skipDomain: string[];
  forceDomain: string[];
  skipSrcAddress: string[];
  skipDstAddress: string[];
}

export interface EngineSettings {
  general: EngineGeneral;
  network: EngineNetwork;
  dns: EngineDns;
  tun: EngineTun;
  sniffer: EngineSniffer;
}

export interface AppSettings {
  language: "system" | "zh" | "en";
  theme: "system" | "light" | "dark";
  trayMode: "icon_speed" | "icon" | "speed";
  /** Tray menu size in percent; 0 = fit the screen automatically */
  trayScale: number;
  launchAtLogin: boolean;
  silentStart: boolean;
  menuCards: {
    browserRule: boolean;
    trafficWave: boolean;
    perfGrid: boolean;
    subscription: boolean;
    copyShell: boolean;
  };
  shellExportStyle: "powershell" | "cmd" | "bash";
  wifiBypass: { enabled: boolean; ssids: string[] };
  controller: { host: string; port: number; secret: string };
  coreChannel: CoreChannel;
  autoCheckUpdate: boolean;
  includeBeta: boolean;
  /** GitHub downloads: "auto" (fastest working source), "direct", or a mirror prefix */
  downloadMirror: string;
  customMirrors: string[];
  historyRetentionDays: 30 | 60 | 90 | 0; // 0 = forever
  systemProxy: boolean;
  tunMode: boolean;
  outboundMode: OutboundMode;
  activeProfileId: string | null;
  policy: {
    hideTimeoutNodes: boolean;
    showHiddenGroups: boolean;
    autoCloseOnSwitch: boolean;
    collapsed: Record<string, boolean>;
  };
  delayTestUrl: string;
  delayTimeout: number;
  sidebarCollapsed: boolean;
  engine: EngineSettings;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] };

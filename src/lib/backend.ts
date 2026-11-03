/**
 * Typed bridge to the Rust backend (Tauri commands + events).
 *
 * This file is the contract between frontend and backend: every function maps
 * 1:1 to a `#[tauri::command]` with the same snake_case name in src-tauri.
 * JS args are camelCase; Tauri maps them to snake_case Rust params.
 *
 * When running in a plain browser (vite dev without Tauri) calls are served by
 * the mock backend so the UI can be developed and previewed.
 */
import type {
  AppInfo,
  AppSettings,
  CoreChannel,
  CoreStatus,
  CoreUpdateInfo,
  DeepPartial,
  DownloadProgress,
  ExternalResource,
  HelperStatus,
  HistoryInfo,
  OutboundMode,
  Profile,
  RouteAgg,
  StatsPeriod,
  StatsSummary,
} from "./types";
import { mockInvoke, mockListen } from "./mock/backend";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return mockInvoke<T>(cmd, args);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Error thrown by backend commands. `code` is a stable machine-readable string. */
export interface BackendError {
  code: string; // e.g. "NEED_ADMIN", "CORE_NOT_RUNNING", "DOWNLOAD_FAILED", "INVALID_CONFIG", "IO", "NETWORK"
  message: string;
}
export function errorMessage(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (typeof e === "object" && "message" in (e as any)) return String((e as any).message);
  return String(e);
}
export function errorCode(e: unknown): string | undefined {
  return typeof e === "object" && e && "code" in (e as any) ? String((e as any).code) : undefined;
}

/* ---------------- Events (backend → all windows) ---------------- */
export type BackendEvent =
  | "core://status" // CoreStatus
  | "core://download-progress" // DownloadProgress
  | "settings://changed" // AppSettings
  | "profiles://changed" // Profile[]
  | "app://navigate" // { page: string } - dashboard should navigate
  | "app://notify"; // { kind: "info"|"success"|"warning"|"error", message: string }

export async function listen<T>(event: BackendEvent, cb: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return mockListen<T>(event, cb);
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => cb(e.payload));
}

/* ---------------- App ---------------- */
export const backend = {
  appInfo: () => call<AppInfo>("app_info"),
  /** Physical memory of the app itself (incl. webview processes), bytes */
  appMemory: () => call<number>("app_memory"),
  quit: () => call<void>("quit_app"),
  restartAsAdmin: () => call<void>("restart_as_admin"),
  /** Show (and focus) the dashboard window, optionally navigating to a route like "/policy" */
  openDashboard: (page?: string) => call<void>("open_dashboard", { page }),
  /** Show the settings window on a tab: "general" | "permissions" | "advanced" | "about" */
  openSettings: (tab?: string) => call<void>("open_settings", { tab }),
  hideTrayPanel: () => call<void>("hide_tray_panel"),
  openUrl: (url: string) => call<void>("open_url", { url }),
  /** Reveal a file or folder in Explorer */
  revealPath: (path: string) => call<void>("reveal_path", { path }),
  /** Exe icon as data URL (PNG), cached by backend. null if not found */
  processIcon: (path: string) => call<string | null>("process_icon", { path }),
  /** Current Wi-Fi SSID, null when not on Wi-Fi */
  wifiSsid: () => call<string | null>("wifi_ssid"),
  /** Network interface names for the "Interface Name" picker */
  listInterfaces: () => call<string[]>("list_interfaces"),
  /** ISO country code per IP (GeoIP mmdb), null when unknown */
  geoipLookup: (ips: string[]) => call<(string | null)[]>("geoip_lookup", { ips }),
  /** Node name → ISO country for nodes placed by their server IP (names without a country hint) */
  nodeCountries: () => call<Record<string, string>>("node_countries"),
  /** Approximate local country/city for the map origin */
  localLocation: () => call<{ country: string; city: string; lat: number; lon: number }>("local_location"),
  checkAppUpdate: () => call<{ hasUpdate: boolean; latest: string; url: string; notes?: string }>("check_app_update"),
  /** Adds the `clashwin` CLI to the user's PATH */
  installCli: () => call<string>("install_cli"),
  /** Primary IPv4 LAN address, null when unavailable */
  lanAddress: () => call<string | null>("lan_address"),
  /** GeoIP/GeoSite database files in the core home dir */
  geoDbStatus: () =>
    call<{ mode: "mmdb" | "dat"; files: { name: string; exists: boolean; size: number; modified?: number }[] }>("geo_db_status"),
  /** Write a UTF-8 text file (used after a save dialog, e.g. exporting logs) */
  writeTextFile: (path: string, content: string) => call<void>("write_text_file", { path, content }),
  /** Tray popup reports its content size so the backend can resize/reposition the window */
  setTrayPanelSize: (width: number, height: number) => call<void>("set_tray_panel_size", { width, height }),

  /* ---------------- Settings ---------------- */
  getSettings: () => call<AppSettings>("get_settings"),
  /** Deep-merge patch; returns full settings. Emits settings://changed. Side effects
   * (autostart, controller, engine changes → runtime config regeneration + reload) are applied by the backend. */
  saveSettings: (patch: DeepPartial<AppSettings>) => call<AppSettings>("save_settings", { patch }),
  /** Reset engine settings section ("general"|"network"|"dns"|"tun"|"sniffer") to defaults */
  resetEngine: (section: keyof AppSettings["engine"]) => call<AppSettings>("reset_engine", { section }),

  /* ---------------- Proxy switches ---------------- */
  setSystemProxy: (enable: boolean) => call<void>("set_system_proxy", { enable }),
  /** Errors with code NEED_ADMIN when not elevated and no helper is installed */
  setTunMode: (enable: boolean) => call<void>("set_tun_mode", { enable }),
  setOutboundMode: (mode: OutboundMode) => call<void>("set_outbound_mode", { mode }),

  /* ---------------- Core (mihomo) ---------------- */
  coreStatus: () => call<CoreStatus>("core_status"),
  coreStart: () => call<CoreStatus>("core_start"),
  coreStop: () => call<CoreStatus>("core_stop"),
  coreRestart: () => call<CoreStatus>("core_restart"),
  /** Regenerate runtime config from active profile + engine settings and hot reload */
  coreReload: () => call<void>("core_reload"),
  coreCheckUpdate: (channel: CoreChannel) => call<CoreUpdateInfo>("core_check_update", { channel }),
  /** Download + install core for channel; progress via core://download-progress; restarts core */
  coreInstall: (channel: CoreChannel) => call<CoreStatus>("core_install", { channel }),
  coreCachedVersions: () => call<string[]>("core_cached_versions"),
  coreRollback: (version: string) => call<CoreStatus>("core_rollback", { version }),
  /** Last N lines of the core's own stdout/stderr */
  coreLogTail: (lines: number) => call<string[]>("core_log_tail", { lines }),

  /* ---------------- Helper (elevated service for TUN without UAC) ---------------- */
  helperStatus: () => call<HelperStatus>("helper_status"),
  helperInstall: () => call<HelperStatus>("helper_install"),
  helperUninstall: () => call<HelperStatus>("helper_uninstall"),

  /* ---------------- Profiles ---------------- */
  listProfiles: () => call<Profile[]>("list_profiles"),
  importProfileUrl: (url: string, name?: string) => call<Profile>("import_profile_url", { url, name }),
  importProfileFile: (path: string, name?: string) => call<Profile>("import_profile_file", { path, name }),
  createProfile: (name: string, content?: string) => call<Profile>("create_profile", { name, content }),
  updateProfile: (id: string) => call<Profile>("update_profile", { id }),
  updateAllProfiles: () => call<Profile[]>("update_all_profiles"),
  deleteProfile: (id: string) => call<void>("delete_profile", { id }),
  editProfileMeta: (id: string, patch: { name?: string; url?: string; autoUpdateMinutes?: number }) =>
    call<Profile>("edit_profile_meta", { id, patch }),
  /** Activate profile: regenerate runtime config and reload core */
  setActiveProfile: (id: string) => call<void>("set_active_profile", { id }),
  readProfile: (id: string) => call<string>("read_profile", { id }),
  /** Validates (mihomo -t) before writing; errors with INVALID_CONFIG */
  writeProfile: (id: string, content: string) => call<void>("write_profile", { id, content }),
  /** Opens the YAML in the system text editor; backend watches the file and reloads on save */
  openProfileInEditor: (id: string) => call<void>("open_profile_in_editor", { id }),
  /** Mount other remote profiles as proxy-providers into this profile */
  setProfileProviders: (id: string, providerIds: string[]) => call<Profile>("set_profile_providers", { id, providerIds }),
  /** External rule/proxy providers referenced by the active runtime config */
  externalResources: () => call<ExternalResource[]>("external_resources"),
  updateExternalResources: () => call<void>("update_external_resources"),

  /* ---------------- Rules editing (active profile) ---------------- */
  /** Raw rule lines ("DOMAIN-SUFFIX,google.com,Proxy") of the active profile (override if present) */
  getRules: () => call<string[]>("get_rules"),
  /** Replace the rule list (stored as an override for the active profile) and reload */
  setRules: (rules: string[]) => call<void>("set_rules", { rules }),
  /** Prepend one rule (index 0) and reload */
  addRule: (rule: string) => call<void>("add_rule", { rule }),
  resetRules: () => call<void>("reset_rules"),
  /** Policy names usable as rule targets (groups + DIRECT/REJECT...) */
  ruleTargets: () => call<string[]>("rule_targets"),

  /* ---------------- Stats / history ---------------- */
  statsSummary: () => call<StatsSummary>("stats_summary"),
  statsPeriod: (period: "today" | "month") => call<StatsPeriod>("stats_period", { period }),
  statsRoutes: (range: "realtime" | "day" | "week" | "month") => call<RouteAgg[]>("stats_routes", { range }),
  historyInfo: () => call<HistoryInfo>("history_info"),
  historyClear: () => call<void>("history_clear"),
};

export type Backend = typeof backend;

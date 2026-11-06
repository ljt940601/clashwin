/**
 * App-wide state shared by every window (dashboard, tray panel, settings).
 * Backend events keep windows in sync.
 */
import { create } from "zustand";
import { backend, errorCode, errorMessage, listen } from "./backend";
import { setController } from "./mihomo";
import { useLang, systemLang } from "@/i18n";
import type { AppInfo, AppSettings, CoreStatus, DeepPartial, OutboundMode, Profile } from "./types";
import { confirm, toast } from "@/components/ui";
import { t } from "@/i18n";

interface AppState {
  ready: boolean;
  settings: AppSettings | null;
  core: CoreStatus;
  info: AppInfo | null;
  profiles: Profile[];
  busy: Record<string, boolean>;

  init: () => Promise<void>;
  saveSettings: (patch: DeepPartial<AppSettings>) => Promise<void>;
  refreshCore: () => Promise<void>;
  refreshProfiles: () => Promise<void>;

  /** UI actions with confirmation/toasts handled here so every surface behaves the same */
  toggleSystemProxy: (enable: boolean, opts?: { confirm?: boolean }) => Promise<void>;
  toggleTun: (enable: boolean, opts?: { confirm?: boolean }) => Promise<void>;
  setMode: (mode: OutboundMode) => Promise<void>;
  switchProfile: (id: string, opts?: { confirm?: boolean }) => Promise<void>;
  reloadConfig: (opts?: { confirm?: boolean }) => Promise<void>;
  startCore: () => Promise<void>;
  stopCore: (opts?: { confirm?: boolean }) => Promise<void>;
  restartCore: () => Promise<void>;
}

const emptyCore: CoreStatus = { state: "stopped", controller: { url: "http://127.0.0.1:9097", secret: "" } };

function applyTheme(theme: AppSettings["theme"]) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "dark" : "light";
  const root = document.documentElement;
  if (themeApplied && root.dataset.theme !== next) {
    // cross-fade colours instead of snapping (class removed once the fade is done)
    root.classList.add("theme-anim");
    window.clearTimeout(themeTimer);
    themeTimer = window.setTimeout(() => root.classList.remove("theme-anim"), 400);
  }
  root.dataset.theme = next;
  root.style.background = ""; // set by index.html for the first paint
  themeApplied = true;
  try {
    localStorage.setItem("clashwin.theme", next); // read by index.html on the next launch
  } catch {
    /* storage unavailable */
  }
}
let themeApplied = false;
let themeTimer: number | undefined;

function applyLanguage(language: AppSettings["language"]) {
  useLang.getState().setLang(language === "system" ? systemLang() : language);
}

function applySettings(s: AppSettings) {
  applyTheme(s.theme);
  applyLanguage(s.language);
}

async function withBusy(key: string, fn: () => Promise<void>) {
  const set = useApp.setState;
  set((s) => ({ busy: { ...s.busy, [key]: true } }));
  try {
    await fn();
  } finally {
    set((s) => ({ busy: { ...s.busy, [key]: false } }));
  }
}

/** Deep-merge a settings patch (arrays are replaced, like the backend does). */
function mergePatch<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (Array.isArray(patch) || typeof patch !== "object" || patch === null) return patch as T;
  const out: any = { ...(base as any) };
  for (const [k, v] of Object.entries(patch)) out[k] = mergePatch((base as any)?.[k], v);
  return out;
}
let saveSeq = 0;
let pendingSaves = 0;

async function handleNeedAdmin(e: unknown): Promise<boolean> {
  if (errorCode(e) !== "NEED_ADMIN") return false;
  const ok = await confirm({ title: t("common.needAdmin"), message: t("common.needAdminDesc"), confirmText: t("common.restartAsAdmin") });
  if (ok) await backend.restartAsAdmin();
  return true;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: null,
  core: emptyCore,
  info: null,
  profiles: [],
  busy: {},

  init: async () => {
    const [settings, core, info, profiles] = await Promise.all([
      backend.getSettings(),
      backend.coreStatus(),
      backend.appInfo(),
      backend.listProfiles(),
    ]);
    setController(core.controller.url, core.controller.secret);
    applySettings(settings);
    set({ settings, core, info, profiles, ready: true });

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      const s = get().settings;
      if (s) applyTheme(s.theme);
    });
    listen<AppSettings>("settings://changed", (s) => {
      // our own saves in flight: their responses carry the newest settings
      if (pendingSaves > 0) return;
      applySettings(s);
      set({ settings: s });
    });
    listen<CoreStatus>("core://status", (c) => {
      setController(c.controller.url, c.controller.secret);
      set({ core: c });
    });
    listen<Profile[]>("profiles://changed", (profiles) => set({ profiles }));
    listen<{ kind: "info" | "success" | "warning" | "error"; message: string }>("app://notify", (n) => toast[n.kind](n.message));
  },

  saveSettings: async (patch) => {
    // Show the change right away so quick successive edits (e.g. pressing Enter to add
    // several list items) build on each other instead of on a stale copy.
    const cur = get().settings;
    if (cur) {
      const next = mergePatch(cur, patch);
      applySettings(next);
      set({ settings: next });
    }
    const seq = ++saveSeq;
    pendingSaves++;
    try {
      const s = await backend.saveSettings(patch);
      if (seq === saveSeq) {
        applySettings(s);
        set({ settings: s });
      }
    } catch (e) {
      toast.error(errorMessage(e));
      // fall back to what the backend actually stored
      backend
        .getSettings()
        .then((s) => {
          if (seq === saveSeq) {
            applySettings(s);
            set({ settings: s });
          }
        })
        .catch(() => {});
    } finally {
      pendingSaves--;
    }
  },

  refreshCore: async () => {
    const c = await backend.coreStatus();
    setController(c.controller.url, c.controller.secret);
    set({ core: c });
  },

  refreshProfiles: async () => set({ profiles: await backend.listProfiles() }),

  toggleSystemProxy: async (enable, opts) => {
    if (opts?.confirm && !(await confirm({ title: t(enable ? "common.sysProxyOnConfirm" : "common.sysProxyOffConfirm") }))) return;
    await withBusy("sysproxy", async () => {
      try {
        await backend.setSystemProxy(enable);
        const s = get().settings;
        if (s) set({ settings: { ...s, systemProxy: enable } });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    });
  },

  toggleTun: async (enable, opts) => {
    if (opts?.confirm && !(await confirm({ title: t(enable ? "common.tunOnConfirm" : "common.tunOffConfirm") }))) return;
    await withBusy("tun", async () => {
      try {
        await backend.setTunMode(enable);
        const s = get().settings;
        if (s) set({ settings: { ...s, tunMode: enable } });
      } catch (e) {
        if (!(await handleNeedAdmin(e))) toast.error(errorMessage(e));
      }
    });
  },

  setMode: async (mode) => {
    const s = get().settings;
    if (s) set({ settings: { ...s, outboundMode: mode } });
    try {
      await backend.setOutboundMode(mode);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },

  switchProfile: async (id, opts) => {
    const p = get().profiles.find((x) => x.id === id);
    if (opts?.confirm && !(await confirm({ title: t("common.switchProfile"), message: t("common.switchProfileConfirm", { name: p?.name ?? id }) }))) return;
    await withBusy("profile", async () => {
      try {
        await backend.setActiveProfile(id);
        const s = get().settings;
        if (s) set({ settings: { ...s, activeProfileId: id } });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    });
  },

  reloadConfig: async (opts) => {
    if (opts?.confirm && !(await confirm({ title: t("common.reloadConfig"), message: t("common.reloadConfirm") }))) return;
    await withBusy("reload", async () => {
      try {
        await backend.coreReload();
        toast.success(t("common.reloadConfig"));
      } catch (e) {
        toast.error(errorMessage(e));
      }
    });
  },

  startCore: async () =>
    withBusy("core", async () => {
      try {
        set({ core: await backend.coreStart() });
      } catch (e) {
        if (!(await handleNeedAdmin(e))) toast.error(errorMessage(e));
      }
    }),

  stopCore: async (opts) => {
    if (opts?.confirm && !(await confirm({ title: t("common.stopCore"), message: t("common.stopCoreConfirm"), danger: true }))) return;
    await withBusy("core", async () => {
      try {
        set({ core: await backend.coreStop() });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    });
  },

  restartCore: async () =>
    withBusy("core", async () => {
      try {
        set({ core: await backend.coreRestart() });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }),
}));

/** Convenience selectors */
export const useSettings = () => useApp((s) => s.settings);
export const useCore = () => useApp((s) => s.core);
export const useCoreRunning = () => useApp((s) => s.core.state === "running");
export const useActiveProfile = () =>
  useApp((s) => s.profiles.find((p) => p.id === s.settings?.activeProfileId) ?? null);

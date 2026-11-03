import { create } from "zustand";
import common from "./modules/common";
import nav from "./modules/nav";
import overview from "./modules/overview";
import requests from "./modules/requests";
import policy from "./modules/policy";
import rules from "./modules/rules";
import profiles from "./modules/profiles";
import logs from "./modules/logs";
import engine from "./modules/engine";
import map from "./modules/map";
import tray from "./modules/tray";
import settings from "./modules/settings";

export type Lang = "zh" | "en";
type Dict = Record<string, string>;
export interface ModuleDict {
  zh: Dict;
  en: Dict;
}

// Each module owns a namespace: keys are looked up as "<namespace>.<key>".
const modules: Record<string, ModuleDict> = {
  common,
  nav,
  overview,
  requests,
  policy,
  rules,
  profiles,
  logs,
  engine,
  map,
  tray,
  settings,
};

const flat: Record<Lang, Dict> = { zh: {}, en: {} };
for (const [ns, m] of Object.entries(modules)) {
  for (const lang of ["zh", "en"] as Lang[]) {
    for (const [k, v] of Object.entries(m[lang] ?? {})) flat[lang][`${ns}.${k}`] = v;
  }
}

export function systemLang(): Lang {
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: systemLang(),
  setLang: (lang) => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    set({ lang });
  },
}));

/** Translate a key like "overview.download". `{name}` placeholders are filled from vars. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = useLang.getState().lang;
  let s = flat[lang][key] ?? flat.en[key] ?? flat.zh[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Hook form: re-renders the component when the language changes. */
export function useT() {
  useLang((s) => s.lang);
  return t;
}

import React from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { CircleArrowUp, Info, Lock, Settings as Gear, SlidersHorizontal } from "lucide-react";
import "./settings.css";
import { useT } from "@/i18n";
import { listen } from "@/lib/backend";
import { cx } from "@/components/ui";
import { WindowControls } from "@/components/layout/WindowControls";
import GeneralTab from "./GeneralTab";
import PermissionsTab from "./PermissionsTab";
import AdvancedTab from "./AdvancedTab";
import UpdatesTab from "./UpdatesTab";
import AboutTab from "./AboutTab";

const TABS = [
  { id: "general", key: "settings.tabGeneral", icon: Gear },
  { id: "permissions", key: "settings.tabPermissions", icon: Lock },
  { id: "advanced", key: "settings.tabAdvanced", icon: SlidersHorizontal },
  { id: "updates", key: "settings.tabUpdates", icon: CircleArrowUp },
  { id: "about", key: "settings.tabAbout", icon: Info },
] as const;

/** Preferences window (index.html#/settings/<tab>). */
export default function SettingsApp() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const current = TABS.find((x) => location.pathname === `/settings/${x.id}`) ?? TABS[0];

  // The backend can ask this window to show a tab: "/settings/about" or just "about".
  React.useEffect(() => {
    let un: (() => void) | undefined;
    listen<{ page: string }>("app://navigate", ({ page }) => {
      if (!page) return;
      if (page.startsWith("/settings/")) navigate(page);
      else if (TABS.some((x) => x.id === page)) navigate(`/settings/${page}`);
    }).then((f) => (un = f));
    return () => un?.();
  }, [navigate]);

  React.useEffect(() => {
    document.title = `${t(current.key)} · ClashWin`;
  }, [current, t]);

  return (
    <div className="st-window">
      <header className="st-header" data-tauri-drag-region>
        <div className="st-titlebar" data-tauri-drag-region>
          <div className="st-title">{t(current.key)}</div>
          <WindowControls maximize={false} />
        </div>
        <nav className="st-tabs" data-tauri-drag-region>
          {TABS.map((x) => (
            <button key={x.id} className={cx("st-tab", x.id === current.id && "active")} onClick={() => navigate(`/settings/${x.id}`)}>
              <x.icon size={20} strokeWidth={1.8} />
              <span>{t(x.key)}</span>
            </button>
          ))}
        </nav>
      </header>
      <div className="st-body">
        <div className="st-content" key={current.id}>
          <Routes>
            <Route path="/settings/general" element={<GeneralTab />} />
            <Route path="/settings/permissions" element={<PermissionsTab />} />
            <Route path="/settings/advanced" element={<AdvancedTab />} />
            <Route path="/settings/updates" element={<UpdatesTab />} />
            <Route path="/settings/about" element={<AboutTab />} />
            <Route path="*" element={<Navigate to="/settings/general" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

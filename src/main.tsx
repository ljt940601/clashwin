import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import flagFontUrl from "country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url";
import "./styles/base.css";
import "./components/layout/layout.css";
import "./styles/motion.css";
import logo from "./assets/logo.svg";
import { DialogHost, MenuHost, ToastHost } from "./components/ui";
import { Sidebar } from "./components/layout/Sidebar";
import { useApp } from "./lib/store";
import { startLive } from "./lib/live";
import { listen } from "./lib/backend";

import OverviewPage from "./pages/overview/OverviewPage";
import RequestsPage from "./pages/requests/RequestsPage";
import PolicyPage from "./pages/policy/PolicyPage";
import RulesPage from "./pages/rules/RulesPage";
import ProfilesPage from "./pages/profiles/ProfilesPage";
import LogsPage from "./pages/logs/LogsPage";
import GeneralPage from "./pages/engine/GeneralPage";
import NetworkPage from "./pages/engine/NetworkPage";
import DnsPage from "./pages/engine/DnsPage";
import TunPage from "./pages/engine/TunPage";
import SnifferPage from "./pages/engine/SnifferPage";
import MapPage from "./pages/map/MapPage";
import TrayPanel from "./tray/TrayPanel";
import SettingsApp from "./settings/SettingsApp";

// Windows has no colour flag emoji glyphs; use the Twemoji flag font for them.
polyfillCountryFlagEmojis("Twemoji Country Flags", flagFontUrl);

// Which window are we? Tauri windows load index.html#/tray, #/settings/..., or the dashboard.
const hash = window.location.hash.replace(/^#/, "");
const windowKind = hash.startsWith("/tray") ? "tray" : hash.startsWith("/settings") ? "settings" : "dashboard";

function Hosts() {
  return (
    <>
      <MenuHost />
      <DialogHost />
      <ToastHost />
    </>
  );
}

function NavigateListener() {
  const navigate = useNavigate();
  React.useEffect(() => {
    let un: (() => void) | undefined;
    // Events sent to the settings window reach every window's listener too; skip its pages.
    listen<{ page: string }>("app://navigate", ({ page }) => page && !page.startsWith("/settings") && navigate(page)).then(
      (f) => (un = f),
    );
    return () => un?.();
  }, [navigate]);
  return null;
}

function Dashboard() {
  // the first appearance gets a fuller entrance than later page changes
  const [entering, setEntering] = React.useState(true);
  React.useEffect(() => {
    const id = window.setTimeout(() => setEntering(false), 700);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className={entering ? "app-shell enter" : "app-shell"}>
      <NavigateListener />
      <Sidebar />
      <Routes>
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/policy" element={<PolicyPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/engine/general" element={<GeneralPage />} />
        <Route path="/engine/network" element={<NetworkPage />} />
        <Route path="/engine/dns" element={<DnsPage />} />
        <Route path="/engine/tun" element={<TunPage />} />
        <Route path="/engine/sniffer" element={<SnifferPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </div>
  );
}

function Root() {
  const ready = useApp((s) => s.ready);
  React.useEffect(() => {
    if (windowKind === "tray") document.body.classList.add("tray-body");
    useApp
      .getState()
      .init()
      .then(() => {
        if (windowKind !== "settings") startLive({ logs: windowKind === "dashboard" });
      });
    // Block the browser context menu except in inputs.
    const onCtx = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("input, textarea, .selectable")) e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);
  // Tray popup: nothing until ready (it's hidden anyway). Other windows: a logo that only
  // fades in if loading takes a moment.
  if (!ready)
    return windowKind === "tray" ? null : (
      <div className="boot">
        <img src={logo} alt="" draggable={false} />
      </div>
    );
  return (
    <HashRouter>
      {windowKind === "tray" ? <TrayPanel /> : windowKind === "settings" ? <SettingsApp /> : <Dashboard />}
      <Hosts />
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);

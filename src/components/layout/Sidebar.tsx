import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Crosshair,
  FileText,
  FolderClosed,
  Globe,
  Layers,
  LayoutGrid,
  Map as MapIcon,
  PanelLeft,
  Rows3,
  ScrollText,
  Server,
  Settings,
  Shield,
} from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { cx, IconButton } from "@/components/ui";
import logo from "@/assets/logo.svg";

export const NAV = [
  {
    items: [
      { to: "/overview", key: "overview", icon: LayoutGrid },
      { to: "/requests", key: "requests", icon: Rows3 },
      { to: "/policy", key: "policy", icon: Layers },
      { to: "/rules", key: "rules", icon: ScrollText },
      { to: "/profiles", key: "profiles", icon: FolderClosed },
      { to: "/logs", key: "logs", icon: FileText },
    ],
  },
  {
    section: "engine",
    items: [
      { to: "/engine/general", key: "general", icon: Settings },
      { to: "/engine/network", key: "network", icon: Globe },
      { to: "/engine/dns", key: "dns", icon: Server },
      { to: "/engine/tun", key: "tun", icon: Shield },
      { to: "/engine/sniffer", key: "sniffer", icon: Crosshair },
    ],
  },
  {
    section: "lab",
    items: [{ to: "/map", key: "map", icon: MapIcon }],
  },
];

export function SidebarToggle({ className }: { className?: string }) {
  const t = useT();
  const collapsed = useApp((s) => s.settings?.sidebarCollapsed ?? false);
  const save = useApp((s) => s.saveSettings);
  return (
    <IconButton
      icon={<PanelLeft size={16} strokeWidth={1.8} />}
      title={t("nav.toggleSidebar")}
      variant="plain"
      className={cx("sidebar-toggle", className)}
      onClick={() => save({ sidebarCollapsed: !collapsed })}
    />
  );
}

/** Accent pill that slides to the active page instead of jumping. */
function useNavIndicator(navRef: React.RefObject<HTMLElement>) {
  const location = useLocation();
  const [box, setBox] = React.useState<{ top: number; height: number } | null>(null);
  const [animated, setAnimated] = React.useState(false);
  React.useLayoutEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>(".sidebar-item.active");
    setBox(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [location.pathname, navRef]);
  React.useEffect(() => {
    // no slide for the first placement
    if (box && !animated) {
      const id = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(id);
    }
  }, [box, animated]);
  return { box, animated };
}

export function Sidebar() {
  const t = useT();
  const collapsed = useApp((s) => s.settings?.sidebarCollapsed ?? false);
  const info = useApp((s) => s.info);
  const settings = useApp((s) => s.settings);
  const core = useApp((s) => s.core);
  const running = core.state === "running";

  const navRef = React.useRef<HTMLElement>(null);
  const indicator = useNavIndicator(navRef);
  const busy = useApp((s) => s.busy);

  return (
    <aside className={cx("sidebar", collapsed && "collapsed")}>
      {/* Windows has no traffic lights here: the brand sits in the title-bar row */}
      <div className="sidebar-top" data-tauri-drag-region>
        <img className="sidebar-logo" src={logo} alt="" draggable={false} data-tauri-drag-region />
        <div className="sidebar-brand" data-tauri-drag-region>
          <div className="sidebar-brand-name" data-tauri-drag-region>
            {info?.name ?? "ClashWin"}
          </div>
          <div className="sidebar-brand-sub" data-tauri-drag-region>
            {info ? `v${info.version}` : "—"}
          </div>
        </div>
        <SidebarToggle />
      </div>
      <nav className={cx("sidebar-nav", indicator.box && "has-indicator")} ref={navRef}>
        {indicator.box && (
          <span
            className={cx("sidebar-indicator", indicator.animated && "animated")}
            style={{ transform: `translateY(${indicator.box.top}px)`, height: indicator.box.height }}
          />
        )}
        {NAV.map((g, gi) => (
          <div key={gi}>
            {g.section && <div className="sidebar-section">{t(`nav.${g.section}`)}</div>}
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} className={({ isActive }) => cx("sidebar-item", isActive && "active")} draggable={false}>
                <it.icon size={15} strokeWidth={1.9} />
                <span>{t(`nav.${it.key}`)}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-status">
        <div className="sidebar-status-row">
          <span className={cx("sidebar-status-dot", settings?.systemProxy && "on", busy.sysproxy && "busy")} />
          {t("common.systemProxy")}
        </div>
        <div className="sidebar-status-row">
          <span className={cx("sidebar-status-dot", settings?.tunMode && "on", busy.tun && "busy")} />
          {t("common.enhancedMode")}
        </div>
        <div className="sidebar-status-row">
          <span
            className={cx(
              "sidebar-status-dot",
              running && "on",
              core.state === "error" && "err",
              (busy.core || core.state === "starting" || core.state === "downloading") && "busy",
            )}
          />
          {t("common.kernel")} {core.version ?? t(`common.${core.state === "not_installed" ? "notInstalled" : "stopped"}`)}
        </div>
      </div>
    </aside>
  );
}

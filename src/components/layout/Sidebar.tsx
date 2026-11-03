import { NavLink } from "react-router-dom";
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

export function SidebarToggle() {
  const t = useT();
  const collapsed = useApp((s) => s.settings?.sidebarCollapsed ?? false);
  const save = useApp((s) => s.saveSettings);
  return (
    <IconButton
      icon={<PanelLeft size={16} />}
      title={t("nav.toggleSidebar")}
      size="sm"
      square
      variant="plain"
      style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--bg-control)" }}
      onClick={() => save({ sidebarCollapsed: !collapsed })}
    />
  );
}

export function Sidebar() {
  const t = useT();
  const collapsed = useApp((s) => s.settings?.sidebarCollapsed ?? false);
  const info = useApp((s) => s.info);
  const settings = useApp((s) => s.settings);
  const core = useApp((s) => s.core);
  const running = core.state === "running";

  return (
    <aside className={cx("sidebar", collapsed && "collapsed")}>
      <div className="sidebar-top" data-tauri-drag-region>
        <SidebarToggle />
      </div>
      <div className="sidebar-brand" data-tauri-drag-region>
        <img src={logo} alt="" draggable={false} />
        <div style={{ minWidth: 0 }}>
          <div className="sidebar-brand-name">{info?.name ?? "ClashWin"}</div>
          <div className="sidebar-brand-sub">
            {info ? `v${info.version} (${info.build})` : "—"}
          </div>
        </div>
      </div>
      <nav className="sidebar-nav">
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
          <span className={cx("sidebar-status-dot", settings?.systemProxy && "on")} />
          {t("common.systemProxy")}
        </div>
        <div className="sidebar-status-row">
          <span className={cx("sidebar-status-dot", settings?.tunMode && "on")} />
          {t("common.enhancedMode")}
        </div>
        <div className="sidebar-status-row">
          <span className={cx("sidebar-status-dot", running && "on", core.state === "error" && "err")} />
          {t("common.kernel")} {core.version ?? t(`common.${core.state === "not_installed" ? "notInstalled" : "stopped"}`)}
        </div>
      </div>
    </aside>
  );
}

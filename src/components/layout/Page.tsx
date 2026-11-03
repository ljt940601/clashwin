import React from "react";
import { WindowControls } from "./WindowControls";
import { SidebarToggle } from "./Sidebar";
import { useApp } from "@/lib/store";
import { cx } from "@/components/ui";

/**
 * Standard page frame: toolbar (title + actions + window controls) and a scrolling body.
 * `flush` removes body padding/scroll for pages that manage their own layout (tables, map).
 */
export function Page({
  title,
  actions,
  children,
  flush,
  bodyStyle,
  bodyRef,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  bodyStyle?: React.CSSProperties;
  bodyRef?: React.Ref<HTMLDivElement>;
}) {
  const collapsed = useApp((s) => s.settings?.sidebarCollapsed ?? false);
  return (
    <div className="main">
      <div className="toolbar" data-tauri-drag-region>
        <div className="toolbar-left" data-tauri-drag-region>
          {collapsed && <SidebarToggle />}
          <div className="toolbar-title" data-tauri-drag-region>
            {title}
          </div>
        </div>
        <div className="toolbar-spacer" data-tauri-drag-region />
        {actions && <div className="toolbar-actions">{actions}</div>}
        <WindowControls />
      </div>
      <div ref={bodyRef} className={cx("page-body", flush && "flush")} style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}

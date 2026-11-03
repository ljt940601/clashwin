import React from "react";
import { cx } from "./basic";

/** macOS-style grouped settings section: title above a rounded box of rows. */
export function FormSection({
  title,
  desc,
  extra,
  children,
  style,
}: {
  title?: React.ReactNode;
  desc?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section className="ui-form-section" style={style}>
      {(title || extra) && (
        <div className="ui-form-section-title">
          <span>{title}</span>
          {extra && <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>{extra}</span>}
        </div>
      )}
      <div className="ui-form-group">{children}</div>
      {desc && <div className="ui-form-section-desc">{desc}</div>}
    </section>
  );
}

/** One row: label (+ optional description) on the left, control on the right. */
export function FormRow({
  label,
  desc,
  children,
  stack,
  style,
}: {
  label?: React.ReactNode;
  desc?: React.ReactNode;
  children?: React.ReactNode;
  stack?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cx("ui-form-row", stack && "stack")} style={style}>
      {(label || desc) && (
        <div className="ui-form-label">
          {label && <div className="ui-form-label-text">{label}</div>}
          {desc && <div className="ui-form-label-desc">{desc}</div>}
        </div>
      )}
      {children !== undefined && <div className="ui-form-control" style={stack ? { width: "100%" } : undefined}>{children}</div>}
    </div>
  );
}

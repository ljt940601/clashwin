import React from "react";
import { Check, Search, Zap } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

/* ---------- Card ---------- */
export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  iconColor?: string;
  extra?: React.ReactNode;
  padding?: number | string;
}
export function Card({ title, icon, iconColor, extra, padding, className, style, children, onClick, ...rest }: CardProps) {
  return (
    <div
      className={cx("ui-card", onClick && "clickable", className)}
      style={{ padding, ...style }}
      onClick={onClick}
      {...rest}
    >
      {(title || extra) && (
        <div className="ui-card-head">
          {icon && (
            <span className="ui-card-icon" style={{ color: iconColor }}>
              {icon}
            </span>
          )}
          {title && <span className="ui-card-title">{title}</span>}
          {extra && <div className="ui-card-extra" onClick={(e) => e.stopPropagation()}>{extra}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/* ---------- Segmented ---------- */
export interface SegOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
}
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  // A thumb slides to the selected option instead of the highlight jumping.
  const ref = React.useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null);
  const [animated, setAnimated] = React.useState(false);
  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>(".ui-seg-item.active");
      setThumb((cur) => {
        if (!el || !el.offsetWidth) return null;
        const next = { left: el.offsetLeft, width: el.offsetWidth };
        return cur && cur.left === next.left && cur.width === next.width ? cur : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [value, options.length]);
  React.useEffect(() => {
    if (thumb && !animated) {
      const id = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(id);
    }
  }, [thumb, animated]);
  return (
    <div ref={ref} className={cx("ui-seg", size, className, thumb && "has-thumb", animated && "animated")} role="tablist">
      {thumb && <span className="ui-seg-thumb" style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} />}
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          title={o.title}
          aria-selected={o.value === value}
          className={cx("ui-seg-item", o.value === value && "active")}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Toggle ---------- */
export function Toggle({
  checked,
  onChange,
  disabled,
  size = "md",
  title,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      className={cx("ui-toggle", size, checked && "on")}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
    />
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx("ui-check", checked && "on")}
      style={{ opacity: disabled ? 0.5 : 1 }}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onChange?.(!checked);
      }}
    >
      <span className="ui-check-box">{checked && <Check size={11} strokeWidth={3.2} />}</span>
      {label && <span>{label}</span>}
    </label>
  );
}

/* ---------- Buttons ---------- */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger" | "plain";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
  loading?: boolean;
}
export function Button({ variant = "default", size = "md", icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx("ui-btn", variant !== "default" && variant, size !== "md" && size, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={12} /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  variant?: "toolbar" | "plain";
  size?: "xs" | "sm" | "md";
  square?: boolean;
  active?: boolean;
}
export function IconButton({ icon, variant = "toolbar", size = "md", square, active, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        "ui-iconbtn",
        variant === "plain" && "plain",
        size !== "md" && size,
        square && "square",
        active && "active",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}

export function PillGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("ui-pillgroup", className)}>{children}</div>;
}

/* ---------- Latency badge ---------- */
export function latencyTier(delay?: number | null): "good" | "mid" | "bad" | "none" {
  if (!delay || delay <= 0) return "none";
  if (delay < 300) return "good";
  if (delay <= 800) return "mid";
  return "bad";
}

export function LatencyBadge({
  delay,
  testing,
  onTest,
  onAccent,
  timeoutLabel = "Timeout",
}: {
  delay?: number | null;
  testing?: boolean;
  onTest?: () => void;
  onAccent?: boolean;
  timeoutLabel?: string;
}) {
  const tier = latencyTier(delay);
  const tested = delay !== undefined && delay !== null;
  const label = testing ? null : tested ? (delay! > 0 ? `${delay}ms` : timeoutLabel) : null;
  return (
    <span
      className={cx("ui-latency", onAccent ? "on-accent" : tier, onTest && "clickable")}
      onClick={(e) => {
        if (!onTest) return;
        e.stopPropagation();
        if (!testing) onTest();
      }}
    >
      {testing ? (
        <Zap size={10} className="spin" />
      ) : label ? (
        label
      ) : (
        <Zap size={10} />
      )}
    </span>
  );
}

export function Tag({ children, solid, color, style }: { children: React.ReactNode; solid?: boolean; color?: string; style?: React.CSSProperties }) {
  return (
    <span className={cx("ui-tag", solid && "solid")} style={{ color, borderColor: color ? `${color}66` : undefined, ...style }}>
      {children}
    </span>
  );
}

/* ---------- Progress ---------- */
export function Progress({
  value,
  color = "var(--accent)",
  height = 3,
  track,
  style,
}: {
  value: number;
  color?: string;
  height?: number;
  track?: string;
  style?: React.CSSProperties;
}) {
  const v = Math.max(0, Math.min(1, isFinite(value) ? value : 0));
  return (
    <div className="ui-progress" style={{ height, background: track, ...style }}>
      <div className="ui-progress-fill" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
}

/** Subscription usage color: blue → amber → orange → red */
export function usageColor(ratio: number) {
  if (ratio >= 0.9) return "var(--red)";
  if (ratio >= 0.75) return "var(--orange)";
  if (ratio >= 0.5) return "var(--amber)";
  return "var(--accent)";
}

/* ---------- Spinner / Empty ---------- */
export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="ui-spinner" style={{ width: size, height: size }} />;
}

export function Empty({ icon, title, desc, children }: { icon?: React.ReactNode; title?: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="ui-empty">
      {icon}
      {title && <div className="ui-empty-title">{title}</div>}
      {desc && <div className="ui-empty-desc">{desc}</div>}
      {children}
    </div>
  );
}

/* ---------- Inputs ---------- */
export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string | number;
  onChange?: (v: string) => void;
  mono?: boolean;
  width?: number | string;
}
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { value, onChange, mono, width, className, style, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx("ui-input", mono && "mono", className)}
      style={{ width, ...style }}
      value={value}
      spellCheck={false}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    />
  );
});

export function NumberField({
  value,
  onChange,
  min,
  max,
  width = 90,
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  width?: number;
  placeholder?: string;
}) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    let n = parseInt(text, 10);
    if (isNaN(n)) n = value;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <input
      className="ui-input mono"
      style={{ width, textAlign: "right" }}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value.replace(/[^\d-]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 4,
  mono,
  placeholder,
  style,
}: {
  value: string;
  onChange?: (v: string) => void;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  return (
    <textarea
      className={cx("ui-input", mono && "mono")}
      rows={rows}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      style={{ width: "100%", ...style }}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  width = 220,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <div className="ui-search">
      <Search size={13} />
      <input
        className="ui-input"
        style={{ width }}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
      />
    </div>
  );
}

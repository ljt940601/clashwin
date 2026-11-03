import React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { create } from "zustand";
import { cx } from "./basic";

/* ---------- Menu model ---------- */
export type MenuEntry =
  | "separator"
  | { header: React.ReactNode }
  | {
      label: React.ReactNode;
      icon?: React.ReactNode;
      shortcut?: string;
      checked?: boolean;
      disabled?: boolean;
      danger?: boolean;
      onClick?: () => void;
      children?: MenuEntry[];
      keepOpen?: boolean;
    };

/* ---------- Positioning ---------- */
export interface Anchor {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

function usePlacement(anchor: Anchor, align: "start" | "end", ref: React.RefObject<HTMLDivElement>, side: "bottom" | "right" = "bottom") {
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (side === "right") {
      left = anchor.x + (anchor.w ?? 0) + 2;
      top = anchor.y - 5;
      if (left + r.width > vw - 4) left = anchor.x - r.width - 2;
    } else {
      left = align === "end" ? anchor.x + (anchor.w ?? 0) - r.width : anchor.x;
      top = anchor.y + (anchor.h ?? 0) + 4;
      if (top + r.height > vh - 4) {
        const above = anchor.y - r.height - 4;
        top = above >= 4 ? above : Math.max(4, vh - r.height - 4);
      }
    }
    left = Math.max(4, Math.min(left, vw - r.width - 4));
    top = Math.max(4, Math.min(top, vh - r.height - 4));
    setPos({ left, top });
  }, [anchor.x, anchor.y, anchor.w, anchor.h, align, side]);
  return pos;
}

/* ---------- Menu list ---------- */
function MenuList({
  items,
  onClose,
  anchor,
  align = "start",
  side = "bottom",
  minWidth,
  depth = 0,
}: {
  items: MenuEntry[];
  onClose: () => void;
  anchor: Anchor;
  align?: "start" | "end";
  side?: "bottom" | "right";
  minWidth?: number;
  depth?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const pos = usePlacement(anchor, align, ref, side);
  const [sub, setSub] = React.useState<{ idx: number; anchor: Anchor } | null>(null);
  return (
    <>
      <div
        ref={ref}
        className="ui-popover"
        data-menu-depth={depth}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) => {
          if (it === "separator") return <div key={i} className="ui-menu-sep" />;
          if ("header" in it) return <div key={i} className="ui-menu-header">{it.header}</div>;
          const hasChildren = !!it.children?.length;
          return (
            <div
              key={i}
              className={cx("ui-menu-item", it.disabled && "disabled", it.danger && "danger", sub?.idx === i && "focused")}
              onMouseEnter={(e) => {
                if (hasChildren) {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSub({ idx: i, anchor: { x: r.left, y: r.top, w: r.width, h: r.height } });
                } else setSub(null);
              }}
              onClick={() => {
                if (it.disabled || hasChildren) return;
                it.onClick?.();
                if (!it.keepOpen) onClose();
              }}
            >
              {items.some((x) => x !== "separator" && !("header" in x) && x.checked !== undefined) && (
                <span className="ui-menu-check">{it.checked && <Check size={12} strokeWidth={2.6} />}</span>
              )}
              {it.icon && <span className="ui-menu-icon">{it.icon}</span>}
              <span className="ui-menu-label">{it.label}</span>
              {it.shortcut && <span className="ui-menu-shortcut">{it.shortcut}</span>}
              {hasChildren && <ChevronRight size={12} style={{ marginLeft: 8, opacity: 0.7 }} />}
            </div>
          );
        })}
      </div>
      {sub && (items[sub.idx] as any).children && (
        <MenuList items={(items[sub.idx] as any).children} onClose={onClose} anchor={sub.anchor} side="right" depth={depth + 1} />
      )}
    </>
  );
}

/* ---------- Global menu host (context menus + dropdowns) ---------- */
interface MenuState {
  menu: { items: MenuEntry[]; anchor: Anchor; align: "start" | "end"; minWidth?: number; onClose?: () => void } | null;
  open: (items: MenuEntry[], anchor: Anchor, opts?: { align?: "start" | "end"; minWidth?: number; onClose?: () => void }) => void;
  close: () => void;
}
export const useMenuStore = create<MenuState>((set, get) => ({
  menu: null,
  open: (items, anchor, opts) => set({ menu: { items, anchor, align: opts?.align ?? "start", minWidth: opts?.minWidth, onClose: opts?.onClose } }),
  close: () => {
    const m = get().menu;
    set({ menu: null });
    m?.onClose?.();
  },
}));

/** Show a menu at the mouse position (right-click). */
export function openContextMenu(e: React.MouseEvent | MouseEvent, items: MenuEntry[]) {
  e.preventDefault();
  e.stopPropagation();
  useMenuStore.getState().open(items, { x: e.clientX, y: e.clientY, w: 0, h: 0 });
}

/** Show a menu anchored under an element. */
export function openMenuAt(el: HTMLElement, items: MenuEntry[], opts?: { align?: "start" | "end"; minWidth?: number; onClose?: () => void }) {
  const r = el.getBoundingClientRect();
  useMenuStore.getState().open(items, { x: r.left, y: r.top, w: r.width, h: r.height }, opts);
}

export function MenuHost() {
  const menu = useMenuStore((s) => s.menu);
  const close = useMenuStore((s) => s.close);
  React.useEffect(() => {
    if (!menu) return;
    const onDown = () => close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onBlur = () => close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [menu, close]);
  if (!menu) return null;
  return createPortal(
    <MenuList items={menu.items} anchor={menu.anchor} align={menu.align} minWidth={menu.minWidth} onClose={close} />,
    document.body,
  );
}

/* ---------- Dropdown button ---------- */
export function Dropdown({
  items,
  children,
  align = "start",
  minWidth,
}: {
  items: MenuEntry[] | (() => MenuEntry[]);
  children: (open: boolean) => React.ReactElement;
  align?: "start" | "end";
  minWidth?: number;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);
  return (
    <span
      ref={ref}
      style={{ display: "inline-flex" }}
      onMouseDown={(e) => {
        if (open) return;
        e.stopPropagation();
        const el = (ref.current?.firstElementChild as HTMLElement) ?? ref.current!;
        setOpen(true);
        openMenuAt(el, typeof items === "function" ? items() : items, { align, minWidth, onClose: () => setOpen(false) });
      }}
    >
      {children(open)}
    </span>
  );
}

/* ---------- Select ---------- */
export interface SelectOption<T> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  width,
  placeholder,
  disabled,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  width?: number | string;
  placeholder?: React.ReactNode;
  disabled?: boolean;
}) {
  const cur = options.find((o) => o.value === value);
  return (
    <Dropdown
      align="start"
      items={() =>
        options.map((o) => ({
          label: o.label,
          checked: o.value === value,
          disabled: o.disabled,
          onClick: () => onChange(o.value),
        }))
      }
    >
      {() => (
        <button type="button" className="ui-select" style={{ width, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : undefined }}>
          <span className="ellipsis">{cur ? cur.label : placeholder ?? "—"}</span>
          <ChevronDown size={13} />
        </button>
      )}
    </Dropdown>
  );
}

/* ---------- Tooltip ---------- */
export function Tooltip({ content, children, delay = 350 }: { content: React.ReactNode; children: React.ReactElement; delay?: number }) {
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const timer = React.useRef<number>();
  if (!content) return children;
  return (
    <>
      {React.cloneElement(children, {
        onMouseEnter: (e: React.MouseEvent) => {
          children.props.onMouseEnter?.(e);
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setPos({ x: r.left + r.width / 2, y: r.bottom + 6 }), delay);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          children.props.onMouseLeave?.(e);
          window.clearTimeout(timer.current);
          setPos(null);
        },
      })}
      {pos &&
        createPortal(
          <div className="ui-tooltip" style={{ left: pos.x, top: pos.y, transform: "translateX(-50%)" }}>
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

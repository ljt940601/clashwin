import React from "react";
import { Check, ListPlus, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { Page } from "@/components/layout/Page";
import { Button, confirm, IconButton, TextArea, TextField, toast, Tooltip } from "@/components/ui";
import { useApp } from "@/lib/store";
import { backend, errorMessage } from "@/lib/backend";
import { useT } from "@/i18n";
import type { EngineSettings } from "@/lib/types";
import "../engine.css";

/* ---------- Data hook ---------- */

/** Read one engine section and get a patch-saver for it. */
export function useEngineSection<K extends keyof EngineSettings>(section: K) {
  const value = useApp((s) => s.settings?.engine[section]) as EngineSettings[K] | undefined;
  const saveSettings = useApp((s) => s.saveSettings);
  const update = React.useCallback(
    (patch: Partial<EngineSettings[K]>) => saveSettings({ engine: { [section]: patch } } as any),
    [saveSettings, section],
  );
  return [value, update] as const;
}

/* ---------- Page frame ---------- */

export function EnginePage({
  section,
  title,
  children,
  extraActions,
}: {
  section: keyof EngineSettings;
  title: React.ReactNode;
  children: React.ReactNode;
  extraActions?: React.ReactNode;
}) {
  const t = useT();
  const ready = useApp((s) => !!s.settings);
  const [busy, setBusy] = React.useState(false);
  const reset = async () => {
    const ok = await confirm({
      title: t("engine.resetTitle"),
      message: t("engine.resetMessage", { section: t(`nav.${section}`) }),
      confirmText: t("common.reset"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const s = await backend.resetEngine(section);
      useApp.setState({ settings: s });
      toast.success(t("engine.resetDone"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page
      title={title}
      actions={
        <>
          {extraActions}
          <Button className="en-toolbar-btn" icon={<RotateCcw size={13} />} loading={busy} onClick={reset}>
            {t("common.reset")}
          </Button>
        </>
      }
    >
      <div className="en-column">{ready ? children : null}</div>
    </Page>
  );
}

/* ---------- Hints ---------- */

export function RestartHint() {
  const t = useT();
  return <span className="en-hint-tag">{t("engine.needsRestart")}</span>;
}

/** Label with an optional trailing hint tag */
export function Label({ children, restart }: { children: React.ReactNode; restart?: boolean }) {
  return (
    <span className="en-label">
      {children}
      {restart && <RestartHint />}
    </span>
  );
}

export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  return <div className={`en-note ${tone}`}>{children}</div>;
}

/* ---------- Commit-on-blur text field ---------- */

export function CommitField({
  value,
  onCommit,
  width = 220,
  mono = true,
  placeholder,
  align,
}: {
  value: string;
  onCommit: (v: string) => void;
  width?: number | string;
  mono?: boolean;
  placeholder?: string;
  align?: "left" | "right";
}) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  const commit = () => {
    const v = text.trim();
    if (v !== value) onCommit(v);
  };
  return (
    <TextField
      value={text}
      onChange={setText}
      mono={mono}
      width={width}
      placeholder={placeholder}
      style={{ textAlign: align }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/* ---------- String list editor ---------- */

export function ListEditor({
  value,
  onChange,
  placeholder,
  maxHeight = 220,
  validate,
  extraButtons,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  maxHeight?: number;
  /** return an error message for invalid input */
  validate?: (item: string) => string | null;
  extraButtons?: React.ReactNode;
}) {
  const t = useT();
  const [draft, setDraft] = React.useState("");
  const [bulk, setBulk] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const itemsRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const add = () => {
    const items = draft
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return;
    for (const it of items) {
      const err = validate?.(it);
      if (err) {
        setError(err);
        return;
      }
    }
    const next = [...value];
    for (const it of items) if (!next.includes(it)) next.push(it);
    setDraft("");
    setError(null);
    onChange(next);
  };

  if (bulk !== null) {
    return (
      <div className="en-list-bulk">
        <TextArea value={bulk} onChange={setBulk} rows={Math.min(12, Math.max(4, bulk.split("\n").length + 1))} mono placeholder={t("engine.onePerLine")} />
        <div className="en-list-bulk-actions">
          <span className="dim">{t("engine.onePerLine")}</span>
          <Button size="sm" onClick={() => setBulk(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Check size={12} />}
            onClick={() => {
              const items = bulk
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              onChange(Array.from(new Set(items)));
              setBulk(null);
            }}
          >
            {t("common.done")}
          </Button>
        </div>
      </div>
    );
  }

  // Keyboard: items are focusable; Delete/Backspace removes the focused one, arrows move.
  const focusItem = (i: number) =>
    requestAnimationFrame(() => {
      const items = itemsRef.current?.querySelectorAll<HTMLElement>(".en-list-item");
      if (items && i >= 0 && i < items.length) items[i].focus();
      else inputRef.current?.focus();
    });
  const onItemKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onChange(value.filter((_, j) => j !== i));
      focusItem(Math.min(i, value.length - 2));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(i + 1);
    } else if (e.key === "ArrowUp" && i > 0) {
      e.preventDefault();
      focusItem(i - 1);
    }
  };

  return (
    <div className="en-list">
      {value.length > 0 && (
        <div className="en-list-items" style={{ maxHeight }} ref={itemsRef}>
          {value.map((it, i) => (
            <div key={`${it}-${i}`} className="en-list-item" tabIndex={0} onKeyDown={(e) => onItemKey(e, i)}>
              <span className="en-list-text selectable">{it}</span>
              <button
                className="en-list-remove"
                tabIndex={-1}
                title={t("engine.removeItem")}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="en-list-add">
        <ListPlus size={13} className="en-list-add-icon" />
        <input
          ref={inputRef}
          className="en-list-input"
          value={draft}
          placeholder={placeholder ?? t("engine.addItem")}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            else if (e.key === "ArrowUp" && !draft && value.length) {
              e.preventDefault();
              focusItem(value.length - 1);
            }
          }}
        />
        {extraButtons}
        <Tooltip content={t("common.add")}>
          <IconButton icon={<Plus size={13} />} size="xs" variant="plain" disabled={!draft.trim()} onClick={add} />
        </Tooltip>
        <Tooltip content={t("engine.bulkEdit")}>
          <IconButton icon={<Pencil size={12} />} size="xs" variant="plain" onClick={() => setBulk(value.join("\n"))} />
        </Tooltip>
      </div>
      {error && <div className="en-list-error">{error}</div>}
      {value.length === 0 && !error && <div className="en-list-empty">{t("engine.emptyList")}</div>}
    </div>
  );
}

/* ---------- Key → value table editor ---------- */

export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  value: { key: string; value: string }[];
  onChange: (v: { key: string; value: string }[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const t = useT();
  const [k, setK] = React.useState("");
  const [v, setV] = React.useState("");
  const add = () => {
    if (!k.trim() || !v.trim()) return;
    onChange([...value.filter((x) => x.key !== k.trim()), { key: k.trim(), value: v.trim() }]);
    setK("");
    setV("");
  };
  const edit = (i: number, patch: Partial<{ key: string; value: string }>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="en-list">
      {value.length > 0 && (
        <div className="en-kv-head">
          <span>{keyPlaceholder}</span>
          <span>{valuePlaceholder}</span>
          <span />
        </div>
      )}
      {value.length > 0 && (
        <div className="en-list-items" style={{ maxHeight: 260 }}>
          {value.map((row, i) => (
            <div key={`${row.key}-${i}`} className="en-kv-row">
              <KvCell value={row.key} onCommit={(key) => edit(i, { key })} />
              <KvCell value={row.value} onCommit={(val) => edit(i, { value: val })} />
              <button className="en-list-remove" title={t("common.delete")} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="en-kv-row add">
        <input className="en-list-input" value={k} placeholder={keyPlaceholder} spellCheck={false} onChange={(e) => setK(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <input className="en-list-input" value={v} placeholder={valuePlaceholder} spellCheck={false} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <IconButton icon={<Plus size={13} />} size="xs" variant="plain" disabled={!k.trim() || !v.trim()} onClick={add} />
      </div>
    </div>
  );
}

function KvCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  return (
    <input
      className="en-list-input"
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/* ---------- Validators ---------- */

const ipv4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
export function isCidr(s: string): boolean {
  const [ip, mask] = s.split("/");
  if (!ip) return false;
  if (ip.includes(":")) return mask === undefined || (+mask >= 0 && +mask <= 128);
  if (!ipv4.test(ip) || ip.split(".").some((x) => +x > 255)) return false;
  return mask === undefined || (/^\d+$/.test(mask) && +mask <= 32);
}

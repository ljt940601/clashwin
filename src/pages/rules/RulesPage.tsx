import React from "react";
import { ArrowDown, ArrowUp, Copy, Minus, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, ScrollText, Trash2 } from "lucide-react";
import { Page } from "@/components/layout/Page";
import {
  Dropdown,
  Empty,
  IconButton,
  SearchField,
  Spinner,
  Toggle,
  Tooltip,
  confirm,
  cx,
  openContextMenu,
  toast,
  type MenuEntry,
} from "@/components/ui";
import { useT } from "@/i18n";
import { mihomo } from "@/lib/mihomo";
import { backend, errorMessage } from "@/lib/backend";
import { useApp } from "@/lib/store";
import { formatCount } from "@/lib/format";
import type { RuleItem, RuleProvider } from "@/lib/types";
import { displayName } from "@/pages/policy/utils";
import { LogicRuleEditor, RuleTypeIcon, StandardRuleEditor, type StandardInitial } from "./RuleEditor";
import { canonicalType, parseRuleLine, ruleMeta } from "./ruleUtils";
import "./rules.css";

const ROW = 32;

type EditorState =
  | { kind: "standard"; rawIndex: number | null; initial?: StandardInitial }
  | { kind: "logic"; rawIndex: number | null; initial?: { op: string; payload: string; policy: string } }
  | null;

function PolicyCell({ name }: { name: string }) {
  const up = name.toUpperCase();
  if (up === "DIRECT") return <span className="rl-policy-tag direct">DIRECT</span>;
  if (up === "REJECT" || up === "REJECT-DROP") return <span className="rl-policy-tag reject">{up}</span>;
  if (up === "PASS") return <span className="rl-policy-tag pass">PASS</span>;
  return <span>{displayName(name)}</span>;
}

export default function RulesPage() {
  const t = useT();
  const running = useApp((s) => s.core.state === "running");
  const activeProfileId = useApp((s) => s.settings?.activeProfileId);

  const [rules, setRules] = React.useState<RuleItem[] | null>(null);
  const [providers, setProviders] = React.useState<Record<string, RuleProvider>>({});
  const [raw, setRaw] = React.useState<string[] | null>(null);
  const [targets, setTargets] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [search, setSearch] = React.useState("");
  const [editor, setEditor] = React.useState<EditorState>(null);
  const [saving, setSaving] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const pendingSelect = React.useRef<number | null>(null);

  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewH, setViewH] = React.useState(600);

  const load = React.useCallback(async () => {
    try {
      const [r, p, lines] = await Promise.all([
        mihomo.rules(),
        mihomo.ruleProviders().catch(() => ({ providers: {} as Record<string, RuleProvider> })),
        backend.getRules().catch(() => null),
      ]);
      const list = (r.rules ?? []).map((x, i) => ({ ...x, index: x.index ?? i }));
      setRules(list);
      setProviders(p.providers ?? {});
      setRaw(lines);
      if (pendingSelect.current !== null) {
        const off = lines ? Math.max(0, list.length - lines.length) : 0;
        setSelected(pendingSelect.current + off);
        pendingSelect.current = null;
      }
    } catch (e) {
      setRules((cur) => cur ?? []);
    }
  }, []);

  React.useEffect(() => {
    if (!running) {
      setRules(null);
      return;
    }
    load();
    backend.ruleTargets().then(setTargets).catch(() => {});
    const id = window.setInterval(() => !document.hidden && load(), 5000);
    return () => window.clearInterval(id);
  }, [running, load, activeProfileId]);

  React.useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, [rules === null]);

  // runtime rules = [engine-injected rules…, profile rules…]
  const offset = rules && raw ? Math.max(0, rules.length - raw.length) : 0;
  const rawIndexOf = (i: number) => (raw && i >= offset && i - offset < raw.length ? i - offset : null);
  const isMatchAt = (i: number) => rules?.[i]?.type === "Match" || rules?.[i]?.type === "MATCH";

  const view = React.useMemo(() => {
    if (!rules) return [];
    const q = search.trim().toLowerCase();
    const all = rules.map((r, i) => ({ r, i }));
    if (!q) return all;
    return all.filter(({ r }) => `${canonicalType(r.type)} ${r.type} ${r.payload} ${r.proxy}`.toLowerCase().includes(q));
  }, [rules, search]);

  const ruleCountOf = (r: RuleItem): string => {
    if (r.type === "RuleSet") {
      const p = providers[r.payload];
      if (p) return formatCount(p.ruleCount);
    }
    return r.size > 0 ? formatCount(r.size) : "—";
  };

  /* ---------- editing ---------- */
  const commit = async (lines: string[], selectRaw: number | null) => {
    setSaving(true);
    try {
      await backend.setRules(lines);
      pendingSelect.current = selectRaw;
      toast.success(t("rules.saved"));
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const openNew = (kind: "standard" | "logic") => setEditor({ kind, rawIndex: null });

  const openEdit = (i: number) => {
    const ri = rawIndexOf(i);
    if (ri === null || !raw) {
      toast.info(t("rules.systemRule"));
      return;
    }
    const p = parseRuleLine(raw[ri]);
    if (ruleMeta(p.type).category === "logic") setEditor({ kind: "logic", rawIndex: ri, initial: { op: p.type, payload: p.payload, policy: p.policy } });
    else
      setEditor({
        kind: "standard",
        rawIndex: ri,
        initial: { type: p.type, payload: p.payload, policy: p.policy, noResolve: p.options.includes("no-resolve"), options: p.options },
      });
  };

  const saveFromEditor = async (line: string) => {
    if (!raw || !editor) return;
    if (editor.rawIndex === null) await commit([line, ...raw], 0);
    else {
      const next = raw.slice();
      next[editor.rawIndex] = line;
      await commit(next, editor.rawIndex);
    }
  };

  const canMove = (i: number, dir: -1 | 1) => {
    const ri = rawIndexOf(i);
    if (ri === null || !raw || isMatchAt(i)) return false;
    const to = ri + dir;
    if (to < 0 || to >= raw.length) return false;
    return parseRuleLine(raw[to]).type !== "MATCH";
  };
  const move = (i: number, dir: -1 | 1) => {
    const ri = rawIndexOf(i);
    if (ri === null || !raw || !canMove(i, dir)) return;
    const next = raw.slice();
    [next[ri], next[ri + dir]] = [next[ri + dir], next[ri]];
    setSelected(i + dir);
    commit(next, ri + dir);
  };
  const canDelete = (i: number) => rawIndexOf(i) !== null && !isMatchAt(i);
  const remove = async (i: number) => {
    const ri = rawIndexOf(i);
    if (ri === null || !raw || !canDelete(i)) return;
    if (!(await confirm({ title: t("rules.remove"), message: t("rules.deleteConfirm", { rule: raw[ri] }), danger: true, confirmText: t("rules.delete") }))) return;
    const next = raw.filter((_, j) => j !== ri);
    setSelected(null);
    commit(next, Math.min(ri, next.length - 1));
  };

  const toggleRule = async (r: RuleItem) => {
    const idx = r.index!;
    const disabled = !!r.extra?.disabled;
    setRules((rs) => rs?.map((x) => (x.index === idx ? { ...x, extra: { ...x.extra!, disabled: !disabled } } : x)) ?? rs);
    try {
      await mihomo.disableRules({ [idx]: !disabled });
    } catch (e) {
      toast.error(errorMessage(e));
      load();
    }
  };

  const copyRule = (i: number) => {
    const r = rules?.[i];
    if (!r) return;
    const ri = rawIndexOf(i);
    const text = ri !== null && raw ? raw[ri] : [canonicalType(r.type), r.payload, r.proxy].filter(Boolean).join(",");
    navigator.clipboard?.writeText(text).then(() => toast.success(t("common.copied")));
  };

  const resetRules = async () => {
    if (!(await confirm({ title: t("rules.resetRules"), message: t("rules.resetConfirm"), danger: true }))) return;
    try {
      await backend.resetRules();
      await load();
      toast.success(t("rules.saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const rowMenu = (i: number): MenuEntry[] => {
    const editable = rawIndexOf(i) !== null;
    return [
      { label: t("rules.edit"), icon: <Pencil size={13} />, disabled: !editable, onClick: () => openEdit(i) },
      "separator",
      { label: t("rules.moveUp"), icon: <ArrowUp size={13} />, disabled: !canMove(i, -1), onClick: () => move(i, -1) },
      { label: t("rules.moveDown"), icon: <ArrowDown size={13} />, disabled: !canMove(i, 1), onClick: () => move(i, 1) },
      "separator",
      { label: t("rules.copy"), icon: <Copy size={13} />, onClick: () => copyRule(i) },
      "separator",
      { label: t("rules.delete"), icon: <Trash2 size={13} />, danger: true, disabled: !canDelete(i), onClick: () => remove(i) },
    ];
  };

  // keep selection visible
  React.useEffect(() => {
    if (selected === null || !bodyRef.current) return;
    const pos = view.findIndex((v) => v.i === selected);
    if (pos < 0) return;
    const el = bodyRef.current;
    const top = pos * ROW;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (selected === null) return;
    const pos = view.findIndex((v) => v.i === selected);
    if (e.key === "ArrowDown" && pos < view.length - 1) {
      e.preventDefault();
      setSelected(view[pos + 1].i);
    } else if (e.key === "ArrowUp" && pos > 0) {
      e.preventDefault();
      setSelected(view[pos - 1].i);
    } else if (e.key === "Delete") remove(selected);
    else if (e.key === "Enter") openEdit(selected);
  };

  /* ---------- render ---------- */
  const actions = (
    <>
      {rules && <span className="dim tnum" style={{ fontSize: 12 }}>{t("rules.count", { n: formatCount(rules.length) })}</span>}
      <SearchField value={search} onChange={setSearch} placeholder={t("rules.searchPlaceholder")} width={220} />
      <Tooltip content={t("rules.refresh")}>
        <IconButton icon={<RefreshCw size={15} className={refreshing ? "spin" : undefined} />} onClick={refresh} disabled={!running} />
      </Tooltip>
      <Dropdown
        align="end"
        items={() => [{ label: t("rules.resetRules"), icon: <RotateCcw size={13} />, onClick: resetRules, disabled: !raw }]}
      >
        {() => <IconButton icon={<MoreHorizontal size={16} />} title={t("rules.more")} />}
      </Dropdown>
    </>
  );

  if (!running || rules === null) {
    return (
      <Page title={t("nav.rules")} actions={actions}>
        {running ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
            <Spinner size={20} />
          </div>
        ) : (
          <Empty icon={<ScrollText size={34} strokeWidth={1.4} />} title={t("common.coreNotRunning")} desc={t("rules.emptyDesc")} />
        )}
      </Page>
    );
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 10);
  const end = Math.min(view.length, Math.ceil((scrollTop + viewH) / ROW) + 10);
  const sel = selected;

  return (
    <Page title={t("nav.rules")} actions={actions} flush>
      <div className="rl-root">
        <div className="rl-head rl-cols">
          <div>{t("rules.colEnabled")}</div>
          <div className="rl-num">{t("rules.colIndex")}</div>
          <div>{t("rules.colType")}</div>
          <div>{t("rules.colPayload")}</div>
          <div className="rl-num">{t("rules.colCount")}</div>
          <div>{t("rules.colPolicy")}</div>
          <div className="rl-num">{t("rules.colHits")}</div>
        </div>
        <div className="rl-body" ref={bodyRef} tabIndex={0} onKeyDown={onKeyDown} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
          {view.length === 0 ? (
            <Empty title={search ? t("rules.noMatch") : t("rules.empty")} desc={search ? undefined : t("rules.emptyDesc")} />
          ) : (
            <div style={{ height: view.length * ROW, position: "relative" }}>
              {view.slice(start, end).map(({ r, i }, k) => {
                const pos = start + k;
                const disabled = !!r.extra?.disabled;
                const type = canonicalType(r.type);
                const system = raw !== null && rawIndexOf(i) === null;
                return (
                  <div
                    key={i}
                    className={cx("rl-row rl-cols", pos % 2 === 1 && "odd", sel === i && "selected", disabled && "disabled")}
                    style={{ top: pos * ROW }}
                    onMouseDown={() => setSelected(i)}
                    onDoubleClick={() => openEdit(i)}
                    onContextMenu={(e) => {
                      setSelected(i);
                      openContextMenu(e, rowMenu(i));
                    }}
                  >
                    <div onMouseDown={(e) => e.stopPropagation()}>
                      <Toggle size="sm" checked={!disabled} disabled={!r.extra} onChange={() => toggleRule(r)} />
                    </div>
                    <div className="rl-num rl-idx">{i}</div>
                    <div className="rl-type">
                      <RuleTypeIcon type={type} />
                      <span className="ellipsis">{type}</span>
                      {system && <span className="rl-system">auto</span>}
                    </div>
                    <div className="rl-payload-cell" title={r.payload}>
                      {r.payload || <span className="rl-dim">—</span>}
                    </div>
                    <div className="rl-num" style={{ color: "var(--text-3)" }}>
                      {ruleCountOf(r)}
                    </div>
                    <div className="rl-policy" title={r.proxy}>
                      <PolicyCell name={r.proxy} />
                    </div>
                    <div className="rl-num" style={{ color: r.extra?.hitCount ? "var(--text-2)" : "var(--text-faint)" }}>
                      {r.extra ? formatCount(r.extra.hitCount) : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="rl-bar">
          <div className="rl-btns">
            <Dropdown
              items={() => [
                { label: t("rules.addStandard"), icon: <Plus size={13} />, onClick: () => openNew("standard"), disabled: !raw },
                { label: t("rules.addLogic"), icon: <Plus size={13} />, onClick: () => openNew("logic"), disabled: !raw },
              ]}
            >
              {() => (
                <button title={t("rules.add")} disabled={!raw}>
                  <Plus size={14} />
                </button>
              )}
            </Dropdown>
            <button title={t("rules.remove")} disabled={sel === null || !canDelete(sel) || saving} onClick={() => sel !== null && remove(sel)}>
              <Minus size={14} />
            </button>
            <button title={t("rules.moveUp")} disabled={sel === null || !canMove(sel, -1) || saving} onClick={() => sel !== null && move(sel, -1)}>
              <ArrowUp size={13} />
            </button>
            <button title={t("rules.moveDown")} disabled={sel === null || !canMove(sel, 1) || saving} onClick={() => sel !== null && move(sel, 1)}>
              <ArrowDown size={13} />
            </button>
          </div>
          <div className="rl-bar-info">
            {saving && <Spinner size={11} />}
            {sel !== null && isMatchAt(sel) && <span>{t("rules.matchLocked")}</span>}
            {sel !== null && raw && rawIndexOf(sel) === null && <span>{t("rules.systemRule")}</span>}
            {search && <span className="tnum">{view.length} / {formatCount(rules.length)}</span>}
          </div>
        </div>
      </div>

      <StandardRuleEditor
        open={editor?.kind === "standard"}
        title={editor?.rawIndex === null ? t("rules.newRule") : t("rules.editRule")}
        initial={editor?.kind === "standard" ? editor.initial : undefined}
        targets={targets}
        ruleSets={Object.keys(providers)}
        onClose={() => setEditor(null)}
        onSave={saveFromEditor}
      />
      <LogicRuleEditor
        open={editor?.kind === "logic"}
        title={editor?.rawIndex === null ? t("rules.newLogic") : t("rules.editLogic")}
        initial={editor?.kind === "logic" ? editor.initial : undefined}
        targets={targets}
        ruleSets={Object.keys(providers)}
        onClose={() => setEditor(null)}
        onSave={saveFromEditor}
      />
    </Page>
  );
}

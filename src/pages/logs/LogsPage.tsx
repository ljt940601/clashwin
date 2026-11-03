import React from "react";
import { ArrowDown, ChevronDown, Copy, Download, FileText, Filter, Pause, Play, Trash2 } from "lucide-react";
import { Page } from "@/components/layout/Page";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { useLive } from "@/lib/live";
import { backend, errorMessage, isTauri } from "@/lib/backend";
import { formatTime } from "@/lib/format";
import {
  Button,
  cx,
  Dropdown,
  Empty,
  IconButton,
  Modal,
  openContextMenu,
  SearchField,
  Select,
  toast,
  Tooltip,
  type MenuEntry,
} from "@/components/ui";
import type { LogLevel, LogRow } from "@/lib/types";
import "./logs.css";

const ROW_H = 26;
const OVERSCAN = 12;
const RANK: Record<string, number> = { debug: 0, info: 1, warning: 2, error: 3, silent: 4 };
const OTHER = "__other__";

/** "[TCP] 1.2.3.4 --> x" → { cat: "TCP", text: "1.2.3.4 --> x" } */
function splitCategory(payload: string): { cat: string; text: string } {
  const m = payload.match(/^\[([^\]]{1,24})\]\s*/);
  if (!m) return { cat: OTHER, text: payload };
  return { cat: m[1], text: payload.slice(m[0].length) };
}

function stamp(ms: number) {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function fullTime(ms: number) {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${formatTime(ms, true)}`;
}

function lineOf(r: LogRow) {
  return `${fullTime(r.time)} [${r.type.toUpperCase()}] ${r.payload}`;
}

async function copyText(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export default function LogsPage() {
  const t = useT();
  const running = useApp((s) => s.core.state === "running");
  const logs = useLive((s) => s.logs);
  const logLevel = useLive((s) => s.logLevel);
  const setLogLevel = useLive((s) => s.setLogLevel);
  const paused = useLive((s) => s.logsPaused);
  const setPaused = useLive((s) => s.setLogsPaused);
  const clearLogs = useLive((s) => s.clearLogs);

  const [frozen, setFrozen] = React.useState<LogRow[] | null>(null);
  const [category, setCategory] = React.useState<string>("");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<LogRow | null>(null);

  // If the store was paused elsewhere (or on remount), take a snapshot now.
  React.useEffect(() => {
    if (paused && !frozen) setFrozen(useLive.getState().logs);
    if (!paused && frozen) setFrozen(null);
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = paused && frozen ? frozen : logs;
  const newCount = paused && frozen ? Math.max(0, (logs[logs.length - 1]?.id ?? 0) - (frozen[frozen.length - 1]?.id ?? 0)) : 0;

  // Category counts over the source (by level threshold)
  const minRank = RANK[logLevel] ?? 1;
  const levelRows = React.useMemo(() => source.filter((r) => (RANK[r.type] ?? 1) >= minRank), [source, minRank]);
  const categories = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of levelRows) {
      const c = splitCategory(r.payload).cat;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [levelRows]);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!category && !q) return levelRows;
    return levelRows.filter((r) => {
      if (category && splitCategory(r.payload).cat !== category) return false;
      if (q && !r.payload.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [levelRows, category, query]);

  /* ---------- virtual scroll ---------- */
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewH, setViewH] = React.useState(600);
  const atBottom = React.useRef(true);
  const [showJump, setShowJump] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Keyed on the newest row id (not length): the buffer is capped, so length stops changing.
  const lastId = rows[rows.length - 1]?.id ?? 0;
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || paused) return;
    if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
      setScrollTop(el.scrollTop);
    }
  }, [lastId, rows.length, paused, viewH]);

  const onScroll = () => {
    const el = scrollRef.current!;
    setScrollTop(el.scrollTop);
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H;
    atBottom.current = bottom;
    setShowJump(!bottom && !paused);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    atBottom.current = true;
    setShowJump(false);
    if (el) el.scrollTop = el.scrollHeight;
  };

  const togglePause = () => {
    if (paused) {
      setFrozen(null);
      setPaused(false);
      atBottom.current = true;
      requestAnimationFrame(jumpToLatest);
    } else {
      setFrozen(useLive.getState().logs);
      setPaused(true);
      setShowJump(false);
    }
  };

  const clear = () => {
    clearLogs();
    setSelected(null);
    if (paused) setFrozen([]);
  };

  const exportLogs = async () => {
    if (!rows.length) return;
    const content = rows.map(lineOf).join("\r\n") + "\r\n";
    const name = `clashwin-logs-${stamp(Date.now())}.log`;
    try {
      if (isTauri) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({ defaultPath: name, filters: [{ name: "Log", extensions: ["log", "txt"] }] });
        if (!path) return;
        await backend.writeTextFile(path, content);
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast.success(t("logs.exported", { n: rows.length }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const total = rows.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);

  const levelLabel = (l: string) => t(`logs.level_${l}`);
  const catLabel = (c: string) => (c === OTHER ? t("logs.catOther") : c);

  const rowMenu = (e: React.MouseEvent, r: LogRow) => {
    setSelected(r.id);
    const items: MenuEntry[] = [
      { label: t("common.copy"), icon: <Copy size={13} />, onClick: () => copyText(lineOf(r), t("common.copied")) },
      { label: t("logs.copyPayload"), onClick: () => copyText(r.payload, t("common.copied")) },
      { label: t("logs.copyAllVisible", { n: rows.length }), onClick: () => copyText(rows.map(lineOf).join("\n"), t("common.copied")) },
      "separator",
      { label: t("logs.viewDetail"), onClick: () => setDetail(r) },
    ];
    const { cat } = splitCategory(r.payload);
    items.push({ label: t("logs.filterCategory", { cat: catLabel(cat) }), onClick: () => setCategory(cat) });
    openContextMenu(e, items);
  };

  const categoryItems = (): MenuEntry[] => [
    { label: `${t("logs.allCategories")}`, checked: category === "", onClick: () => setCategory("") },
    ...(categories.length ? (["separator"] as MenuEntry[]) : []),
    ...categories.map(([c, n]) => ({
      label: (
        <span className="lg-menu-cat">
          <span>{catLabel(c)}</span>
          <span className="lg-menu-count">{n}</span>
        </span>
      ),
      checked: category === c,
      onClick: () => setCategory(c),
    })),
  ];

  return (
    <Page
      title={
        <span>
          {t("nav.logs")}
          <span className="lg-title-count">{total.toLocaleString("en-US")}</span>
        </span>
      }
      flush
      actions={
        <>
          <Dropdown items={categoryItems} align="end" minWidth={200}>
            {() => (
              <button className={cx("lg-cat-btn", category && "active")}>
                <Filter size={13} />
                <span className="ellipsis">{category ? catLabel(category) : t("logs.category")}</span>
                <ChevronDown size={11} strokeWidth={2.4} />
              </button>
            )}
          </Dropdown>
          <Select<LogLevel>
            value={logLevel}
            width={96}
            onChange={setLogLevel}
            options={(["debug", "info", "warning", "error"] as LogLevel[]).map((l) => ({
              value: l,
              label: (
                <span className="lg-level-opt">
                  <span className={`lg-dot ${l}`} />
                  {levelLabel(l)}
                </span>
              ),
            }))}
          />
          <SearchField value={query} onChange={setQuery} placeholder={t("logs.search")} width={180} />
          <Tooltip content={t(paused ? "logs.resume" : "logs.pause")}>
            <IconButton
              icon={paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
              active={paused}
              onClick={togglePause}
            />
          </Tooltip>
          <Tooltip content={t("logs.clear")}>
            <IconButton icon={<Trash2 size={15} />} onClick={clear} disabled={!source.length} />
          </Tooltip>
          <Tooltip content={t("logs.export")}>
            <IconButton icon={<Download size={15} />} onClick={exportLogs} disabled={!rows.length} />
          </Tooltip>
        </>
      }
    >
      <div className="lg-wrap">
        <div className="lg-table">
          <div className="lg-head">
            <span>{t("logs.colTime")}</span>
            <span>{t("logs.colLevel")}</span>
            <span>{t("logs.colCategory")}</span>
            <span>{t("logs.colPayload")}</span>
          </div>
          <div className="lg-scroll" ref={scrollRef} onScroll={onScroll}>
            {total === 0 ? (
              <div className="lg-empty">
                {!running && !source.length ? (
                  <Empty icon={<FileText size={30} strokeWidth={1.4} />} title={t("common.coreNotRunning")} desc={t("logs.emptyCoreDesc")} />
                ) : source.length ? (
                  <Empty icon={<Filter size={28} strokeWidth={1.4} />} title={t("logs.noMatch")} desc={t("logs.noMatchDesc")}>
                    <Button
                      size="sm"
                      onClick={() => {
                        setCategory("");
                        setQuery("");
                      }}
                    >
                      {t("logs.resetFilter")}
                    </Button>
                  </Empty>
                ) : (
                  <Empty icon={<FileText size={30} strokeWidth={1.4} />} title={t("logs.empty")} desc={t("logs.emptyDesc")} />
                )}
              </div>
            ) : (
              <div style={{ height: total * ROW_H, position: "relative" }}>
                {visible.map((r, i) => {
                  const { cat, text } = splitCategory(r.payload);
                  return (
                    <div
                      key={r.id}
                      className={cx("lg-row", `lv-${r.type}`, selected === r.id && "selected", (start + i) % 2 === 1 && "odd")}
                      style={{ top: (start + i) * ROW_H }}
                      onClick={() => setSelected(r.id)}
                      onDoubleClick={() => setDetail(r)}
                      onContextMenu={(e) => rowMenu(e, r)}
                    >
                      <span className="lg-time mono">{formatTime(r.time, true)}</span>
                      <span className="lg-level">
                        <span className={`lg-dot ${r.type}`} />
                        {levelLabel(r.type)}
                      </span>
                      <span className="lg-cat">
                        <span className={cx("lg-tag", `cat-${cat.toLowerCase()}`)}>{catLabel(cat)}</span>
                      </span>
                      <span className="lg-payload mono" title={r.payload}>
                        {text}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {paused && (
          <button className="lg-float" onClick={togglePause}>
            <Pause size={11} fill="currentColor" />
            {newCount > 0 ? t("logs.pausedNew", { n: newCount }) : t("logs.paused")}
            <span className="lg-float-action">{t("logs.resume")}</span>
          </button>
        )}
        {!paused && showJump && (
          <button className="lg-float" onClick={jumpToLatest}>
            <ArrowDown size={12} />
            {t("logs.jumpLatest")}
          </button>
        )}
      </div>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        width={620}
        title={t("logs.detailTitle")}
        footer={
          <>
            <Button icon={<Copy size={12} />} onClick={() => detail && copyText(detail.payload, t("common.copied"))}>
              {t("common.copy")}
            </Button>
            <Button variant="primary" onClick={() => setDetail(null)}>
              {t("common.done")}
            </Button>
          </>
        }
      >
        {detail && (
          <div className="lg-detail">
            <div className="lg-detail-meta">
              <span>
                <span className={`lg-dot ${detail.type}`} />
                {levelLabel(detail.type)}
              </span>
              <span className="mono">{fullTime(detail.time)}</span>
              <span className="lg-tag">{catLabel(splitCategory(detail.payload).cat)}</span>
            </div>
            <pre className="lg-detail-payload mono selectable">{detail.payload}</pre>
          </div>
        )}
      </Modal>
    </Page>
  );
}

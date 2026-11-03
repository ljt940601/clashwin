import React from "react";
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CircleX,
  Copy,
  Cpu,
  Globe,
  Plug,
  Rows3,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { Page } from "@/components/layout/Page";
import { Empty, IconButton, Segmented, SearchField, Tooltip, confirm, cx, openContextMenu, toast, type MenuEntry } from "@/components/ui";
import { useT } from "@/i18n";
import { useLive } from "@/lib/live";
import { useApp } from "@/lib/store";
import { mihomo } from "@/lib/mihomo";
import { errorMessage } from "@/lib/backend";
import { formatBytes, formatDateTime, formatDuration, formatSpeed, formatTime } from "@/lib/format";
import type { ConnectionView } from "@/lib/types";
import { useProcessIcon } from "./processIcon";
import { RuleDialog, type RuleDraft } from "./RuleDialog";
import "./requests.css";

const ROW_H = 28;
const OVERSCAN = 8;

type View = "active" | "closed";
type SortKey = "process" | "host" | "type" | "rule" | "chains" | "dlSpeed" | "ulSpeed" | "download" | "upload" | "time";
interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

/* ---------------- helpers ---------------- */
const startMs = (c: ConnectionView) => Date.parse(c.start) || 0;
const procName = (c: ConnectionView) => c.metadata.process || c.metadata.processPath?.split(/[\\/]/).pop() || "";
const hostOf = (c: ConnectionView) => c.metadata.host || c.metadata.sniffHost || c.metadata.destinationIP || "";
const chainText = (c: ConnectionView) => [...c.chains].reverse().join(" › ");
const ruleText = (c: ConnectionView) => (c.rulePayload ? `${c.rule}(${c.rulePayload})` : c.rule);
const durationOf = (c: ConnectionView, now: number) => (c.closedAt ?? now) - startMs(c);

const sortValue: Record<SortKey, (c: ConnectionView) => string | number> = {
  process: (c) => procName(c).toLowerCase(),
  host: (c) => hostOf(c).toLowerCase(),
  type: (c) => `${c.metadata.network}${c.metadata.type}`,
  rule: (c) => ruleText(c).toLowerCase(),
  chains: (c) => chainText(c).toLowerCase(),
  dlSpeed: (c) => c.downSpeed,
  ulSpeed: (c) => c.upSpeed,
  download: (c) => c.download,
  upload: (c) => c.upload,
  time: (c) => startMs(c),
};

function matches(c: ConnectionView, terms: string[]) {
  if (!terms.length) return true;
  const hay = `${procName(c)} ${c.metadata.processPath} ${hostOf(c)} ${c.metadata.destinationIP}:${c.metadata.destinationPort} ${c.metadata.sourceIP} ${ruleText(c)} ${c.chains.join(" ")} ${c.metadata.network} ${c.metadata.type}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/* ---------------- small cells ---------------- */
function ProcIcon({ path, size = 16 }: { path?: string; size?: number }) {
  const icon = useProcessIcon(path);
  if (icon) return <img className="rq-picon" src={icon} alt="" draggable={false} style={{ width: size, height: size }} />;
  return (
    <span className="rq-picon fallback" style={{ width: size, height: size }}>
      <AppWindow size={Math.round(size * 0.68)} strokeWidth={1.8} />
    </span>
  );
}

function Chain({ chains }: { chains: string[] }) {
  const segs = [...chains].reverse();
  return (
    <span className="rq-chain" title={segs.join(" › ")}>
      {segs.map((s, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight size={10} className="rq-chain-sep" strokeWidth={2.4} />}
          <span className="rq-chain-seg">{s}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

function Speed({ v, cls }: { v: number; cls: string }) {
  return v > 0 ? <span className={cls}>{formatSpeed(v)}</span> : <span className="rq-zero">—</span>;
}

/* ---------------- columns ---------------- */
interface Col {
  key: SortKey;
  label: string;
  right?: boolean;
  defaultDir: 1 | -1;
  render: (c: ConnectionView, now: number) => React.ReactNode;
}

function useColumns(): Col[] {
  const t = useT();
  return [
    {
      key: "process",
      label: t("requests.colProcess"),
      defaultDir: 1,
      render: (c) => (
        <>
          <ProcIcon path={c.metadata.processPath} />
          <span className="txt">{procName(c) || <span className="rq-dim">—</span>}</span>
        </>
      ),
    },
    {
      key: "host",
      label: t("requests.colHost"),
      defaultDir: 1,
      render: (c) => (
        <span className="txt" title={`${hostOf(c)}:${c.metadata.destinationPort}`}>
          {hostOf(c)}
          <span className="rq-dim">:{c.metadata.destinationPort}</span>
        </span>
      ),
    },
    {
      key: "type",
      label: t("requests.colType"),
      defaultDir: 1,
      render: (c) => (
        <>
          <span className={cx("rq-net", c.metadata.network === "udp" && "udp")}>{c.metadata.network.toUpperCase()}</span>
          <span className="txt rq-dim">{c.metadata.type}</span>
        </>
      ),
    },
    {
      key: "rule",
      label: t("requests.colRule"),
      defaultDir: 1,
      render: (c) => (
        <span className="txt" title={ruleText(c)}>
          {c.rule}
          {c.rulePayload && <span className="rq-dim"> {c.rulePayload}</span>}
        </span>
      ),
    },
    { key: "chains", label: t("requests.colChains"), defaultDir: 1, render: (c) => <Chain chains={c.chains} /> },
    { key: "dlSpeed", label: t("requests.colDlSpeed"), right: true, defaultDir: -1, render: (c) => <Speed v={c.downSpeed} cls="rq-dl" /> },
    { key: "ulSpeed", label: t("requests.colUlSpeed"), right: true, defaultDir: -1, render: (c) => <Speed v={c.upSpeed} cls="rq-ul" /> },
    { key: "download", label: t("requests.colDownload"), right: true, defaultDir: -1, render: (c) => formatBytes(c.download) },
    { key: "upload", label: t("requests.colUpload"), right: true, defaultDir: -1, render: (c) => formatBytes(c.upload) },
    { key: "time", label: t("requests.colDuration"), right: true, defaultDir: -1, render: (c, now) => formatDuration(durationOf(c, now)) },
  ];
}

/* ---------------- virtual table ---------------- */
function ConnTable({
  rows,
  now,
  sort,
  onSort,
  selected,
  onRowMouseDown,
  onRowContext,
  onKey,
  empty,
}: {
  rows: ConnectionView[];
  now: number;
  sort: Sort;
  onSort: (k: SortKey, defaultDir: 1 | -1) => void;
  selected: Set<string>;
  onRowMouseDown: (e: React.MouseEvent, index: number) => void;
  onRowContext: (e: React.MouseEvent, index: number) => void;
  onKey: (e: React.KeyboardEvent) => void;
  empty: React.ReactNode;
}) {
  const cols = useColumns();
  const ref = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewH, setViewH] = React.useState(600);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const slice = rows.slice(first, last);

  return (
    <div className="rq-scroll" ref={ref} tabIndex={0} onKeyDown={onKey} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
      <div className="rq-grid rq-head">
        {cols.map((c) => (
          <div
            key={c.key}
            className={cx("rq-th", c.right && "right", sort.key === c.key && "sorted")}
            onClick={() => onSort(c.key, c.defaultDir)}
          >
            <span className="ellipsis">{c.label}</span>
            {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={10} strokeWidth={2.5} /> : <ArrowDown size={10} strokeWidth={2.5} />)}
          </div>
        ))}
      </div>
      <div className="rq-body" style={{ height: rows.length * ROW_H }}>
        {slice.map((c, i) => {
          const idx = first + i;
          return (
            <div
              key={c.id}
              className={cx("rq-row rq-grid", selected.has(c.id) && "selected", !!c.closedAt && "closed")}
              style={{ top: idx * ROW_H, background: !selected.has(c.id) && idx % 2 === 1 ? "rgba(127,127,127,0.035)" : undefined }}
              onMouseDown={(e) => e.button === 0 && onRowMouseDown(e, idx)}
              onContextMenu={(e) => onRowContext(e, idx)}
            >
              {cols.map((col) => (
                <div key={col.key} className={cx("rq-td", col.right && "right")}>
                  {col.render(c, now)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {rows.length === 0 && <div className="rq-empty">{empty}</div>}
    </div>
  );
}

/* ---------------- detail panel ---------------- */
function Detail({ conn, now, onClose }: { conn: ConnectionView | null; now: number; onClose: () => void }) {
  const t = useT();
  const [shown, setShown] = React.useState<ConnectionView | null>(conn);
  React.useEffect(() => {
    if (conn) setShown(conn);
  }, [conn]);
  const c = conn ?? shown;
  const m = c?.metadata;
  return (
    <div className={cx("rq-detail", conn && "open")}>
      {c && m && (
        <div className="rq-detail-inner">
          <div className="rq-detail-head">
            <span className="ttl">{t("requests.detail")}</span>
            <span className="rq-dim ellipsis" style={{ fontSize: 11.5 }}>
              {hostOf(c)}:{m.destinationPort}
            </span>
            <span style={{ flex: 1 }} />
            <IconButton icon={<X size={13} />} variant="plain" size="sm" onClick={onClose} title={t("common.close")} />
          </div>
          <div className="rq-detail-grid">
            <section>
              <div className="rq-sec-title">
                <Cpu size={11} />
                {t("requests.secProcess")}
              </div>
              <div className="rq-proc-card">
                <ProcIcon path={m.processPath} size={32} />
                <span className="rq-proc-name">{procName(c) || "—"}</span>
              </div>
              <div className="rq-path">{m.processPath || "—"}</div>
            </section>
            <section>
              <div className="rq-sec-title">
                <Globe size={11} />
                {t("requests.secRouting")}
              </div>
              <div className="rq-kv">
                <span className="k">{t("requests.host")}</span>
                <span className="v">{m.host || "—"}</span>
                <span className="k">{t("requests.destination")}</span>
                <span className="v mono">
                  {/* Proxied domain connections have no resolved IP; fall back to the host. */}
                  {m.destinationIP || m.host || "—"}:{m.destinationPort}
                  {m.remoteDestination && m.remoteDestination !== m.destinationIP ? ` (${m.remoteDestination})` : ""}
                </span>
                <span className="k">{t("requests.network")}</span>
                <span className="v">
                  {m.network.toUpperCase()} · {m.type}
                </span>
                {m.sniffHost ? (
                  <>
                    <span className="k">{t("requests.sniffHost")}</span>
                    <span className="v">{m.sniffHost}</span>
                  </>
                ) : null}
                <span className="k">{t("requests.dnsMode")}</span>
                <span className="v">{m.dnsMode || "—"}</span>
                <span className="k">{t("requests.rule")}</span>
                <span className="v">
                  {c.rule}
                  {c.rulePayload && <span className="rq-dim"> {c.rulePayload}</span>}
                </span>
                <span className="k">{t("requests.chain")}</span>
                <span className="v">{chainText(c)}</span>
              </div>
            </section>
            <section>
              <div className="rq-sec-title">
                <Plug size={11} />
                {t("requests.secSource")}
              </div>
              <div className="rq-kv">
                <span className="k">{t("requests.sourceAddr")}</span>
                <span className="v mono">
                  {m.sourceIP}:{m.sourcePort}
                </span>
                <span className="k">{t("requests.inbound")}</span>
                <span className="v">
                  {m.inboundName || m.type}
                  {m.inboundIP ? <span className="rq-dim"> {m.inboundIP}:{m.inboundPort}</span> : null}
                </span>
                {m.inboundUser ? (
                  <>
                    <span className="k">User</span>
                    <span className="v">{m.inboundUser}</span>
                  </>
                ) : null}
              </div>
            </section>
            <section>
              <div className="rq-sec-title">
                <Rows3 size={11} />
                {t("requests.secTraffic")}
              </div>
              <div className="rq-kv">
                <span className="k">{t("requests.download")}</span>
                <span className="v">{formatBytes(c.download)}</span>
                <span className="k">{t("requests.upload")}</span>
                <span className="v">{formatBytes(c.upload)}</span>
                <span className="k">{t("requests.speed")}</span>
                <span className="v">
                  <span className="rq-dl">↓ {formatSpeed(c.downSpeed)}</span>
                  {"  "}
                  <span className="rq-ul">↑ {formatSpeed(c.upSpeed)}</span>
                </span>
                <span className="k">{t("requests.start")}</span>
                <span className="v">{formatDateTime(startMs(c))}:{String(new Date(startMs(c)).getSeconds()).padStart(2, "0")}</span>
                <span className="k">{t("requests.duration")}</span>
                <span className="v">{formatDuration(durationOf(c, now))}</span>
                {c.closedAt ? (
                  <>
                    <span className="k">{t("requests.closedAt")}</span>
                    <span className="v">{formatTime(c.closedAt)}</span>
                  </>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- page ---------------- */
export default function RequestsPage() {
  const t = useT();
  const running = useApp((s) => s.core.state === "running");
  const active = useLive((s) => s.connections);
  const closed = useLive((s) => s.closed);
  const clearClosed = useLive((s) => s.clearClosed);

  const [view, setView] = React.useState<View>("active");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<Sort>({ key: "time", dir: -1 });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [anchor, setAnchor] = React.useState<number | null>(null);
  const [ruleDraft, setRuleDraft] = React.useState<RuleDraft | null>(null);
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // reset selection when switching tabs
  React.useEffect(() => {
    setSelected(new Set());
    setFocusId(null);
    setAnchor(null);
  }, [view]);

  const source = view === "active" ? active : closed;
  const rows = React.useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = source.filter((c) => matches(c, terms));
    const get = sortValue[sort.key];
    const key = view === "closed" && sort.key === "time" ? (c: ConnectionView) => c.closedAt ?? startMs(c) : get;
    return list.sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [source, query, sort, view]);

  const focusConn = React.useMemo(() => {
    if (!focusId) return null;
    return active.find((c) => c.id === focusId) ?? closed.find((c) => c.id === focusId) ?? null;
  }, [focusId, active, closed]);

  const onSort = (key: SortKey, defaultDir: 1 | -1) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: defaultDir }));

  const selectIndex = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, index: number) => {
    const c = rows[index];
    if (!c) return;
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected(new Set(rows.slice(a, b + 1).map((r) => r.id)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        n.has(c.id) ? n.delete(c.id) : n.add(c.id);
        return n;
      });
      setAnchor(index);
    } else {
      setSelected(new Set([c.id]));
      setAnchor(index);
    }
    setFocusId(c.id);
  };

  const disconnect = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => mihomo.closeConnection(id)));
      toast.success(t("requests.disconnected", { n: ids.length }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("common.copied"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const onRowContext = (e: React.MouseEvent, index: number) => {
    const c = rows[index];
    if (!c) return;
    let sel = selected;
    if (!selected.has(c.id)) {
      sel = new Set([c.id]);
      setSelected(sel);
      setAnchor(index);
      setFocusId(c.id);
    }
    const host = hostOf(c);
    const proc = procName(c);
    const ids = [...sel];
    const items: MenuEntry[] = [
      {
        label: t("requests.addRuleDomain"),
        icon: <Globe size={13} />,
        disabled: !host,
        onClick: () => setRuleDraft({ kind: "domain", host }),
      },
      {
        label: t("requests.addRuleProcess"),
        icon: <Cpu size={13} />,
        disabled: !proc,
        onClick: () => setRuleDraft({ kind: "process", process: proc, processPath: c.metadata.processPath }),
      },
      "separator",
      { label: t("requests.copyHost"), icon: <Copy size={13} />, disabled: !host, onClick: () => copy(host) },
    ];
    if (view === "active")
      items.push("separator", {
        label: ids.length > 1 ? t("requests.disconnectN", { n: ids.length }) : t("requests.disconnect"),
        icon: <Unplug size={13} />,
        danger: true,
        onClick: () => disconnect(ids),
      });
    openContextMenu(e, items);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSelected(new Set());
      setFocusId(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && view === "active" && selected.size) {
      e.preventDefault();
      disconnect([...selected]);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(rows.map((r) => r.id)));
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const cur = focusId ? rows.findIndex((r) => r.id === focusId) : -1;
      const next = Math.max(0, Math.min(rows.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
      selectIndex({ ctrlKey: false, metaKey: false, shiftKey: e.shiftKey }, next);
      const el = e.currentTarget as HTMLDivElement;
      const top = next * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight - 30) el.scrollTop = top + ROW_H - el.clientHeight + 30;
    }
  };

  const closeAll = async () => {
    if (!active.length) return;
    const ok = await confirm({ title: t("requests.closeAll"), message: t("requests.closeAllConfirm", { n: active.length }), danger: true, confirmText: t("requests.disconnect") });
    if (!ok) return;
    try {
      await mihomo.closeAllConnections();
      toast.success(t("requests.disconnected", { n: active.length }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const empty = !running ? (
    <Empty icon={<Plug size={28} strokeWidth={1.5} />} title={t("requests.coreStopped")} desc={t("requests.coreStoppedDesc")} />
  ) : query ? (
    <Empty title={t("requests.emptySearch")} />
  ) : (
    <Empty icon={<Rows3 size={28} strokeWidth={1.5} />} title={t(view === "active" ? "requests.emptyActive" : "requests.emptyClosed")} />
  );

  return (
    <Page
      flush
      title={
        <span className="rq-title">
          {t("requests.title")}
          <span className="rq-title-count">{rows.length}</span>
        </span>
      }
      actions={
        <>
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { value: "active", label: `${t("requests.active")} (${active.length})` },
              { value: "closed", label: `${t("requests.closed")} (${closed.length})` },
            ]}
          />
          <SearchField value={query} onChange={setQuery} placeholder={t("requests.search")} width={230} />
          {view === "active" ? (
            <Tooltip content={t("requests.closeAll")}>
              <IconButton icon={<CircleX size={17} strokeWidth={1.8} />} disabled={!active.length} onClick={closeAll} />
            </Tooltip>
          ) : (
            <Tooltip content={t("requests.clearClosed")}>
              <IconButton icon={<Trash2 size={16} strokeWidth={1.8} />} disabled={!closed.length} onClick={clearClosed} />
            </Tooltip>
          )}
        </>
      }
    >
      <div className="rq-root">
        <div className="rq-table-wrap">
          <ConnTable
            rows={rows}
            now={now}
            sort={sort}
            onSort={onSort}
            selected={selected}
            onRowMouseDown={(e, i) => selectIndex(e, i)}
            onRowContext={onRowContext}
            onKey={onKey}
            empty={empty}
          />
          <Detail conn={focusConn} now={now} onClose={() => setFocusId(null)} />
        </div>
      </div>
      <RuleDialog draft={ruleDraft} onClose={() => setRuleDraft(null)} />
    </Page>
  );
}

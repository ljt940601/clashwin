import React from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  ChartColumn,
  ChartSpline,
  CircleArrowDown,
  CircleArrowUp,
  Compass,
  Cpu,
  Earth,
  Globe,
  Layers,
  Link,
  Link2,
  ListOrdered,
  MemoryStick,
  Server,
  Split,
  AppWindow,
} from "lucide-react";
import { Page } from "@/components/layout/Page";
import { StandardActions } from "@/components/layout/ToolbarActions";
import { Card, Segmented } from "@/components/ui";
import { TrafficChart } from "@/components/charts/TrafficChart";
import { BarChart, type BarDatum } from "@/components/charts/BarChart";
import { RankList } from "@/components/charts/RankList";
import { useT, useLang } from "@/i18n";
import { backend } from "@/lib/backend";
import { useLive } from "@/lib/live";
import { useApp } from "@/lib/store";
import { formatBytes, formatCount, formatSpeed, greetingKey, splitBytes } from "@/lib/format";
import { countryName, flagEmoji } from "@/lib/countries";
import type { StatsPeriod, StatsSummary } from "@/lib/types";
import "./overview.css";

type Period = "today" | "month";

/** Poll an async source on an interval; re-runs when deps change. */
function usePoll<T>(fn: () => Promise<T>, ms: number, deps: React.DependencyList): T | null {
  const [v, setV] = React.useState<T | null>(null);
  React.useEffect(() => {
    let alive = true;
    const run = () =>
      fn()
        .then((r) => alive && setV(r))
        .catch(() => {});
    run();
    const id = window.setInterval(run, ms);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

/* ---------------- Summary bar ---------------- */
function SummaryBar({ s }: { s: StatsSummary | null }) {
  const t = useT();
  const items = [
    { icon: <CircleArrowDown size={18} strokeWidth={1.6} color="var(--blue)" />, label: t("overview.download"), value: formatBytes(s?.download) },
    { icon: <CircleArrowUp size={18} strokeWidth={1.6} color="var(--red)" />, label: t("overview.upload"), value: formatBytes(s?.upload) },
    { icon: <Link size={17} strokeWidth={1.8} color="var(--teal)" />, label: t("overview.connections"), value: formatCount(s?.connections) },
    { icon: <Compass size={18} strokeWidth={1.6} color="var(--magenta)" />, label: t("overview.destinations"), value: formatCount(s?.destinations) },
  ];
  return (
    <Card className="ov-summary ov-span-3">
      {items.map((it, i) => (
        <div className="ov-sum-item" key={i}>
          <span className="ov-sum-icon">{it.icon}</span>
          <div className="ov-sum-text">
            <span className="ov-sum-label">{it.label}</span>
            <span className="ov-sum-value">{it.value}</span>
          </div>
        </div>
      ))}
    </Card>
  );
}

/* ---------------- Traffic trend ---------------- */
function TrafficTrend() {
  const t = useT();
  const navigate = useNavigate();
  const history = useLive((s) => s.trafficHistory);
  const up = useLive((s) => s.up);
  const down = useLive((s) => s.down);
  const upTotal = useLive((s) => s.uploadTotal);
  const downTotal = useLive((s) => s.downloadTotal);
  return (
    <Card
      className="ov-trend ov-span-2"
      title={t("overview.trafficTrend")}
      icon={<ChartSpline size={13} strokeWidth={2} />}
      iconColor="var(--blue)"
      onClick={() => navigate("/requests")}
    >
      <div className="ov-speeds">
        <div className="ov-speed">
          <div className="ov-speed-top">
            <ArrowDown size={11} strokeWidth={2.6} color="var(--blue)" />
            <span className="ov-big">{formatSpeed(down)}</span>
          </div>
          <span className="ov-sub">{formatBytes(downTotal)}</span>
        </div>
        <div className="ov-speed">
          <div className="ov-speed-top">
            <ArrowUp size={11} strokeWidth={2.6} color="var(--red)" />
            <span className="ov-big">{formatSpeed(up)}</span>
          </div>
          <span className="ov-sub">{formatBytes(upTotal)}</span>
        </div>
      </div>
      <div className="ov-trend-chart">
        <TrafficChart data={history} height={142} axis strokeWidth={1.5} fillOpacity={0.22} />
      </div>
    </Card>
  );
}

/* ---------------- Right column ---------------- */
function StatColumn() {
  const t = useT();
  const active = useLive((s) => s.connections.length);
  const closed = useLive((s) => s.closedCount);
  const memory = useLive((s) => s.memory);
  const appMem = usePoll(() => backend.appMemory(), 3000, []);
  return (
    <div className="ov-stack">
      <Card className="ov-mini" title={t("overview.activeConnections")} icon={<Link2 size={13} strokeWidth={2} />} iconColor="var(--teal)">
        <div className="ov-mini-row">
          <span className="ov-big">{formatCount(active)}</span>
          <span className="ov-sub">{t("overview.closed", { n: formatCount(closed) })}</span>
        </div>
      </Card>
      <Card className="ov-mini" title={t("overview.kernelMemory")} icon={<MemoryStick size={13} strokeWidth={2} />} iconColor="var(--purple)">
        <span className="ov-big">{formatBytes(memory)}</span>
      </Card>
      <Card className="ov-mini" title={t("overview.appMemory")} icon={<Cpu size={13} strokeWidth={2} />} iconColor="var(--pink)">
        <span className="ov-big">{formatBytes(appMem ?? 0)}</span>
      </Card>
    </div>
  );
}

/* ---------------- Period switch ---------------- */
function PeriodSwitch({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const t = useT();
  return (
    <Segmented<Period>
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: "today", label: t("common.today") },
        { value: "month", label: t("common.month") },
      ]}
    />
  );
}

/* ---------------- Traffic split ---------------- */
function TrafficSplit({ stats, period, onPeriod }: { stats: StatsPeriod | null; period: Period; onPeriod: (p: Period) => void }) {
  const t = useT();
  const split = stats?.split ?? { direct: 0, proxy: 0, reject: 0 };
  const total = stats?.total ?? 0;
  const sum = split.direct + split.proxy + split.reject;
  const prev = stats?.prevTotal ?? 0;
  const delta = prev > 0 ? ((total - prev) / prev) * 100 : null;
  const pct = delta === null ? "" : `${Math.abs(delta) < 10 ? Math.abs(delta).toFixed(0) : Math.round(Math.abs(delta))}%`;
  const parts = [
    { key: "direct", v: split.direct, color: "var(--split-direct)" },
    { key: "proxy", v: split.proxy, color: "var(--split-proxy)" },
    { key: "reject", v: split.reject, color: "var(--split-reject)" },
  ];
  return (
    <Card
      className="ov-split"
      title={t("overview.trafficSplit")}
      icon={<Split size={13} strokeWidth={2} />}
      iconColor="var(--indigo)"
      extra={<PeriodSwitch value={period} onChange={onPeriod} />}
    >
      <div className="ov-split-total">
        <span className="num">{formatBytes(total)}</span>
        {delta !== null && (
          <span className="ov-delta">
            {delta >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {t(period === "today" ? "overview.vsYesterday" : "overview.vsLastMonth", { p: pct })}
          </span>
        )}
      </div>
      <div className="ov-splitbar">
        {sum > 0 &&
          parts.map((p) =>
            p.v > 0 ? <div key={p.key} style={{ flexGrow: Math.max(p.v / sum, 0.008), flexBasis: 0, background: p.color, minWidth: 4 }} /> : null,
          )}
      </div>
      <div className="ov-legend">
        {parts.map((p) => (
          <div className="ov-legend-item" key={p.key}>
            <span className="ov-legend-top">
              <span className="ov-dot" style={{ background: p.color }} />
              {formatBytes(p.v)}
            </span>
            <span className="ov-legend-label">{t(`overview.${p.key}`)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- Timeline ---------------- */
/** Axis label with ~3 significant digits: "286 MB", "95.4 MB", "0 B". */
function axisBytes(v: number) {
  const { value, unit } = splitBytes(v, 2);
  const n = parseFloat(value);
  const s = n >= 100 ? Math.round(n) : n >= 10 ? +n.toFixed(1) : +n.toFixed(2);
  return `${s} ${unit}`;
}

function TrafficTimeline() {
  const t = useT();
  const [period, setPeriod] = React.useState<Period>("today");
  const stats = usePoll(() => backend.statsPeriod(period), 30000, [period]);
  const now = new Date();
  const data: BarDatum[] = (stats?.timeline ?? []).map((d) => ({
    label: d.label,
    value: d.value,
    tip: period === "today" ? `${d.label}:00 – ${String((+d.label + 1) % 24).padStart(2, "0")}:00` : `${now.getMonth() + 1}/${d.label}`,
  }));
  let avg: number | undefined;
  if (data.length) {
    const elapsed = period === "today" ? now.getHours() + 1 : now.getDate();
    const sum = data.slice(0, elapsed).reduce((a, b) => a + b.value, 0);
    avg = sum / Math.max(1, elapsed);
  }
  return (
    <Card
      className="ov-timeline ov-span-3"
      title={t("overview.trafficTimeline")}
      icon={<ChartColumn size={13} strokeWidth={2} />}
      iconColor="var(--indigo)"
      extra={<PeriodSwitch value={period} onChange={setPeriod} />}
    >
      <BarChart
        data={data}
        height={126}
        format={axisBytes}
        tipFormat={(v) => formatBytes(v)}
        average={avg}
        avgLabel={t("overview.avg")}
        xLabels={(i, n) => (period === "today" ? i % 6 === 0 : i === 0 || (i + 1) % 5 === 0 || i === n - 1)}
      />
    </Card>
  );
}

/* ---------------- Page ---------------- */
export default function OverviewPage() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const navigate = useNavigate();
  const greeting = React.useMemo(() => greetingKey(), []);
  const coreState = useApp((s) => s.core.state);
  const [period, setPeriod] = React.useState<Period>("today");
  const summary = usePoll(() => backend.statsSummary(), 10000, [coreState]);
  const stats = usePoll(() => backend.statsPeriod(period), 15000, [period, coreState]);
  const empty = t("overview.noData");

  return (
    <Page title={t(greeting)} actions={<StandardActions />}>
      <div className="ov-root">
        <SummaryBar s={summary} />

        <TrafficTrend />
        <StatColumn />

        <div className="ov-half-row">
          <TrafficSplit stats={stats} period={period} onPeriod={setPeriod} />
          <Card className="ov-policy" title={t("overview.policyGroups")} icon={<Layers size={13} strokeWidth={2} />} iconColor="var(--indigo)">
            <RankList
              items={stats?.topPolicies ?? []}
              color="var(--bar-policy)"
              format={(v) => formatBytes(v)}
              limit={3}
              track
              emptyText={empty}
              onItemClick={() => navigate("/policy")}
            />
          </Card>
        </div>

        <TrafficTimeline />

        <Card className="ov-rank" title={t("overview.topRules")} icon={<ListOrdered size={13} strokeWidth={2} />} iconColor="var(--bar-rule)">
          <RankList items={stats?.topRules ?? []} color="var(--bar-rule)" format={formatCount} emptyText={empty} onItemClick={() => navigate("/rules")} />
        </Card>
        <Card className="ov-rank" title={t("overview.topDomains")} icon={<Globe size={13} strokeWidth={2} />} iconColor="var(--bar-domain)">
          <RankList items={stats?.topDomains ?? []} color="var(--bar-domain)" format={(v) => formatBytes(v)} emptyText={empty} />
        </Card>
        <Card className="ov-rank" title={t("overview.topNodes")} icon={<Server size={13} strokeWidth={2} />} iconColor="var(--bar-node)">
          <RankList items={stats?.topNodes ?? []} color="var(--bar-node)" format={(v) => formatBytes(v)} emptyText={empty} />
        </Card>

        <div className="ov-half-row">
          <Card className="ov-rank" title={t("overview.topProcesses")} icon={<AppWindow size={13} strokeWidth={2} />} iconColor="var(--bar-process)">
            <RankList items={stats?.topProcesses ?? []} color="var(--bar-process)" format={(v) => formatBytes(v)} emptyText={empty} />
          </Card>
          <Card className="ov-rank" title={t("overview.topCountries")} icon={<Earth size={13} strokeWidth={2} />} iconColor="var(--bar-country)">
            <RankList
              items={(stats?.topCountries ?? []).map((c) => ({
                ...c,
                label: (
                  <span className="ov-flag-name">
                    <span>{flagEmoji(c.name)}</span>
                    {countryName(c.name, lang)}
                  </span>
                ),
              }))}
              color="var(--bar-country)"
              format={(v) => formatBytes(v)}
              emptyText={empty}
            />
          </Card>
        </div>
      </div>
    </Page>
  );
}

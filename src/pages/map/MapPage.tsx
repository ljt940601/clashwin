import React from "react";
import { ChevronDown, ChevronUp, Flame, LocateFixed, Plane, PowerOff } from "lucide-react";
import { Page } from "@/components/layout/Page";
import { IconButton, Segmented, Tooltip, cx } from "@/components/ui";
import { useLang, useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { countryName, flagEmoji } from "@/lib/countries";
import { formatBytes, formatSpeed } from "@/lib/format";
import { normLon } from "./geo";
import { useLocalPlace, useMapData, type HeatRow, type MapRange } from "./useRoutes";
import { WorldMap } from "./WorldMap";
import "./map.css";

const LS_TARGETS = "clashwin.map.showTargets";
const PANEL_W = 236;

function readBool(key: string, def: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === "1";
  } catch {
    return def;
  }
}
function writeBool(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {}
}

export default function MapPage() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const running = useApp((s) => s.core.state === "running");
  const [range, setRange] = React.useState<MapRange>("realtime");
  const [showTargets, setShowTargets] = React.useState(() => readBool(LS_TARGETS, false));
  // Heat panel: collapsed by default in realtime (matches the clean live view), open for history.
  const [panelPref, setPanelPref] = React.useState<Record<string, boolean>>({});
  const panelOpen = panelPref[range] ?? range !== "realtime";

  const local = useLocalPlace();
  const { data, loading } = useMapData(range, showTargets, local);
  const realtime = range === "realtime";
  const centerLon = normLon(local.lon + 25);

  const fitKey = React.useMemo(
    () =>
      data.endpoints
        .map((e) => e.id)
        .sort()
        .join("|"),
    [data.endpoints],
  );

  const toggleTargets = () => {
    setShowTargets((v) => {
      writeBool(LS_TARGETS, !v);
      return !v;
    });
  };

  const empty = realtime && !running ? "stopped" : !loading && data.routes.length === 0 ? "none" : null;

  return (
    <Page
      title={t("map.title")}
      flush
      actions={
        <>
          <Segmented<MapRange>
            size="lg"
            value={range}
            onChange={setRange}
            options={[
              { value: "realtime", label: t("map.realtime") },
              { value: "day", label: t("map.day") },
              { value: "week", label: t("map.week") },
              { value: "month", label: t("map.month") },
            ]}
          />
          <Tooltip content={t(showTargets ? "map.showTargetsOn" : "map.showTargetsOff")}>
            <IconButton
              icon={<LocateFixed size={16} strokeWidth={1.9} />}
              active={showTargets}
              className={cx("mp-target-btn", showTargets && "on")}
              onClick={toggleTargets}
              aria-pressed={showTargets}
            />
          </Tooltip>
        </>
      }
    >
      <div className="mp-root">
        <WorldMap
          data={data}
          centerLon={centerLon}
          realtime={realtime}
          fitKey={`${range}|${showTargets ? 1 : 0}|${fitKey}`}
          resetKey={`${range}|${showTargets ? 1 : 0}`}
          insetLeft={panelOpen ? PANEL_W + 16 : 0}
          lang={lang}
        />

        <HeatPanel
          open={panelOpen}
          onToggle={() => setPanelPref((p) => ({ ...p, [range]: !panelOpen }))}
          range={range}
          proxyRows={data.proxyHeat}
          targetRows={showTargets ? data.targetHeat : []}
          totalBytes={data.totalBytes}
          totalSpeed={data.totalSpeed}
          totalCount={data.totalCount}
          lang={lang}
        />

        <div className="mp-legend">
          <div className="mp-legend-row">
            <span className="mp-legend-line tunnel" />
            {t("map.tunnelRoute")}
          </div>
          <div className={cx("mp-legend-row", !showTargets && "off")}>
            <span className="mp-legend-line target" />
            {t("map.targetRoute")}
          </div>
        </div>

        {empty && (
          <div className="mp-empty">
            {empty === "stopped" ? <PowerOff size={22} /> : <Plane size={22} />}
            <div className="mp-empty-title">{t(empty === "stopped" ? "map.coreStopped" : "map.noRoutes")}</div>
            <div className="mp-empty-desc">
              {empty === "stopped" ? t("map.coreStoppedDesc") : t(realtime ? "map.noRoutesRealtime" : "map.noRoutesHistory")}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

function HeatPanel({
  open,
  onToggle,
  range,
  proxyRows,
  targetRows,
  totalBytes,
  totalSpeed,
  totalCount,
  lang,
}: {
  open: boolean;
  onToggle: () => void;
  range: MapRange;
  proxyRows: HeatRow[];
  targetRows: HeatRow[];
  totalBytes: number;
  totalSpeed: number;
  totalCount: number;
  lang: "zh" | "en";
}) {
  const t = useT();
  const realtime = range === "realtime";
  const rangeLabel = t(`map.range${range[0].toUpperCase()}${range.slice(1)}`);
  if (!open)
    return (
      <button className="mp-panel-pill" onClick={onToggle}>
        <Flame size={13} />
        <span>{t("map.heatRanking")}</span>
        {proxyRows.length > 0 && <span className="mp-pill-count">{proxyRows.length}</span>}
        <ChevronDown size={13} />
      </button>
    );
  return (
    <div className="mp-panel" style={{ width: PANEL_W }}>
      <div className="mp-panel-head">
        <Flame size={13} className="mp-panel-icon" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mp-panel-title">{t("map.heatRanking")}</div>
          <div className="mp-panel-sub">{rangeLabel}</div>
        </div>
        <button className="mp-panel-collapse" onClick={onToggle} title={t("map.collapse")}>
          <ChevronUp size={14} />
        </button>
      </div>
      <div className="mp-panel-total">
        <div>
          <span>{t("map.total")}</span>
          <b>{formatBytes(totalBytes)}</b>
        </div>
        {realtime && (
          <div>
            <span>{t("map.speed")}</span>
            <b>{formatSpeed(totalSpeed)}</b>
          </div>
        )}
        <div>
          <span>{t("map.connections")}</span>
          <b>{totalCount.toLocaleString("en-US")}</b>
        </div>
      </div>
      <div className="mp-panel-body">
        <HeatSection title={t("map.proxyCountries")} rows={proxyRows} realtime={realtime} lang={lang} kind="tunnel" />
        {targetRows.length > 0 && <HeatSection title={t("map.targetCountries")} rows={targetRows} realtime={realtime} lang={lang} kind="target" />}
      </div>
    </div>
  );
}

function HeatSection({ title, rows, realtime, lang, kind }: { title: string; rows: HeatRow[]; realtime: boolean; lang: "zh" | "en"; kind: "tunnel" | "target" }) {
  const t = useT();
  if (!rows.length) return null;
  const metric = (r: HeatRow) => (realtime ? r.speed || r.bytes : r.bytes);
  const max = Math.max(1, ...rows.map(metric));
  return (
    <div className="mp-heat">
      <div className="mp-heat-title">{title}</div>
      {rows.slice(0, 10).map((r, i) => (
        <div key={r.country || "?"} className="mp-heat-row">
          <span className="mp-heat-rank">{i + 1}</span>
          <div className="mp-heat-main">
            <div className="mp-heat-line">
              <span className="mp-heat-name ellipsis">
                {r.country ? <span className="mp-flag">{flagEmoji(r.country)}</span> : null}
                {r.country ? countryName(r.country, lang) : t("map.unknown")}
              </span>
              <span className="mp-heat-val">{realtime && r.speed > 0 ? formatSpeed(r.speed) : formatBytes(r.bytes)}</span>
            </div>
            <div className={cx("mp-heat-bar", kind)}>
              <div style={{ width: `${Math.max(3, (metric(r) / max) * 100)}%` }} />
            </div>
            <div className="mp-heat-sub ellipsis">
              {r.nodes.length > 0 && <span>{r.nodes.length === 1 ? r.nodes[0] : `${r.nodes.length} ${t("map.nodes")}`}</span>}
              <span>
                {r.count.toLocaleString("en-US")} {t("map.connections")}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

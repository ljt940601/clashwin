import React from "react";
import { useWidth } from "./TrafficChart";
import "./charts.css";

export interface BarDatum {
  label: string;
  value: number;
  /** Full label for the hover tooltip (defaults to label). */
  tip?: string;
}

/** Round a value up to a "nice" axis maximum. */
function niceCeil(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 5 ? 5 : f <= 7.5 ? 7.5 : 10;
  return nf * exp;
}

/**
 * Vertical bar chart with rounded tops, y-axis labels on the left, sparse x labels,
 * a dashed average line labelled on the right, and a hover tooltip.
 */
export function BarChart({
  data,
  height = 130,
  format,
  tipFormat,
  xLabels,
  average,
  avgLabel = "Avg",
  color = "var(--chart-bar)",
}: {
  data: BarDatum[];
  height?: number;
  format: (v: number) => string;
  /** Formatter for the hover tooltip value (defaults to `format`). */
  tipFormat?: (v: number) => string;
  /** Which indexes get an x-axis label. Defaults to every label. */
  xLabels?: (i: number, n: number) => boolean;
  /** Value for the dashed average line (omit to hide). */
  average?: number;
  avgLabel?: string;
  color?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);

  const axisW = 52; // left labels
  const rightW = 34; // "Avg" label
  const top = 8;
  const bottom = 22; // x labels
  const plotW = Math.max(0, width - axisW - rightW);
  const plotH = Math.max(10, height - top - bottom);
  const rawMax = Math.max(...data.map((d) => d.value), average ?? 0, 0);
  const max = rawMax > 0 ? niceCeil(rawMax * 1.05) : 1;
  const n = Math.max(1, data.length);
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(34, slot * 0.7));
  const y = (v: number) => top + plotH * (1 - v / max);
  const baseY = top + plotH;
  // With no data only the zero line is meaningful.
  const ticks = rawMax > 0 ? [1, 2 / 3, 1 / 3, 0] : [0];
  const r = Math.min(3, barW / 2);

  const bar = (i: number, v: number) => {
    const x = axisW + slot * i + (slot - barW) / 2;
    const h = Math.max(0, baseY - y(v));
    if (h <= 0) return null;
    const rr = Math.min(r, h);
    const yt = baseY - h;
    // rounded top corners only
    const d = `M${x},${baseY}V${yt + rr}Q${x},${yt} ${x + rr},${yt}H${x + barW - rr}Q${x + barW},${yt} ${x + barW},${yt + rr}V${baseY}Z`;
    return <path key={i} d={d} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} style={{ transition: "opacity .15s" }} />;
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - axisW;
    const i = Math.floor(px / slot);
    setHover(i >= 0 && i < n && px <= plotW ? i : null);
  };

  const hv = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="ch-bars" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {/* y-axis labels */}
          {ticks.map((f) => (
            <text
              key={f}
              x={axisW - 22}
              y={y(max * f) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--text-dim)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {format(max * f)}
            </text>
          ))}
          {/* hover column highlight */}
          {hover !== null && (
            <rect x={axisW + slot * hover} y={top} width={slot} height={plotH} fill="var(--text)" opacity={0.035} rx={4} />
          )}
          {data.map((d, i) => bar(i, d.value))}
          {/* average line */}
          {average !== undefined && average > 0 && (
            <g>
              <line
                x1={axisW}
                x2={axisW + plotW + 4}
                y1={y(average)}
                y2={y(average)}
                stroke="var(--text-dim)"
                strokeOpacity={0.55}
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <text x={width - 4} y={y(average) + 3} textAnchor="end" fontSize={8.5} fill="var(--text-dim)">
                {avgLabel}
              </text>
            </g>
          )}
          {/* x labels */}
          {data.map((d, i) =>
            (xLabels ? xLabels(i, n) : true) ? (
              <text
                key={`x${i}`}
                x={axisW + slot * i + slot / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={9}
                fill="var(--text-dim)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {d.label}
              </text>
            ) : null,
          )}
        </svg>
      )}
      {hv && hover !== null && (
        <div className="ch-bars-tip" style={{ left: axisW + slot * hover + slot / 2, top: Math.max(4, y(hv.value) - 8) }}>
          {hv.tip ?? hv.label}
          <b>{(tipFormat ?? format)(hv.value)}</b>
        </div>
      )}
    </div>
  );
}

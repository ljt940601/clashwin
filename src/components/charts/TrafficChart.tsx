import React from "react";
import { formatSpeed } from "@/lib/format";
import type { TrafficPoint } from "@/lib/live";

/** Track an element's width with ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(ref.current);
    setW(ref.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Smooth path through points (monotone-ish cubic using Catmull-Rom tension). */
export function smoothPath(pts: [number, number][], tension = 0.5): string {
  if (!pts.length) return "";
  if (pts.length < 3) return `M${pts.map((p) => p.join(",")).join("L")}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = tension / 3;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    let c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    let c2y = p2[1] - (p3[1] - p1[1]) * t;
    // clamp control points to the segment's y-range to avoid overshoot below the baseline
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    c1y = Math.max(lo, Math.min(hi, c1y));
    c2y = Math.max(lo, Math.min(hi, c2y));
    d += `C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Nice max for the y axis */
function niceMax(v: number) {
  if (v <= 0) return 1024;
  return v * 1.15;
}

let gradSeq = 0;

/**
 * Upload/download speed chart: two smoothed lines with translucent gradient fills.
 * `axis` shows speed labels on the right edge like ClashMac's Overview card.
 */
export function TrafficChart({
  data,
  height = 150,
  axis = false,
  strokeWidth = 1.6,
  fillOpacity = 0.28,
  padTop = 6,
}: {
  data: TrafficPoint[];
  height?: number;
  axis?: boolean;
  strokeWidth?: number;
  fillOpacity?: number;
  padTop?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const id = React.useMemo(() => `tg${++gradSeq}`, []);
  const axisW = axis ? 58 : 0;
  const w = Math.max(0, width - axisW);
  const h = height;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.up, d.down)), 0));
  const n = data.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = (v: number) => padTop + (h - padTop - 2) * (1 - v / max);
  const down = data.map((d, i) => [x(i), y(d.down)] as [number, number]);
  const up = data.map((d, i) => [x(i), y(d.up)] as [number, number]);
  const dPath = smoothPath(down);
  const uPath = smoothPath(up);
  const base = h - 1;
  const ticks = [1, 2 / 3, 1 / 3, 0];

  return (
    <div ref={ref} style={{ position: "relative", height: h, width: "100%" }}>
      {width > 0 && (
        <svg width={width} height={h} style={{ display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--chart-down)" stopOpacity={fillOpacity} />
              <stop offset="1" stopColor="var(--chart-down)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`${id}u`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--chart-up)" stopOpacity={fillOpacity} />
              <stop offset="1" stopColor="var(--chart-up)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {dPath && (
            <>
              <path d={`${dPath}L${w},${base}L0,${base}Z`} fill={`url(#${id}d)`} />
              <path d={`${uPath}L${w},${base}L0,${base}Z`} fill={`url(#${id}u)`} />
              <path d={uPath} fill="none" stroke="var(--chart-up)" strokeWidth={strokeWidth} strokeLinejoin="round" />
              <path d={dPath} fill="none" stroke="var(--chart-down)" strokeWidth={strokeWidth} strokeLinejoin="round" />
            </>
          )}
          {axis &&
            ticks.map((f) => (
              <text
                key={f}
                x={width - 4}
                y={y(max * f / 1.15) + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--text-dim)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatSpeed((max / 1.15) * f)}
              </text>
            ))}
        </svg>
      )}
    </div>
  );
}

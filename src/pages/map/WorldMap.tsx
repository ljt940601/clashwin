/**
 * SVG world map with zoom/pan (d3-zoom), great-circle routes, glowing endpoints,
 * ripples and planes animated with requestAnimationFrame.
 *
 * Land is drawn once in a fixed 1000×1000 virtual space and moved with a group
 * transform; overlays are drawn in screen space so strokes/labels stay crisp.
 */
import React from "react";
import { geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { interpolateZoom } from "d3-interpolate";
import { merge, mesh } from "topojson-client";
import { Maximize, Minus, Plus } from "lucide-react";
import topoUrl from "world-atlas/countries-50m.json?url";
import { Tooltip } from "@/components/ui";
import { countryName, flagEmoji } from "@/lib/countries";
import { formatBytes, formatSpeed } from "@/lib/format";
import { t as tr_ } from "@/i18n";
import type { Lang } from "@/i18n";
import { apply, greatCircle, hash01, makeProjection, pointAt, strandPath, W0, type Arc, type ScreenT, type XY } from "./geo";
import type { MapData, MapEndpoint, MapRoute } from "./useRoutes";

// Airplane silhouette pointing to +x, centred on the origin.
const PLANE =
  "M6.5,0C6.5,-0.7 5.8,-1.1 5,-1.1L1.2,-1.1L-1.8,-5.4L-3.1,-5.4L-1.4,-1.1L-4.3,-1.1L-5.6,-2.7L-6.5,-2.7L-5.7,0L-6.5,2.7L-5.6,2.7L-4.3,1.1L-1.4,1.1L-3.1,5.4L-1.8,5.4L1.2,1.1L5,1.1C5.8,1.1 6.5,0.7 6.5,0Z";

let topoPromise: Promise<any> | null = null;
function loadTopo() {
  topoPromise ??= fetch(topoUrl).then((r) => r.json());
  return topoPromise;
}

const ease = (s: number) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2);

interface Props {
  data: MapData;
  centerLon: number;
  realtime: boolean;
  fitKey: string;
  resetKey: string;
  insetLeft: number;
  lang: Lang;
}

type Tier = "thin" | "mid" | "heavy";
function tierOf(r: MapRoute, realtime: boolean): Tier {
  if (realtime) {
    if (!r.active || r.weight < 0.06) return "thin";
    return r.weight < 0.45 ? "mid" : "heavy";
  }
  if (r.weight < 0.15) return "thin";
  return r.weight < 0.5 ? "mid" : "heavy";
}

export function WorldMap({ data, centerLon, realtime, fitKey, resetKey, insetLeft, lang }: Props) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const landRef = React.useRef<SVGGElement>(null);
  const planesRef = React.useRef<SVGGElement>(null);
  const zoomRef = React.useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const trRef = React.useRef<ScreenT>({ k: 1, x: 0, y: 0 });
  const interacted = React.useRef(false);
  const animRef = React.useRef<number>(0);
  const renderRaf = React.useRef<number>(0);
  const fittedOnce = React.useRef(false);
  const epoch = React.useRef(performance.now());

  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [tr, setTr] = React.useState<ScreenT>(trRef.current);
  const [topo, setTopo] = React.useState<any>(null);
  const [hover, setHover] = React.useState<{ id: string; x: number; y: number } | null>(null);

  const proj = React.useMemo(() => makeProjection(centerLon), [centerLon]);

  /* ---------- land ---------- */
  React.useEffect(() => {
    let alive = true;
    loadTopo().then((t) => alive && setTopo(t)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const land = React.useMemo(() => {
    if (!topo) return null;
    const obj = topo.objects.countries;
    const geoms = obj.geometries.filter((g: any) => g.id !== "010"); // drop Antarctica
    const path = geoPath(proj);
    (path as any).digits?.(1);
    const landGeo = merge(topo, geoms as any);
    const borders = mesh(topo, { type: "GeometryCollection", geometries: geoms } as any, (a: any, b: any) => a !== b);
    return { land: path(landGeo as any) ?? "", borders: path(borders as any) ?? "" };
  }, [topo, proj]);

  /* ---------- size ---------- */
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scheduleRender = React.useCallback(() => {
    if (renderRaf.current) return;
    renderRaf.current = requestAnimationFrame(() => {
      renderRaf.current = 0;
      setTr({ ...trRef.current });
    });
  }, []);

  const cancelAnim = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = 0;
  };

  const minK = size.w ? Math.max(size.w / W0, size.h / 760) : 1;
  const maxK = minK * 40;

  /* ---------- zoom behaviour ---------- */
  React.useEffect(() => {
    if (!size.w || !svgRef.current) return;
    const svg = select(svgRef.current);
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([minK, maxK])
      .extent([
        [0, 0],
        [size.w, size.h],
      ])
      .translateExtent([
        [0, 30],
        [W0, 790],
      ])
      .on("zoom", (e: { transform: ZoomTransform; sourceEvent: unknown }) => {
        const t = e.transform;
        trRef.current = { k: t.k, x: t.x, y: t.y };
        landRef.current?.setAttribute("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
        if (e.sourceEvent) {
          interacted.current = true;
          cancelAnim();
        }
        scheduleRender();
      });
    svg.call(z);
    zoomRef.current = z;
    const cur = trRef.current;
    z.transform(svg, zoomIdentity.translate(cur.x, cur.y).scale(Math.max(cur.k, minK)));
    return () => {
      svg.on(".zoom", null);
    };
  }, [size.w, size.h, minK, maxK, scheduleRender]);

  const setTransform = React.useCallback((t: ScreenT) => {
    const z = zoomRef.current;
    if (!z || !svgRef.current) return;
    z.transform(select(svgRef.current), zoomIdentity.translate(t.x, t.y).scale(t.k));
  }, []);

  const animateTo = React.useCallback(
    (t1: ScreenT, maxMs = 900) => {
      cancelAnim();
      const { w, h } = size;
      if (!w) return;
      const t0 = trRef.current;
      const v0: [number, number, number] = [(w / 2 - t0.x) / t0.k, (h / 2 - t0.y) / t0.k, w / t0.k];
      const v1: [number, number, number] = [(w / 2 - t1.x) / t1.k, (h / 2 - t1.y) / t1.k, w / t1.k];
      const ip = interpolateZoom(v0, v1);
      const dur = Math.max(350, Math.min(maxMs, ip.duration * 0.55));
      const start = performance.now();
      const step = (now: number) => {
        const s = Math.min(1, (now - start) / dur);
        const [cx, cy, vw] = ip(ease(s));
        const k = w / vw;
        setTransform({ k, x: w / 2 - cx * k, y: h / 2 - cy * k });
        animRef.current = s < 1 ? requestAnimationFrame(step) : 0;
      };
      animRef.current = requestAnimationFrame(step);
    },
    [size, setTransform],
  );

  /* ---------- fitting ---------- */
  const fitTransform = React.useCallback((): ScreenT | null => {
    const { w, h } = size;
    if (!w) return null;
    const pts = data.endpoints.map((e) => proj(e.coord)).filter(Boolean) as XY[];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    if (!pts.length) return null;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const bw = Math.max(x1 - x0, pts.length > 1 ? 70 : 150);
    const bh = Math.max(y1 - y0, pts.length > 1 ? 55 : 110);
    const padL = insetLeft + 70;
    const padR = 70;
    const padT = 50;
    const padB = 80;
    const k = Math.max(minK, Math.min(minK * 22, Math.min((w - padL - padR) / bw, (h - padT - padB) / bh)));
    return { k, x: padL + (w - padL - padR) / 2 - k * cx, y: padT + (h - padT - padB) / 2 - k * cy };
  }, [size, data.endpoints, proj, insetLeft, minK]);

  React.useEffect(() => {
    interacted.current = false;
  }, [resetKey]);

  React.useEffect(() => {
    if (!size.w || interacted.current) return;
    const t1 = fitTransform();
    if (!t1) return;
    if (!fittedOnce.current) {
      fittedOnce.current = true;
      setTransform(t1);
    } else animateTo(t1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size.w, size.h, insetLeft, resetKey]);

  const zoomStep = (f: number) => {
    interacted.current = true;
    const { w, h } = size;
    const t = trRef.current;
    const k = Math.max(minK, Math.min(maxK, t.k * f));
    animateTo({ k, x: w / 2 - ((w / 2 - t.x) * k) / t.k, y: h / 2 - ((h / 2 - t.y) * k) / t.k }, 400);
  };
  const fitAll = () => {
    interacted.current = false;
    const t1 = fitTransform();
    if (t1) animateTo(t1);
  };

  /* ---------- geometry ---------- */
  const epById = React.useMemo(() => new Map(data.endpoints.map((e) => [e.id, e])), [data.endpoints]);
  const arcCache = React.useMemo(() => new Map<string, Arc>(), [proj]);
  const arcs = React.useMemo(() => {
    const m = new Map<string, Arc>();
    for (const r of data.routes) {
      const a = epById.get(r.from);
      const b = epById.get(r.to);
      if (!a || !b) continue;
      const key = `${a.coord.join(",")}>${b.coord.join(",")}`;
      let arc = arcCache.get(key);
      if (!arc) {
        arc = greatCircle(proj, a.coord, b.coord);
        arcCache.set(key, arc);
      }
      if (arc.len > 0.5) m.set(r.id, arc);
    }
    return m;
  }, [data.routes, epById, arcCache, proj]);
  const arcsRef = React.useRef(arcs);
  arcsRef.current = arcs;

  /* ---------- planes (rAF) ---------- */
  React.useEffect(() => {
    if (!realtime) return;
    let raf = 0;
    const loop = (now: number) => {
      const g = planesRef.current;
      if (g && document.visibilityState === "visible") {
        const t = trRef.current;
        const kids = g.children;
        for (let i = 0; i < kids.length; i++) {
          const el = kids[i] as SVGGElement;
          const id = el.dataset.r!;
          const arc = arcsRef.current.get(id);
          if (!arc) {
            el.setAttribute("opacity", "0");
            continue;
          }
          const n = Number(el.dataset.n) || 1;
          const idx = Number(el.dataset.i) || 0;
          const dur = Math.min(9000, 2600 + arc.len * 14);
          const u = ((now - epoch.current) / dur + idx / n + hash01(id)) % 1;
          const p = pointAt(arc, t, u);
          if (!p) {
            el.setAttribute("opacity", "0");
            continue;
          }
          const op = Math.max(0, Math.min(1, u / 0.07, (1 - u) / 0.07));
          el.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${((p.a * 180) / Math.PI).toFixed(1)})`);
          el.setAttribute("opacity", op.toFixed(2));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [realtime]);

  React.useEffect(() => () => cancelAnim(), []);

  /* ---------- render ---------- */
  const { w, h } = size;
  const onScreen = (p: XY, m = 40) => p[0] > -m && p[0] < w + m && p[1] > -m && p[1] < h + m;
  const screenOf = (e: MapEndpoint): XY | null => {
    const p = proj(e.coord);
    return p ? apply(tr, [p[0], p[1]]) : null;
  };

  const routeEls: React.ReactNode[] = [];
  const planeEls: React.ReactNode[] = [];
  // Draw light routes first so heavy ones sit on top.
  const ordered = [...data.routes].sort((a, b) => a.weight - b.weight);
  for (const r of ordered) {
    const arc = arcs.get(r.id);
    if (!arc) continue;
    const tier = tierOf(r, realtime);
    const cls = r.kind === "target" ? "target" : "tunnel";
    if (tier === "thin") {
      routeEls.push(<path key={r.id} className={`mp-route ${cls} thin`} d={strandPath(arc, tr, 0, 0, 0)} />);
    } else if (tier === "mid") {
      const d = strandPath(arc, tr, 0, 0, 0);
      routeEls.push(
        <g key={r.id}>
          <path className={`mp-route ${cls} glow`} d={d} />
          <path className={`mp-route ${cls} mid`} d={d} />
        </g>,
      );
    } else {
      const n = 2 + Math.round(r.weight * 2); // 2..4 strands
      const gap = 2.3;
      const ph = hash01(r.id) * Math.PI * 2;
      routeEls.push(
        <g key={r.id}>
          <path className={`mp-route ${cls} glow wide`} d={strandPath(arc, tr, 0, 0, 0)} />
          {Array.from({ length: n }, (_, i) => (
            <path key={i} className={`mp-route ${cls} strand`} d={strandPath(arc, tr, (i - (n - 1) / 2) * gap, 1.1, ph + i * 1.7)} />
          ))}
        </g>,
      );
    }
    if (realtime && r.active) {
      const n = r.weight < 0.3 ? 1 : r.weight < 0.7 ? 2 : 3;
      for (let i = 0; i < n; i++)
        planeEls.push(
          <g key={`${r.id}#${i}`} data-r={r.id} data-i={i} data-n={n} opacity={0} className={`mp-plane ${cls}`}>
            <path d={PLANE} transform="scale(0.82)" />
          </g>,
        );
    }
  }

  const ripples: React.ReactNode[] = [];
  const dots: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];
  for (const e of data.endpoints) {
    const p = screenOf(e);
    if (!p || !onScreen(p)) continue;
    const cls = e.kind;
    const landing = e.kind !== "local" && (realtime ? e.speed > 0 : e.bytes > 0);
    if (landing && realtime) {
      ripples.push(
        <g key={e.id} transform={`translate(${p[0].toFixed(1)},${p[1].toFixed(1)})`} className={`mp-ripple-g ${cls}`}>
          <circle className="mp-ripple" r={14} style={{ animationDelay: `${(hash01(e.id) * 2.4).toFixed(2)}s` }} />
          <circle className="mp-ripple" r={14} style={{ animationDelay: `${(hash01(e.id) * 2.4 + 1.2).toFixed(2)}s` }} />
        </g>,
      );
    }
    dots.push(
      <g
        key={e.id}
        className={`mp-ep ${cls}`}
        transform={`translate(${p[0].toFixed(1)},${p[1].toFixed(1)})`}
        onMouseEnter={(ev) => {
          const r = wrapRef.current!.getBoundingClientRect();
          setHover({ id: e.id, x: ev.clientX - r.left, y: ev.clientY - r.top });
        }}
        onMouseMove={(ev) => {
          const r = wrapRef.current!.getBoundingClientRect();
          setHover({ id: e.id, x: ev.clientX - r.left, y: ev.clientY - r.top });
        }}
        onMouseLeave={() => setHover(null)}
      >
        <circle className="mp-halo" r={e.kind === "local" ? 13 : 8} />
        <circle className="mp-ring" r={3.6} />
        <circle className="mp-core" r={1.7} />
        <circle className="mp-hit" r={11} />
      </g>,
    );
    if (e.showLabel)
      labels.push(
        <text key={e.id} className={`mp-label ${cls}`} x={(p[0] + 7.5).toFixed(1)} y={(p[1] + 3.2).toFixed(1)}>
          {e.kind === "local" ? tr_("map.local") : countryName(e.country, lang)}
        </text>,
      );
  }

  const hoverEp = hover ? epById.get(hover.id) : null;

  return (
    <div ref={wrapRef} className="mp-canvas">
      {w > 0 && (
        <svg ref={svgRef} className="mp-svg" width={w} height={h}>
          <g ref={landRef} transform={`translate(${trRef.current.x},${trRef.current.y}) scale(${trRef.current.k})`}>
            {land && (
              <>
                <path className="mp-land" d={land.land} />
                <path className="mp-borders" d={land.borders} />
              </>
            )}
          </g>
          <g className="mp-routes">{routeEls}</g>
          <g>{ripples}</g>
          <g ref={planesRef} className="mp-planes">
            {planeEls}
          </g>
          <g>{dots}</g>
          <g className="mp-labels">{labels}</g>
        </svg>
      )}
      <div className="mp-fade" />

      {hoverEp && hover && <EndpointTip ep={hoverEp} x={hover.x} y={hover.y} w={w} realtime={realtime} lang={lang} />}

      <div className="mp-zoom">
        <Tooltip content={tr_("map.zoomIn")}>
          <button onClick={() => zoomStep(1.7)}>
            <Plus size={14} />
          </button>
        </Tooltip>
        <Tooltip content={tr_("map.zoomOut")}>
          <button onClick={() => zoomStep(1 / 1.7)}>
            <Minus size={14} />
          </button>
        </Tooltip>
        <Tooltip content={tr_("map.fitView")}>
          <button onClick={fitAll}>
            <Maximize size={12} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function EndpointTip({ ep, x, y, w, realtime, lang }: { ep: MapEndpoint; x: number; y: number; w: number; realtime: boolean; lang: Lang }) {
  const title =
    ep.kind === "local" ? (
      <>
        {flagEmoji(ep.country)} {tr_("map.local")} · {countryName(ep.country, lang)}
      </>
    ) : (
      <>
        {flagEmoji(ep.country)} {countryName(ep.country, lang)}
      </>
    );
  const left = x + 248 > w ? x - 244 : x + 14;
  return (
    <div className="mp-tip" style={{ left, top: y + 14 }}>
      <div className="mp-tip-title">{title}</div>
      {ep.nodes.length > 0 && (
        <div className="mp-tip-nodes">
          {ep.nodes.slice(0, 4).map((n) => (
            <div key={n} className="ellipsis">
              {n}
            </div>
          ))}
          {ep.nodes.length > 4 && <div className="dim">{tr_("map.moreNodes", { n: ep.nodes.length - 4 })}</div>}
        </div>
      )}
      <div className="mp-tip-grid">
        <span>{tr_("map.traffic")}</span>
        <b>{formatBytes(ep.bytes)}</b>
        {realtime && (
          <>
            <span>{tr_("map.speed")}</span>
            <b>{formatSpeed(ep.speed)}</b>
          </>
        )}
        <span>{tr_("map.connections")}</span>
        <b>{ep.count.toLocaleString("en-US")}</b>
      </div>
    </div>
  );
}

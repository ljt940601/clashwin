/**
 * Geometry helpers for the flight map: projection in a fixed 1000×1000
 * "virtual" space, great-circle sampling split at the antimeridian seam,
 * deterministic jitter for departure points, and polyline measuring.
 */
import { geoDistance, geoInterpolate, geoMercator, type GeoProjection } from "d3-geo";

export const W0 = 1000;
export type LonLat = [number, number];
export type XY = [number, number];

/** Mercator rotated so the world seam sits roughly opposite the user's location. */
export function makeProjection(centerLon: number): GeoProjection {
  return geoMercator()
    .rotate([-centerLon, 0])
    .scale(W0 / (2 * Math.PI))
    .translate([W0 / 2, W0 / 2]);
}

export function normLon(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** FNV-1a string hash → [0, 1) */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Small territories: keep jittered points close to land.
const SMALL = new Set(["SG", "HK", "MO", "LU", "BE", "NL", "CH", "IL", "TW", "AE", "DK", "EE", "LV", "LT", "MD"]);

/** Deterministic "departure point randomization" around a country's hub city. */
export function jitter(coord: LonLat, key: string, country: string): LonLat {
  const maxR = SMALL.has(country) ? 0.35 : 1.8;
  const a = hash01(key, 7) * Math.PI * 2;
  const r = (0.25 + 0.75 * hash01(key, 13)) * maxR;
  return [coord[0] + Math.cos(a) * r, coord[1] + Math.sin(a) * r * 0.7];
}

export interface Arc {
  segments: XY[][]; // split at the projection seam
  pts: XY[]; // all samples (virtual space), used for plane traversal
  t: number[]; // global parameter 0..1 per sample
  len: number; // approx virtual length
}

/** Great-circle arc between two lon/lat points, sampled and projected. */
export function greatCircle(proj: GeoProjection, a: LonLat, b: LonLat): Arc {
  const d = geoDistance(a, b); // radians
  const n = Math.max(12, Math.min(96, Math.round(d * 60)));
  const ip = geoInterpolate(a, b);
  const pts: XY[] = [];
  const t: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = proj(ip(i / n));
    if (!p) continue;
    pts.push([p[0], p[1]]);
    t.push(i / n);
  }
  const segments: XY[][] = [];
  let cur: XY[] = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      if (Math.abs(dx) > W0 / 2) {
        if (cur.length > 1) segments.push(cur);
        cur = [];
      } else len += Math.hypot(dx, dy);
    }
    cur.push(pts[i]);
  }
  if (cur.length > 1) segments.push(cur);
  return { segments, pts, t, len };
}

export interface ScreenT {
  k: number;
  x: number;
  y: number;
}

export const apply = (tr: ScreenT, p: XY): XY => [p[0] * tr.k + tr.x, p[1] * tr.k + tr.y];

/**
 * Screen-space path for one strand of an arc. `offset` (px) shifts the strand
 * along the normal, tapering to 0 at both ends; `weave` adds a braid wobble.
 */
export function strandPath(arc: Arc, tr: ScreenT, offset: number, weave: number, phase: number): string {
  let d = "";
  let gi = 0;
  for (const seg of arc.segments) {
    const s = seg.map((p) => apply(tr, p));
    for (let i = 0; i < s.length; i++, gi++) {
      let [x, y] = s[i];
      if (offset !== 0 || weave !== 0) {
        const p0 = s[Math.max(0, i - 1)];
        const p1 = s[Math.min(s.length - 1, i + 1)];
        const dx = p1[0] - p0[0];
        const dy = p1[1] - p0[1];
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l;
        const ny = dx / l;
        const tg = arc.t[Math.min(gi, arc.t.length - 1)] ?? i / (s.length - 1);
        const env = Math.sin(Math.PI * tg);
        const o = env * (offset + weave * Math.sin(tg * Math.PI * 5 + phase));
        x += nx * o;
        y += ny * o;
      }
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }
  }
  return d;
}

/** Point + heading (radians) at progress u ∈ [0,1] along an arc, in screen space. */
export function pointAt(arc: Arc, tr: ScreenT, u: number): { x: number; y: number; a: number } | null {
  const pts = arc.pts;
  if (pts.length < 2) return null;
  const f = u * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const r = f - i;
  const p0 = pts[i];
  const p1 = pts[i + 1];
  if (Math.abs(p1[0] - p0[0]) > W0 / 2) return null; // crossing the seam: hide for a frame
  const x = (p0[0] + (p1[0] - p0[0]) * r) * tr.k + tr.x;
  const y = (p0[1] + (p1[1] - p0[1]) * r) * tr.k + tr.y;
  const a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  return { x, y, a };
}

export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip.includes(":")) return /^(::1|f[cd]|fe80|::ffff:(10|127|192\.168)\.)/i.test(ip);
  return /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|198\.1[89]\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/.test(ip);
}

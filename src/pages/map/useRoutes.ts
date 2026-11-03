/**
 * Builds map endpoints / routes / heat ranking from live connections (realtime)
 * or from the backend history aggregates (day / week / month).
 */
import React from "react";
import { backend } from "@/lib/backend";
import { useLive } from "@/lib/live";
import { useApp } from "@/lib/store";
import { countryCoord, SPECIAL_POLICIES } from "@/lib/countries";
import { nodeCountry, refreshNodeCountries } from "@/lib/nodeGeo";
import type { RouteAgg } from "@/lib/types";
import { isPrivateIp, jitter, type LonLat } from "./geo";

export type MapRange = "realtime" | "day" | "week" | "month";

export interface MapEndpoint {
  id: string; // "local" | "p:<node|country>" | "t:<country>"
  kind: "local" | "proxy" | "target";
  country: string;
  coord: LonLat;
  nodes: string[];
  bytes: number;
  speed: number;
  count: number;
  showLabel: boolean;
}

export interface MapRoute {
  id: string;
  kind: "tunnel" | "target";
  from: string;
  to: string;
  bytes: number;
  speed: number;
  count: number;
  weight: number; // 0..1 relative intensity
  active: boolean; // planes fly on it
}

export interface HeatRow {
  country: string; // "" = unknown
  nodes: string[];
  bytes: number;
  speed: number;
  count: number;
}

export interface LocalPlace {
  country: string;
  city: string;
  lat: number;
  lon: number;
}

export interface MapData {
  endpoints: MapEndpoint[];
  routes: MapRoute[];
  proxyHeat: HeatRow[];
  targetHeat: HeatRow[];
  totalBytes: number;
  totalSpeed: number;
  totalCount: number;
}

const EMPTY: MapData = { endpoints: [], routes: [], proxyHeat: [], targetHeat: [], totalBytes: 0, totalSpeed: 0, totalCount: 0 };
const MAX_ROUTES = 48;

/* ---------------- GeoIP cache (module level, shared across mounts) ---------------- */
const geoCache = new Map<string, string | null>();
const geoPending = new Set<string>();

async function resolveIps(ips: string[]): Promise<boolean> {
  const todo: string[] = [];
  for (const ip of ips) {
    if (geoCache.has(ip) || geoPending.has(ip)) continue;
    if (isPrivateIp(ip)) {
      geoCache.set(ip, null);
      continue;
    }
    todo.push(ip);
  }
  if (!todo.length) return false;
  todo.forEach((ip) => geoPending.add(ip));
  try {
    for (let i = 0; i < todo.length; i += 200) {
      const chunk = todo.slice(i, i + 200);
      const res = await backend.geoipLookup(chunk);
      chunk.forEach((ip, j) => geoCache.set(ip, res?.[j] ?? null));
    }
  } catch {
    todo.forEach((ip) => geoCache.set(ip, null));
  } finally {
    todo.forEach((ip) => geoPending.delete(ip));
  }
  return true;
}

/* ---------------- Aggregation ---------------- */
interface RawRoute {
  node: string; // node name or "" when grouped by country only
  proxyCountry: string;
  targetCountry: string | null;
  bytes: number;
  speed: number;
  count: number;
}

function build(raw: RawRoute[], local: LocalPlace, showTargets: boolean, realtime: boolean): MapData {
  const localCoord: LonLat = [local.lon, local.lat];
  const proxyEps = new Map<string, MapEndpoint>();
  const targetEps = new Map<string, MapEndpoint>();
  const tunnels = new Map<string, MapRoute>();
  const targets = new Map<string, MapRoute>();
  const pHeat = new Map<string, HeatRow>();
  const tHeat = new Map<string, HeatRow>();
  let totalBytes = 0;
  let totalSpeed = 0;
  let totalCount = 0;

  for (const r of raw) {
    totalBytes += r.bytes;
    totalSpeed += r.speed;
    totalCount += r.count;

    // heat ranking by proxy country (unknown countries still listed)
    const hk = r.proxyCountry || "";
    const h = pHeat.get(hk) ?? { country: hk, nodes: [], bytes: 0, speed: 0, count: 0 };
    h.bytes += r.bytes;
    h.speed += r.speed;
    h.count += r.count;
    if (r.node && !h.nodes.includes(r.node)) h.nodes.push(r.node);
    pHeat.set(hk, h);

    const base = countryCoord(r.proxyCountry);
    if (!base) continue;
    const key = r.node || r.proxyCountry;
    const pid = `p:${key}`;
    let ep = proxyEps.get(pid);
    if (!ep) {
      ep = {
        id: pid,
        kind: "proxy",
        country: r.proxyCountry,
        coord: jitter(base, key, r.proxyCountry),
        nodes: [],
        bytes: 0,
        speed: 0,
        count: 0,
        showLabel: false,
      };
      proxyEps.set(pid, ep);
    }
    ep.bytes += r.bytes;
    ep.speed += r.speed;
    ep.count += r.count;
    if (r.node && !ep.nodes.includes(r.node)) ep.nodes.push(r.node);

    const tid = `tn:${key}`;
    const tr = tunnels.get(tid) ?? { id: tid, kind: "tunnel" as const, from: "local", to: pid, bytes: 0, speed: 0, count: 0, weight: 0, active: false };
    tr.bytes += r.bytes;
    tr.speed += r.speed;
    tr.count += r.count;
    tunnels.set(tid, tr);

    if (showTargets && r.targetCountry) {
      const tc = r.targetCountry;
      const th = tHeat.get(tc) ?? { country: tc, nodes: [], bytes: 0, speed: 0, count: 0 };
      th.bytes += r.bytes;
      th.speed += r.speed;
      th.count += r.count;
      if (r.node && !th.nodes.includes(r.node)) th.nodes.push(r.node);
      tHeat.set(tc, th);

      const tcoord = countryCoord(tc);
      if (!tcoord) continue;
      // Landing in the same country as the proxy: no separate target leg.
      if (tc === r.proxyCountry) continue;
      const eid = `t:${tc}`;
      const te = targetEps.get(eid) ?? { id: eid, kind: "target" as const, country: tc, coord: tcoord, nodes: [], bytes: 0, speed: 0, count: 0, showLabel: true };
      te.bytes += r.bytes;
      te.speed += r.speed;
      te.count += r.count;
      if (r.node && !te.nodes.includes(r.node)) te.nodes.push(r.node);
      targetEps.set(eid, te);
      const rid = `tg:${key}>${tc}`;
      const rr = targets.get(rid) ?? { id: rid, kind: "target" as const, from: pid, to: eid, bytes: 0, speed: 0, count: 0, weight: 0, active: false };
      rr.bytes += r.bytes;
      rr.speed += r.speed;
      rr.count += r.count;
      targets.set(rid, rr);
    }
  }

  // Normalise intensity and pick the busiest routes.
  const all = [...tunnels.values(), ...targets.values()];
  const metric = (r: MapRoute) => (realtime ? r.speed : r.bytes);
  const max = Math.max(realtime ? 64 * 1024 : 1, ...all.map(metric));
  for (const r of all) {
    r.weight = Math.min(1, metric(r) / max);
    r.active = realtime ? r.speed > 0 : false;
  }
  const routes = all.sort((a, b) => metric(b) - metric(a) || b.bytes - a.bytes).slice(0, MAX_ROUTES);
  const used = new Set<string>(["local"]);
  routes.forEach((r) => {
    used.add(r.from);
    used.add(r.to);
  });

  // One label per country for proxy endpoints: the busiest node carries it.
  const proxies = [...proxyEps.values()].filter((e) => used.has(e.id));
  const labelled = new Set<string>();
  [...proxies].sort((a, b) => b.bytes - a.bytes).forEach((e) => {
    if (!labelled.has(e.country)) {
      labelled.add(e.country);
      e.showLabel = true;
    }
  });
  const targetsUsed = [...targetEps.values()].filter((e) => used.has(e.id)).map((e) => ({ ...e, showLabel: !labelled.has(e.country) }));

  const localEp: MapEndpoint = {
    id: "local",
    kind: "local",
    country: local.country,
    coord: localCoord,
    nodes: [],
    bytes: totalBytes,
    speed: totalSpeed,
    count: totalCount,
    showLabel: true,
  };

  const sortHeat = (m: Map<string, HeatRow>) => [...m.values()].sort((a, b) => (realtime ? b.speed - a.speed || b.bytes - a.bytes : b.bytes - a.bytes));
  return {
    endpoints: [localEp, ...proxies, ...targetsUsed],
    routes,
    proxyHeat: sortHeat(pHeat),
    targetHeat: sortHeat(tHeat),
    totalBytes,
    totalSpeed,
    totalCount,
  };
}

function rawFromLive(showTargets: boolean): { raw: RawRoute[]; ips: string[] } {
  const conns = useLive.getState().connections;
  const byKey = new Map<string, RawRoute>();
  const ips = new Set<string>();
  for (const c of conns) {
    const node = c.chains?.[0];
    if (!node || SPECIAL_POLICIES.has(node.toUpperCase())) continue;
    const pc = nodeCountry(node) ?? "";
    const ip = c.metadata?.destinationIP ?? "";
    let tc: string | null = null;
    if (showTargets && ip) {
      if (geoCache.has(ip)) tc = geoCache.get(ip) ?? null;
      else ips.add(ip);
    }
    const key = `${node}|${tc ?? ""}`;
    const r = byKey.get(key) ?? { node, proxyCountry: pc, targetCountry: tc, bytes: 0, speed: 0, count: 0 };
    r.bytes += c.upload + c.download;
    r.speed += c.upSpeed + c.downSpeed;
    r.count += 1;
    byKey.set(key, r);
  }
  return { raw: [...byKey.values()], ips: [...ips] };
}

function rawFromHistory(rows: RouteAgg[]): RawRoute[] {
  return rows.map((r) => ({
    node: r.node ?? "",
    proxyCountry: r.proxyCountry || nodeCountry(r.node) || "",
    targetCountry: r.targetCountry || null,
    bytes: r.bytes,
    speed: 0,
    count: r.count,
  }));
}

/** Local place (map origin), fetched once. */
let localCache: LocalPlace | null = null;
export function useLocalPlace(): LocalPlace {
  const [place, setPlace] = React.useState<LocalPlace>(localCache ?? { country: "CN", city: "Shanghai", lat: 31.23, lon: 121.47 });
  React.useEffect(() => {
    if (localCache) return;
    backend
      .localLocation()
      .then((p) => {
        if (p && isFinite(p.lat) && isFinite(p.lon)) {
          localCache = p;
          setPlace(p);
        }
      })
      .catch(() => {});
  }, []);
  return place;
}

export function useMapData(range: MapRange, showTargets: boolean, local: LocalPlace): { data: MapData; loading: boolean } {
  const running = useApp((s) => s.core.state === "running");
  const [data, setData] = React.useState<MapData>(EMPTY);
  const [loading, setLoading] = React.useState(false);

  // Realtime: recompute every 2 s from the live connection snapshot.
  React.useEffect(() => {
    if (range !== "realtime") return;
    let alive = true;
    refreshNodeCountries();
    const tick = () => {
      if (!alive) return;
      const { raw, ips } = rawFromLive(showTargets);
      setData(build(raw, local, showTargets, true));
      if (ips.length)
        resolveIps(ips).then((changed) => {
          if (changed && alive) {
            const again = rawFromLive(showTargets);
            setData(build(again.raw, local, showTargets, true));
          }
        });
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [range, showTargets, local, running]);

  // History: fetch aggregates on range change and every minute.
  React.useEffect(() => {
    if (range === "realtime") return;
    let alive = true;
    const load = (first: boolean) => {
      if (first) setLoading(true);
      Promise.all([backend.statsRoutes(range), refreshNodeCountries()])
        .then(([rows]) => alive && setData(build(rawFromHistory(rows ?? []), local, showTargets, false)))
        .catch(() => alive && setData(EMPTY))
        .finally(() => alive && setLoading(false));
    };
    load(true);
    const id = window.setInterval(() => load(false), 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [range, showTargets, local]);

  return { data, loading };
}

/**
 * Live data from the mihomo controller streams, shared per window.
 * Call `startLive()` once when the window mounts (it's idempotent and follows
 * the core's running state). Components read with `useLive(selector)`.
 */
import { create } from "zustand";
import { stream } from "./mihomo";
import { useApp } from "./store";
import type { Connection, ConnectionView, LogLevel, LogRow } from "./types";

export const TRAFFIC_POINTS = 60;
const CLOSED_CAP = 1000;
const LOG_CAP = 3000;

export interface TrafficPoint {
  t: number;
  up: number;
  down: number;
}

interface LiveState {
  connected: boolean;
  up: number;
  down: number;
  trafficHistory: TrafficPoint[]; // last 60 s, oldest first
  uploadTotal: number; // since core start
  downloadTotal: number;
  memory: number; // core memory in use
  connections: ConnectionView[];
  closed: ConnectionView[]; // newest first
  closedCount: number;
  logs: LogRow[]; // oldest first
  logLevel: LogLevel;
  logsPaused: boolean;

  setLogLevel: (l: LogLevel) => void;
  setLogsPaused: (p: boolean) => void;
  clearLogs: () => void;
  clearClosed: () => void;
}

const emptyHistory = (): TrafficPoint[] => {
  const now = Date.now();
  return Array.from({ length: TRAFFIC_POINTS }, (_, i) => ({ t: now - (TRAFFIC_POINTS - i) * 1000, up: 0, down: 0 }));
};

export const useLive = create<LiveState>((set, get) => ({
  connected: false,
  up: 0,
  down: 0,
  trafficHistory: emptyHistory(),
  uploadTotal: 0,
  downloadTotal: 0,
  memory: 0,
  connections: [],
  closed: [],
  closedCount: 0,
  logs: [],
  logLevel: "info",
  logsPaused: false,
  setLogLevel: (logLevel) => {
    set({ logLevel });
    restartLogs();
  },
  setLogsPaused: (logsPaused) => set({ logsPaused }),
  clearLogs: () => set({ logs: [] }),
  clearClosed: () => set({ closed: [], closedCount: 0 }),
}));

let stops: (() => void)[] = [];
let logStop: (() => void) | null = null;
let wantLogs = false;
let started = false;
let prev = new Map<string, Connection>();
let logSeq = 0;
let pendingLogs: LogRow[] = [];
let logFlushTimer: number | undefined;

function stopAll() {
  stops.forEach((f) => f());
  stops = [];
  logStop?.();
  logStop = null;
  prev = new Map();
}

function startStreams() {
  stopAll();
  stops.push(
    stream("traffic", (d) => {
      const hist = get().trafficHistory.slice(1);
      hist.push({ t: Date.now(), up: d.up, down: d.down });
      useLive.setState({ up: d.up, down: d.down, trafficHistory: hist });
    }, { onStatus: (c) => useLive.setState({ connected: c }) }),
  );
  stops.push(stream("memory", (d) => useLive.setState({ memory: d.inuse })));
  stops.push(
    stream("connections", (snap) => {
      const list = snap.connections ?? [];
      const next = new Map<string, Connection>();
      const views: ConnectionView[] = list.map((c) => {
        next.set(c.id, c);
        const p = prev.get(c.id);
        return {
          ...c,
          upSpeed: p ? Math.max(0, c.upload - p.upload) : 0,
          downSpeed: p ? Math.max(0, c.download - p.download) : 0,
        };
      });
      const now = Date.now();
      const newlyClosed: ConnectionView[] = [];
      prev.forEach((c, id) => {
        if (!next.has(id)) newlyClosed.push({ ...c, upSpeed: 0, downSpeed: 0, closedAt: now });
      });
      prev = next;
      const st = get();
      useLive.setState({
        connections: views,
        uploadTotal: snap.uploadTotal,
        downloadTotal: snap.downloadTotal,
        ...(newlyClosed.length
          ? {
              closed: [...newlyClosed, ...st.closed].slice(0, CLOSED_CAP),
              closedCount: st.closedCount + newlyClosed.length,
            }
          : {}),
      });
    }),
  );
  if (wantLogs) restartLogs();
}

function get() {
  return useLive.getState();
}

function restartLogs() {
  logStop?.();
  logStop = null;
  if (!wantLogs || useApp.getState().core.state !== "running") return;
  logStop = stream(
    "logs",
    (e) => {
      if (get().logsPaused) {
        // keep recording in background while paused
      }
      pendingLogs.push({ ...e, id: ++logSeq, time: Date.now() });
      if (!logFlushTimer)
        logFlushTimer = window.setTimeout(() => {
          logFlushTimer = undefined;
          const merged = get().logs.concat(pendingLogs);
          pendingLogs = [];
          useLive.setState({ logs: merged.length > LOG_CAP ? merged.slice(merged.length - LOG_CAP) : merged });
        }, 250);
    },
    { level: get().logLevel },
  );
}

/** Start following the core. Safe to call many times. */
export function startLive(opts: { logs?: boolean } = {}) {
  if (opts.logs && !wantLogs) {
    wantLogs = true;
    if (started) restartLogs();
  }
  if (started) return;
  started = true;
  let lastKey = "";
  const sync = () => {
    const { core } = useApp.getState();
    const key = core.state === "running" ? `${core.controller.url}|${core.controller.secret}|${core.pid ?? ""}` : "";
    if (key === lastKey) return;
    lastKey = key;
    if (key) startStreams();
    else {
      stopAll();
      useLive.setState({ connected: false, up: 0, down: 0, connections: [], memory: 0 });
    }
  };
  sync();
  useApp.subscribe(sync);
}

/**
 * Node download speed tests (one node at a time). Results live for the session so they
 * survive page changes.
 */
import { create } from "zustand";
import { backend, errorCode, errorMessage, listen } from "./backend";
import type { SpeedProgress, SpeedResult } from "./types";

interface SpeedTestState {
  /** node being tested, with live progress */
  running: SpeedProgress | null;
  results: Record<string, SpeedResult>;
  /** last failure per node (cleared by a successful test) */
  errors: Record<string, string>;
  start: (node: string) => Promise<void>;
  cancel: () => void;
}

let listening = false;

export const useSpeedTest = create<SpeedTestState>((set, get) => ({
  running: null,
  results: {},
  errors: {},
  start: async (node) => {
    if (get().running) return;
    if (!listening) {
      listening = true;
      listen<SpeedProgress>("speedtest://progress", (p) => {
        if (get().running?.node === p.node) set({ running: p });
      });
    }
    set({ running: { node, downloaded: 0, total: 0, bytesPerSec: 0 } });
    try {
      const r = await backend.speedTest(node);
      set((s) => {
        const errors = { ...s.errors };
        delete errors[node];
        return { results: { ...s.results, [node]: r }, errors };
      });
    } catch (e) {
      if (errorCode(e) !== "CANCELLED") set((s) => ({ errors: { ...s.errors, [node]: errorMessage(e) } }));
    } finally {
      set({ running: null });
    }
  },
  cancel: () => {
    backend.speedTestCancel().catch(() => {});
  },
}));

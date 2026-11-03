/**
 * Country of a proxy node: the name's flag/keywords first, then the backend's lookup of the
 * node's server IP (for names like "车位4 vless-4" that carry no hint).
 */
import { backend } from "./backend";
import { detectCountry } from "./countries";

let byServer: Record<string, string> = {};
let fetchedAt = 0;
let inflight: Promise<void> | null = null;

/** Refresh the server-IP map (at most once a minute unless forced). */
export function refreshNodeCountries(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedAt < 60_000) return Promise.resolve();
  inflight = backend
    .nodeCountries()
    .then((m) => {
      byServer = m ?? {};
      fetchedAt = Date.now();
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function nodeCountry(name: string | null | undefined): string | null {
  if (!name) return null;
  return detectCountry(name) ?? byServer[name] ?? null;
}

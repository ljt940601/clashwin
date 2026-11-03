/**
 * Usage/expiry reported by the active config's proxy-providers (subscription-userinfo).
 * Used when the profile itself has no subscription info, e.g. a local file that pulls
 * nodes from subscription URLs through proxy-providers.
 */
import React from "react";
import { mihomo } from "./mihomo";
import { useApp } from "./store";
import type { SubscriptionInfo } from "./types";

export interface ProviderSub extends SubscriptionInfo {
  name: string;
}

let cache: ProviderSub[] = [];
let fetchedAt = 0;

async function load(): Promise<ProviderSub[]> {
  const { providers } = await mihomo.proxyProviders();
  cache = Object.values(providers ?? {})
    .filter((p) => p.vehicleType !== "Compatible" && p.subscriptionInfo && p.subscriptionInfo.Total > 0)
    .map((p) => ({
      name: p.name,
      upload: p.subscriptionInfo!.Upload,
      download: p.subscriptionInfo!.Download,
      total: p.subscriptionInfo!.Total,
      expire: p.subscriptionInfo!.Expire,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  fetchedAt = Date.now();
  return cache;
}

/** Provider subscriptions of the running config; refreshed every minute while mounted. */
export function useProviderSubs(enabled = true): ProviderSub[] {
  const running = useApp((s) => s.core.state === "running");
  const activeId = useApp((s) => s.settings?.activeProfileId);
  const [subs, setSubs] = React.useState<ProviderSub[]>(cache);
  React.useEffect(() => {
    if (!enabled || !running) {
      setSubs([]);
      return;
    }
    let alive = true;
    const tick = (force: boolean) => {
      if (!force && Date.now() - fetchedAt < 30_000) {
        setSubs(cache);
        return;
      }
      load()
        .then((s) => alive && setSubs(s))
        .catch(() => {});
    };
    tick(true);
    const id = window.setInterval(() => tick(true), 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled, running, activeId]);
  return subs;
}

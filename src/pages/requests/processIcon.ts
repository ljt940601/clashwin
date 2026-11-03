import React from "react";
import { backend } from "@/lib/backend";

// path → data URL (null = no icon). Shared across the page lifetime.
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function load(path: string): Promise<string | null> {
  let p = pending.get(path);
  if (!p) {
    p = backend
      .processIcon(path)
      .catch(() => null)
      .then((v) => {
        cache.set(path, v ?? null);
        pending.delete(path);
        return v ?? null;
      });
    pending.set(path, p);
  }
  return p;
}

/** Exe icon (PNG data URL) for a process path, cached; null while loading or when unavailable. */
export function useProcessIcon(path: string | undefined): string | null {
  const [icon, setIcon] = React.useState<string | null>(() => (path ? cache.get(path) ?? null : null));
  React.useEffect(() => {
    if (!path) {
      setIcon(null);
      return;
    }
    if (cache.has(path)) {
      setIcon(cache.get(path) ?? null);
      return;
    }
    let alive = true;
    load(path).then((v) => alive && setIcon(v));
    return () => {
      alive = false;
    };
  }, [path]);
  return icon;
}

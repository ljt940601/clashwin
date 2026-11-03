const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** 1536 → "1.5 KB". Uses 1024 steps like ClashMac. */
export function formatBytes(n: number | undefined | null, digits = 2): string {
  if (!n || n < 0 || !isFinite(n)) return "0 B";
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${Math.round(v)} B`;
  return `${+v.toFixed(digits)} ${UNITS[i]}`;
}

/** Split form for big numbers: { value: "1.09", unit: "GB" } */
export function splitBytes(n: number, digits = 2): { value: string; unit: string } {
  const s = formatBytes(n, digits);
  const [value, unit] = s.split(" ");
  return { value, unit };
}

export function formatSpeed(n: number | undefined | null, digits = 1): string {
  return `${formatBytes(n ?? 0, digits)}/s`;
}

export function formatCount(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-US");
}

/** Duration in ms → "45s", "3m 12s", "2h 05m", "3d 4h" */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatTime(ms: number, withMs = false): string {
  const d = new Date(ms);
  const p = (x: number, n = 2) => String(x).padStart(n, "0");
  const base = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return withMs ? `${base}.${p(d.getMilliseconds(), 3)}` : base;
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "3 分钟前" / "3 min ago" */
export function formatAgo(ms: number, lang: "zh" | "en"): string {
  const diff = Math.max(0, Date.now() - ms) / 1000;
  const zh = lang === "zh";
  if (diff < 60) return zh ? "刚刚" : "just now";
  if (diff < 3600) return zh ? `${Math.floor(diff / 60)} 分钟前` : `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return zh ? `${Math.floor(diff / 3600)} 小时前` : `${Math.floor(diff / 3600)} h ago`;
  return zh ? `${Math.floor(diff / 86400)} 天前` : `${Math.floor(diff / 86400)} d ago`;
}

/** Days until a unix-seconds expiry; null when no expiry */
export function daysLeft(expireSec: number | undefined): number | null {
  if (!expireSec) return null;
  return Math.ceil((expireSec * 1000 - Date.now()) / 86400000);
}

export function percent(a: number, b: number, digits = 0): string {
  if (!b) return "0%";
  return `${((a / b) * 100).toFixed(digits)}%`;
}

/** Greeting key by local hour; picks one of the variants at random */
export function greetingKey(date = new Date()): string {
  const h = date.getHours();
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  if (h >= 5 && h < 11) return pick(["common.greetingMorning1", "common.greetingMorning2"]);
  if (h >= 11 && h < 13) return "common.greetingNoon1";
  if (h >= 13 && h < 18) return pick(["common.greetingAfternoon1", "common.greetingAfternoon2"]);
  if (h >= 18 && h < 23) return pick(["common.greetingEvening1", "common.greetingEvening2"]);
  return pick(["common.greetingNight1", "common.greetingNight2"]);
}

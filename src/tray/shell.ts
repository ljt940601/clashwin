import type { AppSettings } from "@/lib/types";
import { backend, isTauri } from "@/lib/backend";

/** Terminal proxy env command for the chosen shell. */
export function shellExport(style: AppSettings["shellExportStyle"], host: string, net: AppSettings["engine"]["network"]): string {
  const httpPort = net.mixedPort || net.httpPort;
  const socksPort = net.mixedPort || net.socksPort;
  const http = httpPort ? `http://${host}:${httpPort}` : "";
  const socks = socksPort ? `socks5://${host}:${socksPort}` : "";
  switch (style) {
    case "cmd":
      return [http && `set http_proxy=${http}`, http && `set https_proxy=${http}`, socks && `set all_proxy=${socks}`].filter(Boolean).join(" & ");
    case "bash":
      return `export ${[http && `https_proxy=${http}`, http && `http_proxy=${http}`, socks && `all_proxy=${socks}`].filter(Boolean).join(" ")}`;
    default:
      return [http && `$env:HTTP_PROXY="${http}"`, http && `$env:HTTPS_PROXY="${http}"`, socks && `$env:ALL_PROXY="${socks}"`].filter(Boolean).join("; ");
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (isTauri) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch {
      /* fall back to the web clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

let lanCache: string | null | undefined;

/** LAN IPv4 of this machine: the bind address if it is concrete, else the backend's primary adapter address. */
export async function lanAddress(bindAddress: string): Promise<string | null> {
  if (bindAddress && !["*", "0.0.0.0", "::", "", "127.0.0.1", "localhost"].includes(bindAddress)) return bindAddress;
  if (lanCache !== undefined) return lanCache;
  try {
    lanCache = await backend.lanAddress();
  } catch {
    lanCache = null;
  }
  return lanCache;
}

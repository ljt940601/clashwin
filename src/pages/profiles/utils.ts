export function safeHost(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

import React from "react";
import { isTauri } from "@/lib/backend";
import { useT } from "@/i18n";

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/** Windows-style caption buttons for the frameless window. */
export function WindowControls({ minimize = true, maximize = true }: { minimize?: boolean; maximize?: boolean }) {
  const t = useT();
  const [maxed, setMaxed] = React.useState(false);
  React.useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    win().then(async (w) => {
      setMaxed(await w.isMaximized());
      un = await w.onResized(async () => setMaxed(await w.isMaximized()));
    });
    return () => un?.();
  }, []);
  return (
    <div className="winctl">
      {minimize && (
        <button title={t("nav.minimize")} onClick={() => isTauri && win().then((w) => w.minimize())}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      )}
      {maximize && (
        <button title={t(maxed ? "nav.restore" : "nav.maximize")} onClick={() => isTauri && win().then((w) => w.toggleMaximize())}>
          {maxed ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="2.5" width="7" height="7" />
              <path d="M2.5 2.5V0.5h7v7h-2" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>
      )}
      <button className="close" title={t("nav.close")} onClick={() => isTauri && win().then((w) => w.hide())}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
    </div>
  );
}

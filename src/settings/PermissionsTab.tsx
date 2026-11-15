import React from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { backend, errorMessage } from "@/lib/backend";
import { Button, FormRow, FormSection, Spinner, Toggle, confirm, toast } from "@/components/ui";
import type { HelperStatus } from "@/lib/types";

export default function PermissionsTab() {
  const t = useT();
  const info = useApp((s) => s.info);
  const settings = useApp((s) => s.settings)!;
  const sysBusy = useApp((s) => s.busy.sysproxy);
  const toggleSystemProxy = useApp((s) => s.toggleSystemProxy);
  const [helper, setHelper] = React.useState<HelperStatus | null>(null);
  const [busy, setBusy] = React.useState<"" | "install" | "uninstall" | "restart">("");

  const load = React.useCallback(() => {
    backend.helperStatus().then(setHelper).catch(() => setHelper(null));
  }, []);
  React.useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const run = async (kind: typeof busy, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy("");
    }
  };

  const install = () =>
    run("install", async () => {
      setHelper(await backend.helperInstall());
      toast.success(t("settings.helperInstalledToast"));
    });
  const uninstall = async () => {
    if (!(await confirm({ title: t("settings.uninstallHelper"), message: t("settings.uninstallHelperConfirm"), danger: true }))) return;
    run("uninstall", async () => {
      setHelper(await backend.helperUninstall());
      toast.success(t("settings.helperUninstalledToast"));
    });
  };
  const restartAdmin = () => run("restart", () => backend.restartAsAdmin());

  const isAdmin = !!info?.isAdmin;
  const hasUpdate = !!helper?.installed && !!helper.latestVersion && !!helper.version && helper.latestVersion !== helper.version;
  const net = settings.engine.network;
  const addr = `127.0.0.1:${net.mixedPort || net.httpPort}`;

  return (
    <>
      <div className="st-intro">
        <span className="st-intro-icon">
          <ShieldCheck size={18} />
        </span>
        <div>
          <b>{t("settings.helperSection")}</b>
          {t("settings.helperDesc")}
        </div>
      </div>

      <FormSection>
        <FormRow label={t("settings.adminRights")}>
          <span className={isAdmin ? "st-pill on" : "st-pill"}>{t(isAdmin ? "settings.adminYes" : "settings.adminNo")}</span>
          {!isAdmin && (
            <Button size="sm" loading={busy === "restart"} onClick={restartAdmin}>
              {t("settings.restartAsAdmin")}
            </Button>
          )}
        </FormRow>
        <FormRow
          label={t("settings.helperTool")}
          desc={
            helper?.installed
              ? [
                  helper.version ? t("settings.helperVersion", { v: helper.version }) : null,
                  hasUpdate ? t("settings.helperUpdate", { v: helper.latestVersion! }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              : undefined
          }
        >
          {helper === null ? (
            <Spinner size={13} />
          ) : (
            <span className={helper.installed ? (helper.running ? "st-pill on" : "st-pill warn") : "st-pill"}>
              {!helper.installed ? t("settings.helperNotInstalled") : helper.running ? t("settings.helperRunning") : t("settings.helperInstalled")}
            </span>
          )}
          {helper && !helper.installed && (
            <Button size="sm" variant="primary" loading={busy === "install"} onClick={install}>
              {t("settings.installHelper")}
            </Button>
          )}
          {hasUpdate && (
            <Button size="sm" variant="primary" loading={busy === "install"} onClick={install}>
              {t("settings.upgradeHelper")}
            </Button>
          )}
          {helper?.installed && (
            <Button size="sm" variant="danger" loading={busy === "uninstall"} onClick={uninstall}>
              {t("settings.uninstallHelper")}
            </Button>
          )}
        </FormRow>
      </FormSection>

      <FormSection title={t("settings.sysProxySection")}>
        <FormRow
          label={t("settings.sysProxyStatus")}
          desc={settings.systemProxy ? t("settings.sysProxyOnDesc", { addr }) : t("settings.sysProxyOffDesc")}
        >
          <span className={settings.systemProxy ? "st-pill on" : "st-pill"}>
            {t(settings.systemProxy ? "settings.sysProxyActive" : "settings.sysProxyInactive")}
          </span>
          {sysBusy && <Spinner size={12} />}
          <Toggle checked={settings.systemProxy} onChange={(v) => toggleSystemProxy(v)} />
        </FormRow>
        <FormRow label={t("settings.sysProxyBypass")} desc={t("settings.sysProxyBypassDesc")}>
          <span className="st-value ellipsis mono" style={{ maxWidth: 220 }} title={net.bypass.join("; ")}>
            {net.bypass.length}
          </span>
          <Button size="sm" variant="plain" icon={<ExternalLink size={12} />} onClick={() => backend.openDashboard("/engine/network")}>
            {t("nav.network")}
          </Button>
        </FormRow>
      </FormSection>
    </>
  );
}

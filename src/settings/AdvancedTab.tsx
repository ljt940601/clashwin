import React from "react";
import { Download, RefreshCw, RotateCcw, Terminal, Trash2 } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { backend, errorMessage, listen } from "@/lib/backend";
import { mihomo } from "@/lib/mihomo";
import { formatBytes, formatCount } from "@/lib/format";
import { Button, FormRow, FormSection, IconButton, NumberField, Progress, Select, TextField, confirm, toast } from "@/components/ui";
import type { AppSettings, CoreChannel, CoreUpdateInfo, DownloadProgress, HistoryInfo } from "@/lib/types";

function randomSecret(len = 16) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

/** Text field that keeps a local draft and commits on blur / Enter. */
function DraftField({
  value,
  onCommit,
  width,
  mono,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  width?: number | string;
  mono?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState(value);
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <TextField
      value={draft}
      onChange={setDraft}
      mono={mono}
      width={width}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const v = draft.trim();
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export default function AdvancedTab() {
  const t = useT();
  const s = useApp((st) => st.settings)!;
  const core = useApp((st) => st.core);
  const save = useApp((st) => st.saveSettings);
  const restartCore = useApp((st) => st.restartCore);
  const refreshCore = useApp((st) => st.refreshCore);
  const coreBusy = useApp((st) => st.busy.core);
  const running = core.state === "running";

  /* ----- kernel updates ----- */
  const [checking, setChecking] = React.useState(false);
  const [update, setUpdate] = React.useState<CoreUpdateInfo | null>(null);
  const [installing, setInstalling] = React.useState(false);
  const [progress, setProgress] = React.useState<DownloadProgress | null>(null);
  const [cached, setCached] = React.useState<string[]>([]);
  const [rollbackTo, setRollbackTo] = React.useState("");
  const [rollingBack, setRollingBack] = React.useState(false);

  React.useEffect(() => {
    let un: (() => void) | undefined;
    listen<DownloadProgress>("core://download-progress", setProgress).then((f) => (un = f));
    return () => un?.();
  }, []);

  const loadCached = React.useCallback(() => {
    backend
      .coreCachedVersions()
      .then((list) => {
        setCached(list);
        setRollbackTo((cur) => (cur && list.includes(cur) ? cur : list.find((v) => v !== core.version) ?? list[0] ?? ""));
      })
      .catch(() => setCached([]));
  }, [core.version]);
  React.useEffect(loadCached, [loadCached]);

  const checkUpdate = async () => {
    setChecking(true);
    setUpdate(null);
    try {
      const info = await backend.coreCheckUpdate(s.coreChannel);
      setUpdate(info);
      if (!info.hasUpdate) toast.success(t("settings.upToDate"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    setProgress({ stage: "checking", downloaded: 0, total: 0 });
    try {
      const st = await backend.coreInstall(s.coreChannel);
      useApp.setState({ core: st });
      toast.success(t("settings.installed", { v: st.version ?? update?.latest ?? "" }));
      setUpdate(null);
      loadCached();
    } catch (e) {
      setProgress((p) => (p ? { ...p, stage: "error", message: errorMessage(e) } : null));
      toast.error(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };

  const rollback = async () => {
    if (!rollbackTo) return;
    if (!(await confirm({ title: t("settings.rollback"), message: t("settings.rollbackConfirm", { v: rollbackTo }), danger: true }))) return;
    setRollingBack(true);
    try {
      useApp.setState({ core: await backend.coreRollback(rollbackTo) });
      await refreshCore();
      toast.success(t("settings.installed", { v: rollbackTo }));
      loadCached();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRollingBack(false);
    }
  };

  /* ----- cache cleanup ----- */
  const [cacheBusy, setCacheBusy] = React.useState("");
  const runCache = async (key: string, fn: () => Promise<void>, ok: string) => {
    setCacheBusy(key);
    try {
      await fn();
      toast.success(t(ok));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCacheBusy("");
    }
  };

  /* ----- history ----- */
  const [history, setHistory] = React.useState<HistoryInfo | null>(null);
  const [clearing, setClearing] = React.useState(false);
  const loadHistory = React.useCallback(() => {
    backend.historyInfo().then(setHistory).catch(() => setHistory(null));
  }, []);
  React.useEffect(loadHistory, [loadHistory]);
  const clearHistory = async () => {
    if (!(await confirm({ title: t("settings.deleteAll"), message: t("settings.deleteAllConfirm"), danger: true, confirmText: t("common.delete") }))) return;
    setClearing(true);
    try {
      await backend.historyClear();
      toast.success(t("settings.historyCleared"));
      loadHistory();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setClearing(false);
    }
  };

  /* ----- CLI ----- */
  const [cliBusy, setCliBusy] = React.useState(false);
  const [cliPath, setCliPath] = React.useState("");
  const installCli = async () => {
    setCliBusy(true);
    try {
      const p = await backend.installCli();
      setCliPath(p);
      toast.success(t("settings.cliInstalled", { path: p }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCliBusy(false);
    }
  };

  const stageKey: Record<DownloadProgress["stage"], string> = {
    checking: "settings.stageChecking",
    downloading: "settings.stageDownloading",
    extracting: "settings.stageExtracting",
    done: "settings.stageDone",
    error: "settings.stageError",
  };
  const pct = progress && progress.total > 0 ? progress.downloaded / progress.total : progress?.stage === "done" ? 1 : 0;

  return (
    <>
      <FormSection title={t("settings.controller")} desc={t("settings.controllerDesc")}>
        <FormRow label={t("settings.controllerHost")} desc={t("settings.controllerHostDesc")}>
          <DraftField mono width={150} value={s.controller.host} onCommit={(v) => save({ controller: { host: v || "127.0.0.1" } })} />
        </FormRow>
        <FormRow label={t("settings.controllerPort")}>
          <NumberField value={s.controller.port} min={1} max={65535} onChange={(v) => save({ controller: { port: v } })} />
        </FormRow>
        <FormRow label={t("settings.controllerSecret")} desc={t("settings.controllerSecretDesc")}>
          <DraftField mono width={180} value={s.controller.secret} onCommit={(v) => save({ controller: { secret: v } })} />
          <IconButton
            size="sm"
            icon={<RefreshCw size={13} />}
            title={t("settings.regenerate")}
            onClick={() => save({ controller: { secret: randomSecret() } })}
          />
        </FormRow>
        <FormRow style={{ justifyContent: "flex-end" }}>
          <Button size="sm" icon={<RotateCcw size={12} />} loading={!!coreBusy} disabled={core.state === "not_installed"} onClick={() => restartCore()}>
            {t("settings.restartKernel")}
          </Button>
        </FormRow>
      </FormSection>

      <FormSection title={t("settings.coreSection")}>
        <FormRow label={t("settings.channel")} desc={t("settings.channelDesc")}>
          <Select<CoreChannel>
            width={170}
            value={s.coreChannel}
            onChange={(v) => {
              setUpdate(null);
              save({ coreChannel: v });
            }}
            options={[
              { value: "stable", label: t("settings.channelStable") },
              { value: "alpha", label: t("settings.channelAlpha") },
              { value: "smart", label: t("settings.channelSmart") },
            ]}
          />
        </FormRow>
        <FormRow
          label={t("settings.currentVersion")}
          desc={
            update
              ? update.hasUpdate
                ? t("settings.latestVersion", { v: update.latest })
                : t("settings.upToDate")
              : undefined
          }
        >
          <span className="st-value mono">{core.version ?? t("common.notInstalled")}</span>
          <Button size="sm" loading={checking} disabled={installing} onClick={checkUpdate}>
            {t("settings.checkUpdate")}
          </Button>
        </FormRow>
        {(update?.hasUpdate || installing || (progress && progress.stage !== "done")) && (
          <FormRow stack>
            {update?.notes && <div className="st-notes">{update.notes}</div>}
            {progress && (installing || progress.stage === "error") && (
              <div className="st-progress">
                <Progress value={pct} height={5} color={progress.stage === "error" ? "var(--red)" : "var(--accent)"} />
                <div className="st-progress-text">
                  <span>{progress.message ?? t(stageKey[progress.stage])}</span>
                  {progress.total > 0 && (
                    <span>
                      {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
                    </span>
                  )}
                </div>
              </div>
            )}
            {update?.hasUpdate && (
              <div className="st-inline" style={{ justifyContent: "flex-end" }}>
                <Button size="sm" variant="primary" icon={<Download size={12} />} loading={installing} onClick={install}>
                  {installing ? t("settings.installing") : t("settings.downloadInstall")}
                </Button>
              </div>
            )}
          </FormRow>
        )}
        <FormRow label={t("settings.rollback")} desc={t("settings.rollbackDesc")}>
          {cached.length ? (
            <Select width={130} value={rollbackTo} onChange={setRollbackTo} options={cached.map((v) => ({ value: v, label: v }))} />
          ) : (
            <span className="st-value">{t("settings.noCachedVersions")}</span>
          )}
          <Button size="sm" loading={rollingBack} disabled={!rollbackTo || rollbackTo === core.version} onClick={rollback}>
            {t("settings.rollbackBtn")}
          </Button>
        </FormRow>
      </FormSection>

      <FormSection title={t("settings.cacheSection")}>
        <FormRow label={t("settings.updateGeo")} desc={t("settings.updateGeoDesc")}>
          <Button size="sm" disabled={!running} loading={cacheBusy === "geo"} onClick={() => runCache("geo", mihomo.updateGeo, "settings.geoUpdated")}>
            {t("settings.run")}
          </Button>
        </FormRow>
        <FormRow label={t("settings.flushFakeIp")} desc={t("settings.flushFakeIpDesc")}>
          <Button size="sm" disabled={!running} loading={cacheBusy === "fakeip"} onClick={() => runCache("fakeip", mihomo.flushFakeIp, "settings.fakeIpFlushed")}>
            {t("settings.run")}
          </Button>
        </FormRow>
        <FormRow label={t("settings.flushDns")} desc={t("settings.flushDnsDesc")}>
          <Button size="sm" disabled={!running} loading={cacheBusy === "dns"} onClick={() => runCache("dns", mihomo.flushDns, "settings.dnsFlushed")}>
            {t("settings.run")}
          </Button>
        </FormRow>
      </FormSection>

      <FormSection title={t("settings.historySection")}>
        <FormRow label={t("settings.historyRecords")}>
          <span className="st-value">
            {history ? t("settings.historyRecordsValue", { n: formatCount(history.records), size: formatBytes(history.bytes) }) : "—"}
          </span>
        </FormRow>
        <FormRow label={t("settings.retention")} desc={t("settings.retentionDesc")}>
          <Select<string>
            width={120}
            value={String(s.historyRetentionDays)}
            onChange={(v) => save({ historyRetentionDays: Number(v) as AppSettings["historyRetentionDays"] })}
            options={[
              { value: "30", label: t("settings.days30") },
              { value: "60", label: t("settings.days60") },
              { value: "90", label: t("settings.days90") },
              { value: "0", label: t("settings.forever") },
            ]}
          />
        </FormRow>
        <FormRow label={t("settings.deleteAll")} desc={t("settings.deleteAllDesc")}>
          <Button size="sm" variant="danger" icon={<Trash2 size={12} />} loading={clearing} onClick={clearHistory}>
            {t("settings.deleteAll")}
          </Button>
        </FormRow>
      </FormSection>

      <FormSection title={t("settings.cliSection")}>
        <FormRow label={t("settings.installCli")} desc={cliPath ? t("settings.cliInstalled", { path: cliPath }) : t("settings.cliDesc")}>
          <Button size="sm" icon={<Terminal size={12} />} loading={cliBusy} onClick={installCli}>
            {t("settings.installCli")}
          </Button>
        </FormRow>
      </FormSection>

      <FormSection title={t("settings.delaySection")}>
        <FormRow label={t("settings.delayUrl")}>
          <DraftField mono width={280} value={s.delayTestUrl} onCommit={(v) => v && save({ delayTestUrl: v })} />
        </FormRow>
        <FormRow label={t("settings.delayTimeout")}>
          <NumberField value={s.delayTimeout} min={500} max={30000} onChange={(v) => save({ delayTimeout: v })} />
        </FormRow>
      </FormSection>
    </>
  );
}

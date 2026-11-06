/**
 * Update center: ClashWin and mihomo updates in one place, release notes as cards,
 * locally kept kernel versions (rollback), and the GitHub download source (mirrors
 * with latency test).
 */
import React from "react";
import { Download, ExternalLink, Gauge, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useLang, useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { backend, errorMessage, listen } from "@/lib/backend";
import { formatBytes } from "@/lib/format";
import { Button, Empty, FormRow, FormSection, IconButton, LatencyBadge, Progress, Select, Spinner, Toggle, cx, confirm, toast } from "@/components/ui";
import type { AppRelease, AppUpdateInfo, CoreChannel, CoreUpdateInfo, DownloadProgress, DownloadSource, SourceProbe } from "@/lib/types";
import { Markdown } from "./Markdown";

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

function normalizeMirror(raw: string): string | null {
  const v = raw.trim();
  try {
    const u = new URL(v);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.host) return null;
  } catch {
    return null;
  }
  return v.endsWith("/") ? v : v + "/";
}

function formatDate(iso: string | undefined, lang: "zh" | "en") {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric" });
}

function ProgressRow({ progress }: { progress: DownloadProgress }) {
  const t = useT();
  const stageKey: Record<DownloadProgress["stage"], string> = {
    checking: "settings.stageChecking",
    downloading: "settings.stageDownloading",
    extracting: "settings.stageExtracting",
    done: "settings.stageDone",
    error: "settings.stageError",
  };
  const pct = progress.total > 0 ? progress.downloaded / progress.total : progress.stage === "done" ? 1 : 0;
  return (
    <div className="st-progress">
      <Progress value={pct} height={5} color={progress.stage === "error" ? "var(--red)" : "var(--accent)"} />
      <div className="st-progress-text">
        <span>{progress.stage === "error" && progress.message ? progress.message : t(stageKey[progress.stage])}</span>
        {progress.total > 1 && (
          <span>
            {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------- changelog card ---------------- */

function ReleaseCard({ r, latest, current }: { r: AppRelease; latest: boolean; current: boolean }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [open, setOpen] = React.useState(false);
  const long = r.notes.split("\n").length > 9 || r.notes.length > 520;
  return (
    <div className={cx("up-card", latest && "latest")}>
      <div className="up-card-head">
        <span className="up-card-ver">v{r.version}</span>
        {latest && <span className="up-badge accent">{t("settings.changelogLatest")}</span>}
        {current && <span className="up-badge">{t("settings.changelogCurrent")}</span>}
        {r.prerelease && <span className="up-badge warn">{t("settings.changelogBeta")}</span>}
        <span className="up-card-date">{formatDate(r.publishedAt, lang)}</span>
      </div>
      <div className={cx("up-card-body", long && !open && "clamped")}>
        {r.notes.trim() ? <Markdown text={r.notes} /> : <div className="dim">{t("settings.changelogNoNotes")}</div>}
      </div>
      <div className="up-card-foot">
        {long && (
          <button className="up-link" onClick={() => setOpen((v) => !v)}>
            {open ? t("settings.changelogCollapse") : t("settings.changelogExpand")}
          </button>
        )}
        {r.url && (
          <button className="up-link" onClick={() => backend.openUrl(r.url).catch(() => {})}>
            <ExternalLink size={11} /> {t("settings.viewOnGithub")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function UpdatesTab() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const info = useApp((s) => s.info);
  const s = useApp((st) => st.settings)!;
  const core = useApp((st) => st.core);
  const save = useApp((st) => st.saveSettings);
  const refreshCore = useApp((st) => st.refreshCore);

  /* ================= ClashWin ================= */
  const [app, setApp] = React.useState<AppUpdateInfo | null>(null);
  const [appChecking, setAppChecking] = React.useState(false);
  const [appError, setAppError] = React.useState<string | null>(null);
  const [appProgress, setAppProgress] = React.useState<DownloadProgress | null>(null);
  const [appInstalling, setAppInstalling] = React.useState(false);

  const checkApp = React.useCallback(
    async (silent: boolean) => {
      setAppChecking(true);
      setAppError(null);
      try {
        const r = await backend.checkAppUpdate();
        setApp(r);
        if (!silent && !r.hasUpdate) toast.success(t("settings.appUpToDate"));
      } catch (e) {
        setAppError(errorMessage(e));
        if (!silent) toast.error(errorMessage(e));
      } finally {
        setAppChecking(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    // show the startup check's result, or look now (the changelog needs the release list)
    backend
      .appUpdateCached()
      .then((c) => (c ? setApp(c) : checkApp(true)))
      .catch(() => checkApp(true));
    let un: (() => void) | undefined;
    listen<DownloadProgress>("app://update-progress", setAppProgress).then((f) => (un = f));
    return () => un?.();
  }, [checkApp]);

  const installApp = async () => {
    if (!app?.hasUpdate) return;
    const ok = await confirm({
      title: t("settings.appInstallConfirmTitle", { v: app.latest }),
      message: t("settings.appInstallConfirm"),
      confirmText: t("settings.appInstall"),
    });
    if (!ok) return;
    setAppInstalling(true);
    setAppProgress({ stage: "checking", downloaded: 0, total: 0 });
    try {
      await backend.installAppUpdate();
      toast.success(t("settings.appInstallStarted"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAppInstalling(false);
    }
  };

  const currentVersion = app?.current ?? info?.version ?? "—";
  const appStatus = appChecking
    ? t("settings.appChecking")
    : appError
      ? t("settings.appCheckFailed", { msg: appError })
      : app
        ? app.hasUpdate
          ? [t("settings.appUpdateAvailable", { v: app.latest }), formatDate(app.publishedAt, lang), app.size ? formatBytes(app.size) : ""]
              .filter(Boolean)
              .join(" · ")
          : t("settings.appUpToDate")
        : undefined;

  /* ================= kernel ================= */
  const [coreChecking, setCoreChecking] = React.useState(false);
  const [coreUpdate, setCoreUpdate] = React.useState<CoreUpdateInfo | null>(null);
  const [coreInstalling, setCoreInstalling] = React.useState(false);
  const [coreProgress, setCoreProgress] = React.useState<DownloadProgress | null>(null);

  React.useEffect(() => {
    let un: (() => void) | undefined;
    listen<DownloadProgress>("core://download-progress", setCoreProgress).then((f) => (un = f));
    return () => un?.();
  }, []);

  const checkCore = async () => {
    setCoreChecking(true);
    setCoreUpdate(null);
    try {
      const r = await backend.coreCheckUpdate(s.coreChannel);
      setCoreUpdate(r);
      if (!r.hasUpdate) toast.success(t("settings.upToDate"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCoreChecking(false);
    }
  };

  const installCore = async () => {
    setCoreInstalling(true);
    setCoreProgress({ stage: "checking", downloaded: 0, total: 0 });
    try {
      const st = await backend.coreInstall(s.coreChannel);
      useApp.setState({ core: st });
      toast.success(t("settings.installed", { v: st.version ?? coreUpdate?.latest ?? "" }));
      setCoreUpdate(null);
      loadCached();
    } catch (e) {
      setCoreProgress((p) => (p ? { ...p, stage: "error", message: errorMessage(e) } : null));
      toast.error(errorMessage(e));
    } finally {
      setCoreInstalling(false);
    }
  };

  /* ================= kept kernel versions ================= */
  const [cached, setCached] = React.useState<string[] | null>(null);
  const [versionBusy, setVersionBusy] = React.useState("");
  const loadCached = React.useCallback(() => {
    backend
      .coreCachedVersions()
      .then(setCached)
      .catch(() => setCached([]));
  }, []);
  React.useEffect(loadCached, [loadCached, core.version]);

  const rollback = async (v: string) => {
    if (!(await confirm({ title: t("settings.rollback"), message: t("settings.rollbackConfirm", { v }), confirmText: t("settings.rollbackBtn") }))) return;
    setVersionBusy(v);
    try {
      useApp.setState({ core: await backend.coreRollback(v) });
      await refreshCore();
      toast.success(t("settings.installed", { v }));
      loadCached();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setVersionBusy("");
    }
  };
  const removeVersion = async (v: string) => {
    if (!(await confirm({ title: t("settings.deleteVersion"), message: t("settings.deleteVersionConfirm", { v }), danger: true, confirmText: t("common.delete") })))
      return;
    try {
      await backend.coreDeleteCached(v);
      toast.success(t("settings.versionDeleted", { v }));
      loadCached();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  /* ================= download source ================= */
  const [sources, setSources] = React.useState<DownloadSource[]>([]);
  const [probes, setProbes] = React.useState<Record<string, SourceProbe>>({});
  const [testing, setTesting] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [draftError, setDraftError] = React.useState<string | null>(null);

  const testSources = React.useCallback(async () => {
    setTesting(true);
    try {
      const list = await backend.testDownloadSources();
      setProbes(Object.fromEntries(list.map((p) => [p.url, p])));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }, []);

  const customKey = s.customMirrors.join("\n");
  React.useEffect(() => {
    backend
      .downloadSources()
      .then(setSources)
      .catch(() => setSources([]));
  }, [customKey]);
  // measure every source when the tab opens and whenever the list changes
  React.useEffect(() => {
    testSources();
  }, [testSources, customKey]);

  const fastest = React.useMemo(() => {
    const ok = Object.values(probes).filter((p) => p.latencyMs !== undefined && sources.some((x) => x.url === p.url));
    ok.sort((a, b) => a.latencyMs! - b.latencyMs!);
    return ok[0];
  }, [probes, sources]);

  const addMirror = () => {
    const v = normalizeMirror(draft);
    if (!v) return setDraftError(t("settings.customMirrorInvalid"));
    if (sources.some((x) => x.url === v)) return setDraftError(t("settings.customMirrorExists"));
    save({ customMirrors: [...s.customMirrors, v] });
    setDraft("");
    setDraftError(null);
  };
  const removeMirror = (url: string) => {
    save({
      customMirrors: s.customMirrors.filter((m) => normalizeMirror(m) !== url),
      ...(s.downloadMirror === url ? { downloadMirror: "auto" } : {}),
    });
  };

  const sourceName = (x: { url: string }) => (x.url ? hostOf(x.url) : t("settings.sourceDirect"));
  const probeBadge = (url: string) => {
    const p = probes[url];
    if (testing && !p) return <LatencyBadge testing />;
    if (!p) return null;
    if (p.latencyMs !== undefined) return <LatencyBadge delay={Math.max(1, p.latencyMs)} />;
    const label = p.error === "timeout" ? t("settings.sourceTimeout") : p.error === "dns" ? t("settings.sourceDns") : t("settings.sourceFailed");
    return (
      <span title={p.error}>
        <LatencyBadge delay={0} timeoutLabel={label} />
      </span>
    );
  };
  const selected = s.downloadMirror || "auto";

  const sourceRow = (value: string, label: React.ReactNode, desc?: React.ReactNode, right?: React.ReactNode) => (
    <div
      key={value}
      className={cx("up-source", selected === value && "on")}
      onClick={() => selected !== value && save({ downloadMirror: value })}
      role="radio"
      aria-checked={selected === value}
    >
      <span className="up-radio" />
      <div className="up-source-main">
        <div className="up-source-label">{label}</div>
        {desc && <div className="up-source-desc">{desc}</div>}
      </div>
      {right}
    </div>
  );

  return (
    <>
      {/* ---------- ClashWin ---------- */}
      <FormSection title={t("settings.appSection")}>
        <FormRow label={t("settings.appCurrent", { v: currentVersion })} desc={appStatus}>
          {app?.hasUpdate ? (
            <Button size="sm" variant="primary" icon={<Download size={12} />} loading={appInstalling} onClick={installApp}>
              {t("settings.appInstall")}
            </Button>
          ) : (
            <Button size="sm" loading={appChecking} onClick={() => checkApp(false)}>
              {t("settings.checkUpdate")}
            </Button>
          )}
        </FormRow>
        {appProgress && (appInstalling || appProgress.stage === "error") && (
          <FormRow stack>
            <ProgressRow progress={appProgress} />
          </FormRow>
        )}
        <FormRow label={t("settings.autoCheck")} desc={t("settings.autoCheckDesc")}>
          <Toggle checked={s.autoCheckUpdate} onChange={(v) => save({ autoCheckUpdate: v })} />
        </FormRow>
        <FormRow label={t("settings.includeBeta")} desc={t("settings.includeBetaDesc")}>
          <Toggle
            checked={s.includeBeta}
            onChange={async (v) => {
              await save({ includeBeta: v });
              checkApp(true);
            }}
          />
        </FormRow>
      </FormSection>

      {/* ---------- changelog ---------- */}
      <section className="ui-form-section">
        <div className="ui-form-section-title">
          <span>{t("settings.changelogSection")}</span>
        </div>
        {app === null ? (
          <div className="up-cards-empty">{appChecking ? <Spinner size={16} /> : <Empty desc={appError ?? t("settings.changelogEmpty")} />}</div>
        ) : app.releases.length === 0 ? (
          <div className="up-cards-empty">
            <Empty desc={t("settings.changelogEmpty")} />
          </div>
        ) : (
          <div className="up-cards">
            {app.releases.slice(0, 5).map((r) => (
              <ReleaseCard key={r.version} r={r} latest={app.hasUpdate && r.version === app.latest} current={r.version === app.current} />
            ))}
          </div>
        )}
      </section>

      {/* ---------- mihomo ---------- */}
      <FormSection title={t("settings.coreSection")}>
        <FormRow label={t("settings.channel")} desc={t("settings.channelDesc")}>
          <Select<CoreChannel>
            width={170}
            value={s.coreChannel}
            onChange={(v) => {
              setCoreUpdate(null);
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
          desc={coreUpdate ? (coreUpdate.hasUpdate ? t("settings.latestVersion", { v: coreUpdate.latest }) : t("settings.upToDate")) : undefined}
        >
          <span className="st-value mono">{core.version ?? t("common.notInstalled")}</span>
          {coreUpdate?.hasUpdate ? (
            <Button size="sm" variant="primary" icon={<Download size={12} />} loading={coreInstalling} onClick={installCore}>
              {coreInstalling ? t("settings.installing") : t("settings.downloadInstall")}
            </Button>
          ) : (
            <Button size="sm" loading={coreChecking} disabled={coreInstalling} onClick={checkCore}>
              {t("settings.checkUpdate")}
            </Button>
          )}
        </FormRow>
        {(coreUpdate?.hasUpdate || (coreProgress && (coreInstalling || coreProgress.stage === "error"))) && (
          <FormRow stack>
            {coreUpdate?.hasUpdate && coreUpdate.notes && (
              <div className="up-card compact">
                <div className="up-card-head">
                  <span className="up-card-ver">{coreUpdate.latest}</span>
                  <span className="up-badge accent">{t("settings.changelogLatest")}</span>
                </div>
                <div className="up-card-body scroll">
                  <Markdown text={coreUpdate.notes} />
                </div>
              </div>
            )}
            {coreProgress && (coreInstalling || coreProgress.stage === "error") && <ProgressRow progress={coreProgress} />}
          </FormRow>
        )}
      </FormSection>

      {/* ---------- kept kernel versions ---------- */}
      <FormSection title={t("settings.localVersions")} desc={t("settings.localVersionsDesc")}>
        {cached === null ? (
          <FormRow>
            <Spinner size={14} />
          </FormRow>
        ) : cached.length === 0 ? (
          <FormRow label={<span className="dim">{t("settings.noCachedVersions")}</span>} />
        ) : (
          cached.map((v) => {
            const inUse = v === core.version;
            return (
              <FormRow
                key={v}
                label={
                  <span className="up-version">
                    <span className="mono">{v}</span>
                    {inUse && <span className="up-badge">{t("settings.versionInUse")}</span>}
                  </span>
                }
              >
                <Button size="sm" icon={<RotateCcw size={12} />} disabled={inUse || !!versionBusy} loading={versionBusy === v} onClick={() => rollback(v)}>
                  {t("settings.rollbackBtn")}
                </Button>
                <IconButton size="sm" variant="plain" icon={<Trash2 size={13} />} title={t("settings.deleteVersion")} disabled={inUse} onClick={() => removeVersion(v)} />
              </FormRow>
            );
          })
        )}
      </FormSection>

      {/* ---------- download source ---------- */}
      <FormSection
        title={t("settings.sourcesSection")}
        desc={t("settings.sourcesDesc")}
        extra={
          <Button size="sm" variant="plain" icon={<Gauge size={12} />} loading={testing} onClick={testSources}>
            {t("settings.sourceTest")}
          </Button>
        }
      >
        {sourceRow("auto", t("settings.sourceAuto"), fastest ? t("settings.sourceAutoPick", { name: sourceName(fastest) }) : t("settings.sourceAutoDesc"))}
        {sources.map((x) =>
          sourceRow(
            x.url || "direct",
            <span className={x.url ? "mono" : undefined}>{sourceName(x)}</span>,
            x.kind === "custom" ? t("settings.sourceCustom") : undefined,
            <>
              {probeBadge(x.url)}
              {x.kind === "custom" && (
                <IconButton
                  size="xs"
                  variant="plain"
                  icon={<X size={12} />}
                  title={t("settings.removeMirror")}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeMirror(x.url);
                  }}
                />
              )}
            </>,
          ),
        )}
        <div className="up-source add">
          <Plus size={13} className="dim" />
          <input
            className="up-source-input"
            value={draft}
            placeholder={t("settings.customMirrorPh")}
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && addMirror()}
          />
          <Button size="sm" disabled={!draft.trim()} onClick={addMirror}>
            {t("common.add")}
          </Button>
        </div>
        {draftError && <div className="up-source-error">{draftError}</div>}
      </FormSection>
    </>
  );
}

import React from "react";
import { RefreshCw, RotateCcw, Terminal, Trash2 } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { backend, errorMessage } from "@/lib/backend";
import { mihomo } from "@/lib/mihomo";
import { formatBytes, formatCount } from "@/lib/format";
import { Button, FormRow, FormSection, IconButton, NumberField, Select, TextField, confirm, toast } from "@/components/ui";
import type { AppSettings, HistoryInfo } from "@/lib/types";

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
  const coreBusy = useApp((st) => st.busy.core);
  const running = core.state === "running";

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

import React from "react";
import { Database, Info, RefreshCw } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { backend, errorMessage } from "@/lib/backend";
import { mihomo } from "@/lib/mihomo";
import { formatBytes, formatTime } from "@/lib/format";
import { Button, FormRow, FormSection, NumberField, Select, Spinner, Toggle, toast } from "@/components/ui";
import { CommitField, EnginePage, Label, Note, useEngineSection } from "./components";
import type { EngineGeneral, LogLevel } from "@/lib/types";

export default function GeneralPage() {
  const t = useT();
  const [g, update] = useEngineSection("general");
  const channel = useApp((s) => s.settings?.coreChannel);
  const running = useApp((s) => s.core.state === "running");
  const [ifaces, setIfaces] = React.useState<string[]>([]);
  const [geoState, setGeoState] = React.useState<{ busy: boolean; at?: number; error?: string }>({ busy: false });

  const [geoFiles, setGeoFiles] = React.useState<{ name: string; exists: boolean; size: number }[] | null>(null);

  React.useEffect(() => {
    backend.listInterfaces().then(setIfaces).catch(() => setIfaces([]));
  }, []);

  // Database files on disk; re-read after an update finishes.
  React.useEffect(() => {
    backend
      .geoDbStatus()
      .then((s) => setGeoFiles(s.files))
      .catch(() => setGeoFiles(null));
  }, [geoState.at, running]);

  if (!g) return <EnginePage section="general" title={t("nav.general")}>{null}</EnginePage>;

  const setUrl = (k: keyof EngineGeneral["geoxUrl"], v: string) => update({ geoxUrl: { ...g.geoxUrl, [k]: v } });

  const updateGeo = async () => {
    setGeoState({ busy: true });
    try {
      await mihomo.updateGeo();
      setGeoState({ busy: false, at: Date.now() });
      toast.success(t("engine.geoUpdated"));
    } catch (e) {
      setGeoState({ busy: false, error: errorMessage(e) });
      toast.error(errorMessage(e));
    }
  };

  // Files the current database mode needs: MMDB → Country.mmdb, GeoData → GeoIP.dat + GeoSite.dat
  const needed = g.geodataMode ? ["geoip.dat", "geosite.dat"] : ["country.mmdb"];
  const neededFiles = (geoFiles ?? []).filter((f) => needed.includes(f.name.toLowerCase()));
  const missing = geoFiles !== null && (neededFiles.length < needed.length || neededFiles.some((f) => !f.exists));
  const fileInfo = neededFiles.filter((f) => f.exists).map((f) => `${f.name} · ${formatBytes(f.size)}`).join("  ");

  const dbStatus = missing && !geoState.busy ? (
    <span className="en-status-line">
      <span className="en-dot warn" />
      {t("engine.dbStatusMissing")}
    </span>
  ) : !running ? (
    <span className="en-status-line">
      <span className="en-dot" />
      {t("engine.dbStatusIdle")}
    </span>
  ) : geoState.busy ? (
    <span className="en-status-line">
      <Spinner size={11} />
      {t("engine.dbStatusDownloading")}
    </span>
  ) : geoState.error ? (
    <span className="en-status-line">
      <span className="en-dot warn" />
      {t("engine.dbStatusFailed")}
    </span>
  ) : (
    <span className="en-status-line">
      <span className="en-dot on" />
      {geoState.at ? t("engine.dbStatusUpdatedAt", { time: formatTime(geoState.at) }) : t("engine.dbStatusLoaded")}
      {fileInfo && <span className="dim">{fileInfo}</span>}
    </span>
  );

  return (
    <EnginePage section="general" title={t("nav.general")}>
      <FormSection title={t("engine.secRouting")}>
        <FormRow label={t("engine.logLevel")} desc={t("engine.logLevelDesc")}>
          <Select<LogLevel>
            value={g.logLevel}
            width={130}
            onChange={(logLevel) => update({ logLevel })}
            options={[
              { value: "debug", label: t("engine.levelDebug") },
              { value: "info", label: t("engine.levelInfo") },
              { value: "warning", label: t("engine.levelWarning") },
              { value: "error", label: t("engine.levelError") },
              { value: "silent", label: t("engine.levelSilent") },
            ]}
          />
        </FormRow>
        <FormRow label="TCP Concurrent" desc={t("engine.tcpConcurrentDesc")}>
          <Toggle checked={g.tcpConcurrent} onChange={(tcpConcurrent) => update({ tcpConcurrent })} />
        </FormRow>
        <FormRow label="Unified Delay" desc={t("engine.unifiedDelayDesc")}>
          <Toggle checked={g.unifiedDelay} onChange={(unifiedDelay) => update({ unifiedDelay })} />
        </FormRow>
        <FormRow label="Interface Name" desc={t("engine.interfaceNameDesc")}>
          <Select<string>
            value={g.interfaceName}
            width={180}
            onChange={(interfaceName) => update({ interfaceName })}
            options={[
              { value: "", label: t("engine.auto") },
              ...Array.from(new Set([...ifaces, ...(g.interfaceName ? [g.interfaceName] : [])])).map((n) => ({ value: n, label: n })),
            ]}
          />
        </FormRow>
        <FormRow label={t("engine.findProcess")} desc={t("engine.findProcessDesc")}>
          <Select<EngineGeneral["findProcessMode"]>
            value={g.findProcessMode}
            width={130}
            onChange={(findProcessMode) => update({ findProcessMode })}
            options={[
              { value: "always", label: t("engine.fpAlways") },
              { value: "strict", label: t("engine.fpStrict") },
              { value: "off", label: t("engine.fpOff") },
            ]}
          />
        </FormRow>
        <FormRow label={t("engine.keepAlive")} desc={t("engine.keepAliveDesc")}>
          <span className="en-inline">
            <NumberField value={g.keepAliveInterval} min={0} max={3600} width={80} onChange={(keepAliveInterval) => update({ keepAliveInterval })} />
            <span className="en-sub">{t("engine.seconds")}</span>
          </span>
        </FormRow>
      </FormSection>

      <FormSection
        title={t("engine.secDatabase")}
        extra={
          <Button size="sm" icon={geoState.busy ? undefined : <RefreshCw size={12} />} loading={geoState.busy} disabled={!running} onClick={updateGeo}>
            {t("engine.updateDbNow")}
          </Button>
        }
      >
        <FormRow label={t("engine.dbStatus")} desc={t("engine.dbStatusDesc")}>
          {dbStatus}
        </FormRow>
        <FormRow label={<Label restart>{t("engine.dbMode")}</Label>} desc={t("engine.dbModeDesc")}>
          <Select<string>
            value={g.geodataMode ? "dat" : "mmdb"}
            width={150}
            onChange={(v) => update({ geodataMode: v === "dat" })}
            options={[
              { value: "mmdb", label: "MMDB" },
              { value: "dat", label: "GeoData (dat)" },
            ]}
          />
        </FormRow>
        <FormRow label={t("engine.dbLoader")} desc={t("engine.dbLoaderDesc")}>
          <Select<EngineGeneral["geodataLoader"]>
            value={g.geodataLoader}
            width={150}
            onChange={(geodataLoader) => update({ geodataLoader })}
            options={[
              { value: "memconservative", label: t("engine.loaderCompressed") },
              { value: "standard", label: t("engine.loaderStandard") },
            ]}
          />
        </FormRow>
        <FormRow label={t("engine.geoAutoUpdate")} desc={t("engine.geoAutoUpdateDesc")}>
          <span className="en-inline">
            {g.geoAutoUpdate && (
              <>
                <NumberField value={g.geoUpdateInterval} min={1} max={720} width={64} onChange={(geoUpdateInterval) => update({ geoUpdateInterval })} />
                <span className="en-sub">{t("engine.hours")}</span>
              </>
            )}
            <Toggle checked={g.geoAutoUpdate} onChange={(geoAutoUpdate) => update({ geoAutoUpdate })} />
          </span>
        </FormRow>
        <FormRow label="GeoIP" desc={t("engine.geoipUrlDesc")} stack>
          <CommitField value={g.geoxUrl.geoip} width="100%" onCommit={(v) => setUrl("geoip", v)} />
        </FormRow>
        <FormRow label="GeoSite" desc={t("engine.geositeUrlDesc")} stack>
          <CommitField value={g.geoxUrl.geosite} width="100%" onCommit={(v) => setUrl("geosite", v)} />
        </FormRow>
        <FormRow label="MMDB" desc={t("engine.mmdbUrlDesc")} stack>
          <CommitField value={g.geoxUrl.mmdb} width="100%" onCommit={(v) => setUrl("mmdb", v)} />
        </FormRow>
        <FormRow label="ASN" desc={t("engine.asnUrlDesc")} stack>
          <CommitField value={g.geoxUrl.asn} width="100%" onCommit={(v) => setUrl("asn", v)} />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secSmart")}>
        <FormRow label={t("engine.smartModel")} desc={t("engine.smartModelDesc")}>
          <Select<EngineGeneral["smartModel"]>
            value={g.smartModel}
            width={150}
            onChange={(smartModel) => update({ smartModel })}
            options={[
              { value: "standard", label: t("engine.modelStandard") },
              { value: "middle", label: t("engine.modelMiddle") },
              { value: "large", label: t("engine.modelLarge") },
            ]}
          />
        </FormRow>
        {channel !== "smart" && (
          <FormRow>
            <Note>
              <Info size={13} />
              <span>{t("engine.smartOnlyNote")}</span>
            </Note>
          </FormRow>
        )}
      </FormSection>

      <FormSection title={t("engine.secCache")} desc={t("engine.secCacheDesc")}>
        <FormRow label={t("engine.storeSelected")} desc={t("engine.storeSelectedDesc")}>
          <Toggle checked={g.storeSelected} onChange={(storeSelected) => update({ storeSelected })} />
        </FormRow>
        <FormRow label={t("engine.storeFakeIp")} desc={t("engine.storeFakeIpDesc")}>
          <Toggle checked={g.storeFakeIp} onChange={(storeFakeIp) => update({ storeFakeIp })} />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secExperimental")}>
        <FormRow label="Disable QUIC GSO / ECN" desc={t("engine.quicGsoDesc")}>
          <Toggle checked={g.quicGsoDisable} onChange={(quicGsoDisable) => update({ quicGsoDisable })} />
        </FormRow>
        <FormRow label="Dialer IP4P Convert" desc={t("engine.ip4pDesc")}>
          <Toggle checked={g.dialerIp4pConvert} onChange={(dialerIp4pConvert) => update({ dialerIp4pConvert })} />
        </FormRow>
      </FormSection>
      <div style={{ display: "flex", justifyContent: "center", gap: 6, alignItems: "center" }} className="en-sub">
        <Database size={12} />
        {t("engine.autoApplyNote")}
      </div>
    </EnginePage>
  );
}

import React from "react";
import { AlertTriangle, Shield, ShieldCheck } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { backend } from "@/lib/backend";
import { Button, cx, FormRow, FormSection, NumberField, Select, Spinner, Toggle } from "@/components/ui";
import { CommitField, EnginePage, isCidr, Label, ListEditor, Note, useEngineSection } from "./components";
import type { EngineTun, HelperStatus } from "@/lib/types";

export default function TunPage() {
  const t = useT();
  const [tun, update] = useEngineSection("tun");
  const on = useApp((s) => s.settings?.tunMode ?? false);
  const busy = useApp((s) => s.busy.tun);
  const toggleTun = useApp((s) => s.toggleTun);
  const isAdmin = useApp((s) => s.info?.isAdmin ?? false);
  const running = useApp((s) => s.core.state === "running");
  const [helper, setHelper] = React.useState<HelperStatus | null>(null);

  React.useEffect(() => {
    backend.helperStatus().then(setHelper).catch(() => setHelper(null));
  }, []);

  if (!tun) return <EnginePage section="tun" title={t("nav.tun")}>{null}</EnginePage>;
  const cidrCheck = (s: string) => (isCidr(s) ? null : t("engine.invalidCidr"));
  const privileged = isAdmin || !!helper?.installed;

  return (
    <EnginePage section="tun" title={t("nav.tun")}>
      <div className="en-hero">
        <div className={cx("en-hero-icon", on && "on")}>{on ? <ShieldCheck size={24} /> : <Shield size={24} />}</div>
        <div className="en-hero-main">
          <div className="en-hero-title">
            {t("common.enhancedMode")}
            <span className="en-sub" style={{ fontWeight: 500 }}>
              {t(on ? "common.on" : "common.off")}
            </span>
          </div>
          <div className="en-hero-desc">{t("engine.tunHeroDesc")}</div>
          <div className="en-hero-meta">
            <span>
              <span className={cx("en-dot", isAdmin ? "on" : "warn")} />
              {t(isAdmin ? "engine.adminYes" : "engine.adminNo")}
            </span>
            <span>
              <span className={cx("en-dot", helper?.installed && "on")} />
              {helper === null ? "…" : t(helper.installed ? "engine.helperInstalled" : "engine.helperMissing")}
            </span>
            <span>
              <span className={cx("en-dot", running && "on")} />
              {t(running ? "engine.coreRunning" : "engine.coreStopped")}
            </span>
          </div>
        </div>
        {busy ? <Spinner size={18} /> : <Toggle checked={on} onChange={(v) => toggleTun(v)} />}
      </div>

      {!privileged && helper !== null && (
        <div style={{ marginBottom: 18 }}>
          <Note tone="warn">
            <AlertTriangle size={13} color="var(--orange)" />
            <span style={{ flex: 1 }}>{t("engine.needAdminHint")}</span>
            <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <Button size="sm" onClick={() => backend.openSettings("permissions")}>
                {t("engine.installHelper")}
              </Button>
              <Button size="sm" variant="primary" onClick={() => backend.restartAsAdmin()}>
                {t("common.restartAsAdmin")}
              </Button>
            </span>
          </Note>
        </div>
      )}

      <FormSection title={t("engine.secTunRoute")}>
        <FormRow label={<Label restart>{t("engine.tunStack")}</Label>} desc={t(`engine.stackDesc_${tun.stack}`)}>
          <Select<EngineTun["stack"]>
            value={tun.stack}
            width={160}
            onChange={(stack) => update({ stack })}
            options={[
              { value: "mixed", label: t("engine.stackMixed") },
              { value: "gvisor", label: "gVisor" },
              { value: "system", label: "System" },
            ]}
          />
        </FormRow>
        <FormRow label={<Label restart>{t("engine.tunDevice")}</Label>} desc={t("engine.tunDeviceDesc")}>
          <CommitField value={tun.device} width={150} onCommit={(device) => update({ device: device || "ClashWin" })} placeholder="ClashWin" />
        </FormRow>
        <FormRow label={t("engine.autoRoute")} desc={t("engine.autoRouteDesc")}>
          <Toggle checked={tun.autoRoute} onChange={(autoRoute) => update({ autoRoute })} />
        </FormRow>
        <FormRow label={t("engine.strictRoute")} desc={t("engine.strictRouteDesc")}>
          <Toggle checked={tun.strictRoute} onChange={(strictRoute) => update({ strictRoute })} />
        </FormRow>
        {tun.strictRoute && (
          <FormRow>
            <Note tone="warn">
              <AlertTriangle size={13} color="var(--orange)" />
              <span>{t("engine.strictRouteWarn")}</span>
            </Note>
          </FormRow>
        )}
        <FormRow label={t("engine.autoDetect")} desc={t("engine.autoDetectDesc")}>
          <Toggle checked={tun.autoDetectInterface} onChange={(autoDetectInterface) => update({ autoDetectInterface })} />
        </FormRow>
        <FormRow label={t("engine.eiNat")} desc={t("engine.eiNatDesc")}>
          <Toggle checked={tun.endpointIndependentNat} onChange={(endpointIndependentNat) => update({ endpointIndependentNat })} />
        </FormRow>
        <FormRow label={<Label restart>MTU</Label>} desc={t("engine.mtuDesc")}>
          <NumberField value={tun.mtu} min={576} max={65535} width={84} onChange={(mtu) => update({ mtu })} />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secDnsHijack")} desc={t("engine.secDnsHijackDesc")}>
        <FormRow stack>
          <ListEditor value={tun.dnsHijack} onChange={(dnsHijack) => update({ dnsHijack })} placeholder="any:53" />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secTunFilter")}>
        <FormRow label={t("engine.excludeIface")} desc={t("engine.excludeIfaceDesc")} stack>
          <ListEditor value={tun.excludeInterface} onChange={(excludeInterface) => update({ excludeInterface })} placeholder="vEthernet (WSL)" />
        </FormRow>
        <FormRow label={t("engine.excludePorts")} desc={t("engine.excludePortsDesc")} stack>
          <ListEditor
            value={tun.excludePorts}
            onChange={(excludePorts) => update({ excludePorts })}
            placeholder="22"
            validate={(s) => (/^\d{1,5}(-\d{1,5})?$/.test(s) && +s.split("-")[0] <= 65535 ? null : t("engine.invalidPort"))}
          />
        </FormRow>
        <FormRow label={t("engine.routeInclude")} desc={t("engine.routeIncludeDesc")} stack>
          <ListEditor value={tun.routeIncludeAddress} onChange={(routeIncludeAddress) => update({ routeIncludeAddress })} placeholder="198.18.0.0/16" validate={cidrCheck} />
        </FormRow>
        <FormRow label={t("engine.routeExclude")} desc={t("engine.routeExcludeDesc")} stack>
          <ListEditor value={tun.routeExcludeAddress} onChange={(routeExcludeAddress) => update({ routeExcludeAddress })} placeholder="192.168.0.0/16" validate={cidrCheck} />
        </FormRow>
      </FormSection>
    </EnginePage>
  );
}

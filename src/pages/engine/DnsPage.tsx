import React from "react";
import { Eraser, Trash2 } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { errorMessage } from "@/lib/backend";
import { mihomo } from "@/lib/mihomo";
import { Button, FormRow, FormSection, Select, Toggle, toast } from "@/components/ui";
import { CommitField, EnginePage, isCidr, KeyValueEditor, Label, ListEditor, useEngineSection } from "./components";
import type { EngineDns } from "@/lib/types";

export default function DnsPage() {
  const t = useT();
  const [d, update] = useEngineSection("dns");
  const running = useApp((s) => s.core.state === "running");
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!d) return <EnginePage section="dns" title={t("nav.dns")}>{null}</EnginePage>;

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const ff = d.fallbackFilter;
  const cidrCheck = (s: string) => (isCidr(s) ? null : t("engine.invalidCidr"));

  return (
    <EnginePage
      section="dns"
      title={t("nav.dns")}
      extraActions={
        <>
          <Button
            className="en-toolbar-btn"
            icon={<Eraser size={13} />}
            loading={busy === "dns"}
            disabled={!running}
            onClick={() => run("dns", () => mihomo.flushDns(), t("engine.dnsFlushed"))}
          >
            {t("engine.flushDns")}
          </Button>
          <Button
            className="en-toolbar-btn"
            icon={<Trash2 size={13} />}
            loading={busy === "fakeip"}
            disabled={!running}
            onClick={() => run("fakeip", () => mihomo.flushFakeIp(), t("engine.fakeIpFlushed"))}
          >
            {t("engine.flushFakeIp")}
          </Button>
        </>
      }
    >
      <FormSection title={t("engine.secDnsMode")}>
        <FormRow label={t("engine.dnsEnable")} desc={t("engine.dnsEnableDesc")}>
          <Toggle checked={d.enable} onChange={(enable) => update({ enable })} />
        </FormRow>
        <FormRow label={<Label restart>{t("engine.dnsListen")}</Label>} desc={t("engine.dnsListenDesc")}>
          <CommitField value={d.listen} width={160} onCommit={(listen) => update({ listen })} placeholder="0.0.0.0:1053" />
        </FormRow>
        <FormRow label={t("engine.dnsMode")} desc={t(`engine.dnsModeDesc_${d.enhancedMode}`)}>
          <Select<EngineDns["enhancedMode"]>
            value={d.enhancedMode}
            width={170}
            onChange={(enhancedMode) => update({ enhancedMode })}
            options={[
              { value: "fake-ip", label: t("engine.modeFakeIp") },
              { value: "redir-host", label: t("engine.modeRedirHost") },
              { value: "normal", label: t("engine.modeNormal") },
            ]}
          />
        </FormRow>
        {d.enhancedMode === "fake-ip" && (
          <>
            <FormRow label={t("engine.fakeIpRange")} desc={t("engine.fakeIpRangeDesc")}>
              <CommitField value={d.fakeIpRange} width={160} onCommit={(fakeIpRange) => update({ fakeIpRange })} placeholder="198.18.0.1/16" />
            </FormRow>
            <FormRow label={t("engine.fakeIpFilter")} desc={t("engine.fakeIpFilterDesc")} stack>
              <ListEditor value={d.fakeIpFilter} onChange={(fakeIpFilter) => update({ fakeIpFilter })} placeholder="+.example.com" />
            </FormRow>
          </>
        )}
        <FormRow label={t("engine.dnsIpv6")} desc={t("engine.dnsIpv6Desc")}>
          <Toggle checked={d.ipv6} onChange={(ipv6) => update({ ipv6 })} />
        </FormRow>
        <FormRow label={t("engine.useHosts")} desc={t("engine.useHostsDesc")}>
          <Toggle checked={d.useHosts} onChange={(useHosts) => update({ useHosts })} />
        </FormRow>
        <FormRow label={t("engine.useSystemHosts")} desc={t("engine.useSystemHostsDesc")}>
          <Toggle checked={d.useSystemHosts} onChange={(useSystemHosts) => update({ useSystemHosts })} />
        </FormRow>
        <FormRow label={t("engine.respectRules")} desc={t("engine.respectRulesDesc")}>
          <Toggle checked={d.respectRules} onChange={(respectRules) => update({ respectRules })} />
        </FormRow>
        <FormRow label={t("engine.preferH3")} desc={t("engine.preferH3Desc")}>
          <Toggle checked={d.preferH3} onChange={(preferH3) => update({ preferH3 })} />
        </FormRow>
        <FormRow label={t("engine.cacheAlgo")} desc={t("engine.cacheAlgoDesc")}>
          <Select<EngineDns["cacheAlgorithm"]>
            value={d.cacheAlgorithm}
            width={130}
            onChange={(cacheAlgorithm) => update({ cacheAlgorithm })}
            options={[
              { value: "arc", label: "ARC" },
              { value: "lru", label: "LRU" },
            ]}
          />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secServers")}>
        <FormRow label={t("engine.defaultNs")} desc={t("engine.defaultNsDesc")} stack>
          <ListEditor value={d.defaultNameserver} onChange={(defaultNameserver) => update({ defaultNameserver })} placeholder="223.5.5.5" />
        </FormRow>
        <FormRow label={t("engine.nameserver")} desc={t("engine.nameserverDesc")} stack>
          <ListEditor value={d.nameserver} onChange={(nameserver) => update({ nameserver })} placeholder="https://doh.pub/dns-query" />
        </FormRow>
        <FormRow label={t("engine.fallback")} desc={t("engine.fallbackDesc")} stack>
          <ListEditor value={d.fallback} onChange={(fallback) => update({ fallback })} placeholder="https://1.1.1.1/dns-query" />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secFallbackFilter")} desc={t("engine.secFallbackFilterDesc")}>
        <FormRow label={t("engine.ffGeoip")} desc={t("engine.ffGeoipDesc")}>
          <span className="en-inline">
            {ff.geoip && (
              <CommitField value={ff.geoipCode} width={64} align="right" onCommit={(geoipCode) => update({ fallbackFilter: { ...ff, geoipCode: geoipCode.toUpperCase() } })} placeholder="CN" />
            )}
            <Toggle checked={ff.geoip} onChange={(geoip) => update({ fallbackFilter: { ...ff, geoip } })} />
          </span>
        </FormRow>
        <FormRow label={t("engine.ffIpcidr")} desc={t("engine.ffIpcidrDesc")} stack>
          <ListEditor value={ff.ipcidr} onChange={(ipcidr) => update({ fallbackFilter: { ...ff, ipcidr } })} placeholder="240.0.0.0/4" validate={cidrCheck} />
        </FormRow>
        <FormRow label={t("engine.ffDomain")} desc={t("engine.ffDomainDesc")} stack>
          <ListEditor value={ff.domain} onChange={(domain) => update({ fallbackFilter: { ...ff, domain } })} placeholder="+.google.com" />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secPolicy")}>
        <FormRow label={t("engine.nsPolicy")} desc={t("engine.nsPolicyDesc")} stack>
          <KeyValueEditor
            value={d.nameserverPolicy}
            onChange={(nameserverPolicy) => update({ nameserverPolicy })}
            keyPlaceholder={t("engine.nsPolicyKey")}
            valuePlaceholder={t("engine.nsPolicyValue")}
          />
        </FormRow>
        <FormRow label={t("engine.proxyNs")} desc={t("engine.proxyNsDesc")} stack>
          <ListEditor value={d.proxyServerNameserver} onChange={(proxyServerNameserver) => update({ proxyServerNameserver })} placeholder="https://doh.pub/dns-query" />
        </FormRow>
        <FormRow label={t("engine.directNs")} desc={t("engine.directNsDesc")} stack>
          <ListEditor value={d.directNameserver} onChange={(directNameserver) => update({ directNameserver })} placeholder="system" />
        </FormRow>
      </FormSection>
    </EnginePage>
  );
}

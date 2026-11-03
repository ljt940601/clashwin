import { useT } from "@/i18n";
import { FormRow, FormSection, Toggle } from "@/components/ui";
import { CommitField, EnginePage, isCidr, ListEditor, useEngineSection } from "./components";
import type { EngineSniffer, SnifferProto } from "@/lib/types";

export default function SnifferPage() {
  const t = useT();
  const [s, update] = useEngineSection("sniffer");
  if (!s) return <EnginePage section="sniffer" title={t("nav.sniffer")}>{null}</EnginePage>;
  const cidrCheck = (v: string) => (isCidr(v) ? null : t("engine.invalidCidr"));

  const protoRow = (key: "http" | "tls" | "quic", name: string) => {
    const p = s[key];
    const set = (patch: Partial<SnifferProto>) => update({ [key]: { ...p, ...patch } } as Partial<EngineSniffer>);
    return (
      <FormRow
        label={<span className="en-proto-name">{name}</span>}
        desc={t(`engine.proto_${key}`)}
      >
        <span className="en-proto" style={{ opacity: p.enable ? 1 : 0.5 }}>
          <CommitField value={p.ports} width={150} onCommit={(ports) => set({ ports })} placeholder="443, 8443" />
          <span className="en-mini-label">{t("engine.override")}</span>
          <Toggle size="sm" checked={p.override} disabled={!p.enable} onChange={(override) => set({ override })} />
        </span>
        <Toggle checked={p.enable} onChange={(enable) => set({ enable })} />
      </FormRow>
    );
  };

  return (
    <EnginePage section="sniffer" title={t("nav.sniffer")}>
      <FormSection title={t("engine.secSnifferCore")}>
        <FormRow label={t("engine.snifferEnable")} desc={t("engine.snifferEnableDesc")}>
          <Toggle checked={s.enable} onChange={(enable) => update({ enable })} />
        </FormRow>
        <FormRow label={t("engine.overrideDest")} desc={t("engine.overrideDestDesc")}>
          <Toggle checked={s.overrideDestination} onChange={(overrideDestination) => update({ overrideDestination })} />
        </FormRow>
        <FormRow label={t("engine.forceDnsMapping")} desc={t("engine.forceDnsMappingDesc")}>
          <Toggle checked={s.forceDnsMapping} onChange={(forceDnsMapping) => update({ forceDnsMapping })} />
        </FormRow>
        <FormRow label={t("engine.parsePureIp")} desc={t("engine.parsePureIpDesc")}>
          <Toggle checked={s.parsePureIp} onChange={(parsePureIp) => update({ parsePureIp })} />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secProtocols")} desc={t("engine.secProtocolsDesc")}>
        {protoRow("http", "HTTP")}
        {protoRow("tls", "TLS")}
        {protoRow("quic", "QUIC")}
      </FormSection>

      <FormSection title={t("engine.secSkip")}>
        <FormRow label={t("engine.skipDomain")} desc={t("engine.skipDomainDesc")} stack>
          <ListEditor value={s.skipDomain} onChange={(skipDomain) => update({ skipDomain })} placeholder="+.push.apple.com" />
        </FormRow>
        <FormRow label={t("engine.forceDomain")} desc={t("engine.forceDomainDesc")} stack>
          <ListEditor value={s.forceDomain} onChange={(forceDomain) => update({ forceDomain })} placeholder="+.netflix.com" />
        </FormRow>
        <FormRow label={t("engine.skipSrc")} desc={t("engine.skipSrcDesc")} stack>
          <ListEditor value={s.skipSrcAddress} onChange={(skipSrcAddress) => update({ skipSrcAddress })} placeholder="192.168.1.10/32" validate={cidrCheck} />
        </FormRow>
        <FormRow label={t("engine.skipDst")} desc={t("engine.skipDstDesc")} stack>
          <ListEditor value={s.skipDstAddress} onChange={(skipDstAddress) => update({ skipDstAddress })} placeholder="17.0.0.0/8" validate={cidrCheck} />
        </FormRow>
      </FormSection>
    </EnginePage>
  );
}

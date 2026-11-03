import { KeyRound } from "lucide-react";
import { useT } from "@/i18n";
import { FormRow, FormSection, IconButton, NumberField, Select, Toggle, Tooltip } from "@/components/ui";
import { CommitField, EnginePage, isCidr, Label, ListEditor, useEngineSection } from "./components";
import type { EngineNetwork } from "@/lib/types";

function randomToken(len: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (x) => chars[x % chars.length]).join("");
}

export default function NetworkPage() {
  const t = useT();
  const [n, update] = useEngineSection("network");
  if (!n) return <EnginePage section="network" title={t("nav.network")}>{null}</EnginePage>;

  const host = n.allowLan ? (n.bindAddress === "*" || !n.bindAddress ? "0.0.0.0" : n.bindAddress) : "127.0.0.1";
  const cidrCheck = (s: string) => (isCidr(s) ? null : t("engine.invalidCidr"));
  const portRow = (key: "mixedPort" | "httpPort" | "socksPort", label: string, desc: string) => (
    <FormRow label={<Label restart>{label}</Label>} desc={desc}>
      <span className="en-inline">
        {n[key] > 0 ? <span className="en-sub mono">{`${host}:${n[key]}`}</span> : <span className="en-sub">{t("engine.portOff")}</span>}
        <NumberField value={n[key]} min={0} max={65535} width={84} onChange={(v) => update({ [key]: v } as Partial<EngineNetwork>)} />
      </span>
    </FormRow>
  );

  return (
    <EnginePage section="network" title={t("nav.network")}>
      <FormSection title={t("engine.secInbound")} desc={t("engine.secInboundDesc")}>
        {portRow("mixedPort", t("engine.mixedPort"), t("engine.mixedPortDesc"))}
        {portRow("httpPort", t("engine.httpPort"), t("engine.httpPortDesc"))}
        {portRow("socksPort", t("engine.socksPort"), t("engine.socksPortDesc"))}
      </FormSection>

      <FormSection title={t("engine.secOptimize")}>
        <FormRow label={t("engine.ipv6")} desc={t("engine.ipv6Desc")}>
          <Toggle checked={n.ipv6} onChange={(ipv6) => update({ ipv6 })} />
        </FormRow>
        <FormRow label={t("engine.tfo")} desc={t("engine.tfoDesc")}>
          <Toggle checked={n.tcpFastOpen} onChange={(tcpFastOpen) => update({ tcpFastOpen })} />
        </FormRow>
        <FormRow label={t("engine.mptcp")} desc={t("engine.mptcpDesc")}>
          <Toggle checked={n.mptcp} onChange={(mptcp) => update({ mptcp })} />
        </FormRow>
        <FormRow label={t("engine.quicBlock")} desc={t("engine.quicBlockDesc")}>
          <Select<EngineNetwork["quicBlock"]>
            value={n.quicBlock}
            width={170}
            onChange={(quicBlock) => update({ quicBlock })}
            options={[
              { value: "off", label: t("engine.quicOff") },
              { value: "all", label: t("engine.quicAll") },
              { value: "overseas", label: t("engine.quicOverseas") },
            ]}
          />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secLan")}>
        <FormRow label={t("engine.allowLan")} desc={t("engine.allowLanDesc")}>
          <Toggle checked={n.allowLan} onChange={(allowLan) => update({ allowLan })} />
        </FormRow>
        <FormRow label={<Label restart>{t("engine.bindAddress")}</Label>} desc={t("engine.bindAddressDesc")}>
          <CommitField value={n.bindAddress} width={160} onCommit={(bindAddress) => update({ bindAddress: bindAddress || "*" })} placeholder="*" />
        </FormRow>
        <FormRow label={t("engine.lanAllowed")} desc={t("engine.lanAllowedDesc")} stack>
          <ListEditor value={n.lanAllowedIps} onChange={(lanAllowedIps) => update({ lanAllowedIps })} placeholder="192.168.0.0/16" validate={cidrCheck} />
        </FormRow>
        <FormRow label={t("engine.lanDenied")} desc={t("engine.lanDeniedDesc")} stack>
          <ListEditor value={n.lanDisallowedIps} onChange={(lanDisallowedIps) => update({ lanDisallowedIps })} placeholder="192.168.1.100/32" validate={cidrCheck} />
        </FormRow>
        <FormRow label={t("engine.auth")} desc={t("engine.authDesc")} stack>
          <ListEditor
            value={n.authentication}
            onChange={(authentication) => update({ authentication })}
            placeholder="user:password"
            validate={(s) => (/^[^:\s]+:\S+$/.test(s) ? null : t("engine.invalidAuth"))}
            extraButtons={
              <Tooltip content={t("engine.genCredentials")}>
                <IconButton
                  icon={<KeyRound size={12} />}
                  size="xs"
                  variant="plain"
                  onClick={() => update({ authentication: [...n.authentication, `user-${randomToken(4).toLowerCase()}:${randomToken(16)}`] })}
                />
              </Tooltip>
            }
          />
        </FormRow>
        <FormRow label={t("engine.skipAuth")} desc={t("engine.skipAuthDesc")} stack>
          <ListEditor value={n.skipAuthPrefixes} onChange={(skipAuthPrefixes) => update({ skipAuthPrefixes })} placeholder="127.0.0.1/8" validate={cidrCheck} />
        </FormRow>
      </FormSection>

      <FormSection title={t("engine.secBypass")} desc={t("engine.secBypassDesc")}>
        <FormRow stack>
          <ListEditor value={n.bypass} onChange={(bypass) => update({ bypass })} placeholder="*.example.com" maxHeight={260} />
        </FormRow>
      </FormSection>
    </EnginePage>
  );
}

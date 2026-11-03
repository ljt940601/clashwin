import React from "react";
import { Button, Modal, Select, TextField, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { backend, errorMessage } from "@/lib/backend";

export type RuleKind = "domain" | "process";

export interface RuleDraft {
  kind: RuleKind;
  /** host or process name/path the rule is based on */
  host?: string;
  process?: string;
  processPath?: string;
}

const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "com.hk", "com.tw",
  "co.jp", "ne.jp", "or.jp", "co.kr", "com.au", "net.au", "com.sg", "com.br", "co.in", "com.mx", "co.nz",
]);

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");

/** "daily-cloudcode-pa.googleapis.com" → "googleapis.com" (approximate registrable domain). */
export function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const last2 = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(last2)) return parts.slice(-3).join(".");
  return last2;
}

function initial(d: RuleDraft): { type: string; payload: string } {
  if (d.kind === "process") return { type: "PROCESS-NAME", payload: d.process ?? "" };
  const h = d.host ?? "";
  if (isIp(h)) return { type: h.includes(":") ? "IP-CIDR6" : "IP-CIDR", payload: h.includes(":") ? `${h}/128` : `${h}/32` };
  return { type: "DOMAIN-SUFFIX", payload: baseDomain(h) };
}

const DOMAIN_TYPES = ["DOMAIN-SUFFIX", "DOMAIN", "DOMAIN-KEYWORD", "DOMAIN-WILDCARD", "IP-CIDR", "IP-CIDR6"];
const PROCESS_TYPES = ["PROCESS-NAME", "PROCESS-PATH", "PROCESS-NAME-REGEX"];
const NO_RESOLVE = new Set(["IP-CIDR", "IP-CIDR6"]);

/** Quick "add rule" sheet opened from the connection context menu. */
export function RuleDialog({ draft, onClose }: { draft: RuleDraft | null; onClose: () => void }) {
  const t = useT();
  const [type, setType] = React.useState("DOMAIN-SUFFIX");
  const [payload, setPayload] = React.useState("");
  const [policy, setPolicy] = React.useState("");
  const [targets, setTargets] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!draft) return;
    const i = initial(draft);
    setType(i.type);
    setPayload(i.payload);
    backend
      .ruleTargets()
      .then((list) => {
        setTargets(list);
        setPolicy((p) => (p && list.includes(p) ? p : list.find((x) => !["DIRECT", "REJECT", "REJECT-DROP", "PASS"].includes(x)) ?? list[0] ?? "DIRECT"));
      })
      .catch(() => setTargets(["DIRECT", "REJECT"]));
  }, [draft]);

  React.useEffect(() => {
    // switching between name/path keeps the payload meaningful
    if (!draft || draft.kind !== "process") return;
    if (type === "PROCESS-PATH" && draft.processPath) setPayload(draft.processPath);
    if (type === "PROCESS-NAME" && draft.process) setPayload(draft.process);
  }, [type, draft]);

  const types = draft?.kind === "process" ? PROCESS_TYPES : DOMAIN_TYPES;
  const rule = `${type},${payload.trim()},${policy}${NO_RESOLVE.has(type) ? ",no-resolve" : ""}`;

  const submit = async () => {
    if (!payload.trim() || !policy) return;
    setSaving(true);
    try {
      await backend.addRule(rule);
      toast.success(t("requests.ruleAdded", { rule }));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      width={460}
      title={t("requests.addRuleTitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={saving} disabled={!payload.trim() || !policy} onClick={submit}>
            {t("common.done")}
          </Button>
        </>
      }
    >
      <div className="rq-rule-form">
        <label>{t("requests.ruleType")}</label>
        <Select value={type} width="100%" onChange={setType} options={types.map((x) => ({ value: x, label: x }))} />
        <label>{t("requests.payload")}</label>
        <TextField value={payload} onChange={setPayload} mono style={{ width: "100%" }} autoFocus onKeyDown={(e) => e.key === "Enter" && submit()} />
        <label>{t("requests.policy")}</label>
        <Select value={policy} width="100%" onChange={setPolicy} options={targets.map((x) => ({ value: x, label: x }))} />
        <div className="rq-rule-preview">{rule}</div>
      </div>
    </Modal>
  );
}

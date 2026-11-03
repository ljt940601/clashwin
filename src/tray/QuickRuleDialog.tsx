import React from "react";
import { Button, Modal, Select, TextField, toast } from "@/components/ui";
import { backend, errorMessage } from "@/lib/backend";
import { useT } from "@/i18n";

/** Quick "add a DOMAIN-SUFFIX rule for a web page" dialog shown from the tray panel. */
export function QuickRuleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [domain, setDomain] = React.useState("");
  const [policy, setPolicy] = React.useState("");
  const [targets, setTargets] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDomain("");
    backend
      .ruleTargets()
      .then((list) => {
        setTargets(list);
        setPolicy((p) => p || list.find((x) => !["DIRECT", "REJECT", "REJECT-DROP", "PASS"].includes(x)) || list[0] || "DIRECT");
      })
      .catch(() => setTargets(["DIRECT", "REJECT"]));
  }, [open]);

  const clean = domain
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[/?#:].*$/, "")
    .replace(/^\*\./, "");

  const submit = async () => {
    if (!clean || !policy) return;
    setBusy(true);
    try {
      await backend.addRule(`DOMAIN-SUFFIX,${clean},${policy}`);
      toast.success(t("tray.ruleAdded"));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={276}
      title={t("tray.addRuleTitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={busy} disabled={!clean} onClick={submit}>
            {t("common.done")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--text-3)" }}>
          {t("tray.domain")}
          <TextField
            value={domain}
            onChange={setDomain}
            placeholder={t("tray.domainPlaceholder")}
            autoFocus
            mono
            style={{ width: "100%" }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--text-3)" }}>
          {t("tray.policy")}
          <Select value={policy} width={150} options={targets.map((x) => ({ value: x, label: x }))} onChange={setPolicy} />
        </div>
        {clean && (
          <div className="mono" style={{ fontSize: 11, color: "var(--text-dim)", wordBreak: "break-all" }}>
            DOMAIN-SUFFIX,{clean},{policy}
          </div>
        )}
      </div>
    </Modal>
  );
}

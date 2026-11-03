import React from "react";
import {
  AppWindow,
  EthernetPort,
  Flag,
  GitBranch,
  Globe,
  Globe2,
  Hash,
  ListChecks,
  MapPin,
  Network,
  Plus,
  Waypoints,
  X,
} from "lucide-react";
import { Button, Dropdown, IconButton, Modal, Segmented, Select, TextField, Toggle, cx } from "@/components/ui";
import { useT } from "@/i18n";
import {
  RULE_TYPES,
  buildRuleLine,
  compileLogic,
  nid,
  parseLogic,
  presetsFor,
  ruleMeta,
  validateLogic,
  type LNode,
  type LogicOp,
  type RuleCategory,
} from "./ruleUtils";

/* ---------------- icon per rule type ---------------- */

const CAT_ICON: Record<RuleCategory, React.ElementType> = {
  domain: Globe,
  ip: Network,
  process: AppWindow,
  port: EthernetPort,
  geo: MapPin,
  ruleset: ListChecks,
  network: Waypoints,
  logic: GitBranch,
  match: Flag,
  other: Hash,
};
const CAT_COLOR: Record<RuleCategory, string> = {
  domain: "var(--blue)",
  ip: "var(--teal)",
  process: "var(--purple)",
  port: "var(--indigo)",
  geo: "var(--green)",
  ruleset: "var(--orange)",
  network: "var(--cyan)",
  logic: "var(--magenta)",
  match: "var(--red)",
  other: "var(--text-dim)",
};

export function RuleTypeIcon({ type, size = 13 }: { type: string; size?: number }) {
  const m = ruleMeta(type);
  const Icon = CAT_ICON[m.category];
  return <Icon size={size} color={CAT_COLOR[m.category]} strokeWidth={2} style={{ flexShrink: 0 }} />;
}

/* ---------------- payload input with preset globe ---------------- */

function PayloadInput({
  type,
  value,
  onChange,
  ruleSets,
  autoFocus,
}: {
  type: string;
  value: string;
  onChange: (v: string) => void;
  ruleSets: string[];
  autoFocus?: boolean;
}) {
  const t = useT();
  const meta = ruleMeta(type);
  if (type === "RULE-SET" && ruleSets.length) {
    return (
      <Select
        value={value}
        width="100%"
        placeholder={t("rules.ruleSet")}
        options={[...(value && !ruleSets.includes(value) ? [value] : []), ...ruleSets].map((r) => ({ value: r, label: r }))}
        onChange={onChange}
      />
    );
  }
  const presets = presetsFor(type);
  return (
    <div className="rl-payload">
      <TextField
        value={value}
        onChange={onChange}
        mono
        placeholder={meta.placeholder ?? t("rules.payloadPh")}
        style={{ flex: 1, width: "100%" }}
        autoFocus={autoFocus}
      />
      {presets && (
        <Dropdown
          align="end"
          minWidth={200}
          items={() => [
            { header: t("rules.presets") },
            ...presets.map((p) => ({
              label: (
                <span style={{ display: "flex", justifyContent: "space-between", gap: 16, width: "100%" }}>
                  <span>{t(p.labelKey)}</span>
                  <span className="mono" style={{ opacity: 0.6, fontSize: 11 }}>
                    {p.value}
                  </span>
                </span>
              ),
              onClick: () => onChange(p.value),
            })),
          ]}
        >
          {() => <IconButton icon={<Globe2 size={14} />} size="sm" title={t("rules.presets")} style={{ width: 28, height: 28 }} />}
        </Dropdown>
      )}
    </div>
  );
}

/* ---------------- standard rule editor ---------------- */

const BUILTIN_POLICIES = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"]);

export interface StandardInitial {
  type: string;
  payload: string;
  policy: string;
  noResolve: boolean;
  options?: string[];
}

export function StandardRuleEditor({
  open,
  title,
  initial,
  targets,
  ruleSets,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initial?: StandardInitial;
  targets: string[];
  ruleSets: string[];
  onClose: () => void;
  onSave: (line: string) => Promise<void> | void;
}) {
  const t = useT();
  const [type, setType] = React.useState(initial?.type ?? "DOMAIN-SUFFIX");
  const [payload, setPayload] = React.useState(initial?.payload ?? "");
  const [policy, setPolicy] = React.useState(initial?.policy ?? targets[0] ?? "DIRECT");
  const [noResolve, setNoResolve] = React.useState(initial?.noResolve ?? false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setType(initial?.type ?? "DOMAIN-SUFFIX");
    setPayload(initial?.payload ?? "");
    setPolicy(initial?.policy ?? targets.find((x) => !BUILTIN_POLICIES.has(x)) ?? targets[0] ?? "DIRECT");
    setNoResolve(initial?.noResolve ?? false);
    setError(null);
  }, [open, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = ruleMeta(type);
  const line = buildRuleLine({ type, payload, policy, noResolve: meta.ip && noResolve, options: initial?.options });
  const typeOptions = RULE_TYPES.filter((m) => m.type !== "SUB-RULE" || initial?.type === "SUB-RULE").map((m) => ({
    value: m.type,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <RuleTypeIcon type={m.type} size={12} />
        {m.type}
      </span>
    ),
  }));
  const policyOptions = [...(policy && !targets.includes(policy) ? [policy] : []), ...targets].map((p) => ({ value: p, label: p }));

  const submit = async () => {
    if (!meta.noPayload && !payload.trim()) return setError(t("rules.payloadRequired"));
    if (!policy) return setError(t("rules.policyRequired"));
    setSaving(true);
    try {
      await onSave(line);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={480}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            {t("common.done")}
          </Button>
        </>
      }
    >
      <div className="rl-form">
        <label>{t("rules.ruleType")}</label>
        <Select value={type} options={typeOptions} onChange={(v) => setType(v)} width="100%" />
        {!meta.noPayload && (
          <>
            <label>{t("rules.payload")}</label>
            <PayloadInput type={type} value={payload} onChange={(v) => (setPayload(v), setError(null))} ruleSets={ruleSets} autoFocus />
          </>
        )}
        <label>{t("rules.policy")}</label>
        <Select value={policy} options={policyOptions} onChange={setPolicy} width="100%" />
        {meta.ip && (
          <>
            <label>{t("rules.noResolve")}</label>
            <div className="rl-form-toggle">
              <Toggle checked={noResolve} onChange={setNoResolve} size="sm" />
              <span>{t("rules.noResolveDesc")}</span>
            </div>
          </>
        )}
      </div>
      <div className="rl-preview">
        <span>{t("rules.preview")}</span>
        <code className="mono selectable">{line}</code>
      </div>
      {error && <div className="rl-error">{error}</div>}
    </Modal>
  );
}

/* ---------------- logic rule editor ---------------- */

const LEAF_TYPES = RULE_TYPES.filter((m) => m.inLogic).map((m) => m.type);

function newCond(): LNode {
  return { id: nid(), kind: "cond", type: "DOMAIN-SUFFIX", payload: "" };
}
function newLogic(op: LogicOp): LNode {
  return { id: nid(), kind: "logic", op, children: [newCond()] };
}

function LogicNodeView({
  node,
  onChange,
  onRemove,
  depth,
  ruleSets,
}: {
  node: LNode;
  onChange: (n: LNode) => void;
  onRemove?: () => void;
  depth: number;
  ruleSets: string[];
}) {
  const t = useT();
  if (node.kind === "cond") {
    return (
      <div className="rl-leaf">
        <Select
          value={node.type}
          width={168}
          options={LEAF_TYPES.map((x) => ({
            value: x,
            label: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <RuleTypeIcon type={x} size={12} />
                {x}
              </span>
            ),
          }))}
          onChange={(v) => onChange({ ...node, type: v })}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <PayloadInput type={node.type} value={node.payload} onChange={(v) => onChange({ ...node, payload: v })} ruleSets={ruleSets} />
        </div>
        {onRemove && <IconButton icon={<X size={13} />} variant="plain" size="sm" title={t("rules.removeNode")} onClick={onRemove} />}
      </div>
    );
  }
  const setChild = (i: number, c: LNode) => onChange({ ...node, children: node.children.map((x, j) => (j === i ? c : x)) });
  const removeChild = (i: number) => onChange({ ...node, children: node.children.filter((_, j) => j !== i) });
  const addChild = (c: LNode) => onChange({ ...node, children: [...node.children, c] });
  const canAdd = node.op !== "NOT" || node.children.length < 1;
  return (
    <div className={cx("rl-logic", depth > 0 && "nested")}>
      <div className="rl-logic-head">
        <Segmented<LogicOp>
          value={node.op}
          onChange={(op) => onChange({ ...node, op })}
          options={[
            { value: "AND", label: "AND", title: t("rules.and") },
            { value: "OR", label: "OR", title: t("rules.or") },
            { value: "NOT", label: "NOT", title: t("rules.not") },
          ]}
        />
        <span className="rl-logic-hint">{t(`rules.${node.op.toLowerCase()}`)}</span>
        <span style={{ flex: 1 }} />
        <Dropdown
          align="end"
          items={() => [
            { label: t("rules.addCondition"), icon: <Plus size={13} />, onClick: () => addChild(newCond()), disabled: !canAdd },
            "separator",
            { header: t("rules.addNested") },
            { label: "AND", icon: <GitBranch size={13} />, onClick: () => addChild(newLogic("AND")), disabled: !canAdd },
            { label: "OR", icon: <GitBranch size={13} />, onClick: () => addChild(newLogic("OR")), disabled: !canAdd },
            { label: "NOT", icon: <GitBranch size={13} />, onClick: () => addChild(newLogic("NOT")), disabled: !canAdd },
          ]}
        >
          {() => <IconButton icon={<Plus size={14} />} size="sm" title={t("rules.addCondition")} />}
        </Dropdown>
        {onRemove && <IconButton icon={<X size={13} />} variant="plain" size="sm" title={t("rules.removeNode")} onClick={onRemove} />}
      </div>
      <div className="rl-logic-children">
        {node.children.map((c, i) => (
          <LogicNodeView
            key={c.id}
            node={c}
            depth={depth + 1}
            ruleSets={ruleSets}
            onChange={(n) => setChild(i, n)}
            onRemove={() => removeChild(i)}
          />
        ))}
      </div>
    </div>
  );
}

export function LogicRuleEditor({
  open,
  title,
  initial,
  targets,
  ruleSets,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initial?: { op: string; payload: string; policy: string };
  targets: string[];
  ruleSets: string[];
  onClose: () => void;
  onSave: (line: string) => Promise<void> | void;
}) {
  const t = useT();
  const make = (): LNode =>
    initial
      ? parseLogic(initial.op, initial.payload)
      : { id: nid(), kind: "logic", op: "AND", children: [{ id: nid(), kind: "cond", type: "NETWORK", payload: "UDP" }, { id: nid(), kind: "cond", type: "DST-PORT", payload: "443" }] };
  const [root, setRoot] = React.useState<LNode>(make);
  const [policy, setPolicy] = React.useState(initial?.policy ?? "REJECT");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setRoot(make());
    setPolicy(initial?.policy ?? (targets.includes("REJECT") ? "REJECT" : targets[0] ?? "DIRECT"));
    setError(null);
  }, [open, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const line = `${compileLogic(root)},${policy}`;
  const policyOptions = [...(policy && !targets.includes(policy) ? [policy] : []), ...targets].map((p) => ({ value: p, label: p }));

  const submit = async () => {
    const e = validateLogic(root);
    if (e) return setError(t(e));
    if (!policy) return setError(t("rules.policyRequired"));
    setSaving(true);
    try {
      await onSave(line);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            {t("common.done")}
          </Button>
        </>
      }
    >
      <div className="rl-logic-wrap">
        <LogicNodeView node={root} depth={0} ruleSets={ruleSets} onChange={(n) => (setRoot(n), setError(null))} />
      </div>
      <div className="rl-form" style={{ marginTop: 12 }}>
        <label>{t("rules.policy")}</label>
        <Select value={policy} options={policyOptions} onChange={setPolicy} width="100%" />
      </div>
      <div className="rl-preview">
        <span>{t("rules.preview")}</span>
        <code className="mono selectable">{line}</code>
      </div>
      {error && <div className="rl-error">{error}</div>}
    </Modal>
  );
}

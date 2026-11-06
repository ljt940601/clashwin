import React from "react";
import { Box, ListChecks, RefreshCw } from "lucide-react";
import { Button, Checkbox, Empty, Modal, NumberField, Spinner, TextField, confirm, toast } from "@/components/ui";
import { YamlEditor, type YamlEditorHandle } from "@/components/editor/YamlEditor";
import { errorLine } from "@/components/editor/yaml";
import { useLang, useT } from "@/i18n";
import { backend, errorMessage } from "@/lib/backend";
import { formatAgo, formatCount } from "@/lib/format";
import type { ExternalResource, Profile } from "@/lib/types";
import { safeHost } from "./utils";

/* ---------------- Import subscription ---------------- */

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setUrl("");
    setName("");
    setError(null);
    // Prefill from clipboard when it holds a link
    navigator.clipboard
      ?.readText?.()
      .then((txt) => {
        const s = txt?.trim();
        if (s && /^https?:\/\/\S+$/i.test(s)) setUrl((u) => u || s);
      })
      .catch(() => {});
  }, [open]);

  const submit = async () => {
    const u = url.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) return setError(t("profiles.invalidUrl"));
    setBusy(true);
    setError(null);
    try {
      const p = await backend.importProfileUrl(u, name.trim() || undefined);
      toast.success(t("profiles.imported", { name: p.name }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      width={480}
      title={t("profiles.importTitle")}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {t("common.done")}
          </Button>
        </>
      }
    >
      <div className="pf-modal-desc">{t("profiles.importDesc")}</div>
      <div className="pf-form">
        <label>{t("profiles.url")}</label>
        <TextField
          value={url}
          onChange={(v) => (setUrl(v), setError(null))}
          placeholder={t("profiles.urlPh")}
          mono
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <label>{t("profiles.name")}</label>
        <TextField value={name} onChange={setName} placeholder={t("profiles.namePh")} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      {error && <div className="pf-error">{error}</div>}
    </Modal>
  );
}

/* ---------------- Edit info ---------------- */

export function EditInfoDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const t = useT();
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [interval, setIntervalMin] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setUrl(profile.url ?? "");
    setIntervalMin(profile.autoUpdateMinutes ?? 0);
    setError(null);
  }, [profile]);

  if (!profile) return null;
  const remote = profile.type === "remote";

  const submit = async () => {
    if (remote && !/^https?:\/\/\S+$/i.test(url.trim())) return setError(t("profiles.invalidUrl"));
    setBusy(true);
    try {
      await backend.editProfileMeta(profile.id, {
        name: name.trim() || profile.name,
        ...(remote ? { url: url.trim(), autoUpdateMinutes: interval } : {}),
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title={t("profiles.editInfoTitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="pf-form">
        <label>{t("profiles.name")}</label>
        <TextField value={name} onChange={setName} autoFocus />
        {remote && (
          <>
            <label>{t("profiles.url")}</label>
            <TextField value={url} onChange={setUrl} mono />
            <label>{t("profiles.interval")}</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <NumberField value={interval} onChange={setIntervalMin} min={0} max={10080} width={90} />
              <span className="dim">{t("profiles.minutes")}</span>
            </div>
            <div className="pf-hint">{t("profiles.intervalHint")}</div>
          </>
        )}
      </div>
      {error && <div className="pf-error">{error}</div>}
    </Modal>
  );
}

/* ---------------- Mount proxy providers ---------------- */

export function MountDialog({ profile, profiles, onClose }: { profile: Profile | null; profiles: Profile[]; onClose: () => void }) {
  const t = useT();
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (profile) setSel(new Set(profile.providers ?? []));
  }, [profile]);
  if (!profile) return null;
  const others = profiles.filter((p) => p.type === "remote" && p.id !== profile.id);

  const submit = async () => {
    setBusy(true);
    try {
      await backend.setProfileProviders(profile.id, [...sel]);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={t("profiles.mountTitle")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!others.length}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="pf-modal-desc">{t("profiles.mountDesc", { name: profile.name })}</div>
      {others.length ? (
        <div className="pf-list">
          {others.map((p) => (
            <div key={p.id} className="pf-list-row">
              <Checkbox
                checked={sel.has(p.id)}
                onChange={(v) =>
                  setSel((s) => {
                    const n = new Set(s);
                    v ? n.add(p.id) : n.delete(p.id);
                    return n;
                  })
                }
              />
              <div className="pf-list-main">
                <div className="pf-list-title">{p.name}</div>
                <div className="pf-list-sub mono">{safeHost(p.url)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty desc={t("profiles.mountEmpty")} />
      )}
    </Modal>
  );
}

/* ---------------- External resources ---------------- */

export function ExternalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [items, setItems] = React.useState<ExternalResource[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    backend
      .externalResources()
      .then(setItems)
      .catch((e) => {
        setItems([]);
        toast.error(errorMessage(e));
      });
  }, []);

  React.useEffect(() => {
    if (open) {
      setItems(null);
      load();
    }
  }, [open, load]);

  const updateAll = async () => {
    setBusy(true);
    try {
      await backend.updateExternalResources();
      toast.success(t("profiles.resourcesUpdated"));
      load();
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
      width={560}
      title={t("profiles.externalTitle")}
      footer={
        <>
          <Button icon={<RefreshCw size={13} className={busy ? "spin" : undefined} />} onClick={updateAll} disabled={busy || !items?.length}>
            {t("profiles.updateAllResources")}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t("common.done")}
          </Button>
        </>
      }
    >
      <div className="pf-modal-desc">{t("profiles.externalDesc")}</div>
      {items === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 30 }}>
          <Spinner size={18} />
        </div>
      ) : items.length === 0 ? (
        <Empty desc={t("profiles.externalEmpty")} />
      ) : (
        <div className="pf-list" style={{ maxHeight: "46vh", overflowY: "auto" }}>
          {items.map((r) => {
            const aliveRatio = r.alive !== undefined && r.count ? r.alive / r.count : 1;
            return (
              <div key={`${r.kind}:${r.name}`} className="pf-list-row">
                {r.kind === "proxy" ? <Box size={15} color="var(--teal)" /> : <ListChecks size={15} color="var(--orange)" />}
                <div className="pf-list-main">
                  <div className="pf-list-title">{r.name}</div>
                  <div className="pf-list-sub">
                    {t(r.kind === "proxy" ? "profiles.proxyProvider" : "profiles.ruleProvider")} · {r.vehicleType}
                    {r.behavior ? ` · ${r.behavior}` : ""}
                    {r.updatedAt ? ` · ${t("profiles.updatedAgo", { ago: formatAgo(new Date(r.updatedAt).getTime(), lang) })}` : ""}
                  </div>
                </div>
                {r.kind === "proxy" && r.alive !== undefined ? (
                  <span
                    className="pf-alive"
                    style={{ color: aliveRatio >= 0.7 ? "var(--green)" : aliveRatio >= 0.4 ? "var(--orange)" : "var(--red)" }}
                  >
                    {t("profiles.nodesAlive", { alive: r.alive, total: r.count })}
                  </span>
                ) : (
                  <span className="pf-alive dim">{t("profiles.rulesCount", { n: formatCount(r.count) })}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- In-app YAML editor ---------------- */

export function EditorDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const t = useT();
  const editorRef = React.useRef<YamlEditorHandle>(null);
  const [text, setText] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!profile) return;
    setText(null);
    setSaved(null);
    setError(null);
    backend
      .readProfile(profile.id)
      .then((s) => {
        setText(s);
        setSaved(s);
      })
      .catch((e) => {
        setText("");
        setSaved("");
        setError(errorMessage(e));
      });
  }, [profile]);

  const errLine = error ? errorLine(error) : null;
  const dirty = text !== null && text !== saved;

  const save = async (close: boolean) => {
    if (!profile || text === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await backend.writeProfile(profile.id, text);
      setSaved(text);
      toast.success(t("profiles.editorSaved"));
      if (close) onClose();
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg);
      const line = errorLine(msg);
      if (line) editorRef.current?.gotoLine(line);
    } finally {
      setBusy(false);
    }
  };

  const asking = React.useRef(false);
  const tryClose = async () => {
    // Escape also reaches this dialog while the confirm below is open: ask only once
    if (busy || asking.current) return;
    if (dirty) {
      asking.current = true;
      const ok = await confirm({ title: t("profiles.editorDiscardTitle"), message: t("profiles.editorDiscard"), danger: true, confirmText: t("profiles.editorDiscardBtn") });
      asking.current = false;
      if (!ok) return;
    }
    onClose();
  };

  if (!profile) return null;

  return (
    <Modal
      open
      onClose={tryClose}
      closeOnBackdrop={false}
      width={900}
      title={
        <>
          {t("profiles.editorTitle", { name: profile.name })}
          {dirty && <span className="pf-editor-dirty" title={t("profiles.editorUnsaved")} />}
        </>
      }
      footer={
        <>
          {errLine && (
            <Button size="sm" variant="plain" onClick={() => editorRef.current?.gotoLine(errLine)} style={{ marginRight: "auto" }}>
              {t("profiles.editorGotoError", { line: errLine })}
            </Button>
          )}
          <Button onClick={tryClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => save(true)} loading={busy} disabled={text === null}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="pf-editor">
        {text === null ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
            <Spinner size={18} />
          </div>
        ) : (
          <YamlEditor ref={editorRef} value={text} onChange={setText} onSave={() => save(false)} errorLine={errLine} autoFocus />
        )}
      </div>
      {error && <div className="pf-error mono">{error}</div>}
    </Modal>
  );
}

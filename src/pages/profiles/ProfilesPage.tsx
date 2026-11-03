import React from "react";
import {
  Boxes,
  Check,
  Cloud,
  Copy,
  FileCode2,
  FilePen,
  FilePlus2,
  FolderOpen,
  FolderClosed,
  Link,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Package,
} from "lucide-react";
import { Page } from "@/components/layout/Page";
import {
  Button,
  Dropdown,
  Empty,
  IconButton,
  Progress,
  Tooltip,
  confirm,
  cx,
  openContextMenu,
  prompt,
  toast,
  usageColor,
  type MenuEntry,
} from "@/components/ui";
import { useLang, useT } from "@/i18n";
import { backend, errorMessage, isTauri } from "@/lib/backend";
import { useApp } from "@/lib/store";
import { daysLeft, formatAgo, formatBytes } from "@/lib/format";
import { useProviderSubs, type ProviderSub } from "@/lib/providerSubs";
import type { Profile } from "@/lib/types";
import { EditInfoDialog, EditorDialog, ExternalDialog, ImportDialog, MountDialog } from "./dialogs";
import { safeHost } from "./utils";
import "./profiles.css";

function formatInterval(min: number, lang: "zh" | "en"): string {
  const zh = lang === "zh";
  if (min % 1440 === 0) return zh ? `${min / 1440} 天` : `${min / 1440} d`;
  if (min % 60 === 0) return zh ? `${min / 60} 小时` : `${min / 60} h`;
  return zh ? `${min} 分钟` : `${min} min`;
}

function ProfileCard({
  profile,
  active,
  updating,
  onActivate,
  onUpdate,
  menu,
  providerSubs,
}: {
  profile: Profile;
  active: boolean;
  /** Usage from the running config's proxy-providers (active card only) */
  providerSubs?: ProviderSub[];
  updating: boolean;
  onActivate: () => void;
  onUpdate: () => void;
  menu: () => MenuEntry[];
}) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const remote = profile.type === "remote";
  const sub = profile.subscription;
  const used = sub ? sub.upload + sub.download : 0;
  const ratio = sub && sub.total > 0 ? used / sub.total : 0;
  const left = sub ? daysLeft(sub.expire) : null;
  const ago = formatAgo(profile.updatedAt, lang);

  const expiryText =
    left === null ? t("profiles.noExpire") : left <= 0 ? t("profiles.expired") : t("profiles.daysLeft", { n: left });
  const expiryColor = left !== null && left <= 0 ? "var(--red)" : left !== null && left <= 3 ? "var(--red)" : left !== null && left <= 7 ? "var(--orange)" : undefined;

  return (
    <div
      className={cx("pf-card", active && "active")}
      onClick={() => !active && onActivate()}
      onContextMenu={(e) => openContextMenu(e, menu())}
      title={active ? undefined : t("profiles.activate")}
    >
      <div className="pf-top">
        <span className={cx("pf-icon", remote ? "remote" : "local")}>
          {remote ? <Cloud size={17} strokeWidth={2} /> : <FileCode2 size={17} strokeWidth={2} />}
        </span>
        <div className="pf-title">
          <div className="pf-name">
            <span>{profile.name}</span>
            {active && (
              <span className="pf-active-pill">
                <Check size={10} strokeWidth={3} />
                {t("profiles.active")}
              </span>
            )}
          </div>
          <div className="pf-sub">
            {remote
              ? `${safeHost(profile.url)} · ${t("profiles.updatedAgo", { ago })}`
              : `${t("profiles.localFile")} · ${t("profiles.modifiedAgo", { ago })}`}
          </div>
        </div>
        <div className="pf-actions" onClick={(e) => e.stopPropagation()}>
          {remote && (
            <Tooltip content={t("profiles.update")}>
              <IconButton
                size="sm"
                variant="plain"
                icon={<RefreshCw size={13} className={updating ? "spin" : undefined} />}
                onClick={() => !updating && onUpdate()}
              />
            </Tooltip>
          )}
          <Dropdown align="end" items={menu} minWidth={200}>
            {() => <IconButton size="sm" variant="plain" icon={<MoreHorizontal size={15} />} title={t("profiles.more")} />}
          </Dropdown>
        </div>
      </div>

      {!(remote && sub && sub.total > 0) && providerSubs && providerSubs.length > 0 ? (
        <div className="pf-usage">
          {providerSubs.slice(0, 3).map((ps) => {
            const u = ps.upload + ps.download;
            const r = ps.total > 0 ? u / ps.total : 0;
            const dl = daysLeft(ps.expire);
            return (
              <div key={ps.name} className="pf-provider-usage">
                <div className="pf-usage-row">
                  <span className="pf-provider-name">{ps.name}</span>
                  <span style={{ color: dl !== null && dl <= 3 ? "var(--red)" : dl !== null && dl <= 7 ? "var(--orange)" : undefined }}>
                    {dl === null ? t("profiles.noExpire") : dl <= 0 ? t("profiles.expired") : t("profiles.daysLeft", { n: dl })}
                  </span>
                </div>
                <Progress value={r} color={usageColor(r)} height={4} />
                <div className="pf-usage-row">
                  <span>
                    <b>{formatBytes(u, 1)}</b> / {formatBytes(ps.total, 0)}
                  </span>
                  <span>{Math.round(r * 100)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : remote && sub && sub.total > 0 ? (
        <div className="pf-usage">
          <Progress value={ratio} color={usageColor(ratio)} height={4} />
          <div className="pf-usage-row">
            <span>
              <b>{formatBytes(used, 1)}</b> / {formatBytes(sub.total, 0)}
            </span>
            <span style={{ color: expiryColor }}>{expiryText}</span>
          </div>
        </div>
      ) : (
        <div className="pf-foot">
          {remote ? (
            <>
              <RefreshCw size={11} />
              <span>
                {profile.autoUpdateMinutes
                  ? t("profiles.autoUpdate", { n: formatInterval(profile.autoUpdateMinutes, lang) })
                  : t("profiles.autoUpdateOff")}
              </span>
            </>
          ) : (
            <>
              <FolderClosed size={11} />
              <span className="mono" title={profile.file}>
                {profile.file ? profile.file.split(/[\\/]/).pop() : "—"}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProfilesPage() {
  const t = useT();
  const providerSubs = useProviderSubs();
  const profiles = useApp((s) => s.profiles);
  const activeId = useApp((s) => s.settings?.activeProfileId ?? null);
  const switchProfile = useApp((s) => s.switchProfile);

  const [updating, setUpdating] = React.useState<Set<string>>(new Set());
  const [updatingAll, setUpdatingAll] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [externalOpen, setExternalOpen] = React.useState(false);
  const [editInfo, setEditInfo] = React.useState<Profile | null>(null);
  const [mount, setMount] = React.useState<Profile | null>(null);
  const [editor, setEditor] = React.useState<Profile | null>(null);

  const remote = profiles.filter((p) => p.type === "remote");
  const local = profiles.filter((p) => p.type === "local");

  const update = async (p: Profile) => {
    setUpdating((s) => new Set(s).add(p.id));
    try {
      await backend.updateProfile(p.id);
      toast.success(`${p.name} · ${t("profiles.updated")}`);
    } catch (e) {
      toast.error(`${p.name}: ${errorMessage(e)}`);
    } finally {
      setUpdating((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
    }
  };

  const updateAll = async () => {
    if (updatingAll) return;
    setUpdatingAll(true);
    setUpdating(new Set(remote.map((p) => p.id)));
    try {
      await backend.updateAllProfiles();
      toast.success(t("profiles.updated"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUpdating(new Set());
      setUpdatingAll(false);
    }
  };

  const addLocal = async () => {
    try {
      let path: string | null = null;
      if (isTauri) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const r = await open({ multiple: false, directory: false, filters: [{ name: t("profiles.yamlFilter"), extensions: ["yaml", "yml"] }] });
        path = typeof r === "string" ? r : null;
      } else {
        path = "C:\\Users\\me\\Downloads\\config.yaml";
      }
      if (!path) return;
      const p = await backend.importProfileFile(path);
      toast.success(t("profiles.imported", { name: p.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const newBlank = async () => {
    const name = await prompt({ title: t("profiles.newBlankTitle"), placeholder: t("profiles.newBlankName"), confirmText: t("common.done") });
    if (!name?.trim()) return;
    try {
      const p = await backend.createProfile(name.trim());
      toast.success(t("profiles.imported", { name: p.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (p: Profile) => {
    const isActive = p.id === activeId;
    const ok = await confirm({
      title: t("profiles.delete"),
      message: t("profiles.deleteConfirm", { name: p.name }) + (isActive ? `\n${t("profiles.deleteActive")}` : ""),
      danger: true,
      confirmText: t("profiles.delete"),
    });
    if (!ok) return;
    try {
      await backend.deleteProfile(p.id);
      toast.success(t("profiles.deleted"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const openExternal = async (p: Profile) => {
    try {
      await backend.openProfileInEditor(p.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const menuFor = (p: Profile) => (): MenuEntry[] => {
    const isActive = p.id === activeId;
    const remoteP = p.type === "remote";
    return [
      ...(!isActive ? [{ label: t("profiles.activate"), icon: <Play size={13} />, onClick: () => switchProfile(p.id, { confirm: true }) }, "separator" as const] : []),
      ...(remoteP
        ? [{ label: t("profiles.update"), icon: <RefreshCw size={13} />, disabled: updating.has(p.id), onClick: () => update(p) }]
        : []),
      { label: t("profiles.editInfo"), icon: <Pencil size={13} />, onClick: () => setEditInfo(p) },
      "separator",
      { label: t("profiles.mountProviders"), icon: <Boxes size={13} />, onClick: () => setMount(p) },
      { label: t("profiles.externalResources"), icon: <Package size={13} />, disabled: !isActive, onClick: () => setExternalOpen(true) },
      "separator",
      { label: t("profiles.editExternal"), icon: <FilePen size={13} />, onClick: () => openExternal(p) },
      { label: t("profiles.editInApp"), icon: <FileCode2 size={13} />, onClick: () => setEditor(p) },
      { label: t("profiles.reveal"), icon: <FolderOpen size={13} />, disabled: !p.file, onClick: () => backend.revealPath(p.file).catch((e) => toast.error(errorMessage(e))) },
      ...(remoteP && p.url
        ? [
            {
              label: t("profiles.copyUrl"),
              icon: <Copy size={13} />,
              onClick: () => navigator.clipboard?.writeText(p.url!).then(() => toast.success(t("common.copied"))),
            },
          ]
        : []),
      "separator",
      { label: t("profiles.delete"), icon: <Trash2 size={13} />, danger: true, onClick: () => remove(p) },
    ];
  };

  const addItems = (): MenuEntry[] => [
    { label: t("profiles.importSub"), icon: <Link size={13} />, onClick: () => setImportOpen(true) },
    { label: t("profiles.addLocal"), icon: <Upload size={13} />, onClick: addLocal },
    { label: t("profiles.newBlank"), icon: <FilePlus2 size={13} />, onClick: newBlank },
  ];

  const actions = (
    <>
      {remote.length > 0 && (
        <Tooltip content={t("profiles.updateAll")}>
          <IconButton icon={<RefreshCw size={15} className={updatingAll ? "spin" : undefined} />} onClick={updateAll} />
        </Tooltip>
      )}
      <Dropdown align="end" items={addItems} minWidth={190}>
        {() => <IconButton icon={<Plus size={17} />} title={t("profiles.add")} />}
      </Dropdown>
    </>
  );

  const renderGrid = (list: Profile[]) => (
    <div className="pf-grid">
      {list.map((p) => (
        <ProfileCard
          key={p.id}
          profile={p}
          active={p.id === activeId}
          providerSubs={p.id === activeId ? providerSubs : undefined}
          updating={updating.has(p.id)}
          onActivate={() => switchProfile(p.id, { confirm: true })}
          onUpdate={() => update(p)}
          menu={menuFor(p)}
        />
      ))}
    </div>
  );

  return (
    <Page title={t("nav.profiles")} actions={actions}>
      {profiles.length === 0 ? (
        <Empty
          icon={<FolderClosed size={40} strokeWidth={1.3} />}
          title={t("profiles.emptyTitle")}
          desc={t("profiles.emptyDesc")}
        >
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button variant="primary" icon={<Link size={13} />} onClick={() => setImportOpen(true)}>
              {t("profiles.importSub")}
            </Button>
            <Button icon={<Upload size={13} />} onClick={addLocal}>
              {t("profiles.addLocal")}
            </Button>
          </div>
        </Empty>
      ) : (
        <div className="pf-root">
          {remote.length > 0 && (
            <section>
              <div className="pf-section-head">
                <Cloud size={13} color="var(--blue)" />
                {t("profiles.remote")}
                <span className="pf-count">{remote.length}</span>
              </div>
              {renderGrid(remote)}
            </section>
          )}
          {local.length > 0 && (
            <section>
              <div className="pf-section-head">
                <FileCode2 size={13} color="var(--purple)" />
                {t("profiles.local")}
                <span className="pf-count">{local.length}</span>
              </div>
              {renderGrid(local)}
            </section>
          )}
        </div>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ExternalDialog open={externalOpen} onClose={() => setExternalOpen(false)} />
      <EditInfoDialog profile={editInfo} onClose={() => setEditInfo(null)} />
      <MountDialog profile={mount} profiles={profiles} onClose={() => setMount(null)} />
      <EditorDialog profile={editor} onClose={() => setEditor(null)} />
    </Page>
  );
}

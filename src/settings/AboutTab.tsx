import React from "react";
import { Bug, Github, Globe, Users } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { backend, errorMessage } from "@/lib/backend";
import { Button, FormRow, FormSection, Modal, Toggle, toast } from "@/components/ui";
import logo from "@/assets/logo.svg";

// Placeholder project links — replace with the real ones before release.
const LINKS = {
  homepage: "https://example.com/clashwin",
  website: "https://example.com/clashwin",
  github: "https://github.com/",
  feedback: "https://example.com/clashwin/issues",
  community: "https://example.com/clashwin/community",
};

export default function AboutTab() {
  const t = useT();
  const info = useApp((s) => s.info);
  const s = useApp((st) => st.settings)!;
  const save = useApp((st) => st.saveSettings);
  const [checking, setChecking] = React.useState(false);
  const [found, setFound] = React.useState<{ latest: string; url: string; notes?: string } | null>(null);

  const check = async () => {
    setChecking(true);
    try {
      const r = await backend.checkAppUpdate();
      if (r.hasUpdate) setFound(r);
      else toast.success(t("settings.appUpToDate"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const open = (url: string) => backend.openUrl(url).catch(() => {});

  return (
    <>
      <div className="st-about-hero">
        <img className="st-about-icon" src={logo} alt="" draggable={false} onClick={() => open(LINKS.homepage)} />
        <div className="st-about-name">{info?.name ?? "ClashWin"}</div>
        <div className="st-about-version">{t("settings.version", { v: info?.version ?? "—", b: info?.build ?? "—" })}</div>
        <div className="st-about-tagline">{t("settings.tagline")}</div>
      </div>

      <FormSection>
        <FormRow label={t("settings.autoCheck")} desc={t("settings.autoCheckDesc")}>
          <Toggle checked={s.autoCheckUpdate} onChange={(v) => save({ autoCheckUpdate: v })} />
        </FormRow>
        <FormRow label={t("settings.includeBeta")} desc={t("settings.includeBetaDesc")}>
          <Toggle checked={s.includeBeta} onChange={(v) => save({ includeBeta: v })} />
        </FormRow>
        <FormRow style={{ justifyContent: "flex-end" }}>
          <Button size="sm" variant="primary" loading={checking} onClick={check}>
            {t("settings.checkAppUpdate")}
          </Button>
        </FormRow>
      </FormSection>

      <div className="st-links">
        <Button size="sm" variant="plain" icon={<Globe size={13} />} onClick={() => open(LINKS.website)}>
          {t("settings.website")}
        </Button>
        <Button size="sm" variant="plain" icon={<Github size={13} />} onClick={() => open(LINKS.github)}>
          GitHub
        </Button>
        <Button size="sm" variant="plain" icon={<Bug size={13} />} onClick={() => open(LINKS.feedback)}>
          {t("settings.feedback")}
        </Button>
        <Button size="sm" variant="plain" icon={<Users size={13} />} onClick={() => open(LINKS.community)}>
          {t("settings.community")}
        </Button>
      </div>
      <div className="st-credits">{t("settings.credits")}</div>

      <Modal
        open={!!found}
        onClose={() => setFound(null)}
        width={400}
        title={found ? t("settings.appUpdateAvailable", { v: found.latest }) : ""}
        footer={
          <>
            <Button onClick={() => setFound(null)}>{t("settings.later")}</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (found) open(found.url);
                setFound(null);
              }}
            >
              {t("settings.goDownload")}
            </Button>
          </>
        }
      >
        {found?.notes && <div className="st-notes">{found.notes}</div>}
      </Modal>
    </>
  );
}

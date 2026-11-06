import { useNavigate } from "react-router-dom";
import { Bug, CircleArrowUp, Github, Package } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { backend } from "@/lib/backend";
import { Button } from "@/components/ui";
import logo from "@/assets/logo.svg";

// Same repository the update center checks (APP_REPO in src-tauri/src/updates.rs).
const REPO = "https://github.com/ljt940601/clashwin";
const LINKS = {
  github: REPO,
  releases: `${REPO}/releases`,
  feedback: `${REPO}/issues`,
};

export default function AboutTab() {
  const t = useT();
  const navigate = useNavigate();
  const info = useApp((s) => s.info);
  const open = (url: string) => backend.openUrl(url).catch(() => {});

  return (
    <>
      <div className="st-about-hero">
        <img className="st-about-icon" src={logo} alt="" draggable={false} onClick={() => open(LINKS.github)} />
        <div className="st-about-name">{info?.name ?? "ClashWin"}</div>
        <div className="st-about-version">{t("settings.version", { v: info?.version ?? "—", b: info?.build ?? "—" })}</div>
        <div className="st-about-tagline">{t("settings.tagline")}</div>
        <Button size="sm" variant="primary" icon={<CircleArrowUp size={13} />} style={{ marginTop: 16 }} onClick={() => navigate("/settings/updates")}>
          {t("settings.checkAppUpdate")}
        </Button>
      </div>

      <div className="st-links">
        <Button size="sm" variant="plain" icon={<Github size={13} />} onClick={() => open(LINKS.github)}>
          GitHub
        </Button>
        <Button size="sm" variant="plain" icon={<Package size={13} />} onClick={() => open(LINKS.releases)}>
          {t("settings.releases")}
        </Button>
        <Button size="sm" variant="plain" icon={<Bug size={13} />} onClick={() => open(LINKS.feedback)}>
          {t("settings.feedback")}
        </Button>
      </div>
      <div className="st-credits">{t("settings.credits")}</div>
    </>
  );
}

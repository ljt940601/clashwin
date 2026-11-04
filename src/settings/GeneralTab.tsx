import React from "react";
import { Wifi } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { backend } from "@/lib/backend";
import { Button, Checkbox, FormRow, FormSection, Select, TextField, Toggle, toast } from "@/components/ui";
import type { AppSettings } from "@/lib/types";

const SELECT_W = 170;

function parseSsids(s: string): string[] {
  return Array.from(new Set(s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean)));
}

export default function GeneralTab() {
  const t = useT();
  const s = useApp((st) => st.settings)!;
  const save = useApp((st) => st.saveSettings);

  const [ssidText, setSsidText] = React.useState(s.wifiBypass.ssids.join(", "));
  const [ssidFocused, setSsidFocused] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  React.useEffect(() => {
    if (!ssidFocused) setSsidText(s.wifiBypass.ssids.join(", "));
  }, [s.wifiBypass.ssids, ssidFocused]);

  const commitSsids = () => {
    const list = parseSsids(ssidText);
    if (list.join("\u0000") !== s.wifiBypass.ssids.join("\u0000")) save({ wifiBypass: { ssids: list } });
  };

  const addCurrent = async () => {
    setAdding(true);
    try {
      const ssid = await backend.wifiSsid();
      if (!ssid) return toast.info(t("settings.notOnWifi"));
      const list = parseSsids(ssidText);
      if (list.includes(ssid)) return toast.info(t("settings.ssidExists", { ssid }));
      await save({ wifiBypass: { ssids: [...list, ssid] } });
      toast.success(t("settings.ssidAdded", { ssid }));
    } finally {
      setAdding(false);
    }
  };

  const card = (key: keyof AppSettings["menuCards"], label: string, desc: string) => (
    <FormRow key={key} label={t(label)} desc={t(desc)}>
      <Toggle checked={s.menuCards[key]} onChange={(v) => save({ menuCards: { [key]: v } })} />
    </FormRow>
  );

  return (
    <>
      <FormSection title={t("settings.startup")}>
        <FormRow label={t("settings.launchAtLogin")} desc={t("settings.launchAtLoginDesc")}>
          <Toggle checked={s.launchAtLogin} onChange={(v) => save({ launchAtLogin: v })} />
        </FormRow>
        <FormRow label={t("settings.silentStart")} desc={t("settings.silentStartDesc")}>
          <Toggle checked={s.silentStart} onChange={(v) => save({ silentStart: v })} />
        </FormRow>
      </FormSection>

      <FormSection title={t("settings.appearance")}>
        <FormRow label={t("settings.trayMode")} desc={t("settings.trayModeDesc")}>
          <Select<AppSettings["trayMode"]>
            width={SELECT_W}
            value={s.trayMode}
            onChange={(v) => save({ trayMode: v })}
            options={[
              { value: "icon_speed", label: t("settings.trayIconSpeed") },
              { value: "icon", label: t("settings.trayIcon") },
              { value: "speed", label: t("settings.traySpeed") },
            ]}
          />
        </FormRow>
        <FormRow label={t("settings.trayScale")} desc={t("settings.trayScaleDesc")}>
          <Select<number>
            width={SELECT_W}
            value={s.trayScale}
            onChange={(v) => save({ trayScale: v })}
            options={[
              { value: 0, label: t("settings.trayScaleAuto") },
              ...[80, 90, 100, 110, 125].map((v) => ({ value: v, label: `${v}%` })),
            ]}
          />
        </FormRow>
        <FormRow label={t("settings.language")}>
          <Select<AppSettings["language"]>
            width={SELECT_W}
            value={s.language}
            onChange={(v) => save({ language: v })}
            options={[
              { value: "system", label: t("settings.langSystem") },
              { value: "en", label: "English" },
              { value: "zh", label: "简体中文" },
            ]}
          />
        </FormRow>
        <FormRow label={t("settings.theme")}>
          <Select<AppSettings["theme"]>
            width={SELECT_W}
            value={s.theme}
            onChange={(v) => save({ theme: v })}
            options={[
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
              { value: "system", label: t("settings.themeSystem") },
            ]}
          />
        </FormRow>
      </FormSection>

      <FormSection title={t("settings.menuCards")} desc={t("settings.menuCardsDesc")}>
        {card("browserRule", "settings.cardBrowserRule", "settings.cardBrowserRuleDesc")}
        {card("trafficWave", "settings.cardTrafficWave", "settings.cardTrafficWaveDesc")}
        {card("perfGrid", "settings.cardPerfGrid", "settings.cardPerfGridDesc")}
        {card("subscription", "settings.cardSubscription", "settings.cardSubscriptionDesc")}
        {card("copyShell", "settings.cardCopyShell", "settings.cardCopyShellDesc")}
        <FormRow label={t("settings.shellStyle")} desc={t("settings.shellStyleDesc")}>
          <Select<AppSettings["shellExportStyle"]>
            width={SELECT_W}
            value={s.shellExportStyle}
            onChange={(v) => save({ shellExportStyle: v })}
            options={[
              { value: "powershell", label: "PowerShell" },
              { value: "cmd", label: "CMD" },
              { value: "bash", label: "Bash / Zsh" },
            ]}
          />
        </FormRow>
      </FormSection>

      <FormSection title={t("settings.wifiBypass")} desc={t("settings.wifiBypassDesc")}>
        <FormRow label={t("settings.wifiBypassEnable")}>
          <Checkbox checked={s.wifiBypass.enabled} onChange={(v) => save({ wifiBypass: { enabled: v } })} />
        </FormRow>
        <FormRow label={t("settings.trustedSsids")} stack>
          <div className="st-inline" style={{ opacity: s.wifiBypass.enabled ? 1 : 0.55 }}>
            <TextField
              value={ssidText}
              onChange={setSsidText}
              placeholder={t("settings.trustedSsidsPlaceholder")}
              style={{ flex: 1 }}
              onFocus={() => setSsidFocused(true)}
              onBlur={() => {
                setSsidFocused(false);
                commitSsids();
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <Button size="sm" icon={<Wifi size={13} />} loading={adding} onClick={addCurrent}>
              {t("settings.addCurrentNetwork")}
            </Button>
          </div>
        </FormRow>
      </FormSection>
    </>
  );
}

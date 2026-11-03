/**
 * Toolbar controls shared by several pages (Overview, Policy, ...):
 * profile switcher, outbound mode, system proxy, enhanced mode (TUN), kernel start/stop.
 */
import { Archive, ChevronDown, Globe, Play, Shield, Square } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { Dropdown, IconButton, Segmented, Spinner, Tooltip } from "@/components/ui";
import type { OutboundMode } from "@/lib/types";

export function ProfileMenu() {
  const t = useT();
  const profiles = useApp((s) => s.profiles);
  const activeId = useApp((s) => s.settings?.activeProfileId);
  const switchProfile = useApp((s) => s.switchProfile);
  const busy = useApp((s) => s.busy.profile);
  const active = profiles.find((p) => p.id === activeId);
  return (
    <Dropdown
      align="end"
      minWidth={200}
      items={() =>
        profiles.length
          ? [
              { header: t("common.switchProfile") },
              ...profiles.map((p) => ({
                label: p.name,
                checked: p.id === activeId,
                onClick: () => p.id !== activeId && switchProfile(p.id, { confirm: true }),
              })),
            ]
          : [{ label: t("common.noProfile"), disabled: true }]
      }
    >
      {() => (
        <Tooltip content={active?.name}>
          <button className="tb-profile">
            {busy ? <Spinner size={14} /> : <Archive size={16} strokeWidth={1.8} />}
            <ChevronDown size={11} strokeWidth={2.4} />
          </button>
        </Tooltip>
      )}
    </Dropdown>
  );
}

export function ModeSwitch() {
  const t = useT();
  const mode = useApp((s) => s.settings?.outboundMode ?? "rule");
  const setMode = useApp((s) => s.setMode);
  return (
    <Segmented<OutboundMode>
      value={mode}
      onChange={setMode}
      options={[
        { value: "rule", label: t("common.rule"), title: t("common.modeRule") },
        { value: "global", label: t("common.global"), title: t("common.modeGlobal") },
        { value: "direct", label: t("common.direct"), title: t("common.modeDirect") },
      ]}
    />
  );
}

export function SystemProxyButton() {
  const t = useT();
  const on = useApp((s) => s.settings?.systemProxy ?? false);
  const busy = useApp((s) => s.busy.sysproxy);
  const toggle = useApp((s) => s.toggleSystemProxy);
  return (
    <Tooltip content={`${t("common.systemProxy")} · ${t(on ? "common.on" : "common.off")}`}>
      <IconButton
        icon={busy ? <Spinner size={14} /> : <Globe size={17} strokeWidth={1.8} color={on ? "var(--blue)" : undefined} />}
        onClick={() => toggle(!on, { confirm: true })}
      />
    </Tooltip>
  );
}

export function TunButton() {
  const t = useT();
  const on = useApp((s) => s.settings?.tunMode ?? false);
  const busy = useApp((s) => s.busy.tun);
  const toggle = useApp((s) => s.toggleTun);
  return (
    <Tooltip content={`${t("common.enhancedMode")} · ${t(on ? "common.on" : "common.off")}`}>
      <IconButton
        icon={
          busy ? (
            <Spinner size={14} />
          ) : (
            <Shield size={17} strokeWidth={1.8} color={on ? "var(--amber)" : undefined} fill={on ? "var(--amber)" : "none"} fillOpacity={on ? 0.35 : 0} />
          )
        }
        onClick={() => toggle(!on, { confirm: true })}
      />
    </Tooltip>
  );
}

export function CoreButton() {
  const t = useT();
  const state = useApp((s) => s.core.state);
  const busy = useApp((s) => s.busy.core);
  const start = useApp((s) => s.startCore);
  const stop = useApp((s) => s.stopCore);
  const running = state === "running";
  return (
    <Tooltip content={t(running ? "common.stopCore" : "common.startCore")}>
      <IconButton
        icon={
          busy || state === "starting" ? (
            <Spinner size={14} />
          ) : running ? (
            <Square size={13} fill="currentColor" strokeWidth={0} />
          ) : (
            <Play size={14} fill="var(--green)" color="var(--green)" />
          )
        }
        onClick={() => (running ? stop({ confirm: true }) : start())}
      />
    </Tooltip>
  );
}

/** The standard right-side toolbar cluster seen on the Overview page. */
export function StandardActions() {
  return (
    <>
      <ProfileMenu />
      <ModeSwitch />
      <SystemProxyButton />
      <TunButton />
      <CoreButton />
    </>
  );
}

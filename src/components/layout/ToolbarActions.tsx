/**
 * Toolbar controls shared by several pages (Overview, Policy, ...):
 * profile switcher, outbound mode, system proxy, enhanced mode (TUN), kernel start/stop.
 */
import React from "react";
import { Archive, ChevronDown, Globe, Play, Shield, Square } from "lucide-react";
import { useT } from "@/i18n";
import { useApp } from "@/lib/store";
import { Dropdown, IconButton, Segmented, Spinner, Tooltip, cx } from "@/components/ui";
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

/**
 * Counts changes of `v` that `count` accepts (not the first render). Updated in a layout
 * effect, so the re-keyed element mounts with its animation class before the first paint.
 */
function useChangeCount<T>(v: T, count: (prev: T, next: T) => boolean = () => true) {
  const prev = React.useRef(v);
  const [n, setN] = React.useState(0);
  React.useLayoutEffect(() => {
    if (prev.current !== v && count(prev.current, v)) setN((x) => x + 1);
    prev.current = v;
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
}

/** Round toolbar switch: tinted when on, a ring spins while busy, ripple when switched on. */
function ToolbarSwitch({
  kind,
  on,
  busy,
  tooltip,
  icon,
  iconKey,
  onClick,
}: {
  kind: "sysproxy" | "tun" | "core";
  on: boolean;
  busy: boolean;
  tooltip: string;
  icon: React.ReactNode;
  /** changes when the icon itself changes, to replay the pop animation */
  iconKey: string;
  onClick: () => void;
}) {
  const ripple = useChangeCount(on, (_, next) => next); // off → on only
  const swaps = useChangeCount(iconKey);
  return (
    <Tooltip content={tooltip}>
      <IconButton
        className={cx("tb-switch", kind, on && "on", busy && "busy")}
        aria-pressed={on}
        aria-busy={busy}
        icon={
          <>
            <span key={`${iconKey}-${swaps}`} className={cx("tb-switch-icon", swaps > 0 && "pop")}>
              {icon}
            </span>
            {ripple > 0 && <span key={ripple} className="tb-ripple" />}
          </>
        }
        onClick={onClick}
      />
    </Tooltip>
  );
}

export function SystemProxyButton() {
  const t = useT();
  const on = useApp((s) => s.settings?.systemProxy ?? false);
  const busy = useApp((s) => !!s.busy.sysproxy);
  const toggle = useApp((s) => s.toggleSystemProxy);
  return (
    <ToolbarSwitch
      kind="sysproxy"
      on={on}
      busy={busy}
      tooltip={`${t("common.systemProxy")} · ${t(on ? "common.on" : "common.off")}`}
      icon={<Globe size={17} strokeWidth={1.8} />}
      iconKey="globe"
      onClick={() => !busy && toggle(!on, { confirm: true })}
    />
  );
}

export function TunButton() {
  const t = useT();
  const on = useApp((s) => s.settings?.tunMode ?? false);
  const busy = useApp((s) => !!s.busy.tun);
  const toggle = useApp((s) => s.toggleTun);
  return (
    <ToolbarSwitch
      kind="tun"
      on={on}
      busy={busy}
      tooltip={`${t("common.enhancedMode")} · ${t(on ? "common.on" : "common.off")}`}
      icon={<Shield size={17} strokeWidth={1.8} fill="currentColor" />}
      iconKey="shield"
      onClick={() => !busy && toggle(!on, { confirm: true })}
    />
  );
}

export function CoreButton() {
  const t = useT();
  const state = useApp((s) => s.core.state);
  const busy = useApp((s) => !!s.busy.core) || state === "starting";
  const start = useApp((s) => s.startCore);
  const stop = useApp((s) => s.stopCore);
  const running = state === "running";
  return (
    <ToolbarSwitch
      kind="core"
      on={running}
      busy={busy}
      tooltip={t(running ? "common.stopCore" : "common.startCore")}
      icon={running ? <Square size={13} fill="currentColor" strokeWidth={0} /> : <Play size={14} fill="currentColor" />}
      iconKey={running ? "stop" : "play"}
      onClick={() => !busy && (running ? stop({ confirm: true }) : start())}
    />
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

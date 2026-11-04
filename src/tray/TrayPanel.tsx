import React from "react";
import {
  Apple,
  Bot,
  Check,
  ChevronRight,
  CircleArrowDown,
  CircleArrowUp,
  Film,
  Gamepad2,
  Globe2,
  Infinity as InfinityIcon,
  Link2,
  MemoryStick,
  Music,
  Send,
  ShieldBan,
  SquareDashed,
  Wifi,
  Zap,
  Chrome,
} from "lucide-react";
import "./tray.css";
import { useT } from "@/i18n";
import { useApp, useActiveProfile } from "@/lib/store";
import { useLive } from "@/lib/live";
import { mihomo } from "@/lib/mihomo";
import { backend, errorMessage, isTauri, listen } from "@/lib/backend";
import { formatBytes, formatSpeed, daysLeft } from "@/lib/format";
import { useProviderSubs } from "@/lib/providerSubs";
import { detectCountry, flagEmoji, hasFlag } from "@/lib/countries";
import { TrafficChart } from "@/components/charts/TrafficChart";
import { LatencyBadge, Progress, Spinner, Tag, Toggle, cx, toast, usageColor } from "@/components/ui";
import type { OutboundMode, ProxyItem } from "@/lib/types";
import { copyText, lanAddress, shellExport } from "./shell";
import { QuickRuleDialog } from "./QuickRuleDialog";

const PANEL_W = 320;
const FLY_W = 270;
const GAP = 6;
const MAX_GROUPS = 8;
const SPECIAL: Record<string, string> = { DIRECT: "direct", REJECT: "reject", "REJECT-DROP": "reject", PASS: "pass" };

type FlyId = "kernel" | "mode" | "profile" | `group:${string}`;

/* ---------- helpers ---------- */

function withFlag(name: string): string {
  if (!name || SPECIAL[name] || hasFlag(name)) return name;
  const f = flagEmoji(detectCountry(name));
  return f ? `${f} ${name}` : name;
}

function GroupIcon({ group }: { group: ProxyItem }) {
  if (group.icon) {
    return (
      <span className="tr-group-icon">
        <img src={group.icon} alt="" draggable={false} />
      </span>
    );
  }
  const n = group.name;
  const cc = detectCountry(n);
  if (cc) return <span className="tr-group-icon">{flagEmoji(cc)}</span>;
  const pick = (): [React.ElementType, string] => {
    if (/stream|media|video|netflix|youtube|disney|hbo|流媒体|视频/i.test(n)) return [Film, "#ff5c8a"];
    if (/^ad|adblock|block|reject|广告|拦截/i.test(n)) return [ShieldBan, "#ff5b51"];
    if (/match|final|other|漏网|兜底|其他/i.test(n)) return [InfinityIcon, "#b55cff"];
    if (/auto|urltest|自动|测速/i.test(n)) return [Zap, "#feb240"];
    if (/telegram|\btg\b|电报/i.test(n)) return [Send, "#38b6ff"];
    if (/apple|苹果/i.test(n)) return [Apple, "var(--tr-dim)"];
    if (/game|steam|游戏/i.test(n)) return [Gamepad2, "#4cc38a"];
    if (/music|spotify|音乐/i.test(n)) return [Music, "#1db954"];
    if (/\bai\b|openai|chatgpt|gpt|claude|gemini|copilot/i.test(n)) return [Bot, "#7b83ff"];
    return [Globe2, "#389aff"];
  };
  const [Icon, color] = pick();
  return (
    <span className="tr-group-icon">
      <Icon size={16} color={color} strokeWidth={2} />
    </span>
  );
}

/** Positioned side menu; clamps itself inside the panel's height. */
function Flyout({
  top,
  panelHeight,
  onEnter,
  children,
}: {
  top: number;
  panelHeight: number;
  onEnter: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [y, setY] = React.useState(top);
  React.useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setY(Math.max(0, Math.min(top - 5, panelHeight - h)));
  }, [top, panelHeight, children]);
  return (
    <div
      ref={ref}
      className="tr-flyout"
      style={{ left: 0, top: y, maxHeight: panelHeight, width: FLY_W }}
      onMouseEnter={onEnter}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function FlyRow({
  label,
  checked,
  right,
  onClick,
  disabled,
  icon,
  showCheck = true,
}: {
  label: React.ReactNode;
  checked?: boolean;
  right?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  showCheck?: boolean;
}) {
  return (
    <div className={cx("tr-row", disabled ? "disabled" : "hoverable")} onClick={() => !disabled && onClick?.()}>
      {showCheck && <span className="tr-check">{checked && <Check size={12} strokeWidth={2.8} />}</span>}
      {icon}
      <span className="tr-fly-name">{label}</span>
      {right && <span className="tr-row-right">{right}</span>}
    </div>
  );
}

/* ---------- panel ---------- */

export default function TrayPanel() {
  const t = useT();
  const settings = useApp((s) => s.settings)!;
  const core = useApp((s) => s.core);
  const profiles = useApp((s) => s.profiles);
  const busy = useApp((s) => s.busy);
  const activeProfile = useActiveProfile();
  const toggleSystemProxy = useApp((s) => s.toggleSystemProxy);
  const toggleTun = useApp((s) => s.toggleTun);
  const setMode = useApp((s) => s.setMode);
  const switchProfile = useApp((s) => s.switchProfile);
  const reloadConfig = useApp((s) => s.reloadConfig);
  const startCore = useApp((s) => s.startCore);
  const stopCore = useApp((s) => s.stopCore);
  const restartCore = useApp((s) => s.restartCore);

  const history = useLive((s) => s.trafficHistory);
  const up = useLive((s) => s.up);
  const down = useLive((s) => s.down);
  const uploadTotal = useLive((s) => s.uploadTotal);
  const downloadTotal = useLive((s) => s.downloadTotal);
  const memory = useLive((s) => s.memory);
  const connCount = useLive((s) => s.connections.length);

  const running = core.state === "running";
  const cards = settings.menuCards;

  const [appMem, setAppMem] = React.useState(0);
  const [proxies, setProxies] = React.useState<Record<string, ProxyItem>>({});
  const [testing, setTesting] = React.useState<Record<string, boolean>>({});
  const [ssid, setSsid] = React.useState<string | null>(null);
  const [lanIp, setLanIp] = React.useState<string | null>(null);
  const [ruleOpen, setRuleOpen] = React.useState(false);
  const [fly, setFly] = React.useState<{ id: FlyId; top: number } | null>(null);
  const [panelH, setPanelH] = React.useState(600);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const openTimer = React.useRef<number>();
  const closeTimer = React.useRef<number>();

  /* ----- data refresh (only while shown) ----- */
  const loadProxies = React.useCallback(async () => {
    if (useApp.getState().core.state !== "running") {
      setProxies({});
      return;
    }
    try {
      setProxies((await mihomo.proxies()).proxies);
    } catch {
      /* core may be restarting */
    }
  }, []);

  const refresh = React.useCallback(() => {
    loadProxies();
    backend.appMemory().then(setAppMem).catch(() => {});
    const s = useApp.getState().settings;
    if (s?.wifiBypass.enabled) backend.wifiSsid().then(setSsid).catch(() => setSsid(null));
  }, [loadProxies]);

  React.useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    const onBlur = () => {
      setFly(null);
      setRuleOpen(false);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadProxies();
        backend.appMemory().then(setAppMem).catch(() => {});
      }
    }, 3000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.clearInterval(iv);
    };
  }, [refresh, loadProxies]);

  React.useEffect(() => {
    loadProxies();
  }, [core.state, core.pid, settings.activeProfileId, settings.outboundMode, loadProxies]);

  React.useEffect(() => {
    if (settings.engine.network.allowLan) lanAddress(settings.engine.network.bindAddress).then(setLanIp);
    else setLanIp(null);
  }, [settings.engine.network.allowLan, settings.engine.network.bindAddress]);

  /* ----- popup shown / hidden (it never takes focus, so focus events don't fire) ----- */
  React.useEffect(() => {
    const offs: Promise<() => void>[] = [
      listen("tray://shown", () => {
        setFly(null);
        refresh();
      }),
      listen("tray://hidden", () => {
        setFly(null);
        setRuleOpen(false);
      }),
    ];
    return () => offs.forEach((p) => p.then((off) => off()));
  }, [refresh]);

  /* ----- native window sizing ----- */
  // The window always reserves room for a flyout on the left so opening one never
  // resizes or moves it; the region below keeps that room transparent to clicks.
  const reserve = FLY_W + GAP;

  /** Report the visible shapes (panel + open flyout) so only they are clickable. */
  const reportRegion = React.useCallback(() => {
    if (!isTauri) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    if (ruleOpen) {
      backend.setTrayPanelRegion([]).catch(() => {}); // dialog overlays the whole window
      return;
    }
    const rects = [{ x: panel.offsetLeft, y: panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight, radius: 12 }];
    const f = root.querySelector<HTMLElement>(".tr-flyout");
    if (f) rects.push({ x: f.offsetLeft, y: f.offsetTop, width: f.offsetWidth, height: f.offsetHeight, radius: 12 });
    backend.setTrayPanelRegion(rects).catch(() => {});
  }, [ruleOpen]);

  React.useLayoutEffect(() => {
    reportRegion();
    const f = rootRef.current?.querySelector<HTMLElement>(".tr-flyout");
    if (!f) return;
    const ro = new ResizeObserver(() => reportRegion());
    ro.observe(f);
    return () => ro.disconnect();
  }, [fly, ruleOpen, reportRegion]);

  // Typing in the quick-rule dialog needs keyboard focus.
  React.useEffect(() => {
    if (ruleOpen) backend.focusTrayPanel().catch(() => {});
  }, [ruleOpen]);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    let timer: number | undefined;
    const report = () => {
      const h = Math.ceil(panel.getBoundingClientRect().height);
      setPanelH(h);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const w = Math.ceil(root.getBoundingClientRect().width);
        backend.setTrayPanelSize(isTauri ? w : PANEL_W + 2, h).catch(() => {});
        reportRegion();
      }, 30);
    };
    const ro = new ResizeObserver(report);
    ro.observe(panel);
    ro.observe(root);
    report();
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, [reserve, reportRegion]);

  /* ----- flyout hover logic ----- */
  const cancelTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  const rowTop = (el: HTMLElement) => el.offsetTop;
  const openFly = (id: FlyId, el: HTMLElement, delay = 140) => {
    cancelTimers();
    if (fly?.id === id) return;
    const top = rowTop(el);
    if (delay === 0) setFly({ id, top });
    else openTimer.current = window.setTimeout(() => setFly({ id, top }), fly ? delay : delay + 60);
  };
  const leaveToPlain = () => {
    window.clearTimeout(openTimer.current);
    if (!fly) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFly(null), 260);
  };
  const subRowProps = (id: FlyId) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => openFly(id, e.currentTarget),
    onClick: (e: React.MouseEvent<HTMLDivElement>) => {
      if (fly?.id === id) {
        cancelTimers();
        setFly(null);
      } else openFly(id, e.currentTarget, 0);
    },
  });
  const plainRowProps = { onMouseEnter: leaveToPlain };

  /* ----- actions ----- */
  const hideAfter = (p: Promise<unknown>) => p.finally(() => backend.hideTrayPanel().catch(() => {}));
  const openDashboard = (page?: string) => hideAfter(backend.openDashboard(page));
  const openSettings = (tab: string) => hideAfter(backend.openSettings(tab));

  const copyShell = async (lan: boolean) => {
    const host = lan ? lanIp : "127.0.0.1";
    if (!host) return;
    const cmd = shellExport(settings.shellExportStyle, host, settings.engine.network);
    if (await copyText(cmd)) toast.success(t("tray.copiedShell"));
    else toast.error(t("common.error"));
  };

  const testGroup = async (g: ProxyItem) => {
    if (testing[g.name]) return;
    setTesting((s) => ({ ...s, [g.name]: true }));
    try {
      await mihomo.groupDelay(g.name, g.testUrl || settings.delayTestUrl, settings.delayTimeout);
    } catch (e) {
      /* individual timeouts are expected */
    } finally {
      await loadProxies();
      setTesting((s) => ({ ...s, [g.name]: false }));
    }
  };

  const selectNode = async (g: ProxyItem, name: string) => {
    setFly(null);
    if (g.now === name) return;
    setProxies((p) => ({ ...p, [g.name]: { ...p[g.name], now: name } }));
    try {
      await mihomo.selectProxy(g.name, name);
      if (settings.policy.autoCloseOnSwitch) {
        const conns = useLive.getState().connections.filter((c) => c.chains.includes(g.name));
        await Promise.all(conns.map((c) => mihomo.closeConnection(c.id).catch(() => {})));
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
    loadProxies();
  };

  /* ----- keyboard shortcuts ----- */
  const stateRef = React.useRef({ fly, ruleOpen, settings, lanIp });
  stateRef.current = { fly, ruleOpen, settings, lanIp };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = stateRef.current;
      const inField = (e.target as HTMLElement)?.closest?.("input, textarea");
      if (e.key === "Escape") {
        if (st.ruleOpen) return; // modal handles its own Esc
        if (st.fly) setFly(null);
        else backend.hideTrayPanel().catch(() => {});
        return;
      }
      if (!e.ctrlKey || inField || st.ruleOpen) return;
      const k = e.key.toLowerCase();
      const app = useApp.getState();
      const handled = () => e.preventDefault();
      if (k === "s") {
        handled();
        app.toggleSystemProxy(!st.settings.systemProxy);
      } else if (k === "e") {
        handled();
        app.toggleTun(!st.settings.tunMode);
      } else if (k === "c" && e.altKey) {
        handled();
        if (st.lanIp) copyShell(true);
      } else if (k === "c") {
        if (window.getSelection()?.toString()) return;
        handled();
        copyShell(false);
      } else if (k === "r") {
        handled();
        app.reloadConfig();
      } else if (k === "d") {
        handled();
        openDashboard();
      } else if (k === ",") {
        handled();
        openSettings("general");
      } else if (k === "u") {
        handled();
        openSettings("about");
      } else if (k === "q") {
        handled();
        backend.quit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- derived ----- */
  const groups = React.useMemo(() => {
    const order = proxies.GLOBAL?.all ?? Object.keys(proxies);
    const seen = new Set<string>();
    const out: ProxyItem[] = [];
    for (const n of order) {
      const p = proxies[n];
      if (!p || seen.has(n) || p.name === "GLOBAL" || p.type !== "Selector" || p.hidden) continue;
      seen.add(n);
      out.push(p);
      if (out.length >= MAX_GROUPS) break;
    }
    return out;
  }, [proxies]);

  const delayOf = React.useCallback(
    (name: string, depth = 0): number | undefined => {
      const p = proxies[name];
      if (!p) return undefined;
      if (p.all && p.now && depth < 4) return delayOf(p.now, depth + 1);
      const h = p.history;
      return h?.length ? h[h.length - 1].delay : undefined;
    },
    [proxies],
  );

  const sub = activeProfile?.type === "remote" ? activeProfile.subscription : undefined;
  const showOwnSub = cards.subscription && !!sub && sub.total > 0;
  // Local configs that pull nodes via proxy-providers: show the providers' usage instead.
  const providerSubs = useProviderSubs(cards.subscription && !showOwnSub);
  const subItems: { name: string; upload: number; download: number; total: number; expire: number }[] = showOwnSub
    ? [{ name: activeProfile!.name, ...sub! }]
    : cards.subscription
      ? providerSubs.slice(0, 3)
      : [];
  const showSub = subItems.length > 0;
  const bypassed = settings.wifiBypass.enabled && !!ssid && settings.wifiBypass.ssids.includes(ssid);
  const coreStateKey: Record<string, string> = {
    running: "tray.running",
    stopped: "tray.stopped",
    starting: "tray.starting",
    not_installed: "tray.notInstalled",
    downloading: "tray.downloading",
    error: "tray.error",
  };
  const modeKey: Record<OutboundMode, string> = { rule: "tray.modeRule", global: "tray.modeGlobal", direct: "tray.modeDirect" };
  const specialLabel = (name: string) => t(`tray.${SPECIAL[name]}`);

  /* ----- flyout content ----- */
  let flyContent: React.ReactNode = null;
  if (fly) {
    if (fly.id === "kernel") {
      flyContent = (
        <>
          <FlyRow showCheck={false} label={t("tray.startKernel")} disabled={running || !!busy.core} onClick={() => (setFly(null), startCore())} />
          <FlyRow showCheck={false} label={t("tray.stopKernel")} disabled={!running || !!busy.core} onClick={() => (setFly(null), stopCore())} />
          <FlyRow showCheck={false} label={t("tray.restartKernel")} disabled={!!busy.core || core.state === "not_installed"} onClick={() => (setFly(null), restartCore())} />
          <div className="tr-sep" />
          <FlyRow showCheck={false} label={t("tray.openLogs")} onClick={() => openDashboard("/logs")} />
        </>
      );
    } else if (fly.id === "mode") {
      flyContent = (["rule", "global", "direct"] as OutboundMode[]).map((m) => (
        <FlyRow key={m} label={t(modeKey[m])} checked={settings.outboundMode === m} onClick={() => (setFly(null), setMode(m))} />
      ));
    } else if (fly.id === "profile") {
      flyContent = profiles.length ? (
        profiles.map((p) => (
          <FlyRow
            key={p.id}
            label={p.name}
            checked={p.id === settings.activeProfileId}
            onClick={() => {
              setFly(null);
              if (p.id !== settings.activeProfileId) switchProfile(p.id);
            }}
          />
        ))
      ) : (
        <div className="tr-empty">{t("tray.noProfile")}</div>
      );
    } else if (fly.id.startsWith("group:")) {
      const g = proxies[fly.id.slice(6)];
      if (g) {
        const isTesting = !!testing[g.name];
        flyContent = (
          <>
            <div className="tr-row hoverable" onClick={() => testGroup(g)}>
              <span className="tr-check" />
              {isTesting ? <Zap size={13} className="spin" color="var(--amber)" /> : <Zap size={13} color="var(--amber)" />}
              <span className="tr-fly-name">{isTesting ? t("tray.testing") : t("tray.testLatency")}</span>
            </div>
            <div className="tr-sep" />
            {(g.all ?? []).map((name) => {
              const special = SPECIAL[name];
              const member = proxies[name];
              return (
                <FlyRow
                  key={name}
                  label={withFlag(name)}
                  checked={g.now === name}
                  onClick={() => selectNode(g, name)}
                  right={
                    special ? (
                      <Tag>{specialLabel(name)}</Tag>
                    ) : member?.all ? (
                      <>
                        <span className="tr-hint" style={{ fontSize: 11 }}>{member.type}</span>
                        <LatencyBadge delay={delayOf(name)} testing={isTesting} timeoutLabel={t("common.timeout")} />
                      </>
                    ) : (
                      <LatencyBadge delay={delayOf(name)} testing={isTesting} timeoutLabel={t("common.timeout")} />
                    )
                  }
                />
              );
            })}
          </>
        );
      }
    }
  }

  const statIcon = 15;

  return (
    <div ref={rootRef} className="tr-root" style={{ paddingLeft: reserve }}>
      {fly && flyContent && (
        <Flyout top={fly.top} panelHeight={panelH} onEnter={cancelTimers}>
          {flyContent}
        </Flyout>
      )}
      <div ref={panelRef} className="tr-panel" onMouseDown={(e) => e.button === 0 && e.target === e.currentTarget && setFly(null)}>
        {/* 1. smart cards */}
        {(bypassed || cards.browserRule) && (
          <>
            {bypassed && (
              <div className="tr-notice" onClick={() => openSettings("general")} onMouseEnter={leaveToPlain}>
                <span className="tr-notice-icon">
                  <Wifi size={14} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <div>{t("tray.wifiBypassed")}</div>
                  <div className="tr-dim ellipsis" style={{ fontSize: 11.5 }}>
                    {ssid}
                  </div>
                </span>
              </div>
            )}
            {cards.browserRule && (
              <div className="tr-notice" onClick={() => setRuleOpen(true)} onMouseEnter={leaveToPlain}>
                <span className="tr-notice-icon">
                  <Chrome size={14} />
                </span>
                <span>{t("tray.addRuleForPage")}</span>
              </div>
            )}
            {(cards.trafficWave || cards.perfGrid || showSub) && <div className="tr-sep" />}
          </>
        )}

        {/* 2. traffic wave */}
        {cards.trafficWave && (
          <div className="tr-wave" onClick={() => openDashboard("/overview")} onMouseEnter={leaveToPlain}>
            <TrafficChart data={history.slice(-40)} height={78} strokeWidth={2.2} fillOpacity={0.16} padTop={4} />
          </div>
        )}

        {/* 3. perf grid */}
        {cards.perfGrid && (
          <div className="tr-grid" onMouseEnter={leaveToPlain}>
            <span className="tr-stat" title={t("tray.download")}>
              <CircleArrowDown size={statIcon} color="var(--blue)" />
              {formatBytes(downloadTotal)}
            </span>
            <span className="tr-stat" title={t("tray.upload")}>
              <CircleArrowUp size={statIcon} color="var(--red)" />
              {formatBytes(uploadTotal)}
            </span>
            <span className="tr-stat" title={t("tray.speed")}>
              <Zap size={statIcon} color="var(--orange)" fill="var(--orange)" fillOpacity={0.25} />
              {formatSpeed(up + down)}
            </span>
            <span className="tr-stat" title={t("tray.connections")}>
              <Link2 size={statIcon} color="var(--teal)" />
              {connCount}
            </span>
            <span className="tr-stat" title={t("tray.kernelMemory")}>
              <MemoryStick size={statIcon} color="var(--magenta)" />
              {formatBytes(memory)}
            </span>
            <span className="tr-stat" title={t("tray.appMemory")}>
              <SquareDashed size={statIcon} color="var(--pink)" />
              {formatBytes(appMem)}
            </span>
          </div>
        )}

        {/* 4. subscription (the profile's own, or its proxy-providers') */}
        {showSub && (
          <>
            {(cards.trafficWave || cards.perfGrid) && <div className="tr-sep" />}
            {subItems.map((it) => {
              const used = it.upload + it.download;
              const ratio = it.total ? used / it.total : 0;
              const dl = daysLeft(it.expire);
              return (
                <div key={it.name} className="tr-sub" onMouseEnter={leaveToPlain}>
                  <div className="tr-sub-head">
                    <span className="tr-sub-name">{it.name}</span>
                    <span className="tr-sub-days" style={dl !== null && dl < 0 ? { color: "var(--red)" } : undefined}>
                      {dl === null ? t("tray.noExpire") : dl < 0 ? t("tray.expired") : t("tray.daysLeft", { n: dl })}
                    </span>
                  </div>
                  <Progress value={ratio} color={usageColor(ratio)} height={4} />
                  <div className="tr-sub-foot">
                    <span>
                      {formatBytes(used)} / {formatBytes(it.total)}
                    </span>
                    <span>{Math.round(ratio * 100)}%</span>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {(cards.trafficWave || cards.perfGrid || showSub) && <div className="tr-sep" />}

        {/* 5. switches */}
        <div className="tr-row tall" onClick={() => toggleSystemProxy(!settings.systemProxy)} {...plainRowProps}>
          <span className="tr-row-label">{t("tray.systemProxy")}</span>
          <span className="tr-row-right">
            {busy.sysproxy && <Spinner size={12} />}
            <Toggle checked={settings.systemProxy} onChange={(v) => toggleSystemProxy(v)} />
          </span>
        </div>
        <div className="tr-row tall" onClick={() => toggleTun(!settings.tunMode)} {...plainRowProps}>
          <span className="tr-row-label">{t("tray.enhancedMode")}</span>
          <span className="tr-row-right">
            {busy.tun && <Spinner size={12} />}
            <Toggle checked={settings.tunMode} onChange={(v) => toggleTun(v)} />
          </span>
        </div>

        <div className="tr-sep" />

        {/* 6. kernel */}
        <div className={cx("tr-row hoverable", fly?.id === "kernel" && "open")} {...subRowProps("kernel")}>
          <span className="tr-row-label">{t("tray.kernel")}</span>
          <span className="tr-dim">{t(coreStateKey[core.state] ?? "tray.stopped")}</span>
          <span className="tr-row-right">
            {(busy.core || core.state === "starting") && <Spinner size={12} />}
            <span className="tr-dim">{core.version ?? ""}</span>
            <ChevronRight size={14} className="tr-chev" />
          </span>
        </div>

        <div className="tr-sep" />

        {/* 7. mode + shell */}
        <div className={cx("tr-row hoverable", fly?.id === "mode" && "open")} {...subRowProps("mode")}>
          <span className="tr-row-label">{t("tray.outboundMode")}</span>
          <span className="tr-row-right">
            <span className="tr-dim">{t(modeKey[settings.outboundMode])}</span>
            <ChevronRight size={14} className="tr-chev" />
          </span>
        </div>
        {cards.copyShell && (
          <div className="tr-row hoverable" onClick={() => copyShell(false)} {...plainRowProps}>
            <span className="tr-row-label">{t("tray.copyShell")}</span>
            <span className="tr-row-right tr-hint">Ctrl+C</span>
          </div>
        )}
        {cards.copyShell && settings.engine.network.allowLan && lanIp && (
          <div className="tr-row hoverable" onClick={() => copyShell(true)} {...plainRowProps}>
            <span className="tr-row-label">{t("tray.copyShellLan")}</span>
            <span className="tr-row-right tr-hint">Ctrl+Alt+C</span>
          </div>
        )}

        {/* 8. policy groups */}
        {running && groups.length > 0 && (
          <>
            <div className="tr-sep" />
            {groups.map((g) => {
              const id = `group:${g.name}` as FlyId;
              return (
                <div key={g.name} className={cx("tr-row hoverable", fly?.id === id && "open")} {...subRowProps(id)}>
                  <GroupIcon group={g} />
                  <span className="tr-row-label ellipsis" style={{ maxWidth: 110 }}>
                    {g.name}
                  </span>
                  <span className="tr-row-right">
                    {testing[g.name] && <Zap size={11} className="spin" color="var(--amber)" />}
                    <span className="tr-dim ellipsis">{withFlag(g.now ?? "")}</span>
                    <ChevronRight size={14} className="tr-chev" />
                  </span>
                </div>
              );
            })}
          </>
        )}

        <div className="tr-sep" />

        {/* 9. profile */}
        <div className={cx("tr-row hoverable", fly?.id === "profile" && "open")} {...subRowProps("profile")}>
          <span className="tr-row-label">{t("tray.switchProfile")}</span>
          <span className="tr-row-right">
            {busy.profile && <Spinner size={12} />}
            <span className="tr-dim ellipsis">{activeProfile?.name ?? t("tray.noProfile")}</span>
            <ChevronRight size={14} className="tr-chev" />
          </span>
        </div>
        <div className={cx("tr-row", running ? "hoverable" : "disabled")} onClick={() => running && reloadConfig()} {...plainRowProps}>
          <span className="tr-row-label">{t("tray.reloadConfig")}</span>
          <span className="tr-row-right tr-hint">{busy.reload ? <Spinner size={12} /> : "Ctrl+R"}</span>
        </div>

        <div className="tr-sep" />

        {/* 10. windows */}
        <div className="tr-row hoverable" onClick={() => openDashboard()} {...plainRowProps}>
          <span className="tr-row-label">{t("tray.dashboard")}</span>
          <span className="tr-row-right tr-hint">Ctrl+D</span>
        </div>
        <div className="tr-row hoverable" onClick={() => openSettings("general")} {...plainRowProps}>
          <span className="tr-row-label">{t("tray.settings")}</span>
          <span className="tr-row-right tr-hint">Ctrl+,</span>
        </div>

        <div className="tr-sep" />

        {/* 11. updates */}
        <div className="tr-row hoverable" onClick={() => openSettings("about")} {...plainRowProps}>
          <span className="tr-row-label">{t("tray.checkUpdates")}</span>
          <span className="tr-row-right tr-hint">Ctrl+U</span>
        </div>

        <div className="tr-sep" />

        {/* 12. quit */}
        <div className="tr-row hoverable" onClick={() => backend.quit()} {...plainRowProps}>
          <span className="tr-row-label">{t("tray.quit")}</span>
          <span className="tr-row-right tr-hint">Ctrl+Q</span>
        </div>
      </div>
      <QuickRuleDialog open={ruleOpen} onClose={() => setRuleOpen(false)} />
    </div>
  );
}

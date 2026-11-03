import React from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Gauge,
  Layers,
  Link2,
  LifeBuoy,
  MousePointerClick,
  Package,
  Pin,
  Power,
  RefreshCw,
  Scale,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";
import { Page } from "@/components/layout/Page";
import { ModeSwitch } from "@/components/layout/ToolbarActions";
import {
  Dropdown,
  Empty,
  IconButton,
  LatencyBadge,
  Progress,
  Spinner,
  Tag,
  Tooltip,
  cx,
  toast,
  usageColor,
} from "@/components/ui";
import { useLang, useT } from "@/i18n";
import { mihomo } from "@/lib/mihomo";
import { useApp } from "@/lib/store";
import { useLive } from "@/lib/live";
import { errorMessage } from "@/lib/backend";
import { daysLeft, formatAgo, formatBytes } from "@/lib/format";
import type { ProxyItem, ProxyProvider } from "@/lib/types";
import "./policy.css";
import { SELECTABLE, displayName, isGroup, lastDelay, resolvePath, specialKind } from "./utils";

/* ---------------- helpers ---------------- */

const groupStyle: Record<string, { icon: React.ElementType; color: string }> = {
  Selector: { icon: MousePointerClick, color: "var(--accent)" },
  URLTest: { icon: Gauge, color: "var(--green)" },
  Fallback: { icon: LifeBuoy, color: "var(--orange)" },
  LoadBalance: { icon: Scale, color: "var(--purple)" },
  Relay: { icon: Link2, color: "var(--teal)" },
  Smart: { icon: Sparkles, color: "var(--magenta)" },
};

function GroupIcon({ group }: { group: ProxyItem }) {
  const st = groupStyle[group.type] ?? { icon: Layers, color: "var(--accent)" };
  const [broken, setBroken] = React.useState(false);
  return (
    <span className="pl-gicon" style={{ background: `color-mix(in srgb, ${st.color} 16%, transparent)`, color: st.color }}>
      {group.icon && !broken ? (
        <img src={group.icon} alt="" onError={() => setBroken(true)} draggable={false} />
      ) : (
        <st.icon size={16} strokeWidth={2} />
      )}
    </span>
  );
}

/* ---------------- node tile ---------------- */

function NodeTile({
  name,
  item,
  proxies,
  selected,
  selectable,
  delay,
  testing,
  onSelect,
  onTest,
}: {
  name: string;
  item?: ProxyItem;
  proxies: Record<string, ProxyItem>;
  selected: boolean;
  selectable: boolean;
  delay?: number;
  testing: boolean;
  onSelect: () => void;
  onTest: () => void;
}) {
  const t = useT();
  const special = specialKind(name, item);
  const nested = isGroup(item);
  const nestedNow = nested ? resolvePath(name, proxies).slice(-1)[0] : undefined;
  return (
    <div
      className={cx("pl-node", selectable && "selectable", selected && "selected")}
      onClick={selectable ? onSelect : undefined}
      title={name}
    >
      <div className="pl-nname">{displayName(name)}</div>
      <div className="pl-nfoot">
        <span className="pl-ntype">
          {nested && <Layers size={10} />}
          <span className="ellipsis">{nested && nestedNow ? `${item!.type} · ${nestedNow}` : item?.type ?? "—"}</span>
          {item?.udp && !special && !nested && <span className="pl-udp">UDP</span>}
        </span>
        {special ? (
          <Tag>{t(`policy.${special}`)}</Tag>
        ) : (
          <LatencyBadge
            delay={delay}
            testing={testing}
            onAccent={selected}
            onTest={onTest}
            timeoutLabel={t("common.timeout")}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------- group card ---------------- */

function GroupCard({
  group,
  proxies,
  open,
  onToggle,
  testingNodes,
  testingGroup,
  hideTimeout,
  testUrl,
  onSelect,
  onTestNode,
  onTestGroup,
  onUnfix,
}: {
  group: ProxyItem;
  proxies: Record<string, ProxyItem>;
  open: boolean;
  onToggle: () => void;
  testingNodes: Set<string>;
  testingGroup: boolean;
  hideTimeout: boolean;
  testUrl: string;
  onSelect: (node: string) => void;
  onTestNode: (node: string) => void;
  onTestGroup: () => void;
  onUnfix: () => void;
}) {
  const t = useT();
  const path = resolvePath(group.name, proxies);
  const finalNode = path[path.length - 1];
  const finalItem = finalNode ? proxies[finalNode] : undefined;
  const finalSpecial = finalNode ? specialKind(finalNode, finalItem) : undefined;
  const members = group.all ?? [];
  const selectable = SELECTABLE.has(group.type);
  const delayOf = (n: string) => {
    const it = proxies[n];
    if (isGroup(it)) {
      const last = resolvePath(n, proxies).slice(-1)[0];
      return lastDelay(proxies[last], testUrl);
    }
    return lastDelay(it, testUrl);
  };
  const visible = members.filter((n) => {
    if (!hideTimeout || n === group.now) return true;
    const it = proxies[n];
    if (specialKind(n, it) || isGroup(it)) return true;
    return delayOf(n) !== 0;
  });

  return (
    <div className={cx("pl-group", open && "open")}>
      <div className="pl-head" onClick={onToggle}>
        <GroupIcon group={group} />
        <div className="pl-gmain">
          <div className="pl-gtitle">
            <span className="pl-gname">{group.name}</span>
            <Tag>{group.type}</Tag>
            {group.hidden && <Tag style={{ opacity: 0.7 }}>hidden</Tag>}
          </div>
          <div className="pl-gpath">
            <span>{group.name}</span>
            {path.map((p, i) => (
              <React.Fragment key={i}>
                <ChevronRight size={11} />
                <span className={i === path.length - 1 ? "pl-gpath-node" : undefined}>{displayName(p)}</span>
              </React.Fragment>
            ))}
            <span style={{ marginLeft: 6, flexShrink: 0 }}>· {t("policy.nodes", { n: members.length })}</span>
          </div>
        </div>
        <div className="pl-gactions" onClick={(e) => e.stopPropagation()}>
          {group.fixed && group.type !== "Selector" && (
            <Tooltip content={t("policy.fixedTip", { name: group.fixed })}>
              <button className="pl-fixed" onClick={onUnfix}>
                <Pin size={10} />
                {t("policy.fixed")}
              </button>
            </Tooltip>
          )}
          {finalNode &&
            (finalSpecial ? (
              <Tag>{t(`policy.${finalSpecial}`)}</Tag>
            ) : (
              <LatencyBadge delay={lastDelay(finalItem, testUrl)} timeoutLabel={t("common.timeout")} />
            ))}
          <Tooltip content={t("policy.testGroup")}>
            <IconButton
              size="sm"
              variant="plain"
              icon={testingGroup ? <Zap size={14} className="spin" color="var(--accent)" /> : <Zap size={14} />}
              onClick={() => !testingGroup && onTestGroup()}
            />
          </Tooltip>
        </div>
        <ChevronDown size={16} className="pl-chevron" />
      </div>
      {open && (
        <div className="pl-grid">
          {visible.map((n) => (
            <NodeTile
              key={n}
              name={n}
              item={proxies[n]}
              proxies={proxies}
              selected={group.now === n}
              selectable={selectable}
              delay={delayOf(n)}
              testing={testingNodes.has(n) || (testingGroup && !specialKind(n, proxies[n]))}
              onSelect={() => onSelect(n)}
              onTest={() => onTestNode(n)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- provider card ---------------- */

function ProviderCard({
  provider,
  open,
  onToggle,
  testingNodes,
  testUrl,
  onTestNode,
  onReload,
}: {
  provider: ProxyProvider;
  open: boolean;
  onToggle: () => void;
  testingNodes: Set<string>;
  testUrl: string;
  onTestNode: (n: string) => void;
  onReload: () => void;
}) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [checking, setChecking] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const sub = provider.subscriptionInfo;
  const used = sub ? sub.Upload + sub.Download : 0;
  const left = sub ? daysLeft(sub.Expire) : null;
  const byName: Record<string, ProxyItem> = Object.fromEntries(provider.proxies.map((p) => [p.name, p]));

  const run = async (fn: () => Promise<void>, set: (b: boolean) => void) => {
    set(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      set(false);
      onReload();
    }
  };

  return (
    <div className={cx("pl-group", open && "open")}>
      <div className="pl-head" onClick={onToggle}>
        <span className="pl-gicon" style={{ background: "color-mix(in srgb, var(--teal) 16%, transparent)", color: "var(--teal)" }}>
          <Package size={16} strokeWidth={2} />
        </span>
        <div className="pl-gmain">
          <div className="pl-gtitle">
            <span className="pl-gname">{provider.name}</span>
            <Tag>{provider.vehicleType}</Tag>
          </div>
          <div className="pl-gpath">
            <span>{t("policy.nodes", { n: provider.proxies.length })}</span>
            {provider.updatedAt && (
              <span>· {t("policy.updatedAgo", { ago: formatAgo(new Date(provider.updatedAt).getTime(), lang) })}</span>
            )}
          </div>
        </div>
        <div className="pl-gactions" onClick={(e) => e.stopPropagation()}>
          {sub && sub.Total > 0 && (
            <div className="pl-usage">
              <div className="pl-usage-text">
                <span>
                  {formatBytes(used, 1)} / {formatBytes(sub.Total, 0)}
                </span>
                {left !== null && (
                  <span style={{ color: left <= 0 ? "var(--red)" : left <= 7 ? "var(--orange)" : undefined }}>
                    {left <= 0 ? t("policy.expired") : t("policy.daysLeft", { n: left })}
                  </span>
                )}
              </div>
              <Progress value={used / sub.Total} color={usageColor(used / sub.Total)} height={3} />
            </div>
          )}
          <Tooltip content={t("policy.healthcheck")}>
            <IconButton
              size="sm"
              variant="plain"
              icon={checking ? <Activity size={14} className="spin" color="var(--accent)" /> : <Activity size={14} />}
              onClick={() => !checking && run(() => mihomo.healthcheckProvider(provider.name), setChecking)}
            />
          </Tooltip>
          {provider.vehicleType === "HTTP" && (
            <Tooltip content={t("policy.updateProvider")}>
              <IconButton
                size="sm"
                variant="plain"
                icon={<RefreshCw size={13} className={updating ? "spin" : undefined} />}
                onClick={() => !updating && run(() => mihomo.updateProxyProvider(provider.name), setUpdating)}
              />
            </Tooltip>
          )}
        </div>
        <ChevronDown size={16} className="pl-chevron" />
      </div>
      {open && (
        <div className="pl-grid">
          {provider.proxies.map((p) => (
            <NodeTile
              key={p.name}
              name={p.name}
              item={byName[p.name]}
              proxies={byName}
              selected={false}
              selectable={false}
              delay={lastDelay(p, testUrl)}
              testing={testingNodes.has(p.name) || checking}
              onSelect={() => {}}
              onTest={() => onTestNode(p.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- page ---------------- */

export default function PolicyPage() {
  const t = useT();
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const coreState = useApp((s) => s.core.state);
  const running = coreState === "running";
  const mode = settings?.outboundMode ?? "rule";
  const pol = settings?.policy ?? { hideTimeoutNodes: false, showHiddenGroups: false, autoCloseOnSwitch: true, collapsed: {} };
  const testUrlDefault = settings?.delayTestUrl ?? "https://www.gstatic.com/generate_204";
  const timeout = settings?.delayTimeout ?? 5000;

  const [proxies, setProxies] = React.useState<Record<string, ProxyItem> | null>(null);
  const [providers, setProviders] = React.useState<ProxyProvider[]>([]);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>(pol.collapsed ?? {});
  const [testingNodes, setTestingNodes] = React.useState<Set<string>>(new Set());
  const [testingGroups, setTestingGroups] = React.useState<Set<string>>(new Set());
  const [batch, setBatch] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [p, pv] = await Promise.all([mihomo.proxies(), mihomo.proxyProviders().catch(() => ({ providers: {} }))]);
      setProxies(p.proxies);
      setProviders(
        Object.values(pv.providers ?? {}).filter((x) => x.vehicleType !== "Compatible" && x.proxies?.length),
      );
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, []);

  React.useEffect(() => {
    if (!running) {
      setProxies(null);
      return;
    }
    load();
    const id = window.setInterval(() => {
      if (!document.hidden) load();
    }, 5000);
    return () => window.clearInterval(id);
  }, [running, load]);

  // ---- ordering ----
  const groups = React.useMemo(() => {
    if (!proxies) return [];
    const order = proxies.GLOBAL?.all ?? Object.keys(proxies);
    const seen = new Set<string>();
    const out: ProxyItem[] = [];
    for (const n of order) {
      const p = proxies[n];
      if (p && isGroup(p) && n !== "GLOBAL" && !seen.has(n)) {
        seen.add(n);
        out.push(p);
      }
    }
    for (const p of Object.values(proxies)) if (isGroup(p) && p.name !== "GLOBAL" && !seen.has(p.name)) out.push(p);
    const filtered = pol.showHiddenGroups ? out : out.filter((g) => !g.hidden);
    if (mode === "global" && proxies.GLOBAL) return [proxies.GLOBAL, ...filtered];
    return filtered;
  }, [proxies, pol.showHiddenGroups, mode]);

  // Groups start expanded, providers start collapsed.
  const isCollapsed = (key: string) => collapsed[key] ?? key.startsWith("provider:");
  const isOpen = (key: string) => !isCollapsed(key);
  const toggle = (key: string) => {
    const v = !isCollapsed(key);
    setCollapsed((c) => ({ ...c, [key]: v }));
    saveSettings({ policy: { collapsed: { [key]: v } } });
  };
  const allKeys = [...groups.map((g) => g.name), ...providers.map((p) => `provider:${p.name}`)];
  const anyOpen = allKeys.some(isOpen);
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    for (const k of allKeys) next[k] = anyOpen;
    setCollapsed((c) => ({ ...c, ...next }));
    saveSettings({ policy: { collapsed: next } });
  };

  // ---- actions ----
  const testUrlFor = (g?: ProxyItem) => g?.testUrl || testUrlDefault;

  const testNode = async (name: string, url = testUrlDefault) => {
    setTestingNodes((s) => new Set(s).add(name));
    try {
      await mihomo.proxyDelay(name, url, timeout);
    } catch {
      /* timeout is recorded by the core as delay 0 */
    } finally {
      setTestingNodes((s) => {
        const n = new Set(s);
        n.delete(name);
        return n;
      });
      load();
    }
  };

  const testGroup = async (g: ProxyItem) => {
    setTestingGroups((s) => new Set(s).add(g.name));
    try {
      await mihomo.groupDelay(g.name, testUrlFor(g), timeout);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTestingGroups((s) => {
        const n = new Set(s);
        n.delete(g.name);
        return n;
      });
      load();
    }
  };

  const testAll = async () => {
    if (batch) return;
    setBatch(true);
    const targets = groups.filter((g) => g.name !== "GLOBAL");
    setTestingGroups(new Set(targets.map((g) => g.name)));
    await Promise.allSettled(targets.map((g) => mihomo.groupDelay(g.name, testUrlFor(g), timeout)));
    setTestingGroups(new Set());
    setBatch(false);
    await load();
    toast.success(t("policy.testDone"));
  };

  const select = async (g: ProxyItem, node: string) => {
    if (!SELECTABLE.has(g.type)) {
      toast.info(t("policy.notSelectable"));
      return;
    }
    if (g.now === node && (g.type === "Selector" || g.fixed === node)) return;
    setProxies((p) =>
      p ? { ...p, [g.name]: { ...p[g.name], now: node, fixed: g.type !== "Selector" ? node : p[g.name].fixed } } : p,
    );
    try {
      await mihomo.selectProxy(g.name, node);
      if (pol.autoCloseOnSwitch) {
        const related = useLive.getState().connections.filter((c) => c.chains.includes(g.name));
        await Promise.allSettled(related.map((c) => mihomo.closeConnection(c.id)));
        if (related.length) toast.info(t("policy.closedConns", { n: related.length }));
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
    load();
  };

  const unfix = async (g: ProxyItem) => {
    try {
      await mihomo.unfixProxy(g.name);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    load();
  };

  const actions = (
    <>
      <ModeSwitch />
      <Tooltip content={t(anyOpen ? "policy.collapseAll" : "policy.expandAll")}>
        <IconButton
          icon={anyOpen ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
          onClick={toggleAll}
          disabled={!proxies}
        />
      </Tooltip>
      <Tooltip content={t("policy.testAll")}>
        <IconButton
          icon={<Zap size={16} className={batch ? "spin" : undefined} color={batch ? "var(--accent)" : undefined} />}
          onClick={testAll}
          disabled={!proxies}
        />
      </Tooltip>
      <Dropdown
        align="end"
        minWidth={210}
        items={() => [
          { header: t("policy.options") },
          {
            label: t("policy.hideTimeout"),
            checked: pol.hideTimeoutNodes,
            onClick: () => saveSettings({ policy: { hideTimeoutNodes: !pol.hideTimeoutNodes } }),
          },
          {
            label: t("policy.showHidden"),
            checked: pol.showHiddenGroups,
            onClick: () => saveSettings({ policy: { showHiddenGroups: !pol.showHiddenGroups } }),
          },
          {
            label: t("policy.autoClose"),
            checked: pol.autoCloseOnSwitch,
            onClick: () => saveSettings({ policy: { autoCloseOnSwitch: !pol.autoCloseOnSwitch } }),
          },
        ]}
      >
        {() => <IconButton icon={<Settings2 size={16} />} title={t("policy.options")} />}
      </Dropdown>
    </>
  );

  let body: React.ReactNode;
  if (!running) {
    body = <Empty icon={<Power size={34} strokeWidth={1.4} />} title={t("policy.coreDown")} desc={t("policy.coreDownDesc")} />;
  } else if (!proxies) {
    body = loadError ? (
      <Empty title={t("common.error")} desc={loadError} />
    ) : (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <Spinner size={20} />
      </div>
    );
  } else if (!groups.length) {
    body = <Empty icon={<Layers size={34} strokeWidth={1.4} />} title={t("policy.empty")} desc={t("policy.emptyDesc")} />;
  } else {
    body = (
      <div className="pl-root">
        {groups.map((g) => (
          <GroupCard
            key={g.name}
            group={g}
            proxies={proxies}
            open={isOpen(g.name)}
            onToggle={() => toggle(g.name)}
            testingNodes={testingNodes}
            testingGroup={testingGroups.has(g.name)}
            hideTimeout={pol.hideTimeoutNodes}
            testUrl={testUrlFor(g)}
            onSelect={(n) => select(g, n)}
            onTestNode={(n) => testNode(n, testUrlFor(g))}
            onTestGroup={() => testGroup(g)}
            onUnfix={() => unfix(g)}
          />
        ))}
        {providers.length > 0 && <div className="pl-section-title">{t("policy.providers")}</div>}
        {providers.map((p) => (
          <ProviderCard
            key={p.name}
            provider={p}
            open={isOpen(`provider:${p.name}`)}
            onToggle={() => toggle(`provider:${p.name}`)}
            testingNodes={testingNodes}
            testUrl={p.testUrl || testUrlDefault}
            onTestNode={(n) => testNode(n, p.testUrl || testUrlDefault)}
            onReload={load}
          />
        ))}
      </div>
    );
  }

  return (
    <Page title={t("nav.policy")} actions={actions}>
      {body}
    </Page>
  );
}

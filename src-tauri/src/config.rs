//! Runtime config generation: active profile YAML + rule override + mounted providers
//! + engine settings → mihomo `runtime.yaml`. Pure functions, unit-tested.

use serde_yaml::{Mapping, Value};

use crate::settings::{AppSettings, SnifferProto};
use crate::util::{AppError, Res};

/// A remote profile mounted into the active profile as a proxy-provider.
#[derive(Debug, Clone)]
pub struct MountedProvider {
    pub id: String,
    pub name: String,
    pub url: String,
}

pub struct GenInput<'a> {
    pub profile_yaml: Option<&'a str>,
    pub rule_override: Option<&'a [String]>,
    pub providers: &'a [MountedProvider],
    pub settings: &'a AppSettings,
    /// TUN can only be enabled when the process is elevated.
    pub tun_allowed: bool,
    /// Local port of the node speed-test listener (see speedtest.rs); None = leave it out.
    pub speedtest_port: Option<u16>,
}

const MINIMAL: &str = "proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n";

fn k(s: &str) -> Value {
    Value::String(s.to_string())
}
fn vs(v: &str) -> Value {
    Value::String(v.to_string())
}
fn seq(items: &[String]) -> Value {
    Value::Sequence(items.iter().filter(|s| !s.trim().is_empty()).map(|s| vs(s.trim())).collect())
}
fn set(m: &mut Mapping, key: &str, v: Value) {
    m.insert(k(key), v);
}
fn remove(m: &mut Mapping, key: &str) {
    m.remove(k(key));
}

/// Parse a profile into a YAML mapping (merge keys applied).
pub fn parse_profile(text: &str) -> Res<Mapping> {
    let mut v: Value = serde_yaml::from_str(text)?;
    v.apply_merge().ok();
    match v {
        Value::Mapping(m) => Ok(m),
        Value::Null => Ok(Mapping::new()),
        _ => Err(AppError::invalid_config("Profile is not a YAML mapping")),
    }
}

/// Port list string "80, 8080-8880" → YAML sequence (numbers stay numbers, ranges stay strings).
pub fn ports_seq(s: &str) -> Value {
    Value::Sequence(
        s.split(|c| c == ',' || c == ' ' || c == ';')
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
            .map(|p| match p.parse::<u64>() {
                Ok(n) => Value::Number(n.into()),
                Err(_) => vs(p),
            })
            .collect(),
    )
}

/// Rule lines of a profile mapping.
pub fn rules_of(m: &Mapping) -> Vec<String> {
    match m.get(k("rules")) {
        Some(Value::Sequence(s)) => s
            .iter()
            .filter_map(|r| match r {
                Value::String(s) => Some(s.clone()),
                other => serde_yaml::to_string(other).ok().map(|s| s.trim().to_string()),
            })
            .collect(),
        _ => vec![],
    }
}

/// Names of proxy groups declared in a config mapping.
pub fn group_names(m: &Mapping) -> Vec<String> {
    match m.get(k("proxy-groups")) {
        Some(Value::Sequence(gs)) => gs
            .iter()
            .filter_map(|g| g.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
            .collect(),
        _ => vec![],
    }
}

pub fn provider_key(id: &str) -> String {
    format!("cw-{id}")
}

pub fn generate(input: &GenInput) -> Res<Mapping> {
    let s = input.settings;
    let mut m = parse_profile(input.profile_yaml.unwrap_or(MINIMAL))?;

    // ---- rules (override replaces profile rules) ----
    let mut rules: Vec<String> = match input.rule_override {
        Some(r) => r.to_vec(),
        None => rules_of(&m),
    };
    if rules.is_empty() {
        rules.push("MATCH,DIRECT".into());
    }
    match s.engine.network.quic_block.as_str() {
        "all" => rules.insert(0, "AND,((NETWORK,UDP),(DST-PORT,443)),REJECT".into()),
        "overseas" => rules.insert(0, "AND,((NETWORK,UDP),(DST-PORT,443),(NOT,((GEOIP,CN)))),REJECT".into()),
        _ => {}
    }
    set(&mut m, "rules", Value::Sequence(rules.into_iter().map(Value::String).collect()));

    // ---- mounted providers ----
    if !input.providers.is_empty() {
        let mut pp = match m.remove(k("proxy-providers")) {
            Some(Value::Mapping(p)) => p,
            _ => Mapping::new(),
        };
        let mut names = vec![];
        for p in input.providers {
            let key = provider_key(&p.id);
            let mut hc = Mapping::new();
            set(&mut hc, "enable", Value::Bool(true));
            set(&mut hc, "url", vs(&s.delay_test_url));
            set(&mut hc, "interval", Value::Number(600.into()));
            let mut def = Mapping::new();
            set(&mut def, "type", vs("http"));
            set(&mut def, "url", vs(&p.url));
            set(&mut def, "path", vs(&format!("./providers/{}.yaml", p.id)));
            set(&mut def, "interval", Value::Number(86400.into()));
            set(&mut def, "health-check", Value::Mapping(hc));
            set(&mut def, "override", {
                let mut o = Mapping::new();
                set(&mut o, "additional-prefix", vs(&format!("[{}] ", p.name)));
                Value::Mapping(o)
            });
            pp.insert(vs(&key), Value::Mapping(def));
            names.push(key);
        }
        set(&mut m, "proxy-providers", Value::Mapping(pp));
        if let Some(Value::Sequence(groups)) = m.get_mut(k("proxy-groups")) {
            for g in groups.iter_mut() {
                let Some(gm) = g.as_mapping_mut() else { continue };
                let ty = gm.get(k("type")).and_then(|t| t.as_str()).unwrap_or("").to_lowercase();
                if !matches!(ty.as_str(), "select" | "url-test" | "fallback" | "load-balance" | "smart") {
                    continue;
                }
                let mut uses = match gm.remove(k("use")) {
                    Some(Value::Sequence(u)) => u,
                    _ => vec![],
                };
                for n in &names {
                    if !uses.iter().any(|u| u.as_str() == Some(n)) {
                        uses.push(vs(n));
                    }
                }
                gm.insert(k("use"), Value::Sequence(uses));
            }
        }
    }

    // ---- node speed test ----
    // A hidden select group holding every node, reached only through its own local
    // listener: testing a node switches this group, never the user's groups or rules.
    if let Some(port) = input.speedtest_port {
        let mut members = vec![vs("DIRECT")];
        if let Some(Value::Sequence(ps)) = m.get(k("proxies")) {
            for p in ps {
                if let Some(n) = p.get("name").and_then(|n| n.as_str()) {
                    if !members.iter().any(|x| x.as_str() == Some(n)) {
                        members.push(vs(n));
                    }
                }
            }
        }
        let uses: Vec<Value> = match m.get(k("proxy-providers")) {
            Some(Value::Mapping(pp)) => pp.keys().cloned().collect(),
            _ => vec![],
        };
        let mut g = Mapping::new();
        set(&mut g, "name", vs(crate::speedtest::GROUP));
        set(&mut g, "type", vs("select"));
        set(&mut g, "proxies", Value::Sequence(members));
        if !uses.is_empty() {
            set(&mut g, "use", Value::Sequence(uses));
        }
        set(&mut g, "hidden", Value::Bool(true));
        match m.get_mut(k("proxy-groups")) {
            Some(Value::Sequence(groups)) => groups.push(Value::Mapping(g)),
            _ => set(&mut m, "proxy-groups", Value::Sequence(vec![Value::Mapping(g)])),
        }
        let mut l = Mapping::new();
        set(&mut l, "name", vs(crate::speedtest::LISTENER));
        set(&mut l, "type", vs("http"));
        set(&mut l, "port", Value::Number(port.into()));
        set(&mut l, "listen", vs("127.0.0.1"));
        set(&mut l, "proxy", vs(crate::speedtest::GROUP));
        match m.get_mut(k("listeners")) {
            Some(Value::Sequence(ls)) => ls.push(Value::Mapping(l)),
            _ => set(&mut m, "listeners", Value::Sequence(vec![Value::Mapping(l)])),
        }
    }

    // ---- proxies: TFO / MPTCP ----
    let net = &s.engine.network;
    if net.tcp_fast_open || net.mptcp {
        if let Some(Value::Sequence(ps)) = m.get_mut(k("proxies")) {
            for p in ps.iter_mut() {
                if let Some(pm) = p.as_mapping_mut() {
                    if net.tcp_fast_open {
                        pm.insert(k("tfo"), Value::Bool(true));
                    }
                    if net.mptcp {
                        pm.insert(k("mptcp"), Value::Bool(true));
                    }
                }
            }
        }
    }

    // ---- inbound / network ----
    for key in ["redir-port", "tproxy-port", "external-controller-tls", "external-controller-unix", "external-controller-pipe"] {
        remove(&mut m, key);
    }
    set(&mut m, "mixed-port", Value::Number(net.mixed_port.into()));
    if net.http_port > 0 {
        set(&mut m, "port", Value::Number(net.http_port.into()));
    } else {
        remove(&mut m, "port");
    }
    if net.socks_port > 0 {
        set(&mut m, "socks-port", Value::Number(net.socks_port.into()));
    } else {
        remove(&mut m, "socks-port");
    }
    set(&mut m, "allow-lan", Value::Bool(net.allow_lan));
    set(&mut m, "bind-address", vs(if net.bind_address.trim().is_empty() { "*" } else { net.bind_address.trim() }));
    set(&mut m, "lan-allowed-ips", seq(&net.lan_allowed_ips));
    set(&mut m, "lan-disallowed-ips", seq(&net.lan_disallowed_ips));
    if net.authentication.iter().any(|a| !a.trim().is_empty()) {
        set(&mut m, "authentication", seq(&net.authentication));
    } else {
        remove(&mut m, "authentication");
    }
    set(&mut m, "skip-auth-prefixes", seq(&net.skip_auth_prefixes));
    set(&mut m, "ipv6", Value::Bool(net.ipv6));

    // ---- general ----
    let g = &s.engine.general;
    set(&mut m, "mode", vs(&s.outbound_mode));
    set(&mut m, "log-level", vs(&g.log_level));
    set(&mut m, "tcp-concurrent", Value::Bool(g.tcp_concurrent));
    set(&mut m, "unified-delay", Value::Bool(g.unified_delay));
    if g.interface_name.trim().is_empty() {
        remove(&mut m, "interface-name");
    } else {
        set(&mut m, "interface-name", vs(g.interface_name.trim()));
    }
    set(&mut m, "find-process-mode", vs(&g.find_process_mode));
    set(&mut m, "geodata-mode", Value::Bool(g.geodata_mode));
    set(&mut m, "geodata-loader", vs(&g.geodata_loader));
    set(&mut m, "geo-auto-update", Value::Bool(g.geo_auto_update));
    set(&mut m, "geo-update-interval", Value::Number(g.geo_update_interval.into()));
    let mut geox = Mapping::new();
    set(&mut geox, "geoip", vs(&g.geox_url.geoip));
    set(&mut geox, "geosite", vs(&g.geox_url.geosite));
    set(&mut geox, "mmdb", vs(&g.geox_url.mmdb));
    set(&mut geox, "asn", vs(&g.geox_url.asn));
    set(&mut m, "geox-url", Value::Mapping(geox));
    set(&mut m, "keep-alive-interval", Value::Number(g.keep_alive_interval.into()));
    let mut profile = Mapping::new();
    set(&mut profile, "store-selected", Value::Bool(g.store_selected));
    set(&mut profile, "store-fake-ip", Value::Bool(g.store_fake_ip));
    set(&mut m, "profile", Value::Mapping(profile));
    if g.quic_gso_disable {
        set(&mut m, "quic-go-disable-gso", Value::Bool(true));
        set(&mut m, "quic-go-disable-ecn", Value::Bool(true));
    } else {
        remove(&mut m, "quic-go-disable-gso");
        remove(&mut m, "quic-go-disable-ecn");
    }

    // ---- controller ----
    let host = if s.controller.host.trim().is_empty() { "127.0.0.1" } else { s.controller.host.trim() };
    let ctl = if host.contains(':') && !host.starts_with('[') {
        format!("[{}]:{}", host, s.controller.port)
    } else {
        format!("{}:{}", host, s.controller.port)
    };
    set(&mut m, "external-controller", vs(&ctl));
    set(&mut m, "secret", vs(&s.controller.secret));
    let mut cors = Mapping::new();
    set(&mut cors, "allow-origins", Value::Sequence(vec![vs("*")]));
    set(&mut cors, "allow-private-network", Value::Bool(true));
    set(&mut m, "external-controller-cors", Value::Mapping(cors));

    // ---- dns ----
    let d = &s.engine.dns;
    let mut dns = Mapping::new();
    set(&mut dns, "enable", Value::Bool(d.enable));
    if !d.listen.trim().is_empty() {
        set(&mut dns, "listen", vs(d.listen.trim()));
    }
    set(&mut dns, "ipv6", Value::Bool(d.ipv6));
    set(&mut dns, "enhanced-mode", vs(&d.enhanced_mode));
    if d.enhanced_mode == "fake-ip" {
        set(&mut dns, "fake-ip-range", vs(&d.fake_ip_range));
        set(&mut dns, "fake-ip-filter", seq(&d.fake_ip_filter));
    }
    set(&mut dns, "use-hosts", Value::Bool(d.use_hosts));
    set(&mut dns, "use-system-hosts", Value::Bool(d.use_system_hosts));
    set(&mut dns, "respect-rules", Value::Bool(d.respect_rules && !d.proxy_server_nameserver.is_empty()));
    set(&mut dns, "prefer-h3", Value::Bool(d.prefer_h3));
    set(&mut dns, "cache-algorithm", vs(&d.cache_algorithm));
    set(&mut dns, "default-nameserver", seq(&d.default_nameserver));
    set(&mut dns, "nameserver", seq(&d.nameserver));
    if !d.fallback.is_empty() {
        set(&mut dns, "fallback", seq(&d.fallback));
        let mut ff = Mapping::new();
        set(&mut ff, "geoip", Value::Bool(d.fallback_filter.geoip));
        set(&mut ff, "geoip-code", vs(&d.fallback_filter.geoip_code));
        set(&mut ff, "ipcidr", seq(&d.fallback_filter.ipcidr));
        set(&mut ff, "domain", seq(&d.fallback_filter.domain));
        set(&mut dns, "fallback-filter", Value::Mapping(ff));
    }
    if !d.nameserver_policy.is_empty() {
        let mut np = Mapping::new();
        for kv in &d.nameserver_policy {
            if kv.key.trim().is_empty() {
                continue;
            }
            let vals: Vec<String> = kv.value.split(|c| c == ',' || c == ';').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
            let v = if vals.len() == 1 { vs(&vals[0]) } else { seq(&vals) };
            np.insert(vs(kv.key.trim()), v);
        }
        set(&mut dns, "nameserver-policy", Value::Mapping(np));
    }
    if !d.proxy_server_nameserver.is_empty() {
        set(&mut dns, "proxy-server-nameserver", seq(&d.proxy_server_nameserver));
    }
    if !d.direct_nameserver.is_empty() {
        set(&mut dns, "direct-nameserver", seq(&d.direct_nameserver));
    }
    set(&mut m, "dns", Value::Mapping(dns));

    // ---- tun ----
    let t = &s.engine.tun;
    let mut tun = Mapping::new();
    set(&mut tun, "enable", Value::Bool(s.tun_mode && input.tun_allowed));
    set(&mut tun, "stack", vs(&t.stack));
    if !t.device.trim().is_empty() {
        set(&mut tun, "device", vs(t.device.trim()));
    }
    set(&mut tun, "auto-route", Value::Bool(t.auto_route));
    set(&mut tun, "strict-route", Value::Bool(t.strict_route));
    set(&mut tun, "auto-detect-interface", Value::Bool(t.auto_detect_interface));
    set(&mut tun, "dns-hijack", seq(&t.dns_hijack));
    set(&mut tun, "mtu", Value::Number(t.mtu.into()));
    set(&mut tun, "endpoint-independent-nat", Value::Bool(t.endpoint_independent_nat));
    if !t.exclude_interface.is_empty() {
        set(&mut tun, "exclude-interface", seq(&t.exclude_interface));
    }
    if !t.route_include_address.is_empty() {
        set(&mut tun, "route-include-address", seq(&t.route_include_address));
    }
    if !t.route_exclude_address.is_empty() {
        set(&mut tun, "route-exclude-address", seq(&t.route_exclude_address));
    }
    if !t.exclude_ports.is_empty() {
        // Ports excluded from the TUN route are expressed as direct rules (sing-tun has no
        // stable Windows port-exclusion option), so traffic like SSH keeps working.
        let mut rules = rules_of(&m);
        for p in t.exclude_ports.iter().rev() {
            let p = p.trim();
            if !p.is_empty() {
                rules.insert(0, format!("DST-PORT,{p},DIRECT"));
            }
        }
        set(&mut m, "rules", Value::Sequence(rules.into_iter().map(Value::String).collect()));
    }
    set(&mut m, "tun", Value::Mapping(tun));

    // ---- sniffer ----
    let sn = &s.engine.sniffer;
    let mut sniffer = Mapping::new();
    set(&mut sniffer, "enable", Value::Bool(sn.enable));
    set(&mut sniffer, "override-destination", Value::Bool(sn.override_destination));
    set(&mut sniffer, "force-dns-mapping", Value::Bool(sn.force_dns_mapping));
    set(&mut sniffer, "parse-pure-ip", Value::Bool(sn.parse_pure_ip));
    let mut sniff = Mapping::new();
    let proto = |p: &SnifferProto| {
        let mut pm = Mapping::new();
        set(&mut pm, "ports", ports_seq(&p.ports));
        set(&mut pm, "override-destination", Value::Bool(p.override_dest));
        Value::Mapping(pm)
    };
    if sn.http.enable {
        set(&mut sniff, "HTTP", proto(&sn.http));
    }
    if sn.tls.enable {
        set(&mut sniff, "TLS", proto(&sn.tls));
    }
    if sn.quic.enable {
        set(&mut sniff, "QUIC", proto(&sn.quic));
    }
    set(&mut sniffer, "sniff", Value::Mapping(sniff));
    if !sn.skip_domain.is_empty() {
        set(&mut sniffer, "skip-domain", seq(&sn.skip_domain));
    }
    if !sn.force_domain.is_empty() {
        set(&mut sniffer, "force-domain", seq(&sn.force_domain));
    }
    if !sn.skip_src_address.is_empty() {
        set(&mut sniffer, "skip-src-address", seq(&sn.skip_src_address));
    }
    if !sn.skip_dst_address.is_empty() {
        set(&mut sniffer, "skip-dst-address", seq(&sn.skip_dst_address));
    }
    set(&mut m, "sniffer", Value::Mapping(sniffer));

    Ok(m)
}

pub fn to_yaml(m: &Mapping) -> Res<String> {
    Ok(serde_yaml::to_string(m)?)
}

/// Light validation used when no core binary is available: must parse and look like a Clash config.
pub fn validate_profile_text(text: &str) -> Res<Mapping> {
    let t = text.trim_start();
    if t.starts_with('<') {
        return Err(AppError::invalid_config("Received HTML instead of a YAML config"));
    }
    let m = parse_profile(text)?;
    let has = |key: &str| m.contains_key(k(key));
    if !(has("proxies") || has("proxy-providers") || has("proxy-groups") || has("rules")) {
        return Err(AppError::invalid_config(
            "Not a Clash/mihomo config (no proxies, proxy-providers, proxy-groups or rules)",
        ));
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROFILE: &str = r#"
mixed-port: 1234
redir-port: 7892
external-controller: 0.0.0.0:9090
secret: old
proxies:
  - { name: HK, type: ss, server: 1.2.3.4, port: 443, cipher: aes-128-gcm, password: x }
proxy-groups:
  - name: Proxy
    type: select
    proxies: [HK, DIRECT]
  - name: Relay
    type: relay
    proxies: [HK]
rules:
  - DOMAIN-SUFFIX,google.com,Proxy
  - MATCH,DIRECT
"#;

    fn gen(settings: &AppSettings, rules: Option<&[String]>, providers: &[MountedProvider], tun_allowed: bool) -> Mapping {
        generate(&GenInput { profile_yaml: Some(PROFILE), rule_override: rules, providers, settings, tun_allowed, speedtest_port: None }).unwrap()
    }

    #[test]
    fn overlays_engine_settings() {
        let mut s = AppSettings::default();
        s.controller.secret = "abc".into();
        s.outbound_mode = "global".into();
        let m = gen(&s, None, &[], false);
        assert_eq!(m["mixed-port"], Value::Number(7890.into()));
        assert!(m.get("redir-port").is_none());
        assert_eq!(m["external-controller"], vs("127.0.0.1:9097"));
        assert_eq!(m["secret"], vs("abc"));
        assert_eq!(m["mode"], vs("global"));
        assert_eq!(m["dns"]["enhanced-mode"], vs("fake-ip"));
        assert_eq!(m["sniffer"]["sniff"]["HTTP"]["ports"][1], vs("8080-8880"));
        assert_eq!(m["sniffer"]["sniff"]["HTTP"]["ports"][0], Value::Number(80.into()));
        assert_eq!(m["profile"]["store-selected"], Value::Bool(true));
        assert_eq!(rules_of(&m), vec!["DOMAIN-SUFFIX,google.com,Proxy".to_string(), "MATCH,DIRECT".to_string()]);
    }

    #[test]
    fn tun_requires_elevation() {
        let mut s = AppSettings::default();
        s.tun_mode = true;
        assert_eq!(gen(&s, None, &[], false)["tun"]["enable"], Value::Bool(false));
        assert_eq!(gen(&s, None, &[], true)["tun"]["enable"], Value::Bool(true));
        assert_eq!(gen(&s, None, &[], true)["tun"]["stack"], vs("mixed"));
    }

    #[test]
    fn rule_override_and_quic_block() {
        let mut s = AppSettings::default();
        s.engine.network.quic_block = "overseas".into();
        let ov = vec!["DOMAIN,a.com,DIRECT".to_string(), "MATCH,Proxy".to_string()];
        let m = gen(&s, Some(&ov), &[], false);
        let r = rules_of(&m);
        assert_eq!(r.len(), 3);
        assert!(r[0].starts_with("AND,((NETWORK,UDP),(DST-PORT,443),(NOT,((GEOIP,CN))))"));
        assert_eq!(r[1], "DOMAIN,a.com,DIRECT");
    }

    #[test]
    fn mounts_providers_into_select_groups() {
        let s = AppSettings::default();
        let p = vec![MountedProvider { id: "p2".into(), name: "Backup".into(), url: "https://x/sub".into() }];
        let m = gen(&s, None, &p, false);
        assert_eq!(m["proxy-providers"]["cw-p2"]["type"], vs("http"));
        assert_eq!(m["proxy-providers"]["cw-p2"]["path"], vs("./providers/p2.yaml"));
        let groups = m["proxy-groups"].as_sequence().unwrap();
        assert_eq!(groups[0]["use"][0], vs("cw-p2"));
        assert!(groups[1].get("use").is_none(), "relay groups untouched");
    }

    #[test]
    fn tfo_applies_to_proxies() {
        let mut s = AppSettings::default();
        s.engine.network.tcp_fast_open = true;
        let m = gen(&s, None, &[], false);
        assert_eq!(m["proxies"][0]["tfo"], Value::Bool(true));
    }

    #[test]
    fn minimal_when_no_profile() {
        let s = AppSettings::default();
        let m = generate(&GenInput { profile_yaml: None, rule_override: None, providers: &[], settings: &s, tun_allowed: false, speedtest_port: None }).unwrap();
        assert_eq!(rules_of(&m), vec!["MATCH,DIRECT".to_string()]);
        assert!(to_yaml(&m).unwrap().contains("external-controller"));
    }

    #[test]
    fn validation() {
        assert!(validate_profile_text("<html></html>").is_err());
        assert!(validate_profile_text("foo: bar").is_err());
        assert!(validate_profile_text("proxies: []").is_ok());
        assert!(validate_profile_text("dm1lc3M6Ly9hYmM=").is_err());
    }

    #[test]
    fn merge_keys_applied() {
        let y = "base: &b {type: ss, port: 1}\nproxies:\n  - <<: *b\n    name: a\n";
        let m = parse_profile(y).unwrap();
        assert_eq!(m["proxies"][0]["type"], vs("ss"));
    }

    #[test]
    fn speedtest_group_and_listener() {
        let s = AppSettings::default();
        let providers = vec![MountedProvider { id: "p2".into(), name: "Backup".into(), url: "https://sub.example/x".into() }];
        let m = generate(&GenInput {
            profile_yaml: Some(PROFILE),
            rule_override: None,
            providers: &providers,
            settings: &s,
            tun_allowed: false,
            speedtest_port: Some(27890),
        })
        .unwrap();
        let groups = m["proxy-groups"].as_sequence().unwrap();
        let g = groups.iter().find(|g| g["name"] == vs(crate::speedtest::GROUP)).expect("speed-test group");
        assert_eq!(g["type"], vs("select"));
        assert_eq!(g["hidden"], Value::Bool(true));
        let members: Vec<&str> = g["proxies"].as_sequence().unwrap().iter().filter_map(|v| v.as_str()).collect();
        assert_eq!(members[0], "DIRECT");
        let profile_proxies: Vec<String> = m["proxies"].as_sequence().unwrap().iter().filter_map(|p| p["name"].as_str().map(String::from)).collect();
        assert!(!profile_proxies.is_empty());
        for n in &profile_proxies {
            assert!(members.contains(&n.as_str()), "{n} missing from the speed-test group");
        }
        assert!(g["use"].as_sequence().unwrap().iter().any(|u| u.as_str() == Some("cw-p2")));
        let l = &m["listeners"].as_sequence().unwrap()[0];
        assert_eq!(l["name"], vs(crate::speedtest::LISTENER));
        assert_eq!(l["port"], Value::Number(27890.into()));
        assert_eq!(l["listen"], vs("127.0.0.1"));
        assert_eq!(l["proxy"], vs(crate::speedtest::GROUP));
        // no port, no extras
        let plain = gen(&s, None, &[], false);
        assert!(plain.get("listeners").is_none());
        assert!(!plain["proxy-groups"].as_sequence().unwrap().iter().any(|g| g["name"] == vs(crate::speedtest::GROUP)));
    }
}

#[cfg(test)]
mod print {
    #[test]
    #[ignore]
    fn print_runtime() {
        let mut s = crate::settings::AppSettings::default();
        s.controller.secret = "s3cret".into();
        s.tun_mode = true;
        let m = super::generate(&super::GenInput { profile_yaml: Some("proxies:\n  - {name: HK, type: ss, server: a, port: 1, cipher: aes-128-gcm, password: x}\nproxy-groups:\n  - {name: Proxy, type: select, proxies: [HK]}\nrules:\n  - MATCH,Proxy\n"), rule_override: None, providers: &[], settings: &s, tun_allowed: true, speedtest_port: None }).unwrap();
        println!("{}", super::to_yaml(&m).unwrap());
    }
}

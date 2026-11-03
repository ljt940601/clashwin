//! App settings. Mirrors `src/lib/types.ts` (AppSettings) and `src/lib/defaults.ts` exactly.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use crate::util::{json_merge, random_hex, write_atomic, Res};

fn s(v: &str) -> String {
    v.to_string()
}
fn sv(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeoxUrl {
    pub geoip: String,
    pub geosite: String,
    pub mmdb: String,
    pub asn: String,
}
impl Default for GeoxUrl {
    fn default() -> Self {
        Self {
            geoip: s("https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat"),
            geosite: s("https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat"),
            mmdb: s("https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb"),
            asn: s("https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/GeoLite2-ASN.mmdb"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineGeneral {
    pub log_level: String,
    pub tcp_concurrent: bool,
    pub unified_delay: bool,
    pub interface_name: String,
    pub find_process_mode: String,
    pub geodata_mode: bool,
    pub geodata_loader: String,
    pub geo_auto_update: bool,
    pub geo_update_interval: u32,
    pub geox_url: GeoxUrl,
    pub smart_model: String,
    pub store_selected: bool,
    pub store_fake_ip: bool,
    pub quic_gso_disable: bool,
    pub dialer_ip4p_convert: bool,
    pub keep_alive_interval: u32,
}
impl Default for EngineGeneral {
    fn default() -> Self {
        Self {
            log_level: s("info"),
            tcp_concurrent: true,
            unified_delay: true,
            interface_name: String::new(),
            find_process_mode: s("always"),
            geodata_mode: false,
            geodata_loader: s("memconservative"),
            geo_auto_update: true,
            geo_update_interval: 24,
            geox_url: GeoxUrl::default(),
            smart_model: s("standard"),
            store_selected: true,
            store_fake_ip: true,
            quic_gso_disable: false,
            dialer_ip4p_convert: false,
            keep_alive_interval: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineNetwork {
    pub mixed_port: u16,
    pub http_port: u16,
    pub socks_port: u16,
    pub ipv6: bool,
    pub tcp_fast_open: bool,
    pub mptcp: bool,
    pub quic_block: String,
    pub allow_lan: bool,
    pub bind_address: String,
    pub lan_allowed_ips: Vec<String>,
    pub lan_disallowed_ips: Vec<String>,
    pub authentication: Vec<String>,
    pub skip_auth_prefixes: Vec<String>,
    pub bypass: Vec<String>,
}
impl Default for EngineNetwork {
    fn default() -> Self {
        Self {
            mixed_port: 7890,
            http_port: 0,
            socks_port: 0,
            ipv6: false,
            tcp_fast_open: false,
            mptcp: false,
            quic_block: s("off"),
            allow_lan: false,
            bind_address: s("*"),
            lan_allowed_ips: sv(&["0.0.0.0/0", "::/0"]),
            lan_disallowed_ips: vec![],
            authentication: vec![],
            skip_auth_prefixes: sv(&["127.0.0.1/8", "::1/128"]),
            bypass: sv(&[
                "localhost", "127.*", "10.*", "172.16.*", "172.17.*", "172.18.*", "172.19.*", "172.2*", "172.30.*", "172.31.*",
                "192.168.*", "<local>",
            ]),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FallbackFilter {
    pub geoip: bool,
    pub geoip_code: String,
    pub ipcidr: Vec<String>,
    pub domain: Vec<String>,
}
impl Default for FallbackFilter {
    fn default() -> Self {
        Self { geoip: true, geoip_code: s("CN"), ipcidr: sv(&["240.0.0.0/4"]), domain: vec![] }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineDns {
    pub enable: bool,
    pub listen: String,
    pub enhanced_mode: String,
    pub fake_ip_range: String,
    pub fake_ip_filter: Vec<String>,
    pub default_nameserver: Vec<String>,
    pub nameserver: Vec<String>,
    pub fallback: Vec<String>,
    pub fallback_filter: FallbackFilter,
    pub nameserver_policy: Vec<KeyValue>,
    pub proxy_server_nameserver: Vec<String>,
    pub direct_nameserver: Vec<String>,
    pub use_hosts: bool,
    pub use_system_hosts: bool,
    pub respect_rules: bool,
    pub prefer_h3: bool,
    pub ipv6: bool,
    pub cache_algorithm: String,
}
impl Default for EngineDns {
    fn default() -> Self {
        Self {
            enable: true,
            listen: s("0.0.0.0:1053"),
            enhanced_mode: s("fake-ip"),
            fake_ip_range: s("198.18.0.1/16"),
            fake_ip_filter: sv(&[
                "*.lan",
                "*.local",
                "+.msftconnecttest.com",
                "+.msftncsi.com",
                "localhost.ptlogin2.qq.com",
                "+.stun.*.*",
                "+.stun.*.*.*",
            ]),
            default_nameserver: sv(&["223.5.5.5", "119.29.29.29"]),
            nameserver: sv(&["https://doh.pub/dns-query", "https://dns.alidns.com/dns-query"]),
            fallback: vec![],
            fallback_filter: FallbackFilter::default(),
            nameserver_policy: vec![],
            proxy_server_nameserver: sv(&["https://doh.pub/dns-query", "https://dns.alidns.com/dns-query"]),
            direct_nameserver: vec![],
            use_hosts: true,
            use_system_hosts: true,
            respect_rules: false,
            prefer_h3: false,
            ipv6: false,
            cache_algorithm: s("arc"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineTun {
    pub stack: String,
    pub device: String,
    pub auto_route: bool,
    pub strict_route: bool,
    pub auto_detect_interface: bool,
    pub dns_hijack: Vec<String>,
    pub mtu: u32,
    pub endpoint_independent_nat: bool,
    pub exclude_interface: Vec<String>,
    pub exclude_ports: Vec<String>,
    pub route_include_address: Vec<String>,
    pub route_exclude_address: Vec<String>,
}
impl Default for EngineTun {
    fn default() -> Self {
        Self {
            stack: s("mixed"),
            device: s("ClashWin"),
            auto_route: true,
            strict_route: false,
            auto_detect_interface: true,
            dns_hijack: sv(&["any:53", "tcp://any:53"]),
            mtu: 1500,
            endpoint_independent_nat: false,
            exclude_interface: vec![],
            exclude_ports: vec![],
            route_include_address: vec![],
            route_exclude_address: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SnifferProto {
    pub enable: bool,
    pub ports: String,
    #[serde(rename = "override")]
    pub override_dest: bool,
}
impl Default for SnifferProto {
    fn default() -> Self {
        Self { enable: true, ports: s("443"), override_dest: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineSniffer {
    pub enable: bool,
    pub override_destination: bool,
    pub force_dns_mapping: bool,
    pub parse_pure_ip: bool,
    pub http: SnifferProto,
    pub tls: SnifferProto,
    pub quic: SnifferProto,
    pub skip_domain: Vec<String>,
    pub force_domain: Vec<String>,
    pub skip_src_address: Vec<String>,
    pub skip_dst_address: Vec<String>,
}
impl Default for EngineSniffer {
    fn default() -> Self {
        Self {
            enable: true,
            override_destination: false,
            force_dns_mapping: true,
            parse_pure_ip: true,
            http: SnifferProto { enable: true, ports: s("80, 8080-8880"), override_dest: true },
            tls: SnifferProto { enable: true, ports: s("443, 8443"), override_dest: false },
            quic: SnifferProto { enable: true, ports: s("443, 8443"), override_dest: false },
            skip_domain: sv(&["Mijia Cloud", "+.push.apple.com", "+.apple.com"]),
            force_domain: vec![],
            skip_src_address: vec![],
            skip_dst_address: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineSettings {
    pub general: EngineGeneral,
    pub network: EngineNetwork,
    pub dns: EngineDns,
    pub tun: EngineTun,
    pub sniffer: EngineSniffer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MenuCards {
    pub browser_rule: bool,
    pub traffic_wave: bool,
    pub perf_grid: bool,
    pub subscription: bool,
    pub copy_shell: bool,
}
impl Default for MenuCards {
    fn default() -> Self {
        Self { browser_rule: false, traffic_wave: true, perf_grid: true, subscription: true, copy_shell: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WifiBypass {
    pub enabled: bool,
    pub ssids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Controller {
    pub host: String,
    pub port: u16,
    pub secret: String,
}
impl Default for Controller {
    fn default() -> Self {
        Self { host: s("127.0.0.1"), port: 9097, secret: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PolicySettings {
    pub hide_timeout_nodes: bool,
    pub show_hidden_groups: bool,
    pub auto_close_on_switch: bool,
    pub collapsed: HashMap<String, bool>,
}
impl Default for PolicySettings {
    fn default() -> Self {
        Self { hide_timeout_nodes: false, show_hidden_groups: false, auto_close_on_switch: true, collapsed: HashMap::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub language: String,
    pub theme: String,
    pub tray_mode: String,
    pub launch_at_login: bool,
    pub silent_start: bool,
    pub menu_cards: MenuCards,
    pub shell_export_style: String,
    pub wifi_bypass: WifiBypass,
    pub controller: Controller,
    pub core_channel: String,
    pub auto_check_update: bool,
    pub include_beta: bool,
    pub history_retention_days: u32,
    pub system_proxy: bool,
    pub tun_mode: bool,
    pub outbound_mode: String,
    pub active_profile_id: Option<String>,
    pub policy: PolicySettings,
    pub delay_test_url: String,
    pub delay_timeout: u32,
    pub sidebar_collapsed: bool,
    pub engine: EngineSettings,
}
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: s("system"),
            theme: s("system"),
            tray_mode: s("icon_speed"),
            launch_at_login: false,
            silent_start: false,
            menu_cards: MenuCards::default(),
            shell_export_style: s("powershell"),
            wifi_bypass: WifiBypass::default(),
            controller: Controller::default(),
            core_channel: s("stable"),
            auto_check_update: true,
            include_beta: false,
            history_retention_days: 90,
            system_proxy: false,
            tun_mode: false,
            outbound_mode: s("rule"),
            active_profile_id: None,
            policy: PolicySettings::default(),
            delay_test_url: s("https://www.gstatic.com/generate_204"),
            delay_timeout: 5000,
            sidebar_collapsed: false,
            engine: EngineSettings::default(),
        }
    }
}

impl AppSettings {
    /// Load from disk (missing fields take defaults). Generates a controller secret on first run.
    pub fn load(path: &Path) -> AppSettings {
        let mut s: AppSettings = std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).map_err(|e| log::warn!("settings.json invalid: {e}")).ok())
            .unwrap_or_default();
        if s.controller.secret.is_empty() {
            s.controller.secret = random_hex(24);
        }
        if s.controller.port == 0 {
            s.controller.port = 9097;
        }
        if s.controller.host.trim().is_empty() {
            s.controller.host = "127.0.0.1".into();
        }
        s
    }

    pub fn save(&self, path: &Path) -> Res<()> {
        write_atomic(path, &serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }

    /// Deep-merge a JSON patch into these settings.
    pub fn merged(&self, patch: &serde_json::Value) -> Res<AppSettings> {
        let mut v = serde_json::to_value(self)?;
        json_merge(&mut v, patch);
        let mut out: AppSettings = serde_json::from_value(v)?;
        // policy.collapsed is a map: merge rather than replace is already handled by json_merge
        if out.controller.secret.is_empty() {
            out.controller.secret = self.controller.secret.clone();
        }
        Ok(out)
    }

    /// Reset one engine section to defaults.
    pub fn reset_engine_section(&mut self, section: &str) {
        let d = EngineSettings::default();
        match section {
            "general" => self.engine.general = d.general,
            "network" => self.engine.network = d.network,
            "dns" => self.engine.dns = d.dns,
            "tun" => self.engine.tun = d.tun,
            "sniffer" => self.engine.sniffer = d.sniffer,
            _ => {}
        }
    }

    /// Controller base URL usable by local clients.
    pub fn controller_url(&self) -> String {
        let host = match self.controller.host.as_str() {
            "" | "0.0.0.0" | "*" | "::" => "127.0.0.1",
            h => h,
        };
        if host.contains(':') && !host.starts_with('[') {
            format!("http://[{}]:{}", host, self.controller.port)
        } else {
            format!("http://{}:{}", host, self.controller.port)
        }
    }

    pub fn is_zh(&self) -> bool {
        crate::util::ui_is_zh(&self.language)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_roundtrip_camel_case() {
        let v = serde_json::to_value(AppSettings::default()).unwrap();
        assert_eq!(v["trayMode"], "icon_speed");
        assert_eq!(v["engine"]["network"]["mixedPort"], 7890);
        assert_eq!(v["engine"]["sniffer"]["http"]["override"], true);
        assert_eq!(v["engine"]["dns"]["fallbackFilter"]["geoipCode"], "CN");
        assert_eq!(v["menuCards"]["copyShell"], true);
        assert_eq!(v["activeProfileId"], serde_json::Value::Null);
        let back: AppSettings = serde_json::from_value(v).unwrap();
        assert_eq!(back, AppSettings::default());
    }

    #[test]
    fn partial_json_fills_defaults() {
        let s: AppSettings = serde_json::from_str(r#"{"theme":"dark","engine":{"tun":{"stack":"gvisor"}}}"#).unwrap();
        assert_eq!(s.theme, "dark");
        assert_eq!(s.engine.tun.stack, "gvisor");
        assert_eq!(s.engine.tun.mtu, 1500);
        assert_eq!(s.engine.dns.enhanced_mode, "fake-ip");
    }

    #[test]
    fn merge_patch() {
        let s = AppSettings::default();
        let m = s
            .merged(&serde_json::json!({"policy": {"collapsed": {"Proxy": true}}, "engine": {"network": {"allowLan": true}}}))
            .unwrap();
        assert!(m.engine.network.allow_lan);
        assert_eq!(m.engine.network.mixed_port, 7890);
        assert_eq!(m.policy.collapsed.get("Proxy"), Some(&true));
        assert!(m.policy.auto_close_on_switch);
    }
}

#[cfg(test)]
mod dump {
    #[test]
    #[ignore]
    fn dump_defaults() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("rust-defaults.json");
        std::fs::write(p, serde_json::to_string(&super::AppSettings::default()).unwrap()).unwrap();
    }
}

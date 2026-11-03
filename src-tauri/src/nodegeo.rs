//! Node region by server address.
//!
//! Many node names carry no country hint ("车位4 vless-4"). For those we read the node's
//! `server` from the runtime config and the proxy-provider caches, resolve it through the
//! core's own DNS (so another proxy's fake-ip TUN can't hand us 198.18.x addresses), and
//! look the IP up in the GeoIP database.

use base64::Engine;
use futures_util::{stream, StreamExt};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use crate::geo::detect_country;
use crate::state::AppState;

/// node name -> ISO country, for nodes whose name has no country hint
static NODE_CC: Lazy<RwLock<HashMap<String, String>>> = Lazy::new(Default::default);
/// server host -> country (None = looked up, unknown); avoids repeat DNS queries
static SERVER_CC: Lazy<RwLock<HashMap<String, Option<String>>>> = Lazy::new(Default::default);

/// Country resolved from the node's server address, if known.
pub fn get(name: &str) -> Option<String> {
    NODE_CC.read().get(name).cloned()
}

/// Snapshot of all server-based results.
pub fn snapshot() -> HashMap<String, String> {
    NODE_CC.read().clone()
}

/// Resolve every node that the name heuristics can't place. Cheap when cached.
pub async fn refresh(st: &AppState) -> HashMap<String, String> {
    let home = st.paths.home.clone();
    let nodes = tokio::task::spawn_blocking(move || collect_nodes(&home)).await.unwrap_or_default();
    st.geo.refresh();

    let pending: Vec<(String, String)> = nodes.into_iter().filter(|(name, _)| detect_country(name).is_none()).collect();
    let ctl = st.controller_info();
    let running = st.core.is_running();

    let results: Vec<(String, Option<String>)> = stream::iter(pending)
        .map(|(name, server)| {
            let ctl = ctl.clone();
            async move {
                let cached = SERVER_CC.read().get(&server).cloned();
                let cc = match cached {
                    Some(c) => c,
                    None => {
                        let ip = resolve(&ctl, &server, running).await;
                        let c = ip.and_then(|ip| st.geo.lookup(&ip.to_string()));
                        // Only remember failures when the core could answer; otherwise retry later.
                        if c.is_some() || running {
                            SERVER_CC.write().insert(server.clone(), c.clone());
                        }
                        c
                    }
                };
                (name, cc)
            }
        })
        .buffer_unordered(8)
        .collect()
        .await;

    let mut map = NODE_CC.write();
    for (name, cc) in results {
        match cc {
            Some(c) => {
                map.insert(name, c);
            }
            None => {
                map.remove(&name);
            }
        }
    }
    map.clone()
}

/// Forget cached server lookups (e.g. after the GeoIP database changed).
pub fn clear_cache() {
    SERVER_CC.write().clear();
}

async fn resolve(ctl: &crate::core::ControllerInfo, server: &str, core_running: bool) -> Option<IpAddr> {
    let host = server.trim().trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Some(ip);
    }
    if !core_running {
        return None;
    }
    for qtype in ["A", "AAAA"] {
        let path = format!("/dns/query?name={}&type={qtype}", percent_encoding::utf8_percent_encode(host, percent_encoding::NON_ALPHANUMERIC));
        let Ok(v) = crate::core::api(ctl, reqwest::Method::GET, &path, None).await else { continue };
        if let Some(answers) = v.get("Answer").and_then(|a| a.as_array()) {
            for a in answers {
                if let Some(ip) = a.get("data").and_then(|d| d.as_str()).and_then(|d| d.parse::<IpAddr>().ok()) {
                    if !crate::geo::is_private(&ip) {
                        return Some(ip);
                    }
                }
            }
        }
    }
    None
}

/* ---------------- Collect (name, server) pairs ---------------- */

/// Nodes from runtime.yaml plus every cached proxy-provider file under the core home.
/// Provider names get the provider's `override` (proxy-name rules, prefix, suffix) applied
/// so they match the names the core reports.
pub fn collect_nodes(home: &Path) -> Vec<(String, String)> {
    let mut out: HashMap<String, String> = HashMap::new();
    let mut seen_files: Vec<PathBuf> = vec![];

    if let Some(runtime) = std::fs::read_to_string(home.join("runtime.yaml")).ok().and_then(|t| serde_yaml::from_str::<serde_yaml::Value>(&t).ok()) {
        if let Some(provs) = runtime.get("proxy-providers").and_then(|p| p.as_mapping()) {
            for (_, cfg) in provs {
                let Some(path) = cfg.get("path").and_then(|p| p.as_str()) else { continue };
                let file = home.join(path.trim_start_matches("./"));
                let Ok(text) = std::fs::read_to_string(&file) else { continue };
                let ov = Override::from(cfg.get("override"));
                for (name, server) in parse_nodes(&text) {
                    out.entry(ov.apply(&name)).or_insert(server);
                }
                seen_files.push(file);
            }
        }
    }

    let mut files: Vec<PathBuf> = vec![home.join("runtime.yaml")];
    for dir in ["proxy_providers", "providers", "proxies"] {
        collect_files(&home.join(dir), &mut files, 0);
    }
    files.retain(|f| !seen_files.iter().any(|s| same_file(s, f)));
    for f in files {
        let Ok(bytes) = std::fs::read(&f) else { continue };
        // Provider caches can be large but are bounded by the subscription size; skip anything absurd.
        if bytes.len() > 32 * 1024 * 1024 {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (name, server) in parse_nodes(&text) {
            out.entry(name).or_insert(server);
        }
    }
    out.into_iter().collect()
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// proxy-provider `override` naming rules, applied in mihomo's order:
/// proxy-name replacements, then additional-prefix / additional-suffix.
#[derive(Default)]
struct Override {
    rules: Vec<(regex::Regex, String)>,
    prefix: String,
    suffix: String,
}

impl Override {
    fn from(v: Option<&serde_yaml::Value>) -> Self {
        let Some(v) = v else { return Self::default() };
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let rules = v
            .get("proxy-name")
            .and_then(|x| x.as_sequence())
            .map(|list| {
                list.iter()
                    .filter_map(|r| {
                        let re = regex::Regex::new(r.get("pattern")?.as_str()?).ok()?;
                        let target = r.get("target").and_then(|t| t.as_str()).unwrap_or("").to_string();
                        Some((re, target))
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self { rules, prefix: s("additional-prefix"), suffix: s("additional-suffix") }
    }

    fn apply(&self, name: &str) -> String {
        let mut n = name.to_string();
        for (re, target) in &self.rules {
            n = re.replace_all(&n, target.as_str()).into_owned();
        }
        format!("{}{}{}", self.prefix, n, self.suffix)
    }
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > 3 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_files(&p, out, depth + 1);
        } else {
            out.push(p);
        }
    }
}

/// Parse a Clash YAML (`proxies:` list), a plain share-link list, or a base64 share-link list.
pub fn parse_nodes(text: &str) -> Vec<(String, String)> {
    if let Ok(v) = serde_yaml::from_str::<serde_yaml::Value>(text) {
        if let Some(list) = v.get("proxies").and_then(|p| p.as_sequence()) {
            return list
                .iter()
                .filter_map(|p| {
                    let name = p.get("name")?.as_str()?.to_string();
                    let server = p.get("server")?.as_str()?.to_string();
                    Some((name, server))
                })
                .collect();
        }
    }
    let links = if text.contains("://") {
        text.to_string()
    } else {
        let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        match b64(&compact) {
            Some(s) => s,
            None => return vec![],
        }
    };
    links.lines().filter_map(|l| parse_link(l.trim())).collect()
}

fn b64(s: &str) -> Option<String> {
    use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
    for eng in [&STANDARD, &STANDARD_NO_PAD, &URL_SAFE, &URL_SAFE_NO_PAD] {
        if let Ok(b) = eng.decode(s.trim_end_matches('=').to_string() + &"=".repeat((4 - s.trim_end_matches('=').len() % 4) % 4)) {
            if let Ok(t) = String::from_utf8(b) {
                return Some(t);
            }
        }
        if let Ok(b) = eng.decode(s) {
            if let Ok(t) = String::from_utf8(b) {
                return Some(t);
            }
        }
    }
    None
}

fn pct_decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned()
}

/// One share link -> (name, server).
pub fn parse_link(line: &str) -> Option<(String, String)> {
    let (scheme, rest) = line.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme == "vmess" {
        let json = b64(rest.split('#').next()?)?;
        let v: serde_json::Value = serde_json::from_str(&json).ok()?;
        let name = v.get("ps")?.as_str()?.to_string();
        let server = v.get("add")?.as_str()?.to_string();
        return Some((name, server));
    }
    let (body, frag) = match rest.split_once('#') {
        Some((b, f)) => (b, pct_decode(f)),
        None => (rest, String::new()),
    };
    if frag.is_empty() {
        return None;
    }
    if scheme == "ss" && !body.contains('@') {
        // ss://base64(method:pass@host:port)
        let decoded = b64(body.split('?').next()?)?;
        let hostport = decoded.rsplit_once('@')?.1;
        return Some((frag, host_of(hostport)?));
    }
    let after_at = body.rsplit_once('@').map(|(_, h)| h).unwrap_or(body);
    let hostport = after_at.split(['/', '?']).next()?;
    Some((frag, host_of(hostport)?))
}

fn host_of(hostport: &str) -> Option<String> {
    let h = if let Some(rest) = hostport.strip_prefix('[') {
        rest.split(']').next()?
    } else {
        hostport.rsplit_once(':').map(|(h, _)| h).unwrap_or(hostport)
    };
    (!h.is_empty()).then(|| h.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clash_yaml() {
        let y = "proxies:\n  - {name: 车位4 vless-4, type: vless, server: a.example.com, port: 443}\n  - name: HK\n    type: ss\n    server: 1.2.3.4\n    port: 1\n";
        let n = parse_nodes(y);
        assert_eq!(n.len(), 2);
        assert!(n.contains(&("车位4 vless-4".into(), "a.example.com".into())));
        assert!(n.contains(&("HK".into(), "1.2.3.4".into())));
    }

    #[test]
    fn parses_links() {
        assert_eq!(parse_link("vless://uuid@node.example.com:443?security=tls#%E8%BD%A6%E4%BD%8D4"), Some(("车位4".into(), "node.example.com".into())));
        assert_eq!(parse_link("trojan://pw@[2001:db8::1]:443#v6"), Some(("v6".into(), "2001:db8::1".into())));
        // ss://base64(method:pass@host:port)#name
        let enc = base64::engine::general_purpose::STANDARD.encode("aes-128-gcm:pw@9.9.9.9:8388");
        assert_eq!(parse_link(&format!("ss://{enc}#n1")), Some(("n1".into(), "9.9.9.9".into())));
        let vm = base64::engine::general_purpose::STANDARD.encode(r#"{"ps":"vm","add":"v.example.org","port":"443"}"#);
        assert_eq!(parse_link(&format!("vmess://{vm}")), Some(("vm".into(), "v.example.org".into())));
    }

    #[test]
    fn applies_provider_override() {
        let cfg: serde_yaml::Value = serde_yaml::from_str("additional-prefix: '车位4 '\nproxy-name:\n  - {pattern: '\\s*-\\s*专线', target: ''}\n").unwrap();
        let ov = Override::from(Some(&cfg));
        assert_eq!(ov.apply("vless-4"), "车位4 vless-4");
        assert_eq!(ov.apply("HK - 专线"), "车位4 HK");
    }

    #[test]
    fn parses_base64_list() {
        let list = "trojan://p@t.example.com:443#t1\nanytls://p@x.example.com:443#t2\n";
        let enc = base64::engine::general_purpose::STANDARD.encode(list);
        let n = parse_nodes(&enc);
        assert_eq!(n.len(), 2);
    }
}

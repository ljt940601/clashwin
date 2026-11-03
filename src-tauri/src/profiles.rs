//! Profile metadata storage and subscription fetching.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::config;
use crate::util::{write_atomic, AppError, Res};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SubscriptionInfo {
    pub upload: u64,
    pub download: u64,
    pub total: u64,
    pub expire: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String, // "local" | "remote"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_update_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subscription: Option<SubscriptionInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub providers: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_rule_override: Option<bool>,
}

impl Profile {
    pub fn is_remote(&self) -> bool {
        self.kind == "remote"
    }
}

pub fn load(path: &Path) -> Vec<Profile> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save(path: &Path, list: &[Profile]) -> Res<()> {
    // hasRuleOverride is computed on read; don't persist it
    let clean: Vec<Profile> = list.iter().cloned().map(|mut p| {
        p.has_rule_override = None;
        p
    }).collect();
    write_atomic(path, &serde_json::to_vec_pretty(&clean)?)?;
    Ok(())
}

/// `upload=123; download=456; total=789; expire=1700000000`
pub fn parse_userinfo(s: &str) -> Option<SubscriptionInfo> {
    let mut info = SubscriptionInfo::default();
    let mut any = false;
    for part in s.split(';') {
        let mut kv = part.splitn(2, '=');
        let (Some(k), Some(v)) = (kv.next(), kv.next()) else { continue };
        let v = v.trim();
        let num = v.parse::<f64>().ok().map(|f| f.max(0.0));
        match k.trim().to_ascii_lowercase().as_str() {
            "upload" => {
                info.upload = num.unwrap_or(0.0) as u64;
                any = true
            }
            "download" => {
                info.download = num.unwrap_or(0.0) as u64;
                any = true
            }
            "total" => {
                info.total = num.unwrap_or(0.0) as u64;
                any = true
            }
            "expire" => {
                info.expire = num.unwrap_or(0.0) as i64;
                any = true
            }
            _ => {}
        }
    }
    any.then_some(info)
}

/// Filename from Content-Disposition (`filename*=UTF-8''...` preferred), without extension.
pub fn parse_disposition_name(s: &str) -> Option<String> {
    let mut plain: Option<String> = None;
    for part in s.split(';') {
        let part = part.trim();
        let lower = part.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("filename*=").map(|_| &part[10..]) {
            let v = rest.trim().trim_matches('"');
            let v = match v.find("''") {
                Some(i) => &v[i + 2..],
                None => v,
            };
            let decoded = percent_encoding::percent_decode_str(v).decode_utf8_lossy().to_string();
            if !decoded.is_empty() {
                return Some(strip_ext(&decoded));
            }
        } else if lower.starts_with("filename=") {
            let v = part[9..].trim().trim_matches('"');
            let decoded = percent_encoding::percent_decode_str(v).decode_utf8_lossy().to_string();
            if !decoded.is_empty() {
                plain = Some(strip_ext(&decoded));
            }
        }
    }
    plain
}

fn strip_ext(s: &str) -> String {
    for ext in [".yaml", ".yml", ".txt", ".conf"] {
        if s.to_ascii_lowercase().ends_with(ext) {
            return s[..s.len() - ext.len()].to_string();
        }
    }
    s.to_string()
}

/// `profile-title` header, optionally `base64:...` encoded.
pub fn decode_profile_title(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Some(b) = s.strip_prefix("base64:") {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b.trim())
            .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(b.trim()))
            .ok()?;
        return String::from_utf8(bytes).ok().filter(|x| !x.is_empty());
    }
    Some(s.to_string())
}

pub struct Fetched {
    pub text: String,
    pub info: Option<SubscriptionInfo>,
    pub name: Option<String>,
}

pub const SUB_USER_AGENT: &str = "clash.meta/v1.19 ClashWin/0.1.0 mihomo";

/// Download a subscription. `proxy` routes through the running core when the direct attempt fails.
pub async fn fetch(url: &str, proxy: Option<&str>) -> Res<Fetched> {
    let mut b = reqwest::Client::builder()
        .user_agent(SUB_USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10));
    match proxy {
        Some(p) => b = b.proxy(reqwest::Proxy::all(p).map_err(|e| AppError::network(e.to_string()))?),
        None => b = b.no_proxy(),
    }
    let client = b.build()?;
    let resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::network(format!("HTTP {} from subscription", resp.status())));
    }
    let h = resp.headers().clone();
    let hs = |name: &str| h.get(name).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let info = hs("subscription-userinfo").and_then(|s| parse_userinfo(&s));
    let name = hs("profile-title")
        .and_then(|s| decode_profile_title(&s))
        .or_else(|| hs("content-disposition").and_then(|s| parse_disposition_name(&s)));
    let bytes = resp.bytes().await?;
    let text = String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_string();
    config::validate_profile_text(&text)?;
    Ok(Fetched { text, info, name })
}

/// Default display name when nothing better is available.
pub fn name_from_url(url: &str) -> String {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_string())).unwrap_or_else(|| "Subscription".into())
}

pub const BLANK_PROFILE: &str = "# ClashWin local profile\nproxies: []\n\nproxy-groups:\n  - name: Proxy\n    type: select\n    proxies:\n      - DIRECT\n\nrules:\n  - MATCH,Proxy\n";

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn userinfo() {
        let i = parse_userinfo("upload=1234; download=5678; total=1073741824000; expire=1735689600").unwrap();
        assert_eq!(i.upload, 1234);
        assert_eq!(i.download, 5678);
        assert_eq!(i.total, 1073741824000);
        assert_eq!(i.expire, 1735689600);
        assert_eq!(parse_userinfo("upload=1;download=2;total=3;expire=").unwrap().expire, 0);
        assert!(parse_userinfo("garbage").is_none());
    }
    #[test]
    fn disposition() {
        assert_eq!(parse_disposition_name("attachment; filename*=UTF-8''%E6%88%91%E7%9A%84.yaml").as_deref(), Some("我的"));
        assert_eq!(parse_disposition_name("attachment; filename=\"Mini_en.yaml\"").as_deref(), Some("Mini_en"));
        assert_eq!(parse_disposition_name("inline").as_deref(), None);
    }
    #[test]
    fn title() {
        assert_eq!(decode_profile_title("base64:5oiR55qE6K6i6ZiF").as_deref(), Some("我的订阅"));
        assert_eq!(decode_profile_title("Plain").as_deref(), Some("Plain"));
    }
    #[test]
    fn profile_json_shape() {
        let p = Profile {
            id: "a".into(),
            name: "n".into(),
            kind: "remote".into(),
            url: Some("u".into()),
            file: "f".into(),
            updated_at: 1,
            auto_update_minutes: Some(60),
            subscription: None,
            providers: None,
            has_rule_override: Some(true),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["type"], "remote");
        assert_eq!(v["autoUpdateMinutes"], 60);
        assert_eq!(v["hasRuleOverride"], true);
        assert!(v.get("subscription").is_none());
    }
}

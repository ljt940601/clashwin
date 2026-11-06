//! Update center backend: ClashWin's own updates (GitHub Releases), GitHub download
//! mirrors with latency probing, and checksum-verified downloads shared with the core
//! installer.
//!
//! Mirrors are public "reverse proxy" services: `<prefix>https://github.com/...` fetches
//! the same file through them. A mirror could hand back anything, so a file is only
//! fetched through one when GitHub publishes its SHA-256 and the download matches it.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::time::{Duration, Instant};

use crate::core;
use crate::settings::AppSettings;
use crate::state::AppState;
use crate::util::{AppError, Res};

/// GitHub repository that publishes ClashWin releases (see .github/workflows/release.yml).
pub const APP_REPO: &str = "ljt940601/clashwin";

/// Public GitHub download proxies. Users can add their own in Settings → Updates.
pub const MIRROR_PRESETS: &[&str] = &["https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/", "https://gh.llkk.cc/"];

/// Tiny file used to time each source; it goes through the same release-download path as
/// a real core download.
const PROBE_URL: &str = "https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt";
const PROBE_TTL: Duration = Duration::from_secs(600);
const UA: &str = concat!("ClashWin/", env!("CARGO_PKG_VERSION"));

/* ---------------- sources ---------------- */

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSource {
    /// Mirror prefix ending in "/", or "" for a direct GitHub download.
    pub url: String,
    /// "direct" | "preset" | "custom"
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceProbe {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// "https://ghfast.top" → "https://ghfast.top/". None when it isn't an http(s) URL.
pub fn normalize_prefix(p: &str) -> Option<String> {
    let p = p.trim();
    let u = url::Url::parse(p).ok()?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().map_or(true, |h| h.is_empty()) {
        return None;
    }
    let mut s = p.to_string();
    if !s.ends_with('/') {
        s.push('/');
    }
    Some(s)
}

pub fn with_mirror(prefix: &str, url: &str) -> String {
    if prefix.is_empty() {
        url.to_string()
    } else {
        format!("{prefix}{url}")
    }
}

/// Direct + presets + the user's own mirrors, in display order, without duplicates.
pub fn sources(s: &AppSettings) -> Vec<DownloadSource> {
    let mut out = vec![DownloadSource { url: String::new(), kind: "direct".into() }];
    for p in MIRROR_PRESETS {
        out.push(DownloadSource { url: p.to_string(), kind: "preset".into() });
    }
    for c in &s.custom_mirrors {
        if let Some(p) = normalize_prefix(c) {
            if !out.iter().any(|x| x.url == p) {
                out.push(DownloadSource { url: p, kind: "custom".into() });
            }
        }
    }
    out
}

fn probe_client() -> Res<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(UA)
        .no_proxy()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(8))
        .build()?)
}

/// Time a small download through one source.
pub async fn probe(client: &reqwest::Client, prefix: &str) -> SourceProbe {
    let started = Instant::now();
    let res: Res<()> = async {
        let r = client.get(with_mirror(prefix, PROBE_URL)).send().await?;
        if !r.status().is_success() {
            return Err(AppError::network(format!("HTTP {}", r.status().as_u16())));
        }
        if r.content_length().is_some_and(|n| n > 1024) {
            return Err(AppError::network("unexpected response"));
        }
        let body = r.bytes().await?;
        let text = String::from_utf8_lossy(&body);
        let v = text.trim();
        if v.len() > 64 || !v.starts_with('v') {
            return Err(AppError::network("unexpected response"));
        }
        Ok(())
    }
    .await;
    match res {
        Ok(()) => SourceProbe { url: prefix.to_string(), latency_ms: Some(started.elapsed().as_millis() as u64), error: None },
        Err(e) => SourceProbe { url: prefix.to_string(), latency_ms: None, error: Some(short_error(&e.message)) },
    }
}

fn short_error(m: &str) -> String {
    let l = m.to_ascii_lowercase();
    if l.contains("timed out") || l.contains("timeout") {
        "timeout".into()
    } else if l.contains("dns") || l.contains("resolve") {
        "dns".into()
    } else if l.starts_with("http ") || l == "unexpected response" {
        m.to_string()
    } else {
        "unreachable".into()
    }
}

static PROBE_CACHE: Lazy<Mutex<Option<(Instant, Vec<SourceProbe>)>>> = Lazy::new(|| Mutex::new(None));

/// Probe every source in parallel; results are cached for a few minutes.
pub async fn probe_all(s: &AppSettings, force: bool) -> Vec<SourceProbe> {
    let list: Vec<String> = sources(s).into_iter().map(|x| x.url).collect();
    if !force {
        if let Some((at, cached)) = PROBE_CACHE.lock().clone() {
            if at.elapsed() < PROBE_TTL && list.iter().all(|u| cached.iter().any(|p| &p.url == u)) {
                return cached.into_iter().filter(|p| list.contains(&p.url)).collect();
            }
        }
    }
    let Ok(client) = probe_client() else {
        return list.into_iter().map(|url| SourceProbe { url, latency_ms: None, error: Some("unreachable".into()) }).collect();
    };
    let out = futures_util::future::join_all(list.iter().map(|u| probe(&client, u))).await;
    *PROBE_CACHE.lock() = Some((Instant::now(), out.clone()));
    out
}

/// Fastest working sources first; direct GitHub is always tried as a last resort.
pub fn rank_probes(probes: &[SourceProbe]) -> Vec<String> {
    let mut ok: Vec<&SourceProbe> = probes.iter().filter(|p| p.latency_ms.is_some()).collect();
    ok.sort_by_key(|p| p.latency_ms);
    let mut out: Vec<String> = ok.into_iter().take(3).map(|p| p.url.clone()).collect();
    if !out.iter().any(|u| u.is_empty()) {
        out.push(String::new());
    }
    out
}

/// Order in which to try sources for one download, from the user's choice.
pub async fn ordered_sources(s: &AppSettings) -> Vec<String> {
    match s.download_mirror.as_str() {
        "auto" => rank_probes(&probe_all(s, false).await),
        "" | "direct" => vec![String::new()],
        p => match normalize_prefix(p) {
            Some(p) => vec![p, String::new()],
            None => vec![String::new()],
        },
    }
}

/// The core's local mixed port, usable as an HTTP proxy while the core runs.
pub fn local_proxy(st: &AppState) -> Option<String> {
    st.core.is_running().then(|| format!("http://127.0.0.1:{}", st.settings.read().engine.network.mixed_port))
}

/* ---------------- verified downloads ---------------- */

/// "sha256:ab12…" (GitHub's asset digest) → "ab12…".
pub fn sha256_from_digest(d: Option<&str>) -> Option<String> {
    let h = d?.strip_prefix("sha256:")?.trim().to_ascii_lowercase();
    (h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit())).then_some(h)
}

pub fn verify(bytes: &[u8], size: u64, sha256: Option<&str>) -> Res<()> {
    if size > 0 && bytes.len() as u64 != size {
        return Err(AppError::new("DOWNLOAD_FAILED", format!("Size mismatch ({} of {size} bytes)", bytes.len())));
    }
    if let Some(want) = sha256 {
        let got = format!("{:x}", Sha256::digest(bytes));
        if !got.eq_ignore_ascii_case(want) {
            return Err(AppError::new("DOWNLOAD_FAILED", "Checksum mismatch: the downloaded file is not the published one"));
        }
    }
    Ok(())
}

/// Download a GitHub release asset: through the chosen mirror(s) when its checksum is
/// known, else directly; finally through the running core's proxy.
pub async fn download_asset(st: &AppState, url: &str, size: u64, sha256: Option<&str>, mut progress: impl FnMut(u64, u64)) -> Res<Vec<u8>> {
    let settings = st.settings();
    let mut last: Option<AppError> = None;
    for src in ordered_sources(&settings).await {
        if !src.is_empty() && sha256.is_none() {
            continue; // can't check a mirror's copy without the published checksum
        }
        let target = with_mirror(&src, url);
        match core::download(&target, None, &mut progress).await.and_then(|b| verify(&b, size, sha256).map(|_| b)) {
            Ok(b) => return Ok(b),
            Err(e) => {
                log::warn!("download via {} failed: {}", if src.is_empty() { "github.com" } else { &src }, e.message);
                last = Some(e);
            }
        }
    }
    if let Some(p) = local_proxy(st) {
        match core::download(url, Some(&p), &mut progress).await.and_then(|b| verify(&b, size, sha256).map(|_| b)) {
            Ok(b) => return Ok(b),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| AppError::new("DOWNLOAD_FAILED", "No download source is available")))
}

/* ---------------- versions ---------------- */

/// "v1.2.3-beta.1" → ([1,2,3], Some("beta.1")).
pub fn parse_version(s: &str) -> Option<(Vec<u64>, Option<String>)> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    let s = s.split('+').next()?;
    let (main, pre) = match s.split_once('-') {
        Some((m, p)) => (m, Some(p.to_string())),
        None => (s, None),
    };
    let mut nums = main.split('.').map(|x| x.parse::<u64>().ok()).collect::<Option<Vec<_>>>()?;
    if nums.is_empty() || nums.len() > 4 {
        return None;
    }
    nums.resize(3.max(nums.len()), 0);
    Some((nums, pre))
}

/// Semver-style comparison; a release sorts above its own pre-releases.
pub fn cmp_versions(a: &str, b: &str) -> Ordering {
    let (Some((an, ap)), Some((bn, bp))) = (parse_version(a), parse_version(b)) else {
        return Ordering::Equal;
    };
    let len = an.len().max(bn.len());
    for i in 0..len {
        match an.get(i).unwrap_or(&0).cmp(bn.get(i).unwrap_or(&0)) {
            Ordering::Equal => {}
            o => return o,
        }
    }
    match (ap, bp) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => {
            let (xs, ys): (Vec<&str>, Vec<&str>) = (x.split('.').collect(), y.split('.').collect());
            for (p, q) in xs.iter().zip(ys.iter()) {
                let o = match (p.parse::<u64>(), q.parse::<u64>()) {
                    (Ok(m), Ok(n)) => m.cmp(&n),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    _ => p.cmp(q),
                };
                if o != Ordering::Equal {
                    return o;
                }
            }
            xs.len().cmp(&ys.len())
        }
    }
}

/* ---------------- app releases ---------------- */

#[derive(Debug, Clone)]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRelease {
    pub version: String,
    pub name: String,
    pub notes: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub url: String,
    /// Installer size in bytes, 0 when the release has no Windows installer for this CPU.
    pub size: u64,
    #[serde(skip)]
    pub asset: Option<Asset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current: String,
    pub latest: String,
    pub has_update: bool,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    pub size: u64,
    /// Recent releases, newest first (for the changelog cards).
    pub releases: Vec<AppRelease>,
}

/// The NSIS installer for this CPU, e.g. "ClashWin_0.2.0_x64-setup.exe".
pub fn pick_installer(names: &[String], arch: &str) -> Option<usize> {
    let tag = match arch {
        "aarch64" => "arm64",
        "x86" => "x86",
        _ => "x64",
    };
    let setups: Vec<(usize, String)> = names
        .iter()
        .enumerate()
        .map(|(i, n)| (i, n.to_ascii_lowercase()))
        .filter(|(_, n)| n.ends_with("-setup.exe"))
        .collect();
    let has = |n: &str, t: &str| n.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| w == t);
    if let Some((i, _)) = setups.iter().find(|(_, n)| has(n, tag)) {
        return Some(*i);
    }
    // an installer that names no CPU at all is taken as the x64 build
    if tag == "x64" {
        return setups.iter().find(|(_, n)| !["x64", "x86", "arm64"].iter().any(|t| has(n, t))).map(|(i, _)| *i);
    }
    None
}

fn truncate(mut s: String, max: usize) -> String {
    if s.len() > max {
        let mut cut = max;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
        s.push_str("\n…");
    }
    s
}

pub fn parse_app_release(v: &serde_json::Value) -> Option<AppRelease> {
    if v.get("draft").and_then(|d| d.as_bool()).unwrap_or(false) {
        return None;
    }
    let tag = v.get("tag_name")?.as_str()?.to_string();
    parse_version(&tag)?;
    let assets = v.get("assets").and_then(|a| a.as_array()).cloned().unwrap_or_default();
    let names: Vec<String> = assets.iter().map(|a| a.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string()).collect();
    let asset = pick_installer(&names, std::env::consts::ARCH).and_then(|i| {
        let a = &assets[i];
        Some(Asset {
            name: names[i].clone(),
            url: a.get("browser_download_url")?.as_str()?.to_string(),
            size: a.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
            sha256: sha256_from_digest(a.get("digest").and_then(|d| d.as_str())),
        })
    });
    let str_of = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let name = str_of("name");
    Some(AppRelease {
        version: tag.trim_start_matches(['v', 'V']).to_string(),
        name: if name.is_empty() { tag.clone() } else { name },
        notes: truncate(str_of("body").replace("\r\n", "\n"), 6000),
        published_at: v.get("published_at").and_then(|x| x.as_str()).map(String::from),
        prerelease: v.get("prerelease").and_then(|x| x.as_bool()).unwrap_or(false),
        url: str_of("html_url"),
        size: asset.as_ref().map_or(0, |a| a.size),
        asset,
    })
}

/// Pick the newest installable release and build the update summary.
pub fn summarize(current: &str, mut releases: Vec<AppRelease>, include_beta: bool) -> AppUpdateInfo {
    releases.retain(|r| include_beta || !r.prerelease);
    releases.sort_by(|a, b| cmp_versions(&b.version, &a.version));
    releases.truncate(8);
    let best = releases.iter().find(|r| r.asset.is_some());
    let has_update = best.is_some_and(|r| cmp_versions(&r.version, current) == Ordering::Greater);
    AppUpdateInfo {
        current: current.to_string(),
        latest: best.map_or_else(|| current.to_string(), |r| r.version.clone()),
        has_update,
        url: best.map_or_else(|| format!("https://github.com/{APP_REPO}/releases"), |r| r.url.clone()),
        notes: best.map(|r| r.notes.clone()).filter(|n| !n.trim().is_empty()),
        published_at: best.and_then(|r| r.published_at.clone()),
        size: best.map_or(0, |r| r.size),
        releases,
    }
}

async fn get_json(url: &str, proxy: Option<&str>) -> Res<serde_json::Value> {
    let r = core::http_client(proxy)?.get(url).header("Accept", "application/vnd.github+json").send().await?;
    let status = r.status();
    if !status.is_success() {
        let hint = if status.as_u16() == 403 || status.as_u16() == 429 { " (GitHub rate limit, try again later)" } else { "" };
        return Err(AppError::network(format!("GitHub API {status}{hint}")));
    }
    Ok(r.json().await?)
}

static LAST_CHECK: Lazy<Mutex<Option<AppUpdateInfo>>> = Lazy::new(|| Mutex::new(None));

/// Last result of an app update check in this session.
pub fn cached_check() -> Option<AppUpdateInfo> {
    LAST_CHECK.lock().clone()
}

pub async fn check_app(st: &AppState, current: &str) -> Res<AppUpdateInfo> {
    let url = format!("https://api.github.com/repos/{APP_REPO}/releases?per_page=15");
    let list = match get_json(&url, None).await {
        Ok(v) => v,
        Err(e) => match local_proxy(st) {
            Some(p) => get_json(&url, Some(&p)).await.map_err(|_| e)?,
            None => return Err(e),
        },
    };
    let releases: Vec<AppRelease> = list.as_array().map(|a| a.iter().filter_map(parse_app_release).collect()).unwrap_or_default();
    let info = summarize(current, releases, st.settings.read().include_beta);
    *LAST_CHECK.lock() = Some(info.clone());
    Ok(info)
}

pub fn installer_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("ClashWin-update")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_order() {
        assert_eq!(cmp_versions("0.2.0", "0.1.9"), Ordering::Greater);
        assert_eq!(cmp_versions("v0.1.0", "0.1.0"), Ordering::Equal);
        assert_eq!(cmp_versions("0.1.10", "0.1.9"), Ordering::Greater);
        assert_eq!(cmp_versions("1.0.0", "1.0.0-beta.2"), Ordering::Greater);
        assert_eq!(cmp_versions("1.0.0-beta.10", "1.0.0-beta.2"), Ordering::Greater);
        assert_eq!(cmp_versions("1.0.0-alpha", "1.0.0-beta"), Ordering::Less);
        assert_eq!(cmp_versions("1.0", "1.0.0"), Ordering::Equal);
        assert!(parse_version("latest").is_none());
    }

    #[test]
    fn installer_pick() {
        let n = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let names = n(&["ClashWin_0.2.0_x64-setup.exe", "ClashWin_0.2.0_arm64-setup.exe", "latest.json"]);
        assert_eq!(pick_installer(&names, "x86_64"), Some(0));
        assert_eq!(pick_installer(&names, "aarch64"), Some(1));
        assert_eq!(pick_installer(&n(&["ClashWin-setup.exe"]), "x86_64"), Some(0));
        assert_eq!(pick_installer(&n(&["ClashWin_0.2.0_x64-setup.exe"]), "aarch64"), None);
        assert_eq!(pick_installer(&n(&["notes.txt"]), "x86_64"), None);
    }

    #[test]
    fn mirrors() {
        assert_eq!(normalize_prefix(" https://ghfast.top "), Some("https://ghfast.top/".into()));
        assert_eq!(normalize_prefix("ftp://x.y/"), None);
        assert_eq!(normalize_prefix("ghfast.top"), None);
        assert_eq!(with_mirror("https://m.example/", "https://github.com/a"), "https://m.example/https://github.com/a");
        assert_eq!(with_mirror("", "https://github.com/a"), "https://github.com/a");
        let p = |u: &str, ms: Option<u64>| SourceProbe { url: u.into(), latency_ms: ms, error: None };
        assert_eq!(rank_probes(&[p("", Some(900)), p("a/", Some(120)), p("b/", None)]), vec!["a/".to_string(), String::new()]);
        assert_eq!(rank_probes(&[p("", None), p("a/", Some(300))]), vec!["a/".to_string(), String::new()]);
    }

    #[test]
    fn checksums() {
        let hash = format!("{:x}", Sha256::digest(b"hello"));
        assert_eq!(sha256_from_digest(Some(&format!("sha256:{hash}"))), Some(hash.clone()));
        assert_eq!(sha256_from_digest(Some("md5:abc")), None);
        assert!(verify(b"hello", 5, Some(&hash)).is_ok());
        assert!(verify(b"hellO", 5, Some(&hash)).is_err());
        assert!(verify(b"hello", 6, None).is_err());
    }

    #[test]
    fn summary() {
        let rel = |v: &str, pre: bool, asset: bool| AppRelease {
            version: v.into(),
            name: v.into(),
            notes: format!("notes {v}"),
            published_at: None,
            prerelease: pre,
            url: format!("u/{v}"),
            size: 1,
            asset: asset.then(|| Asset { name: "x64-setup.exe".into(), url: "a".into(), size: 1, sha256: None }),
        };
        let list = vec![rel("0.1.0", false, true), rel("0.3.0-beta.1", true, true), rel("0.2.0", false, true), rel("0.2.1", false, false)];
        let s = summarize("0.1.0", list.clone(), false);
        assert!(s.has_update);
        assert_eq!(s.latest, "0.2.0"); // 0.2.1 has no installer, beta excluded
        assert_eq!(s.releases.len(), 3);
        assert_eq!(s.releases[0].version, "0.2.1");
        let b = summarize("0.1.0", list.clone(), true);
        assert_eq!(b.latest, "0.3.0-beta.1");
        let none = summarize("0.2.0", list, false);
        assert!(!none.has_update);
    }
}

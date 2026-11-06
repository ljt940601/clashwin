//! mihomo process management, controller HTTP helper, and core download/update.

use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use crate::util::{hidden_command, AppError, Res};
use crate::winutil::Job;

const LOG_CAP: usize = 2000;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ControllerInfo {
    pub url: String,
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    /// running | stopped | starting | not_installed | downloading | error
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    pub controller: ControllerInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct CoreManager {
    child: Mutex<Option<Child>>,
    status: RwLock<CoreStatus>,
    logs: std::sync::Arc<Mutex<VecDeque<String>>>,
    expected_exit: AtomicBool,
    /// Incremented on every start so stale monitors stop.
    pub generation: AtomicU64,
    job: Option<Job>,
}

impl CoreManager {
    pub fn new(controller: ControllerInfo, installed: bool, version: Option<String>) -> Self {
        Self {
            child: Mutex::new(None),
            status: RwLock::new(CoreStatus {
                state: if installed { "stopped".into() } else { "not_installed".into() },
                version,
                pid: None,
                started_at: None,
                controller,
                error: None,
            }),
            logs: Default::default(),
            expected_exit: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            job: Job::new(),
        }
    }

    pub fn status(&self) -> CoreStatus {
        self.status.read().clone()
    }
    pub fn update(&self, f: impl FnOnce(&mut CoreStatus)) -> CoreStatus {
        let mut s = self.status.write();
        f(&mut s);
        s.clone()
    }
    pub fn is_running(&self) -> bool {
        self.status.read().state == "running"
    }
    pub fn controller(&self) -> ControllerInfo {
        self.status.read().controller.clone()
    }

    pub fn push_log(&self, line: String) {
        let mut l = self.logs.lock();
        if l.len() >= LOG_CAP {
            l.pop_front();
        }
        l.push_back(line);
    }
    pub fn log_tail(&self, n: usize) -> Vec<String> {
        let l = self.logs.lock();
        l.iter().skip(l.len().saturating_sub(n)).cloned().collect()
    }

    /// Spawn the core. Returns pid.
    pub fn spawn(&self, exe: &Path, home: &Path, config: &Path) -> Res<u32> {
        self.kill();
        self.expected_exit.store(false, Ordering::SeqCst);
        let mut cmd = hidden_command(exe);
        cmd.arg("-d").arg(home).arg("-f").arg(config).current_dir(home).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| AppError::io(format!("Failed to start core: {e}")))?;
        if let Some(job) = &self.job {
            job.assign(&child);
        }
        let pid = child.id();
        for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
            .into_iter()
            .flatten()
        {
            let logs = self.logs.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stream);
                for line in reader.split(b'\n').map_while(Result::ok) {
                    let s = String::from_utf8_lossy(&line).trim_end().to_string();
                    if s.is_empty() {
                        continue;
                    }
                    let mut l = logs.lock();
                    if l.len() >= LOG_CAP {
                        l.pop_front();
                    }
                    l.push_back(s);
                }
            });
        }
        *self.child.lock() = Some(child);
        self.generation.fetch_add(1, Ordering::SeqCst);
        Ok(pid)
    }

    /// Stop the core (expected exit).
    pub fn kill(&self) {
        self.expected_exit.store(true, Ordering::SeqCst);
        if let Some(mut c) = self.child.lock().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }

    /// Some(exit description) if the child exited unexpectedly since the last check.
    pub fn check_exit(&self) -> Option<String> {
        let mut g = self.child.lock();
        let c = g.as_mut()?;
        match c.try_wait() {
            Ok(Some(status)) => {
                *g = None;
                if self.expected_exit.load(Ordering::SeqCst) {
                    None
                } else {
                    Some(format!("Core exited unexpectedly ({status})"))
                }
            }
            _ => None,
        }
    }

    pub fn has_child(&self) -> bool {
        self.child.lock().is_some()
    }
}

/* ---------------- Controller HTTP ---------------- */

pub fn controller_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("http client")
}

/// Call the mihomo REST API.
pub async fn api(ctl: &ControllerInfo, method: reqwest::Method, path: &str, body: Option<serde_json::Value>) -> Res<serde_json::Value> {
    let client = controller_client();
    let mut req = client.request(method, format!("{}{}", ctl.url, path));
    if !ctl.secret.is_empty() {
        req = req.bearer_auth(&ctl.secret);
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| AppError::new("CORE_NOT_RUNNING", e.to_string()))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("HTTP {status}"));
        let code = if status.as_u16() == 400 { "INVALID_CONFIG" } else { "NETWORK" };
        return Err(AppError::new(code, msg));
    }
    if text.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text)))
}

/* ---------------- Version detection ---------------- */

pub fn read_installed_version(version_file: &Path, exe: &Path) -> Option<String> {
    if let Ok(s) = std::fs::read_to_string(version_file) {
        let s = s.trim();
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    if !exe.exists() {
        return None;
    }
    // Fallback for a manually placed binary: ask it.
    let out = hidden_command(exe).arg("-v").output().ok()?;
    parse_version_output(&crate::util::decode_console(&out.stdout))
}

/// "Mihomo Meta v1.19.27 windows amd64 with go1.24" → "v1.19.27"; also "alpha-abc123".
pub fn parse_version_output(s: &str) -> Option<String> {
    s.split_whitespace()
        .find(|t| (t.starts_with('v') && t[1..].starts_with(|c: char| c.is_ascii_digit())) || t.starts_with("alpha-"))
        .map(|t| t.to_string())
}

/* ---------------- Releases ---------------- */

#[derive(Debug, Clone)]
pub struct ReleaseInfo {
    pub version: String,
    pub notes: String,
    pub asset_name: String,
    pub asset_url: String,
    pub size: u64,
    /// Hex SHA-256 published by GitHub for the asset, when available.
    pub sha256: Option<String>,
}

pub fn target_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86" => "386",
        _ => "amd64",
    }
}

pub fn cpu_has_avx2() -> bool {
    #[cfg(any(target_arch = "x86_64", target_arch = "x86"))]
    {
        std::is_x86_feature_detected!("avx2")
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "x86")))]
    {
        false
    }
}

/// Choose the best Windows asset. Returns its index.
pub fn pick_asset(names: &[String], arch: &str, avx2: bool) -> Option<usize> {
    let mut best: Option<(i32, usize)> = None;
    for (i, n) in names.iter().enumerate() {
        let l = n.to_ascii_lowercase();
        if !l.contains("windows") || !l.ends_with(".zip") {
            continue;
        }
        let arch_ok = match arch {
            "amd64" => l.contains("amd64"),
            "arm64" => l.contains("arm64"),
            "386" => l.contains("-386"),
            _ => false,
        };
        if !arch_ok {
            continue;
        }
        let mut score = 10;
        if l.contains("go1") {
            score -= 8; // legacy-Go builds for old Windows
        }
        if arch == "amd64" {
            let compat = l.contains("compatible") || l.contains("-v1-");
            let v3 = l.contains("-v3-");
            let v2 = l.contains("-v2-");
            if avx2 {
                if v3 {
                    score += 3;
                } else if !compat && !v2 {
                    score += 2;
                } else if v2 {
                    score += 1;
                }
            } else if compat {
                score += 3;
            } else if v3 || (!v2 && !compat) {
                score -= 5; // may require AVX2
            }
        }
        if best.map(|(s, _)| score > s).unwrap_or(true) {
            best = Some((score, i));
        }
    }
    best.map(|(_, i)| i)
}

/// Version label from an asset name, e.g. "mihomo-windows-amd64-alpha-abc123.zip" → "alpha-abc123".
pub fn version_from_asset(name: &str, tag: &str) -> String {
    if tag.starts_with('v') && tag[1..].starts_with(|c: char| c.is_ascii_digit()) {
        return tag.to_string();
    }
    let base = name.trim_end_matches(".zip");
    if let Some(i) = base.find("alpha") {
        return base[i..].to_string();
    }
    if let Some(v) = base.split('-').rev().find(|t| t.starts_with('v') && t[1..].starts_with(|c: char| c.is_ascii_digit())) {
        return v.to_string();
    }
    tag.to_string()
}

fn release_api(channel: &str) -> (&'static str, Option<&'static str>) {
    match channel {
        "alpha" => ("MetaCubeX/mihomo", Some("Prerelease-Alpha")),
        "smart" => ("vernesong/mihomo", None),
        _ => ("MetaCubeX/mihomo", None),
    }
}

pub fn http_client(proxy: Option<&str>) -> Res<reqwest::Client> {
    let mut b = reqwest::Client::builder()
        .user_agent(concat!("ClashWin/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(12))
        .timeout(std::time::Duration::from_secs(600));
    b = match proxy {
        Some(p) => b.proxy(reqwest::Proxy::all(p).map_err(|e| AppError::network(e.to_string()))?),
        None => b.no_proxy(),
    };
    Ok(b.build()?)
}

fn parse_release(rel: &serde_json::Value) -> Option<ReleaseInfo> {
    let tag = rel.get("tag_name")?.as_str().unwrap_or("").to_string();
    let assets = rel.get("assets")?.as_array()?;
    let names: Vec<String> = assets.iter().map(|a| a.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string()).collect();
    let i = pick_asset(&names, target_arch(), cpu_has_avx2())?;
    let a = &assets[i];
    let mut notes = rel.get("body").and_then(|b| b.as_str()).unwrap_or("").to_string();
    if notes.len() > 4000 {
        let mut cut = 4000;
        while !notes.is_char_boundary(cut) {
            cut -= 1;
        }
        notes.truncate(cut);
    }
    Some(ReleaseInfo {
        version: version_from_asset(&names[i], &tag),
        notes,
        asset_name: names[i].clone(),
        asset_url: a.get("browser_download_url")?.as_str()?.to_string(),
        size: a.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
        sha256: crate::updates::sha256_from_digest(a.get("digest").and_then(|d| d.as_str())),
    })
}

/// Look up the latest release for a channel.
pub async fn fetch_release(channel: &str, proxy: Option<&str>) -> Res<ReleaseInfo> {
    let client = http_client(proxy)?;
    let (repo, tag) = release_api(channel);
    let get = |url: String| {
        let client = client.clone();
        async move {
            let r = client.get(&url).header("Accept", "application/vnd.github+json").send().await?;
            if !r.status().is_success() {
                return Err(AppError::network(format!("GitHub API {} ({url})", r.status())));
            }
            Ok::<serde_json::Value, AppError>(r.json().await?)
        }
    };
    let found = match (channel, tag) {
        ("smart", _) => {
            let list = get(format!("https://api.github.com/repos/{repo}/releases?per_page=10")).await?;
            list.as_array().and_then(|a| a.iter().find_map(parse_release))
        }
        (_, Some(t)) => parse_release(&get(format!("https://api.github.com/repos/{repo}/releases/tags/{t}")).await?),
        _ => parse_release(&get(format!("https://api.github.com/repos/{repo}/releases/latest")).await?),
    };
    found.ok_or_else(|| AppError::new("NOT_FOUND", format!("No Windows {} build found for channel {channel}", target_arch())))
}

/// Download with progress callback (downloaded, total).
pub async fn download(url: &str, proxy: Option<&str>, mut progress: impl FnMut(u64, u64)) -> Res<Vec<u8>> {
    use futures_util::StreamExt;
    let client = http_client(proxy)?;
    let resp = client.get(url).send().await.map_err(|e| AppError::new("DOWNLOAD_FAILED", e.to_string()))?;
    if !resp.status().is_success() {
        return Err(AppError::new("DOWNLOAD_FAILED", format!("HTTP {}", resp.status())));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut buf = Vec::with_capacity(total as usize);
    let mut stream = resp.bytes_stream();
    let mut last = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::new("DOWNLOAD_FAILED", e.to_string()))?;
        buf.extend_from_slice(&chunk);
        if last.elapsed().as_millis() > 120 {
            progress(buf.len() as u64, total);
            last = std::time::Instant::now();
        }
    }
    progress(buf.len() as u64, total.max(buf.len() as u64));
    Ok(buf)
}

/// Extract the first .exe from a zip archive.
pub fn extract_exe(zip_bytes: &[u8]) -> Res<Vec<u8>> {
    let mut ar = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).map_err(|e| AppError::new("DOWNLOAD_FAILED", format!("Bad archive: {e}")))?;
    for i in 0..ar.len() {
        let mut f = ar.by_index(i).map_err(|e| AppError::new("DOWNLOAD_FAILED", e.to_string()))?;
        if f.is_file() && f.name().to_ascii_lowercase().ends_with(".exe") {
            let mut out = Vec::with_capacity(f.size() as usize);
            f.read_to_end(&mut out)?;
            return Ok(out);
        }
    }
    Err(AppError::new("DOWNLOAD_FAILED", "No executable found in the archive"))
}

/// Versions kept under core/versions, newest first (by folder mtime).
pub fn cached_versions(versions_dir: &Path) -> Vec<String> {
    let mut v: Vec<(std::time::SystemTime, String)> = std::fs::read_dir(versions_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().join("mihomo.exe").exists())
                .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), e.file_name().to_string_lossy().to_string()))
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().map(|(_, n)| n).collect()
}

/// Copy the current core into versions/<ver>/ before replacing it.
pub fn backup_current(exe: &Path, versions_dir: &Path, version: &str) {
    if !exe.exists() || version.is_empty() {
        return;
    }
    let dir = versions_dir.join(sanitize(version));
    if dir.join("mihomo.exe").exists() {
        return;
    }
    if std::fs::create_dir_all(&dir).is_ok() {
        let _ = std::fs::copy(exe, dir.join("mihomo.exe"));
    }
}

pub fn sanitize(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }).collect()
}

/// Install a binary as the active core (replace atomically).
pub fn install_binary(exe: &Path, version_file: &Path, bytes: &[u8], version: &str) -> Res<()> {
    let tmp: PathBuf = exe.with_extension("exe.new");
    std::fs::write(&tmp, bytes)?;
    if exe.exists() {
        // Windows can't overwrite a running exe; caller stops the core first. Retry briefly.
        let mut ok = false;
        for _ in 0..20 {
            if std::fs::remove_file(exe).is_ok() {
                ok = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        if !ok {
            return Err(AppError::io("Could not replace the core binary (still in use)"));
        }
    }
    std::fs::rename(&tmp, exe)?;
    std::fs::write(version_file, version)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_assets() {
        let n = names(&[
            "mihomo-darwin-arm64-v1.19.27.gz",
            "mihomo-windows-amd64-v1.19.27.zip",
            "mihomo-windows-amd64-compatible-v1.19.27.zip",
            "mihomo-windows-amd64-v3-v1.19.27.zip",
            "mihomo-windows-amd64-go120-v1.19.27.zip",
            "mihomo-windows-arm64-v1.19.27.zip",
            "mihomo-windows-386-v1.19.27.zip",
        ]);
        assert_eq!(pick_asset(&n, "amd64", true), Some(3));
        assert_eq!(pick_asset(&n, "amd64", false), Some(2));
        assert_eq!(pick_asset(&n, "arm64", false), Some(5));
        assert_eq!(pick_asset(&n, "386", false), Some(6));
        assert_eq!(pick_asset(&names(&["mihomo-linux-amd64.gz"]), "amd64", true), None);
    }

    #[test]
    fn versions() {
        assert_eq!(version_from_asset("mihomo-windows-amd64-v1.19.27.zip", "v1.19.27"), "v1.19.27");
        assert_eq!(version_from_asset("mihomo-windows-amd64-alpha-8d84c5b.zip", "Prerelease-Alpha"), "alpha-8d84c5b");
        assert_eq!(parse_version_output("Mihomo Meta v1.19.27 windows amd64 with go1.24.1"), Some("v1.19.27".into()));
        assert_eq!(parse_version_output("Mihomo Meta alpha-abc windows"), Some("alpha-abc".into()));
    }

    #[test]
    fn zip_extract() {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            w.start_file::<_, ()>("readme.txt", zip::write::FileOptions::default()).unwrap();
            std::io::Write::write_all(&mut w, b"hi").unwrap();
            w.start_file::<_, ()>("mihomo-windows-amd64.exe", zip::write::FileOptions::default()).unwrap();
            std::io::Write::write_all(&mut w, b"MZ binary").unwrap();
            w.finish().unwrap();
        }
        assert_eq!(extract_exe(&buf).unwrap(), b"MZ binary");
    }
}

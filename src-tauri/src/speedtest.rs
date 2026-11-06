//! Download speed test for a single node.
//!
//! The runtime config carries a hidden select group (GROUP) that holds every node, and
//! a local HTTP listener (LISTENER) whose traffic always goes to that group, bypassing
//! the rules (see config.rs). Testing a node selects it in that group and downloads a
//! file through the listener, so the user's own groups, selections and traffic are
//! left alone. One test runs at a time; there is deliberately no batch test.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::core;
use crate::state::state;
use crate::util::{now_ms, AppError, Res};

pub const GROUP: &str = "ClashWin-SpeedTest";
pub const LISTENER: &str = "clashwin-speedtest";

/// Cloudflare's speed-test endpoint returns exactly `bytes` bytes.
pub fn test_url(bytes: u64) -> String {
    format!("https://speed.cloudflare.com/__down?bytes={bytes}")
}
/// Sizes offered in settings (MB); anything else is clamped into this range.
pub const SIZES_MB: &[u32] = &[5, 10, 25, 50];
/// How long the transfer may run once data starts arriving.
const WINDOW: Duration = Duration::from_secs(10);
/// Time allowed for the connection and the first response bytes.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// No data for this long counts as a stall.
const STALL: Duration = Duration::from_secs(5);

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedProgress {
    pub node: String,
    pub downloaded: u64,
    pub total: u64,
    /// Average so far, bytes per second
    pub bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedResult {
    pub node: String,
    /// Average download speed, bytes per second
    pub bytes_per_sec: u64,
    pub downloaded: u64,
    /// Time from the request until the response headers arrived
    pub ttfb_ms: u64,
    /// Duration of the transfer itself
    pub elapsed_ms: u64,
    /// True when the 10-second window ended before the whole file arrived
    pub partial: bool,
    /// When the test finished (ms since epoch)
    pub at: i64,
}

/// Settings value (MB, 1024-based like the sizes shown everywhere in the app) → bytes.
pub fn size_bytes(mb: u32) -> u64 {
    let mb = mb.clamp(SIZES_MB[0], *SIZES_MB.last().unwrap());
    mb as u64 * 1024 * 1024
}

/// Bytes per second for `bytes` received over `elapsed`.
pub fn rate(bytes: u64, elapsed: Duration) -> u64 {
    let secs = elapsed.as_secs_f64();
    if secs <= 0.0 {
        return 0;
    }
    (bytes as f64 / secs) as u64
}

struct BusyGuard;
impl Drop for BusyGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}

pub fn cancel() {
    if BUSY.load(Ordering::SeqCst) {
        CANCEL.store(true, Ordering::SeqCst);
    }
}

fn progress(app: &AppHandle, p: SpeedProgress) {
    let _ = app.emit("speedtest://progress", p);
}

pub async fn run(app: &AppHandle, node: &str) -> Res<SpeedResult> {
    let st = state(app);
    if !st.core.is_running() {
        return Err(AppError::new("CORE_NOT_RUNNING", "The kernel is not running"));
    }
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err(AppError::new("BUSY", "Another speed test is running"));
    }
    let _guard = BusyGuard;
    CANCEL.store(false, Ordering::SeqCst);

    // point the hidden group at the node under test
    let ctl = st.core.controller();
    let path = format!("/proxies/{}", percent_encoding::utf8_percent_encode(GROUP, percent_encoding::NON_ALPHANUMERIC));
    core::api(&ctl, reqwest::Method::PUT, &path, Some(serde_json::json!({ "name": node })))
        .await
        .map_err(|e| AppError::new("SPEEDTEST_UNAVAILABLE", format!("Can't test this node: {}", e.message)))?;

    let total = size_bytes(st.settings.read().speed_test_size_mb);
    let client = reqwest::Client::builder()
        .user_agent(concat!("ClashWin/", env!("CARGO_PKG_VERSION")))
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{}", st.speedtest_port)).map_err(|e| AppError::network(e.to_string()))?)
        .connect_timeout(CONNECT_TIMEOUT)
        .build()?;

    let started = Instant::now();
    let resp = tokio::time::timeout(CONNECT_TIMEOUT, client.get(test_url(total)).send())
        .await
        .map_err(|_| AppError::network("Timed out connecting through this node"))?
        .map_err(|e| AppError::network(e.to_string()))?;
    let ttfb = started.elapsed();
    if !resp.status().is_success() {
        return Err(AppError::network(format!("HTTP {}", resp.status().as_u16())));
    }

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let t0 = Instant::now();
    let mut downloaded = 0u64;
    let mut last_emit = Instant::now();
    let mut partial = false;
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            return Err(AppError::new("CANCELLED", "Speed test cancelled"));
        }
        let left = WINDOW.saturating_sub(t0.elapsed());
        if left.is_zero() {
            partial = true;
            break;
        }
        match tokio::time::timeout(left.min(STALL), stream.next()).await {
            Ok(Some(Ok(chunk))) => downloaded += chunk.len() as u64,
            Ok(Some(Err(e))) => {
                if downloaded == 0 {
                    return Err(AppError::network(e.to_string()));
                }
                partial = true; // keep what was measured
                break;
            }
            Ok(None) => break,
            Err(_) if t0.elapsed() >= WINDOW => {
                partial = true;
                break;
            }
            Err(_) => {
                if downloaded == 0 {
                    return Err(AppError::network("No data received through this node"));
                }
                partial = true; // stalled
                break;
            }
        }
        if last_emit.elapsed() >= Duration::from_millis(150) {
            last_emit = Instant::now();
            progress(app, SpeedProgress { node: node.to_string(), downloaded, total, bytes_per_sec: rate(downloaded, t0.elapsed()) });
        }
        if downloaded >= total {
            break;
        }
    }
    let elapsed = t0.elapsed();
    if downloaded == 0 {
        return Err(AppError::network("No data received through this node"));
    }
    Ok(SpeedResult {
        node: node.to_string(),
        bytes_per_sec: rate(downloaded, elapsed),
        downloaded,
        ttfb_ms: ttfb.as_millis() as u64,
        elapsed_ms: elapsed.as_millis() as u64,
        partial,
        at: now_ms(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_and_rates() {
        assert_eq!(size_bytes(10), 10 * 1024 * 1024);
        assert_eq!(size_bytes(0), 5 * 1024 * 1024);
        assert_eq!(size_bytes(500), 50 * 1024 * 1024);
        assert_eq!(rate(10_000_000, Duration::from_secs(2)), 5_000_000);
        assert_eq!(rate(1, Duration::ZERO), 0);
        assert!(test_url(5_242_880).ends_with("bytes=5242880"));
    }
}

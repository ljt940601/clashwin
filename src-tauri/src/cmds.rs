//! Tauri commands. One function per entry in src/lib/backend.ts (same snake_case names).

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::config;
use crate::core::{self, CoreStatus};
use crate::geo::{self, LocalLocation};
use crate::profiles::{self, Profile};
use crate::settings::AppSettings;
use crate::state::{state, AppState};
use crate::stats::{HistoryInfo, RouteAgg, StatsPeriod, StatsSummary};
use crate::util::{now_ms, AppError, Res};
use crate::{admin, winutil, windows};

/* ======================= App ======================= */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: String,
    version: String,
    build: String,
    is_admin: bool,
    os: String,
    arch: String,
    data_dir: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> Res<AppInfo> {
    let st = state(&app);
    Ok(AppInfo {
        name: "ClashWin".into(),
        version: app.package_info().version.to_string(),
        build: option_env!("CLASHWIN_BUILD").unwrap_or("1").to_string(),
        is_admin: st.elevated,
        os: sysinfo::System::long_os_version().unwrap_or_else(|| "Windows".into()),
        arch: std::env::consts::ARCH.into(),
        data_dir: st.paths.data.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn app_memory() -> Res<u64> {
    Ok(tokio::task::spawn_blocking(winutil::app_memory).await.unwrap_or(0))
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> Res<()> {
    state(&app).cleanup();
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn restart_as_admin(app: AppHandle) -> Res<()> {
    state(&app).relaunch_elevated(&app)
}

#[tauri::command]
pub async fn open_dashboard(app: AppHandle, page: Option<String>) -> Res<()> {
    windows::hide_tray_panel(&app);
    windows::show_dashboard(&app, page);
    Ok(())
}

#[tauri::command]
pub async fn open_settings(app: AppHandle, tab: Option<String>) -> Res<()> {
    windows::hide_tray_panel(&app);
    windows::open_settings(&app, tab)?;
    Ok(())
}

#[tauri::command]
pub async fn hide_tray_panel(app: AppHandle) -> Res<()> {
    windows::hide_tray_panel(&app);
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct PanelRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub radius: f64,
}

#[tauri::command]
pub async fn set_tray_panel_region(app: AppHandle, rects: Vec<PanelRect>) -> Res<()> {
    let r: Vec<(f64, f64, f64, f64, f64)> = rects.iter().map(|p| (p.x, p.y, p.width, p.height, p.radius)).collect();
    windows::set_tray_panel_region(&app, &r);
    Ok(())
}

#[tauri::command]
pub async fn focus_tray_panel(app: AppHandle) -> Res<()> {
    windows::focus_tray_panel(&app);
    Ok(())
}

#[tauri::command]
pub async fn set_tray_panel_size(app: AppHandle, width: f64, height: f64) -> Res<()> {
    windows::set_tray_panel_size(&app, width, height);
    Ok(())
}

#[tauri::command]
pub async fn open_url(app: AppHandle, url: String) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) {
        return Err(AppError::new("INVALID", "Only http(s) links can be opened"));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::io(e.to_string()))
}

#[tauri::command]
pub async fn reveal_path(path: String) -> Res<()> {
    let p = std::path::Path::new(&path);
    let mut c = crate::util::hidden_command("explorer.exe");
    if p.is_file() {
        c.arg(format!("/select,{}", p.display()));
    } else {
        c.arg(p);
    }
    c.spawn()?;
    Ok(())
}

#[tauri::command]
pub async fn process_icon(app: AppHandle, path: String) -> Res<Option<String>> {
    let st = state(&app);
    if let Some(v) = st.icon_cache.lock().get(&path) {
        return Ok(v.clone());
    }
    let p = path.clone();
    let png = tokio::task::spawn_blocking(move || winutil::process_icon_png(&p)).await.ok().flatten();
    let url = png.map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)));
    st.icon_cache.lock().insert(path, url.clone());
    Ok(url)
}

#[tauri::command]
pub async fn wifi_ssid() -> Res<Option<String>> {
    Ok(tokio::task::spawn_blocking(winutil::wifi_ssid).await.ok().flatten())
}

#[tauri::command]
pub async fn list_interfaces() -> Res<Vec<String>> {
    Ok(tokio::task::spawn_blocking(winutil::list_interfaces).await.unwrap_or_default())
}

#[tauri::command]
pub async fn lan_address() -> Res<Option<String>> {
    Ok(tokio::task::spawn_blocking(winutil::lan_address).await.ok().flatten())
}

#[tauri::command]
pub async fn geoip_lookup(app: AppHandle, ips: Vec<String>) -> Res<Vec<Option<String>>> {
    let st = state(&app);
    st.geo.refresh();
    Ok(ips.iter().map(|ip| st.geo.lookup(ip)).collect())
}

/// Node name -> ISO country for nodes placed by their server IP (names without a country hint).
#[tauri::command]
pub async fn node_countries(app: AppHandle) -> Res<std::collections::HashMap<String, String>> {
    let st = state(&app);
    Ok(crate::nodegeo::refresh(&st).await)
}

#[tauri::command]
pub async fn local_location() -> Res<LocalLocation> {
    Ok(tokio::task::spawn_blocking(geo::local_location).await.unwrap_or(LocalLocation {
        country: "CN".into(),
        city: "Shanghai".into(),
        lat: 31.23,
        lon: 121.47,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
    has_update: bool,
    latest: String,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Res<AppUpdate> {
    // No update server yet: report the running version as latest.
    Ok(AppUpdate { has_update: false, latest: app.package_info().version.to_string(), url: "https://github.com".into(), notes: None })
}

#[tauri::command]
pub async fn install_cli() -> Res<String> {
    tokio::task::spawn_blocking(winutil::install_cli).await.map_err(|e| AppError::io(e.to_string()))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoFile {
    name: String,
    exists: bool,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    modified: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoDbStatus {
    mode: String,
    files: Vec<GeoFile>,
}

#[tauri::command]
pub async fn geo_db_status(app: AppHandle) -> Res<GeoDbStatus> {
    let st = state(&app);
    let mode = if st.settings.read().engine.general.geodata_mode { "dat" } else { "mmdb" };
    let files = ["Country.mmdb", "GeoIP.dat", "GeoSite.dat", "GeoLite2-ASN.mmdb"]
        .iter()
        .map(|name| {
            let meta = std::fs::metadata(st.paths.home.join(name)).ok();
            GeoFile {
                name: name.to_string(),
                exists: meta.is_some(),
                size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                modified: meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64),
            }
        })
        .collect();
    Ok(GeoDbStatus { mode: mode.into(), files })
}

#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Res<()> {
    std::fs::write(&path, content)?;
    Ok(())
}

/* ======================= Settings ======================= */

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Res<AppSettings> {
    Ok(state(&app).settings())
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, patch: Value) -> Res<AppSettings> {
    let st = state(&app);
    let old = st.settings();
    let mut new = old.merged(&patch)?;
    if new.tun_mode && !old.tun_mode && !st.elevated {
        new.tun_mode = false; // TUN must go through set_tun_mode (elevation)
    }
    let new = st.commit_settings(&app, new)?;
    apply_settings_effects(&app, &st, &old, &new).await;
    Ok(new)
}

async fn apply_settings_effects(app: &AppHandle, st: &Arc<AppState>, old: &AppSettings, new: &AppSettings) {
    if old.launch_at_login != new.launch_at_login {
        use tauri_plugin_autostart::ManagerExt;
        let r = if new.launch_at_login { app.autolaunch().enable() } else { app.autolaunch().disable() };
        if let Err(e) = r {
            log::warn!("autostart: {e}");
            st.notify(app, "error", "设置开机自启动失败", "Failed to update launch at login");
        }
    }
    if old.system_proxy != new.system_proxy {
        let _ = st.apply_sysproxy_registry(new.system_proxy && st.core.is_running());
    } else if new.system_proxy
        && st.sysproxy_by_us.load(Ordering::SeqCst)
        && (old.engine.network.mixed_port != new.engine.network.mixed_port || old.engine.network.bypass != new.engine.network.bypass)
    {
        let _ = st.apply_sysproxy_registry(true);
    }
    if old.controller != new.controller {
        if st.core.is_running() {
            let st2 = st.clone();
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = st2.restart_core(&app2).await {
                    st2.notify(&app2, "error", &format!("重启内核失败：{}", e.message), &format!("Kernel restart failed: {}", e.message));
                }
            });
        } else {
            let _ = st.write_runtime();
        }
    } else if old.engine != new.engine || old.outbound_mode != new.outbound_mode || old.tun_mode != new.tun_mode || old.delay_test_url != new.delay_test_url {
        st.schedule_reload(app);
    }
    if old.history_retention_days != new.history_retention_days {
        let _ = st.stats.prune(new.history_retention_days, chrono::Local::now());
    }
}

#[tauri::command]
pub async fn reset_engine(app: AppHandle, section: String) -> Res<AppSettings> {
    let st = state(&app);
    let old = st.settings();
    let mut new = old.clone();
    new.reset_engine_section(&section);
    let new = st.commit_settings(&app, new)?;
    apply_settings_effects(&app, &st, &old, &new).await;
    Ok(new)
}

/* ======================= Proxy switches ======================= */

#[tauri::command]
pub async fn set_system_proxy(app: AppHandle, enable: bool) -> Res<()> {
    let st = state(&app);
    if enable {
        if !st.core.is_running() {
            if !st.paths.core_exe().exists() {
                return Err(AppError::new("CORE_NOT_INSTALLED", "The mihomo core is not installed"));
            }
            st.start_core(&app).await?;
        }
        // Apply first: if the port belongs to another program this fails and the
        // setting stays off instead of claiming a proxy that isn't ours.
        st.apply_sysproxy_registry(true)?;
        st.update_settings(&app, |s| s.system_proxy = true)?;
    } else {
        st.update_settings(&app, |s| s.system_proxy = false)?;
        st.apply_sysproxy_registry(false)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_tun_mode(app: AppHandle, enable: bool) -> Res<()> {
    let st = state(&app);
    if enable && !st.elevated {
        if admin::helper_installed() {
            st.update_settings(&app, |s| s.tun_mode = true)?;
            st.relaunch_elevated(&app)?;
            return Ok(());
        }
        return Err(AppError::new("NEED_ADMIN", "Enhanced Mode requires administrator rights"));
    }
    let prev = st.settings().tun_mode;
    st.update_settings(&app, |s| s.tun_mode = enable)?;
    if let Err(e) = st.reload(&app).await {
        st.update_settings(&app, |s| s.tun_mode = prev)?;
        let _ = st.write_runtime();
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub async fn set_outbound_mode(app: AppHandle, mode: String) -> Res<()> {
    if !matches!(mode.as_str(), "rule" | "global" | "direct") {
        return Err(AppError::new("INVALID", "mode must be rule, global or direct"));
    }
    let st = state(&app);
    st.update_settings(&app, |s| s.outbound_mode = mode.clone())?;
    let _ = st.write_runtime();
    if st.core.is_running() {
        core::api(&st.core.controller(), reqwest::Method::PATCH, "/configs", Some(json!({ "mode": mode }))).await?;
    }
    Ok(())
}

/* ======================= Core ======================= */

#[tauri::command]
pub async fn core_status(app: AppHandle) -> Res<CoreStatus> {
    Ok(state(&app).core.status())
}

#[tauri::command]
pub async fn core_start(app: AppHandle) -> Res<CoreStatus> {
    state(&app).start_core(&app).await
}

#[tauri::command]
pub async fn core_stop(app: AppHandle) -> Res<CoreStatus> {
    Ok(state(&app).stop_core(&app).await)
}

#[tauri::command]
pub async fn core_restart(app: AppHandle) -> Res<CoreStatus> {
    state(&app).restart_core(&app).await
}

#[tauri::command]
pub async fn core_reload(app: AppHandle) -> Res<()> {
    let st = state(&app);
    if !st.core.is_running() {
        if st.paths.core_exe().exists() {
            st.start_core(&app).await?;
            return Ok(());
        }
        return Err(AppError::new("CORE_NOT_RUNNING", "The kernel is not running"));
    }
    st.reload(&app).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreUpdateInfo {
    channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    current: Option<String>,
    latest: String,
    has_update: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

fn local_proxy(st: &AppState) -> Option<String> {
    st.core.is_running().then(|| format!("http://127.0.0.1:{}", st.settings.read().engine.network.mixed_port))
}

async fn release_with_fallback(st: &AppState, channel: &str) -> Res<core::ReleaseInfo> {
    match core::fetch_release(channel, None).await {
        Ok(r) => Ok(r),
        Err(e) => match local_proxy(st) {
            Some(p) => core::fetch_release(channel, Some(&p)).await.map_err(|_| e),
            None => Err(e),
        },
    }
}

#[tauri::command]
pub async fn core_check_update(app: AppHandle, channel: String) -> Res<CoreUpdateInfo> {
    let st = state(&app);
    let rel = release_with_fallback(&st, &channel).await?;
    let current = st.core.status().version.or_else(|| std::fs::read_to_string(st.paths.core_version_file()).ok().map(|s| s.trim().to_string()));
    let has_update = current.as_deref() != Some(rel.version.as_str());
    Ok(CoreUpdateInfo { channel, current, latest: rel.version, has_update, notes: (!rel.notes.is_empty()).then_some(rel.notes) })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    stage: String,
    downloaded: u64,
    total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn progress(app: &AppHandle, stage: &str, downloaded: u64, total: u64, message: Option<String>) {
    let _ = app.emit("core://download-progress", DownloadProgress { stage: stage.into(), downloaded, total, message });
}

/// Download + install the core for `channel`, then (re)start it. Used by the command and first-run.
pub async fn install_core(app: &AppHandle, channel: &str) -> Res<CoreStatus> {
    let st = state(app);
    let prev = st.core.status();
    let was_running = prev.state == "running";
    st.core.update(|s| {
        s.state = "downloading".into();
        s.error = None;
    });
    st.emit_core(app);
    progress(app, "checking", 0, 0, None);

    let result: Res<String> = async {
        let rel = release_with_fallback(&st, channel).await?;
        let app2 = app.clone();
        let cb = move |d: u64, t: u64| progress(&app2, "downloading", d, t, None);
        let zip = match core::download(&rel.asset_url, None, cb.clone()).await {
            Ok(z) => z,
            Err(e) => match local_proxy(&st) {
                Some(p) => core::download(&rel.asset_url, Some(&p), cb).await.map_err(|_| e)?,
                None => return Err(e),
            },
        };
        progress(app, "extracting", zip.len() as u64, zip.len() as u64, None);
        let bin = tokio::task::spawn_blocking(move || core::extract_exe(&zip)).await.map_err(|e| AppError::io(e.to_string()))??;
        // replace the binary (stop the core first: Windows locks running executables)
        let _g = st.op.lock().await;
        st.core.generation.fetch_add(1, Ordering::SeqCst);
        st.core.kill();
        let exe = st.paths.core_exe();
        if let Some(cur) = prev.version.clone() {
            core::backup_current(&exe, &st.paths.versions, &cur);
        }
        core::install_binary(&exe, &st.paths.core_version_file(), &bin, &rel.version)?;
        core::backup_current(&exe, &st.paths.versions, &rel.version);
        Ok(rel.version)
    }
    .await;

    match result {
        Ok(version) => {
            st.core.update(|s| {
                s.state = "stopped".into();
                s.version = Some(version.clone());
                s.pid = None;
            });
            progress(app, "done", 1, 1, Some(version));
            st.emit_core(app);
            let _ = was_running;
            st.start_core(app).await
        }
        Err(e) => {
            progress(app, "error", 0, 0, Some(e.message.clone()));
            // restore the previous state if we never touched the running core
            let still_running = st.core.has_child();
            st.core.update(|s| {
                s.state = if still_running && was_running {
                    "running".into()
                } else if st.paths.core_exe().exists() {
                    "stopped".into()
                } else {
                    "not_installed".into()
                };
                s.error = Some(e.message.clone());
            });
            st.emit_core(app);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn core_install(app: AppHandle, channel: String) -> Res<CoreStatus> {
    install_core(&app, &channel).await
}

#[tauri::command]
pub async fn core_cached_versions(app: AppHandle) -> Res<Vec<String>> {
    Ok(core::cached_versions(&state(&app).paths.versions))
}

#[tauri::command]
pub async fn core_rollback(app: AppHandle, version: String) -> Res<CoreStatus> {
    let st = state(&app);
    let src = st.paths.versions.join(core::sanitize(&version)).join("mihomo.exe");
    if !src.exists() {
        return Err(AppError::not_found(format!("Version {version} is not cached")));
    }
    let bytes = std::fs::read(&src)?;
    {
        let _g = st.op.lock().await;
        st.core.generation.fetch_add(1, Ordering::SeqCst);
        st.core.kill();
        let exe = st.paths.core_exe();
        if let Some(cur) = st.core.status().version {
            core::backup_current(&exe, &st.paths.versions, &cur);
        }
        core::install_binary(&exe, &st.paths.core_version_file(), &bytes, &version)?;
        st.core.update(|s| {
            s.state = "stopped".into();
            s.version = Some(version.clone());
            s.pid = None;
        });
    }
    st.emit_core(&app);
    st.start_core(&app).await
}

#[tauri::command]
pub async fn core_log_tail(app: AppHandle, lines: usize) -> Res<Vec<String>> {
    Ok(state(&app).core.log_tail(lines.min(2000)))
}

/* ======================= Helper ======================= */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperStatus {
    installed: bool,
    running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    latest_version: String,
}

fn helper_status_now(st: &AppState) -> HelperStatus {
    let installed = admin::helper_installed();
    HelperStatus {
        installed,
        running: installed && st.elevated,
        version: installed.then(|| admin::HELPER_VERSION.to_string()),
        latest_version: admin::HELPER_VERSION.into(),
    }
}

#[tauri::command]
pub async fn helper_status(app: AppHandle) -> Res<HelperStatus> {
    let st = state(&app);
    Ok(tokio::task::spawn_blocking(move || helper_status_now(&st)).await.map_err(|e| AppError::io(e.to_string()))?)
}

#[tauri::command]
pub async fn helper_install(app: AppHandle) -> Res<HelperStatus> {
    let st = state(&app);
    let data = st.paths.data.clone();
    tokio::task::spawn_blocking(move || admin::helper_install(&data)).await.map_err(|e| AppError::io(e.to_string()))??;
    Ok(helper_status_now(&st))
}

#[tauri::command]
pub async fn helper_uninstall(app: AppHandle) -> Res<HelperStatus> {
    let st = state(&app);
    tokio::task::spawn_blocking(admin::helper_uninstall).await.map_err(|e| AppError::io(e.to_string()))??;
    Ok(helper_status_now(&st))
}

/* ======================= Profiles ======================= */

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

async fn fetch_subscription(st: &AppState, url: &str) -> Res<profiles::Fetched> {
    match profiles::fetch(url, None).await {
        Ok(f) => Ok(f),
        Err(e) if e.code == "NETWORK" => match local_proxy(st) {
            Some(p) => profiles::fetch(url, Some(&p)).await.map_err(|_| e),
            None => Err(e),
        },
        Err(e) => Err(e),
    }
}

fn view_of(st: &AppState, id: &str) -> Res<Profile> {
    st.profiles_view().into_iter().find(|p| p.id == id).ok_or_else(|| AppError::not_found(format!("Profile {id} not found")))
}

/// Reload the core if `id` is the active profile.
async fn reload_if_active(app: &AppHandle, st: &Arc<AppState>, id: &str) -> Res<()> {
    if st.settings.read().active_profile_id.as_deref() == Some(id) {
        st.reload(app).await?;
    }
    Ok(())
}

async fn add_profile(app: &AppHandle, st: &Arc<AppState>, p: Profile) -> Res<Profile> {
    let id = p.id.clone();
    st.profiles.write().push(p);
    st.save_profiles()?;
    st.emit_profiles(app);
    if st.settings.read().active_profile_id.is_none() {
        activate(app, st, &id).await?;
    }
    view_of(st, &id)
}

#[tauri::command]
pub async fn list_profiles(app: AppHandle) -> Res<Vec<Profile>> {
    Ok(state(&app).profiles_view())
}

#[tauri::command]
pub async fn import_profile_url(app: AppHandle, url: String, name: Option<String>) -> Res<Profile> {
    let st = state(&app);
    let url = url.trim().to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::new("INVALID", "Subscription URL must start with http:// or https://"));
    }
    let f = fetch_subscription(&st, &url).await?;
    let id = new_id();
    let file = st.paths.profile_file(&id);
    crate::util::write_atomic(&file, f.text.as_bytes())?;
    let name = name.filter(|n| !n.trim().is_empty()).or(f.name).unwrap_or_else(|| profiles::name_from_url(&url));
    let p = Profile {
        id,
        name,
        kind: "remote".into(),
        url: Some(url),
        file: file.to_string_lossy().to_string(),
        updated_at: now_ms(),
        auto_update_minutes: Some(1440),
        subscription: f.info,
        providers: None,
        has_rule_override: None,
    };
    add_profile(&app, &st, p).await
}

#[tauri::command]
pub async fn import_profile_file(app: AppHandle, path: String, name: Option<String>) -> Res<Profile> {
    let st = state(&app);
    let text = std::fs::read_to_string(&path).map_err(|e| AppError::io(format!("Cannot read {path}: {e}")))?;
    config::validate_profile_text(&text)?;
    let id = new_id();
    let file = st.paths.profile_file(&id);
    crate::util::write_atomic(&file, text.as_bytes())?;
    let default_name = std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Local".into());
    let p = Profile {
        id,
        name: name.filter(|n| !n.trim().is_empty()).unwrap_or(default_name),
        kind: "local".into(),
        url: None,
        file: file.to_string_lossy().to_string(),
        updated_at: now_ms(),
        auto_update_minutes: None,
        subscription: None,
        providers: None,
        has_rule_override: None,
    };
    add_profile(&app, &st, p).await
}

#[tauri::command]
pub async fn create_profile(app: AppHandle, name: String, content: Option<String>) -> Res<Profile> {
    let st = state(&app);
    let text = content.filter(|c| !c.trim().is_empty()).unwrap_or_else(|| profiles::BLANK_PROFILE.to_string());
    config::parse_profile(&text)?;
    let id = new_id();
    let file = st.paths.profile_file(&id);
    crate::util::write_atomic(&file, text.as_bytes())?;
    let p = Profile {
        id,
        name: if name.trim().is_empty() { "Local".into() } else { name.trim().to_string() },
        kind: "local".into(),
        url: None,
        file: file.to_string_lossy().to_string(),
        updated_at: now_ms(),
        auto_update_minutes: None,
        subscription: None,
        providers: None,
        has_rule_override: None,
    };
    add_profile(&app, &st, p).await
}

/// Re-download a remote profile. Shared with the auto-update task.
pub async fn update_profile_inner(app: &AppHandle, id: &str) -> Res<Profile> {
    let st = state(app);
    let p = st.profile(id)?;
    if p.is_remote() {
        let url = p.url.clone().ok_or_else(|| AppError::invalid_config("Remote profile has no URL"))?;
        let f = fetch_subscription(&st, &url).await?;
        crate::util::write_atomic(std::path::Path::new(&p.file), f.text.as_bytes())?;
        {
            let mut list = st.profiles.write();
            if let Some(x) = list.iter_mut().find(|x| x.id == id) {
                x.updated_at = now_ms();
                if f.info.is_some() {
                    x.subscription = f.info;
                }
            }
        }
        st.save_profiles()?;
        st.emit_profiles(app);
        reload_if_active(app, &st, id).await?;
    }
    view_of(&st, id)
}

#[tauri::command]
pub async fn update_profile(app: AppHandle, id: String) -> Res<Profile> {
    update_profile_inner(&app, &id).await
}

#[tauri::command]
pub async fn update_all_profiles(app: AppHandle) -> Res<Vec<Profile>> {
    let st = state(&app);
    let ids: Vec<String> = st.profiles.read().iter().filter(|p| p.is_remote()).map(|p| p.id.clone()).collect();
    let mut errors = vec![];
    for id in ids {
        if let Err(e) = update_profile_inner(&app, &id).await {
            let name = st.profile(&id).map(|p| p.name).unwrap_or(id);
            errors.push(format!("{name}: {}", e.message));
        }
    }
    if !errors.is_empty() {
        st.notify(&app, "warning", &format!("部分订阅更新失败\n{}", errors.join("\n")), &format!("Some subscriptions failed to update\n{}", errors.join("\n")));
    }
    Ok(st.profiles_view())
}

#[tauri::command]
pub async fn delete_profile(app: AppHandle, id: String) -> Res<()> {
    let st = state(&app);
    let p = st.profile(&id)?;
    {
        let mut list = st.profiles.write();
        list.retain(|x| x.id != id);
        for x in list.iter_mut() {
            if let Some(pv) = x.providers.as_mut() {
                pv.retain(|y| y != &id);
            }
        }
    }
    st.save_profiles()?;
    let _ = std::fs::remove_file(&p.file);
    let _ = std::fs::remove_file(st.paths.rules_override_file(&id));
    let _ = std::fs::remove_file(st.paths.home.join("providers").join(format!("{id}.yaml")));
    st.editor_watch.lock().remove(&id);
    let was_active = st.settings.read().active_profile_id.as_deref() == Some(id.as_str());
    if was_active {
        let next = st.profiles.read().first().map(|x| x.id.clone());
        st.update_settings(&app, |s| s.active_profile_id = next)?;
        if st.core.is_running() {
            st.reload(&app).await?;
        } else {
            let _ = st.write_runtime();
        }
    }
    st.emit_profiles(&app);
    Ok(())
}

#[tauri::command]
pub async fn edit_profile_meta(app: AppHandle, id: String, patch: Value) -> Res<Profile> {
    let st = state(&app);
    {
        let mut list = st.profiles.write();
        let p = list.iter_mut().find(|x| x.id == id).ok_or_else(|| AppError::not_found("Profile not found"))?;
        if let Some(n) = patch.get("name").and_then(|v| v.as_str()) {
            if !n.trim().is_empty() {
                p.name = n.trim().to_string();
            }
        }
        if let Some(u) = patch.get("url").and_then(|v| v.as_str()) {
            if p.is_remote() && !u.trim().is_empty() {
                p.url = Some(u.trim().to_string());
            }
        }
        if let Some(m) = patch.get("autoUpdateMinutes").and_then(|v| v.as_u64()) {
            p.auto_update_minutes = Some(m as u32);
        }
    }
    st.save_profiles()?;
    st.emit_profiles(&app);
    view_of(&st, &id)
}

async fn activate(app: &AppHandle, st: &Arc<AppState>, id: &str) -> Res<()> {
    st.profile(id)?;
    let prev = st.settings().active_profile_id;
    st.update_settings(app, |s| s.active_profile_id = Some(id.to_string()))?;
    if st.core.is_running() {
        if let Err(e) = st.reload(app).await {
            st.update_settings(app, |s| s.active_profile_id = prev)?;
            let _ = st.write_runtime();
            return Err(e);
        }
    } else {
        let _ = st.write_runtime();
        if st.paths.core_exe().exists() && st.core.status().state != "downloading" {
            st.start_core(app).await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn set_active_profile(app: AppHandle, id: String) -> Res<()> {
    let st = state(&app);
    activate(&app, &st, &id).await
}

#[tauri::command]
pub async fn read_profile(app: AppHandle, id: String) -> Res<String> {
    let p = state(&app).profile(&id)?;
    Ok(std::fs::read_to_string(&p.file)?)
}

/// Validate with `mihomo -t` when the core is installed, else a YAML sanity check.
///
/// On a fresh install `mihomo -t` first downloads the GeoIP/GeoSite databases, which can
/// take a long time; after a few seconds we stop waiting and accept a config that parses.
async fn validate_with_core(st: &AppState, content: &str) -> Res<()> {
    config::parse_profile(content)?;
    let exe = st.paths.core_exe();
    if !exe.exists() {
        return config::validate_profile_text(content).map(|_| ());
    }
    let tag = uuid::Uuid::new_v4().simple().to_string();
    let tmp = st.paths.home.join(format!("validate-{tag}.yaml"));
    let log = st.paths.home.join(format!("validate-{tag}.log"));
    std::fs::write(&tmp, content)?;
    let (home, tmp2, log2) = (st.paths.home.clone(), tmp.clone(), log.clone());
    // Output goes to a file, not a pipe: a full pipe would block the child until the timeout.
    let res = tokio::task::spawn_blocking(move || -> std::io::Result<Option<bool>> {
        let out = std::fs::File::create(&log2)?;
        let mut child = crate::util::hidden_command(&exe)
            .arg("-t")
            .arg("-d")
            .arg(&home)
            .arg("-f")
            .arg(&tmp2)
            .stdout(out.try_clone()?)
            .stderr(out)
            .spawn()?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(12);
        loop {
            if let Some(status) = child.try_wait()? {
                return Ok(Some(status.success()));
            }
            if std::time::Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(None);
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    })
    .await;
    let output = std::fs::read(&log).map(|b| crate::util::decode_console(&b)).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    let _ = std::fs::remove_file(&log);
    match res {
        Ok(Ok(Some(true))) => Ok(()),
        Ok(Ok(Some(false))) => {
            let msg = output
                .lines()
                .filter(|l| l.to_ascii_lowercase().contains("error") || l.to_ascii_lowercase().contains("fatal"))
                .last()
                .unwrap_or_else(|| output.lines().last().unwrap_or("Invalid configuration"))
                .to_string();
            Err(AppError::invalid_config(msg))
        }
        Ok(Ok(None)) => {
            log::warn!("mihomo -t did not finish in time (likely downloading geo data); accepting the parsed config");
            config::validate_profile_text(content).map(|_| ())
        }
        Ok(Err(e)) => Err(AppError::io(format!("Failed to run the core for validation: {e}"))),
        Err(e) => Err(AppError::io(e.to_string())),
    }
}

/// Remove validation leftovers from older versions / interrupted runs.
pub fn cleanup_validation_files(home: &std::path::Path) {
    if let Ok(rd) = std::fs::read_dir(home) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("validate") && (name.ends_with(".yaml") || name.ends_with(".log")) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

#[tauri::command]
pub async fn write_profile(app: AppHandle, id: String, content: String) -> Res<()> {
    let st = state(&app);
    let p = st.profile(&id)?;
    validate_with_core(&st, &content).await?;
    crate::util::write_atomic(std::path::Path::new(&p.file), content.as_bytes())?;
    {
        let mut list = st.profiles.write();
        if let Some(x) = list.iter_mut().find(|x| x.id == id) {
            x.updated_at = now_ms();
        }
    }
    st.save_profiles()?;
    if let Some(m) = st.editor_watch.lock().get_mut(&id) {
        *m = std::fs::metadata(&p.file).and_then(|m| m.modified()).ok();
    }
    st.emit_profiles(&app);
    reload_if_active(&app, &st, &id).await
}

#[tauri::command]
pub async fn open_profile_in_editor(app: AppHandle, id: String) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    let st = state(&app);
    let p = st.profile(&id)?;
    let mtime = std::fs::metadata(&p.file).and_then(|m| m.modified()).ok();
    st.editor_watch.lock().insert(id.clone(), mtime);
    if app.opener().open_path(&p.file, None::<&str>).is_err() {
        std::process::Command::new("notepad.exe").arg(&p.file).spawn()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_profile_providers(app: AppHandle, id: String, provider_ids: Vec<String>) -> Res<Profile> {
    let st = state(&app);
    {
        let mut list = st.profiles.write();
        let valid: Vec<String> = provider_ids
            .into_iter()
            .filter(|pid| pid != &id && list.iter().any(|x| &x.id == pid && x.is_remote()))
            .collect();
        let p = list.iter_mut().find(|x| x.id == id).ok_or_else(|| AppError::not_found("Profile not found"))?;
        p.providers = if valid.is_empty() { None } else { Some(valid) };
    }
    st.save_profiles()?;
    st.emit_profiles(&app);
    reload_if_active(&app, &st, &id).await?;
    view_of(&st, &id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalResource {
    kind: String,
    name: String,
    vehicle_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    behavior: Option<String>,
    count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    alive: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

#[tauri::command]
pub async fn external_resources(app: AppHandle) -> Res<Vec<ExternalResource>> {
    let st = state(&app);
    if !st.core.is_running() {
        return Ok(vec![]);
    }
    let ctl = st.core.controller();
    let mut out = vec![];
    let px = core::api(&ctl, reqwest::Method::GET, "/providers/proxies", None).await?;
    if let Some(map) = px.get("providers").and_then(|p| p.as_object()) {
        for (name, p) in map {
            let vt = p.get("vehicleType").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if vt == "Compatible" {
                continue;
            }
            let proxies = p.get("proxies").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let alive = proxies
                .iter()
                .filter(|x| {
                    x.get("alive").and_then(|a| a.as_bool()).unwrap_or_else(|| {
                        x.get("history").and_then(|h| h.as_array()).and_then(|h| h.last()).and_then(|l| l.get("delay")).and_then(|d| d.as_u64()).unwrap_or(0) > 0
                    })
                })
                .count() as u64;
            out.push(ExternalResource {
                kind: "proxy".into(),
                name: name.clone(),
                vehicle_type: vt,
                behavior: None,
                count: proxies.len() as u64,
                alive: Some(alive),
                updated_at: p.get("updatedAt").and_then(|v| v.as_str()).map(|s| s.to_string()),
            });
        }
    }
    let rx = core::api(&ctl, reqwest::Method::GET, "/providers/rules", None).await?;
    if let Some(map) = rx.get("providers").and_then(|p| p.as_object()) {
        for (name, p) in map {
            out.push(ExternalResource {
                kind: "rule".into(),
                name: name.clone(),
                vehicle_type: p.get("vehicleType").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                behavior: p.get("behavior").and_then(|v| v.as_str()).map(|s| s.to_string()),
                count: p.get("ruleCount").and_then(|v| v.as_u64()).unwrap_or(0),
                alive: None,
                updated_at: p.get("updatedAt").and_then(|v| v.as_str()).map(|s| s.to_string()),
            });
        }
    }
    out.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.name.cmp(&b.name)));
    Ok(out)
}

#[tauri::command]
pub async fn update_external_resources(app: AppHandle) -> Res<()> {
    let st = state(&app);
    if !st.core.is_running() {
        return Err(AppError::new("CORE_NOT_RUNNING", "The kernel is not running"));
    }
    let ctl = st.core.controller();
    let enc = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
    let mut tasks = vec![];
    for (kind, path) in [("proxies", "/providers/proxies"), ("rules", "/providers/rules")] {
        let v = core::api(&ctl, reqwest::Method::GET, path, None).await?;
        if let Some(map) = v.get("providers").and_then(|p| p.as_object()) {
            for (name, p) in map {
                if p.get("vehicleType").and_then(|v| v.as_str()) == Some("HTTP") {
                    tasks.push(format!("/providers/{kind}/{}", enc(name)));
                }
            }
        }
    }
    let results = futures_util::future::join_all(tasks.iter().map(|p| core::api(&ctl, reqwest::Method::PUT, p, None))).await;
    let failed: Vec<String> = results.into_iter().filter_map(|r| r.err().map(|e| e.message)).collect();
    if !failed.is_empty() && failed.len() == tasks.len() {
        return Err(AppError::network(failed.join("; ")));
    }
    Ok(())
}

/* ======================= Rules ======================= */

fn active_rules(st: &AppState) -> Res<Vec<String>> {
    let Some(p) = st.active_profile() else { return Ok(vec![]) };
    if let Some(ov) = st.rule_override(&p.id) {
        return Ok(ov);
    }
    let text = std::fs::read_to_string(&p.file)?;
    Ok(config::rules_of(&config::parse_profile(&text)?))
}

async fn store_rules(app: &AppHandle, st: &Arc<AppState>, rules: Vec<String>) -> Res<()> {
    let p = st.active_profile().ok_or_else(|| AppError::not_found("No active profile"))?;
    let path = st.paths.rules_override_file(&p.id);
    let prev = std::fs::read(&path).ok();
    crate::util::write_atomic(&path, &serde_json::to_vec_pretty(&rules)?)?;
    if let Err(e) = st.reload(app).await {
        match prev {
            Some(b) => {
                let _ = std::fs::write(&path, b);
            }
            None => {
                let _ = std::fs::remove_file(&path);
            }
        }
        let _ = st.write_runtime();
        return Err(e);
    }
    st.emit_profiles(app);
    Ok(())
}

#[tauri::command]
pub async fn get_rules(app: AppHandle) -> Res<Vec<String>> {
    active_rules(&state(&app))
}

#[tauri::command]
pub async fn set_rules(app: AppHandle, rules: Vec<String>) -> Res<()> {
    let st = state(&app);
    let rules: Vec<String> = rules.into_iter().map(|r| r.trim().to_string()).filter(|r| !r.is_empty()).collect();
    store_rules(&app, &st, rules).await
}

#[tauri::command]
pub async fn add_rule(app: AppHandle, rule: String) -> Res<()> {
    let st = state(&app);
    let rule = rule.trim().to_string();
    if rule.is_empty() {
        return Err(AppError::new("INVALID", "Empty rule"));
    }
    let mut rules = active_rules(&st)?;
    rules.insert(0, rule);
    store_rules(&app, &st, rules).await
}

#[tauri::command]
pub async fn reset_rules(app: AppHandle) -> Res<()> {
    let st = state(&app);
    if let Some(p) = st.active_profile() {
        let _ = std::fs::remove_file(st.paths.rules_override_file(&p.id));
    }
    st.reload(&app).await?;
    st.emit_profiles(&app);
    Ok(())
}

#[tauri::command]
pub async fn rule_targets(app: AppHandle) -> Res<Vec<String>> {
    let st = state(&app);
    let mut out: Vec<String> = vec!["DIRECT".into(), "REJECT".into(), "REJECT-DROP".into(), "PASS".into()];
    if let Ok(m) = st.build_runtime() {
        for g in config::group_names(&m) {
            if !out.contains(&g) {
                out.push(g);
            }
        }
    }
    Ok(out)
}

/* ======================= Stats ======================= */

#[tauri::command]
pub async fn stats_summary(app: AppHandle) -> Res<StatsSummary> {
    let st = state(&app);
    tokio::task::spawn_blocking(move || st.stats.summary()).await.map_err(|e| AppError::io(e.to_string()))?
}

#[tauri::command]
pub async fn stats_period(app: AppHandle, period: String) -> Res<StatsPeriod> {
    let st = state(&app);
    tokio::task::spawn_blocking(move || st.stats.period(&period, chrono::Local::now())).await.map_err(|e| AppError::io(e.to_string()))?
}

#[tauri::command]
pub async fn stats_routes(app: AppHandle, range: String) -> Res<Vec<RouteAgg>> {
    let st = state(&app);
    tokio::task::spawn_blocking(move || st.stats.routes(&range, chrono::Local::now())).await.map_err(|e| AppError::io(e.to_string()))?
}

#[tauri::command]
pub async fn history_info(app: AppHandle) -> Res<HistoryInfo> {
    let st = state(&app);
    tokio::task::spawn_blocking(move || st.stats.info()).await.map_err(|e| AppError::io(e.to_string()))?
}

#[tauri::command]
pub async fn history_clear(app: AppHandle) -> Res<()> {
    let st = state(&app);
    tokio::task::spawn_blocking(move || st.stats.clear()).await.map_err(|e| AppError::io(e.to_string()))?
}

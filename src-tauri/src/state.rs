//! Central app state and orchestration (core lifecycle, reloads, system proxy, events).

use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

use crate::config::{self, GenInput, MountedProvider};
use crate::core::{self, ControllerInfo, CoreManager, CoreStatus};
use crate::geo::GeoDb;
use crate::profiles::{self, Profile};
use crate::settings::AppSettings;
use crate::stats::Stats;
use crate::util::{now_ms, AppError, Paths, Res};
use crate::{admin, sysproxy};

pub struct TrayUi {
    pub anchor: Option<(f64, f64)>,
    pub hidden_at: Option<Instant>,
    pub size: (f64, f64),
    /// Visible shapes of the popup (physical px, window-relative); empty = whole window.
    pub region: Vec<crate::traypopup::RegionRect>,
}

pub struct AppState {
    pub paths: Paths,
    pub elevated: bool,
    pub settings: RwLock<AppSettings>,
    pub profiles: RwLock<Vec<Profile>>,
    pub core: CoreManager,
    pub stats: Stats,
    pub geo: GeoDb,
    /// latest (up, down) bytes/s from the traffic stream
    pub traffic: Mutex<(u64, u64)>,
    pub sysproxy_by_us: AtomicBool,
    /// What we wrote to the system proxy and what was there before (restored on release).
    pub sysproxy_owned: Mutex<Option<(sysproxy::ProxyState, Option<sysproxy::ProxyState>)>>,
    pub editor_watch: Mutex<HashMap<String, Option<SystemTime>>>,
    pub icon_cache: Mutex<HashMap<String, Option<String>>>,
    pub tray_ui: Mutex<TrayUi>,
    /// Wi-Fi bypass: (systemProxy, tunMode) before bypass kicked in
    pub wifi_prev: Mutex<Option<(bool, bool)>>,
    pub reload_seq: AtomicU64,
    pub op: tokio::sync::Mutex<()>,
    pub cleaned_up: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Notify {
    pub kind: String,
    pub message: String,
}

pub fn state(app: &AppHandle) -> Arc<AppState> {
    app.state::<Arc<AppState>>().inner().clone()
}

impl AppState {
    pub fn new(paths: Paths) -> Self {
        let _ = paths.ensure();
        let settings = AppSettings::load(&paths.settings);
        let _ = settings.save(&paths.settings);
        let profiles = profiles::load(&paths.profiles_json);
        let exe = paths.core_exe();
        let installed = exe.exists();
        let version = if installed { core::read_installed_version(&paths.core_version_file(), &exe) } else { None };
        let ctl = ControllerInfo { url: settings.controller_url(), secret: settings.controller.secret.clone() };
        let stats = Stats::open(&paths.history_db);
        let geo = GeoDb::new(&paths.home);
        Self {
            elevated: admin::is_elevated(),
            core: CoreManager::new(ctl, installed, version),
            settings: RwLock::new(settings),
            profiles: RwLock::new(profiles),
            stats,
            geo,
            traffic: Mutex::new((0, 0)),
            sysproxy_by_us: AtomicBool::new(false),
            sysproxy_owned: Mutex::new(None),
            editor_watch: Mutex::new(HashMap::new()),
            icon_cache: Mutex::new(HashMap::new()),
            tray_ui: Mutex::new(TrayUi { anchor: None, hidden_at: None, size: (600.0, 660.0), region: vec![] }),
            wifi_prev: Mutex::new(None),
            reload_seq: AtomicU64::new(0),
            op: tokio::sync::Mutex::new(()),
            cleaned_up: AtomicBool::new(false),
            paths,
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.settings.read().clone()
    }

    /* ---------------- events ---------------- */

    pub fn emit_settings(&self, app: &AppHandle) {
        let _ = app.emit("settings://changed", self.settings());
    }
    pub fn emit_core(&self, app: &AppHandle) {
        let _ = app.emit("core://status", self.core.status());
    }
    pub fn emit_profiles(&self, app: &AppHandle) {
        let _ = app.emit("profiles://changed", self.profiles_view());
    }
    pub fn notify(&self, app: &AppHandle, kind: &str, zh: &str, en: &str) {
        let msg = if self.settings.read().is_zh() { zh } else { en };
        let _ = app.emit("app://notify", Notify { kind: kind.into(), message: msg.into() });
    }

    /// Replace settings, persist and broadcast.
    pub fn commit_settings(&self, app: &AppHandle, s: AppSettings) -> Res<AppSettings> {
        s.save(&self.paths.settings)?;
        *self.settings.write() = s.clone();
        self.emit_settings(app);
        Ok(s)
    }

    pub fn update_settings(&self, app: &AppHandle, f: impl FnOnce(&mut AppSettings)) -> Res<AppSettings> {
        let mut s = self.settings();
        f(&mut s);
        self.commit_settings(app, s)
    }

    /* ---------------- profiles ---------------- */

    pub fn profiles_view(&self) -> Vec<Profile> {
        self.profiles
            .read()
            .iter()
            .cloned()
            .map(|mut p| {
                p.has_rule_override = Some(self.paths.rules_override_file(&p.id).exists());
                p
            })
            .collect()
    }

    pub fn save_profiles(&self) -> Res<()> {
        profiles::save(&self.paths.profiles_json, &self.profiles.read())
    }

    pub fn profile(&self, id: &str) -> Res<Profile> {
        self.profiles.read().iter().find(|p| p.id == id).cloned().ok_or_else(|| AppError::not_found(format!("Profile {id} not found")))
    }

    pub fn active_profile(&self) -> Option<Profile> {
        let id = self.settings.read().active_profile_id.clone()?;
        self.profiles.read().iter().find(|p| p.id == id).cloned()
    }

    pub fn rule_override(&self, id: &str) -> Option<Vec<String>> {
        std::fs::read(self.paths.rules_override_file(id)).ok().and_then(|b| serde_json::from_slice(&b).ok())
    }

    /* ---------------- runtime config ---------------- */

    pub fn build_runtime(&self) -> Res<serde_yaml::Mapping> {
        let settings = self.settings();
        let active = self.active_profile();
        let text = match &active {
            Some(p) => Some(std::fs::read_to_string(&p.file).map_err(|e| AppError::io(format!("Cannot read profile {}: {e}", p.name)))?),
            None => None,
        };
        let ov = active.as_ref().and_then(|p| self.rule_override(&p.id));
        let providers: Vec<MountedProvider> = match &active {
            Some(p) => {
                let list = self.profiles.read();
                p.providers
                    .clone()
                    .unwrap_or_default()
                    .iter()
                    .filter(|id| **id != p.id)
                    .filter_map(|id| list.iter().find(|x| &x.id == id))
                    .filter_map(|x| x.url.clone().map(|url| MountedProvider { id: x.id.clone(), name: x.name.clone(), url }))
                    .collect()
            }
            None => vec![],
        };
        config::generate(&GenInput {
            profile_yaml: text.as_deref(),
            rule_override: ov.as_deref(),
            providers: &providers,
            settings: &settings,
            tun_allowed: self.elevated,
        })
    }

    pub fn write_runtime(&self) -> Res<PathBuf> {
        let m = self.build_runtime()?;
        let path = self.paths.runtime_config();
        crate::util::write_atomic(&path, config::to_yaml(&m)?.as_bytes())?;
        Ok(path)
    }

    /// Regenerate runtime config and hot-reload the running core.
    pub async fn reload(&self, _app: &AppHandle) -> Res<()> {
        let path = self.write_runtime()?;
        if !self.core.is_running() {
            return Ok(());
        }
        let ctl = self.core.controller();
        core::api(&ctl, reqwest::Method::PUT, "/configs?force=true", Some(serde_json::json!({ "path": path.to_string_lossy() }))).await?;
        Ok(())
    }

    /// Debounced reload (settings edits arrive in bursts).
    pub fn schedule_reload(self: &Arc<Self>, app: &AppHandle) {
        let seq = self.reload_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let st = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            if st.reload_seq.load(Ordering::SeqCst) != seq {
                return;
            }
            if let Err(e) = st.reload(&app).await {
                log::warn!("reload failed: {e}");
                st.notify(&app, "error", &format!("配置重载失败：{}", e.message), &format!("Reload failed: {}", e.message));
            }
        });
    }

    /* ---------------- core lifecycle ---------------- */

    pub fn controller_info(&self) -> ControllerInfo {
        let s = self.settings.read();
        ControllerInfo { url: s.controller_url(), secret: s.controller.secret.clone() }
    }

    pub async fn start_core(self: &Arc<Self>, app: &AppHandle) -> Res<CoreStatus> {
        let _g = self.op.lock().await;
        self.start_core_locked(app).await
    }

    async fn start_core_locked(self: &Arc<Self>, app: &AppHandle) -> Res<CoreStatus> {
        let exe = self.paths.core_exe();
        if !exe.exists() {
            self.core.update(|s| {
                s.state = "not_installed".into();
                s.pid = None;
            });
            self.emit_core(app);
            return Err(AppError::new("CORE_NOT_INSTALLED", "The mihomo core is not installed"));
        }
        let ctl = self.controller_info();
        let config = match self.write_runtime() {
            Ok(p) => p,
            Err(e) => {
                self.core.update(|s| {
                    s.state = "error".into();
                    s.error = Some(e.message.clone());
                });
                self.emit_core(app);
                return Err(e);
            }
        };
        let exe2 = exe.clone();
        let _ = tokio::task::spawn_blocking(move || crate::winutil::kill_processes_with_exe(&exe2)).await;

        // Our own stale core is gone now, so a busy proxy port belongs to another program
        // (often another Clash client). mihomo would silently skip that listener.
        let busy: Vec<u16> = {
            let s = self.settings.read();
            let n = &s.engine.network;
            [n.mixed_port, n.http_port, n.socks_port]
                .into_iter()
                .filter(|p| *p != 0 && std::net::TcpListener::bind(("127.0.0.1", *p)).is_err())
                .collect()
        };
        if !busy.is_empty() {
            let ports = busy.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", ");
            log::warn!("proxy port(s) already in use: {ports}");
            let (me, app2) = (self.clone(), app.clone());
            // Delay so windows that are still loading receive the notice.
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                me.notify(
                    &app2,
                    "warning",
                    &format!("端口 {ports} 已被其他程序占用，代理端口不可用。请在 引擎 → 网络 中更换端口。"),
                    &format!("Port {ports} is used by another program, so the proxy port is unavailable. Change it in Engine → Network."),
                );
            });
        }

        self.core.update(|s| {
            s.state = "starting".into();
            s.error = None;
            s.pid = None;
            s.controller = ctl.clone();
        });
        self.emit_core(app);

        let pid = match self.core.spawn(&exe, &self.paths.home, &config) {
            Ok(p) => p,
            Err(e) => {
                self.core.update(|s| {
                    s.state = "error".into();
                    s.error = Some(e.message.clone());
                });
                self.emit_core(app);
                return Err(e);
            }
        };
        let gen = self.core.generation.load(Ordering::SeqCst);
        let deadline = Instant::now() + std::time::Duration::from_secs(25);
        let version = loop {
            if let Some(err) = self.core.check_exit() {
                let tail = self.core.log_tail(6).join("\n");
                let msg = if tail.is_empty() { err } else { format!("{err}\n{tail}") };
                self.core.update(|s| {
                    s.state = "error".into();
                    s.pid = None;
                    s.error = Some(msg.clone());
                });
                self.emit_core(app);
                return Err(AppError::new("CORE_NOT_RUNNING", msg));
            }
            if let Ok(v) = core::api(&ctl, reqwest::Method::GET, "/version", None).await {
                break v.get("version").and_then(|x| x.as_str()).map(|s| s.to_string());
            }
            if Instant::now() > deadline {
                self.core.kill();
                self.core.update(|s| {
                    s.state = "error".into();
                    s.pid = None;
                    s.error = Some("Timed out waiting for the core controller".into());
                });
                self.emit_core(app);
                return Err(AppError::new("CORE_NOT_RUNNING", "Timed out waiting for the core controller"));
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        };

        let status = self.core.update(|s| {
            s.state = "running".into();
            s.pid = Some(pid);
            s.started_at = Some(now_ms());
            s.error = None;
            if version.is_some() {
                s.version = version.clone();
            }
        });
        self.emit_core(app);
        self.stats.reset_seen();
        self.geo.refresh();

        // crash monitor
        let st = self.clone();
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                if st.core.generation.load(Ordering::SeqCst) != gen {
                    break;
                }
                if let Some(err) = st.core.check_exit() {
                    let tail = st.core.log_tail(6).join("\n");
                    st.core.update(|s| {
                        s.state = "error".into();
                        s.pid = None;
                        s.error = Some(format!("{err}\n{tail}"));
                    });
                    st.emit_core(&app2);
                    st.notify(&app2, "error", "内核意外退出", "The kernel exited unexpectedly");
                    if st.sysproxy_by_us.load(Ordering::SeqCst) {
                        let _ = st.apply_sysproxy_registry(false);
                    }
                    break;
                }
                if !st.core.has_child() {
                    break;
                }
            }
        });

        if self.settings.read().system_proxy {
            if let Err(e) = self.apply_sysproxy_registry(true) {
                // Don't leave the switch showing "on" while the proxy isn't ours.
                log::warn!("system proxy: {e}");
                let _ = self.update_settings(app, |s| s.system_proxy = false);
                let msg = e.message.clone();
                let (me, app2) = (self.clone(), app.clone());
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    me.notify(&app2, "warning", &msg, &msg);
                });
            }
        }
        Ok(status)
    }

    pub async fn stop_core(&self, app: &AppHandle) -> CoreStatus {
        let _g = self.op.lock().await;
        self.stop_core_locked(app)
    }

    fn stop_core_locked(&self, app: &AppHandle) -> CoreStatus {
        self.core.generation.fetch_add(1, Ordering::SeqCst);
        self.core.kill();
        if self.sysproxy_by_us.load(Ordering::SeqCst) {
            let _ = self.apply_sysproxy_registry(false);
        }
        *self.traffic.lock() = (0, 0);
        let installed = self.paths.core_exe().exists();
        let s = self.core.update(|s| {
            s.state = if installed { "stopped".into() } else { "not_installed".into() };
            s.pid = None;
            s.started_at = None;
            s.error = None;
        });
        let _ = self.stats.flush();
        self.emit_core(app);
        s
    }

    pub async fn restart_core(self: &Arc<Self>, app: &AppHandle) -> Res<CoreStatus> {
        let _g = self.op.lock().await;
        self.stop_core_locked(app);
        self.start_core_locked(app).await
    }

    /* ---------------- system proxy ---------------- */

    /// Write the registry according to `enable` (does not touch settings).
    pub fn apply_sysproxy_registry(&self, enable: bool) -> Res<()> {
        let (port, bypass, zh) = {
            let s = self.settings.read();
            (s.engine.network.mixed_port, s.engine.network.bypass.clone(), s.is_zh())
        };
        if enable {
            // Only point the system at a port our own core is serving; otherwise the traffic
            // would silently go to whatever program holds that port (e.g. another Clash client).
            let core_pid = self.core.status().pid;
            match (port, sysproxy::listener_pid(port), core_pid) {
                (0, ..) => {
                    return Err(AppError::new(
                        "PORT_IN_USE",
                        if zh { "混合端口已关闭（为 0），无法开启系统代理。请在 引擎 → 网络 中设置端口。" } else { "The mixed port is off (0), so the system proxy can't be enabled. Set a port in Engine → Network." },
                    ))
                }
                (_, Some(owner), Some(core)) if owner != core => {
                    return Err(AppError::new(
                        "PORT_IN_USE",
                        if zh {
                            format!("端口 {port} 被其他程序（进程 {owner}）占用，ClashWin 的代理没有在这个端口上运行。请在 引擎 → 网络 中把混合端口改成其他端口后再开启系统代理。")
                        } else {
                            format!("Port {port} is held by another program (PID {owner}), so ClashWin's proxy isn't running there. Change the mixed port in Engine → Network, then enable the system proxy.")
                        },
                    ))
                }
                _ => {}
            }
            let before = sysproxy::current().ok();
            let written = sysproxy::enable(port, &bypass)?;
            let mut owned = self.sysproxy_owned.lock();
            // Keep the settings from before our first write: across re-applies (port or bypass
            // change) and across restarts (saved on disk), so they can be restored later.
            let saved = self.paths.data.join("sysproxy_prev.json");
            let previous = match owned.take() {
                Some((_, prev)) => prev,
                None => {
                    let fresh = before.filter(|b| !(b.enabled && b.server.starts_with("127.0.0.1:") && b.server == written.server));
                    let from_disk = std::fs::read(&saved).ok().and_then(|b| serde_json::from_slice::<sysproxy::ProxyState>(&b).ok());
                    // After a restart the registry already holds our own value; use the saved one.
                    match fresh {
                        Some(f) if f.server != written.server => Some(f),
                        _ => from_disk,
                    }
                }
            };
            match &previous {
                Some(p) => {
                    let _ = crate::util::write_atomic(&saved, &serde_json::to_vec(p).unwrap_or_default());
                }
                None => {
                    let _ = std::fs::remove_file(&saved);
                }
            }
            *owned = Some((written, previous));
            self.sysproxy_by_us.store(true, Ordering::SeqCst);
        } else {
            if let Some((written, previous)) = self.sysproxy_owned.lock().take() {
                sysproxy::release(&written, previous.as_ref())?;
                let _ = std::fs::remove_file(self.paths.data.join("sysproxy_prev.json"));
            }
            self.sysproxy_by_us.store(false, Ordering::SeqCst);
        }
        Ok(())
    }

    /* ---------------- elevation ---------------- */

    /// Relaunch elevated (via helper task when installed, else UAC prompt), then exit.
    pub fn relaunch_elevated(&self, app: &AppHandle) -> Res<()> {
        let marker = self.paths.relaunch_marker();
        admin::write_relaunch_marker(&marker);
        let r = if admin::helper_installed() {
            admin::helper_run()
        } else {
            let exe = std::env::current_exe()?;
            admin::run_elevated(&exe, "--elevated", false, false).map(|_| ())
        };
        if let Err(e) = r {
            let _ = std::fs::remove_file(&marker);
            return Err(e);
        }
        self.cleanup();
        app.exit(0);
        Ok(())
    }

    /* ---------------- shutdown ---------------- */

    /// Stop the core, restore the system proxy and flush stats. Idempotent.
    pub fn cleanup(&self) {
        if self.cleaned_up.swap(true, Ordering::SeqCst) {
            return;
        }
        self.core.generation.fetch_add(1, Ordering::SeqCst);
        self.core.kill();
        // Only give back a proxy we set ourselves; never guess by address (another client may
        // use the same port).
        if self.sysproxy_by_us.load(Ordering::SeqCst) {
            let _ = self.apply_sysproxy_registry(false);
        }
        let _ = self.stats.flush();
    }
}

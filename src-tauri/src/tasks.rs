//! Background loops: controller streams (traffic + stats), maintenance, tray refresh,
//! subscription auto-update, Wi-Fi bypass, external editor watch, first-run core install.

use futures_util::StreamExt;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::sleep;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

use crate::state::state;
use crate::stats::ConnSample;
use crate::util::now_ms;
use crate::{cmds, tray, updates, winutil};

pub fn spawn_all(app: &AppHandle) {
    let a = app.clone();
    tauri::async_runtime::spawn(async move { startup(a).await });
    let a = app.clone();
    tauri::async_runtime::spawn(async move { traffic_loop(a).await });
    let a = app.clone();
    tauri::async_runtime::spawn(async move { connections_loop(a).await });
    let a = app.clone();
    tauri::async_runtime::spawn(async move { maintenance_loop(a).await });
    let a = app.clone();
    tauri::async_runtime::spawn(async move { tray_loop(a).await });
    let a = app.clone();
    tauri::async_runtime::spawn(async move { profile_update_loop(a).await });
    let a = app.clone();
    tauri::async_runtime::spawn(async move { wifi_loop(a).await });
    let a = app.clone();
    tauri::async_runtime::spawn(async move { editor_watch_loop(a).await });
    let a = app.clone();
    tauri::async_runtime::spawn(async move { update_check_loop(a).await });
}

/// Look for a new ClashWin release a little after launch, then twice a day.
async fn update_check_loop(app: AppHandle) {
    use tauri::Emitter;
    sleep(Duration::from_secs(45)).await;
    let mut notified: Option<String> = None;
    loop {
        let st = state(&app);
        if st.settings.read().auto_check_update {
            let current = app.package_info().version.to_string();
            match updates::check_app(&st, &current).await {
                Ok(info) if info.has_update => {
                    let _ = app.emit("app://update-available", &info);
                    if notified.as_deref() != Some(info.latest.as_str()) {
                        st.notify(
                            &app,
                            "info",
                            &format!("发现新版本 ClashWin {}，可在 设置 → 更新 中安装。", info.latest),
                            &format!("ClashWin {} is available. Install it from Settings → Updates.", info.latest),
                        );
                        notified = Some(info.latest.clone());
                    }
                }
                Ok(_) => {}
                Err(e) => log::info!("app update check failed: {e}"),
            }
        }
        sleep(Duration::from_secs(12 * 3600)).await;
    }
}

async fn startup(app: AppHandle) {
    let st = state(&app);
    cmds::cleanup_validation_files(&st.paths.home);
    // keep autostart registration in sync with settings
    {
        use tauri_plugin_autostart::ManagerExt;
        let want = st.settings.read().launch_at_login;
        if let Ok(is) = app.autolaunch().is_enabled() {
            if is != want {
                let _ = if want { app.autolaunch().enable() } else { app.autolaunch().disable() };
            }
        }
    }
    // TUN only takes effect with admin rights. Don't show it as on when it can't be.
    if !st.elevated && st.settings.read().tun_mode {
        if crate::admin::helper_usable(&st.paths.data) && st.relaunch_elevated(&app).is_ok() {
            return; // the elevated instance takes over
        }
        let _ = st.update_settings(&app, |s| s.tun_mode = false);
        let (st2, app2) = (st.clone(), app.clone());
        tauri::async_runtime::spawn(async move {
            sleep(Duration::from_secs(3)).await;
            st2.notify(
                &app2,
                "warning",
                "增强模式需要管理员权限，已暂时关闭。可在 设置 → 权限 中安装辅助服务，或以管理员身份重启。",
                "Enhanced Mode needs administrator rights and was turned off. Install the helper in Settings → Permissions, or restart as administrator.",
            );
        });
    }
    if std::env::var_os("CLASHWIN_SKIP_CORE").is_some() {
        log::info!("CLASHWIN_SKIP_CORE set: not starting or installing the core");
        return;
    }
    if st.paths.core_exe().exists() {
        if let Err(e) = st.start_core(&app).await {
            log::error!("core start failed: {e}");
        }
    } else {
        // First run: fetch the core for this CPU in the background.
        let channel = st.settings.read().core_channel.clone();
        if let Err(e) = cmds::install_core(&app, &channel).await {
            log::error!("core install failed: {e}");
            st.notify(&app, "error", &format!("内核下载失败：{}", e.message), &format!("Kernel download failed: {}", e.message));
        }
    }
}

/// Follow a controller WebSocket while the core runs; reconnects automatically.
async fn ws_follow(app: &AppHandle, path: &str, mut on_text: impl FnMut(&str) + Send) {
    let st = state(app);
    loop {
        if !st.core.is_running() {
            sleep(Duration::from_millis(800)).await;
            continue;
        }
        let gen = st.core.generation.load(Ordering::SeqCst);
        let ctl = st.core.controller();
        let url = format!("{}{}", ctl.url.replacen("http", "ws", 1), path);
        if let Ok(mut req) = url.as_str().into_client_request() {
            if !ctl.secret.is_empty() {
                if let Ok(v) = format!("Bearer {}", ctl.secret).parse() {
                    req.headers_mut().insert("Authorization", v);
                }
            }
            if let Ok(Ok((mut ws, _))) = tokio::time::timeout(Duration::from_secs(5), tokio_tungstenite::connect_async(req)).await {
                loop {
                    match tokio::time::timeout(Duration::from_secs(3), ws.next()).await {
                        Ok(Some(Ok(Message::Text(t)))) => on_text(&t),
                        Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) => break,
                        _ => {}
                    }
                    if st.core.generation.load(Ordering::SeqCst) != gen || !st.core.is_running() {
                        break;
                    }
                }
                let _ = ws.close(None).await;
            }
        }
        sleep(Duration::from_millis(1000)).await;
    }
}

async fn traffic_loop(app: AppHandle) {
    let st = state(&app);
    ws_follow(&app, "/traffic", move |t| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(t) {
            let up = v.get("up").and_then(|x| x.as_u64()).unwrap_or(0);
            let down = v.get("down").and_then(|x| x.as_u64()).unwrap_or(0);
            *st.traffic.lock() = (up, down);
        }
    })
    .await;
}

async fn connections_loop(app: AppHandle) {
    let st = state(&app);
    ws_follow(&app, "/connections?interval=1000", move |t| {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(t) else { return };
        let samples: Vec<ConnSample> = v
            .get("connections")
            .and_then(|c| c.as_array())
            .map(|a| a.iter().filter_map(ConnSample::from_json).collect())
            .unwrap_or_default();
        let geo = &st.geo;
        st.stats.ingest(&samples, &|ip: &str| geo.lookup(ip), chrono::Local::now());
    })
    .await;
}

async fn maintenance_loop(app: AppHandle) {
    let st = state(&app);
    let mut tick: u64 = 0;
    loop {
        sleep(Duration::from_secs(10)).await;
        tick += 1;
        if let Err(e) = st.stats.flush() {
            log::warn!("stats flush: {e}");
        }
        if tick % 6 == 1 {
            st.geo.refresh();
        }
        // Place nodes whose names carry no country hint (by server IP), shortly after start
        // and every 5 minutes; lookups are cached so this is cheap.
        if st.core.is_running() && (tick == 2 || tick % 30 == 0) {
            let n = crate::nodegeo::refresh(&st).await.len();
            log::debug!("node regions by server IP: {n}");
        }
        if tick % 360 == 1 {
            let days = st.settings.read().history_retention_days;
            let _ = st.stats.prune(days, chrono::Local::now());
        }
    }
}

async fn tray_loop(app: AppHandle) {
    loop {
        tray::refresh(&app);
        sleep(Duration::from_secs(1)).await;
    }
}

async fn profile_update_loop(app: AppHandle) {
    let st = state(&app);
    sleep(Duration::from_secs(45)).await;
    loop {
        let now = now_ms();
        let due: Vec<String> = st
            .profiles
            .read()
            .iter()
            .filter(|p| p.is_remote())
            .filter(|p| {
                let m = p.auto_update_minutes.unwrap_or(0) as i64;
                m > 0 && now - p.updated_at >= m * 60_000
            })
            .map(|p| p.id.clone())
            .collect();
        for id in due {
            if let Err(e) = cmds::update_profile_inner(&app, &id).await {
                log::warn!("auto-update {id}: {e}");
                // back off: pretend we tried so we don't hammer a failing server every minute
                if let Some(p) = st.profiles.write().iter_mut().find(|p| p.id == id) {
                    let m = p.auto_update_minutes.unwrap_or(60) as i64;
                    p.updated_at = now - (m * 60_000) + 30 * 60_000;
                }
            }
        }
        sleep(Duration::from_secs(60)).await;
    }
}

async fn wifi_loop(app: AppHandle) {
    let st = state(&app);
    loop {
        sleep(Duration::from_secs(10)).await;
        let s = st.settings();
        let has_prev = st.wifi_prev.lock().is_some();
        let trusted_ssid = if s.wifi_bypass.enabled {
            let ssid = tokio::task::spawn_blocking(winutil::wifi_ssid).await.ok().flatten();
            ssid.filter(|x| s.wifi_bypass.ssids.iter().any(|t| t.trim() == x.trim()))
        } else {
            None
        };
        if let Some(ssid) = trusted_ssid {
            if !has_prev && (s.system_proxy || s.tun_mode) {
                *st.wifi_prev.lock() = Some((s.system_proxy, s.tun_mode));
                let _ = st.update_settings(&app, |x| {
                    x.system_proxy = false;
                    x.tun_mode = false;
                });
                let _ = st.apply_sysproxy_registry(false);
                st.schedule_reload(&app);
                st.notify(&app, "info", &format!("已绕过当前无线网络 {ssid}"), &format!("Bypassing trusted Wi-Fi {ssid}"));
            }
        } else if has_prev {
            let prev = st.wifi_prev.lock().take();
            if let Some((sys, tun)) = prev {
                let tun = tun && st.elevated;
                let _ = st.update_settings(&app, |x| {
                    x.system_proxy = sys;
                    x.tun_mode = tun;
                });
                if sys && st.core.is_running() {
                    let _ = st.apply_sysproxy_registry(true);
                }
                st.schedule_reload(&app);
                st.notify(&app, "info", "已离开信任的无线网络，代理已恢复", "Left trusted Wi-Fi; proxy restored");
            }
        }
    }
}

async fn editor_watch_loop(app: AppHandle) {
    let st = state(&app);
    loop {
        sleep(Duration::from_millis(1500)).await;
        let watched: Vec<(String, Option<std::time::SystemTime>)> = st.editor_watch.lock().iter().map(|(k, v)| (k.clone(), *v)).collect();
        for (id, last) in watched {
            let Ok(p) = st.profile(&id) else {
                st.editor_watch.lock().remove(&id);
                continue;
            };
            let cur = std::fs::metadata(&p.file).and_then(|m| m.modified()).ok();
            if cur.is_none() || cur == last {
                continue;
            }
            st.editor_watch.lock().insert(id.clone(), cur);
            if let Some(x) = st.profiles.write().iter_mut().find(|x| x.id == id) {
                x.updated_at = now_ms();
            }
            let _ = st.save_profiles();
            st.emit_profiles(&app);
            if st.settings.read().active_profile_id.as_deref() == Some(id.as_str()) {
                match st.reload(&app).await {
                    Ok(_) => st.notify(&app, "success", "配置已更新并重新加载", "Profile saved and reloaded"),
                    Err(e) => st.notify(&app, "error", &format!("配置有误：{}", e.message), &format!("Profile error: {}", e.message)),
                }
            }
        }
    }
}

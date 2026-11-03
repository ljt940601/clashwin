//! System tray icon: click toggles the popup panel, double-click opens the dashboard,
//! tooltip shows live speeds, a dimmed "sleep" icon when not proxying.

use std::sync::atomic::{AtomicU8, Ordering};
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

use crate::state::state;
use crate::windows;

const ICON_PNG: &[u8] = include_bytes!("../icons/32x32.png");
const TRAY_ID: &str = "main";

/// 0 = unset, 1 = active, 2 = sleep
static CURRENT: AtomicU8 = AtomicU8::new(0);

fn active_icon() -> Image<'static> {
    Image::from_bytes(ICON_PNG).expect("tray icon").to_owned()
}

/// Grayscale, dimmed variant of the app icon.
fn sleep_icon() -> Image<'static> {
    let img = active_icon();
    let (w, h) = (img.width(), img.height());
    let mut rgba = img.rgba().to_vec();
    for p in rgba.chunks_exact_mut(4) {
        let l = (0.3 * p[0] as f32 + 0.59 * p[1] as f32 + 0.11 * p[2] as f32) as u8;
        let v = (l as f32 * 0.85 + 30.0).min(255.0) as u8;
        p[0] = v;
        p[1] = v;
        p[2] = v;
        p[3] = (p[3] as f32 * 0.62) as u8;
    }
    Image::new_owned(rgba, w, h)
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(sleep_icon())
        .tooltip("ClashWin")
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                TrayIconEvent::Click { button: MouseButton::Left | MouseButton::Right, button_state: MouseButtonState::Up, position, .. } => {
                    windows::toggle_tray_panel(app, position);
                }
                TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
                    windows::hide_tray_panel(app);
                    windows::show_dashboard(app, None);
                }
                _ => {}
            }
        })
        .build(app)?;
    CURRENT.store(2, Ordering::SeqCst);
    Ok(())
}

pub fn format_speed(b: u64) -> String {
    const U: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = b as f64;
    let mut i = 0;
    while v >= 1024.0 && i < U.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{} B/s", b)
    } else {
        format!("{:.1} {}/s", v, U[i])
    }
}

/// Refresh tooltip + icon. Called every second.
pub fn refresh(app: &AppHandle) {
    let st = state(app);
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let running = st.core.is_running();
    let (sys, tun) = {
        let s = st.settings.read();
        (s.system_proxy, s.tun_mode)
    };
    let active = running && (sys || tun);
    let want = if active { 1 } else { 2 };
    if CURRENT.swap(want, Ordering::SeqCst) != want {
        let _ = tray.set_icon(Some(if active { active_icon() } else { sleep_icon() }));
    }
    let tip = if running {
        let (up, down) = *st.traffic.lock();
        let zh = st.settings.read().is_zh();
        let mode = if !active {
            if zh {
                "未代理"
            } else {
                "Not proxying"
            }
        } else if tun {
            if zh {
                "增强模式"
            } else {
                "Enhanced Mode"
            }
        } else if zh {
            "系统代理"
        } else {
            "System Proxy"
        };
        format!("ClashWin · {mode}\n↑ {}   ↓ {}", format_speed(up), format_speed(down))
    } else {
        let zh = st.settings.read().is_zh();
        format!("ClashWin · {}", if zh { "内核未运行" } else { "Kernel stopped" })
    };
    let _ = tray.set_tooltip(Some(tip));
}

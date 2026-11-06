//! Window management: dashboard ("main"), tray popup ("tray"), settings ("settings").

use serde::Serialize;
use std::time::Instant;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::admin;
use crate::state::state;

#[derive(Clone, Serialize)]
struct NavigatePayload {
    page: String,
}

/// Is the UI dark? Follows the app's theme setting, or Windows' app theme for "system".
fn ui_is_dark(app: &AppHandle) -> bool {
    match state(app).settings.read().theme.as_str() {
        "dark" => true,
        "light" => false,
        _ => crate::winutil::system_prefers_dark(),
    }
}

/// Window background shown before the page paints (matches --bg-window), so a dark
/// window doesn't flash white while it loads.
fn window_bg(app: &AppHandle) -> Color {
    if ui_is_dark(app) {
        Color(0x1e, 0x1f, 0x21, 0xff)
    } else {
        Color(0xf5, 0xf5, 0xf7, 0xff)
    }
}

pub fn create_main(app: &AppHandle, visible: bool) -> tauri::Result<WebviewWindow> {
    create_main_restored(app, visible, None)
}

/// A dashboard route we can put in the window URL ("/rules", "/engine/dns", ...).
fn valid_page(p: &str) -> bool {
    p.starts_with('/') && p.len() < 64 && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_'))
}

/// Create the dashboard; after an elevation relaunch, reopen it the way it was (page, place, size).
pub fn create_main_restored(app: &AppHandle, visible: bool, restore: Option<&admin::Relaunch>) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("main") {
        return Ok(w);
    }
    let page = restore.and_then(|r| r.page.as_deref()).filter(|p| valid_page(p)).unwrap_or("/overview");
    let bounds = restore.and_then(|r| r.bounds);
    let maximized = restore.is_some_and(|r| r.maximized);
    let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(format!("index.html#{page}").into()))
        .title("ClashWin")
        .inner_size(1240.0, 800.0)
        .min_inner_size(960.0, 620.0)
        .background_color(window_bg(app))
        .decorations(false)
        .shadow(true)
        .resizable(true)
        .center()
        .visible(visible && bounds.is_none() && !maximized)
        .build()?;
    if let Some((x, y, width, height)) = bounds {
        let _ = w.set_position(PhysicalPosition::new(x, y));
        let _ = w.set_size(PhysicalSize::new(width, height));
    }
    if maximized {
        let _ = w.maximize();
    }
    if visible && (bounds.is_some() || maximized) {
        let _ = w.show();
    }
    let handle = w.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = handle.hide();
        }
    });
    Ok(w)
}

/// The dashboard's state, to hand to the instance that replaces us when relaunching elevated.
pub fn dashboard_handover(app: &AppHandle) -> admin::Relaunch {
    let Some(w) = app.get_webview_window("main") else {
        return admin::Relaunch { show: Some(false), ..Default::default() };
    };
    let maximized = w.is_maximized().unwrap_or(false);
    let minimized = w.is_minimized().unwrap_or(false);
    let bounds = match (maximized || minimized, w.outer_position(), w.inner_size()) {
        (false, Ok(p), Ok(s)) => Some((p.x, p.y, s.width, s.height)),
        _ => None,
    };
    let page = w.url().ok().and_then(|u| u.fragment().map(str::to_string)).filter(|p| valid_page(p));
    admin::Relaunch { autostart: false, show: Some(w.is_visible().unwrap_or(false)), page, bounds, maximized }
}

pub fn show_dashboard(app: &AppHandle, page: Option<String>) {
    let w = match create_main(app, true) {
        Ok(w) => w,
        Err(e) => {
            log::error!("dashboard window: {e}");
            return;
        }
    };
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    if let Some(p) = page.filter(|p| !p.is_empty()) {
        let _ = app.emit_to("main", "app://navigate", NavigatePayload { page: p });
    }
}

pub fn open_settings(app: &AppHandle, tab: Option<String>) -> tauri::Result<()> {
    let tab = tab.filter(|t| !t.is_empty()).unwrap_or_else(|| "general".into());
    if let Some(w) = app.get_webview_window("settings") {
        let _ = app.emit_to("settings", "app://navigate", NavigatePayload { page: format!("/settings/{tab}") });
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    let w = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App(format!("index.html#/settings/{tab}").into()))
        .title("ClashWin Settings")
        .inner_size(680.0, 560.0)
        .background_color(window_bg(app))
        .decorations(false)
        .shadow(true)
        .resizable(false)
        .maximizable(false)
        .center()
        .visible(true)
        .build()?;
    let _ = w.set_focus();
    Ok(())
}

/* ---------------- tray popup ---------------- */

pub fn create_tray_panel(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("tray") {
        return Ok(w);
    }
    let (lw, lh) = state(app).tray_ui.lock().size;
    let w = WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("index.html#/tray".into()))
        .title("ClashWin")
        .inner_size(lw, lh)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false)
        .build()?;
    crate::traypopup::make_non_activating(&w);
    let handle = w.clone();
    let app2 = app.clone();
    w.on_window_event(move |e| match e {
        // Only reached when the popup was explicitly focused (e.g. for typing in a dialog).
        WindowEvent::Focused(false) => {
            if handle.is_visible().unwrap_or(false) {
                hide_tray_panel(&app2);
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            hide_tray_panel(&app2);
        }
        _ => {}
    });
    Ok(w)
}

pub fn hide_tray_panel(app: &AppHandle) {
    crate::traypopup::cancel_watch();
    if let Some(w) = app.get_webview_window("tray") {
        if w.is_visible().unwrap_or(false) {
            state(app).tray_ui.lock().hidden_at = Some(Instant::now());
        }
        // The popup is shown with raw Win32 (to avoid activation), so Tauri still thinks it
        // is hidden and its hide() would be a no-op; hide it the same raw way.
        crate::traypopup::hide_raw(&w);
        let _ = w.hide();
        let _ = w.emit("tray://hidden", ());
    }
}

/// Clickable shapes reported by the popup (CSS px, window-relative). Empty = whole window.
pub fn set_tray_panel_region(app: &AppHandle, rects: &[(f64, f64, f64, f64, f64)]) {
    let Some(w) = app.get_webview_window("tray") else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let px = |v: f64| (v * scale).round() as i32;
    let region: Vec<crate::traypopup::RegionRect> = rects.iter().map(|&(x, y, rw, rh, r)| (px(x), px(y), px(rw), px(rh), px(r))).collect();
    crate::traypopup::set_region(&w, &region);
    crate::traypopup::update_hook_region(&region);
    state(app).tray_ui.lock().region = region;
}

/// Give the popup keyboard focus (needed while typing in its dialogs). The overflow
/// area will close, which is fine while the user types.
pub fn focus_tray_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("tray") {
        let _ = w.set_focus();
    }
}

/// Show/hide the popup anchored at the mouse position of the tray click.
pub fn toggle_tray_panel(app: &AppHandle, click: PhysicalPosition<f64>) {
    let st = state(app);
    let w = match create_tray_panel(app) {
        Ok(w) => w,
        Err(e) => {
            log::error!("tray window: {e}");
            return;
        }
    };
    if w.is_visible().unwrap_or(false) {
        hide_tray_panel(app);
        return;
    }
    // The click that hid the panel (via focus loss) shouldn't immediately reopen it.
    if let Some(t) = st.tray_ui.lock().hidden_at {
        if t.elapsed().as_millis() < 300 {
            return;
        }
    }
    // Prefer the live cursor position (physical px); the event position is a fallback.
    let anchor = app.cursor_position().ok().map(|p| (p.x, p.y)).filter(|(x, y)| *x != 0.0 || *y != 0.0).unwrap_or((click.x, click.y));
    log::debug!("tray click at {:?}, cursor anchor {:?}", (click.x, click.y), anchor);
    st.tray_ui.lock().anchor = Some(anchor);
    place_tray_panel(app, &w, None);
    // Like a native tray menu: don't take activation, so the hidden-icons overflow stays
    // open until the popup closes; the watcher handles outside clicks / Esc / app switches.
    crate::traypopup::show_without_activation(&w);
    crate::traypopup::watch_dismiss(app);
    let _ = w.emit("tray://shown", ());
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Edge {
    Bottom,
    Top,
    Left,
    Right,
}

/// Place the popup like a context menu at the mouse anchor: it opens away from the taskbar,
/// to the left of the cursor when there's room (tray icons sit at the right), otherwise to the
/// right, and always stays inside the monitor's work area. When `keep` is given (previous outer
/// rect: x, y, w, h) the corner nearest the cursor stays fixed while the size changes.
fn place_tray_panel(app: &AppHandle, w: &WebviewWindow, keep: Option<(i32, i32, i32, i32)>) {
    let st = state(app);
    let (lw, lh) = st.tray_ui.lock().size;
    let anchor = st.tray_ui.lock().anchor.or_else(|| app.cursor_position().ok().map(|p| (p.x, p.y)));
    let (ax, ay) = anchor.unwrap_or((0.0, 0.0));
    let monitor = app.monitor_from_point(ax, ay).ok().flatten().or_else(|| w.primary_monitor().ok().flatten());
    let Some(m) = monitor else {
        let _ = w.set_size(LogicalSize::new(lw, lh));
        return;
    };
    let scale = m.scale_factor();
    let pw = (lw * scale).round() as i32;
    let ph = (lh * scale).round() as i32;
    let wa = m.work_area();
    let (wx, wy, ww, wh) = (wa.position.x, wa.position.y, wa.size.width as i32, wa.size.height as i32);
    let (mx, my) = (m.position().x, m.position().y);
    let (mw, mh) = (m.size().width as i32, m.size().height as i32);
    // Which side is the taskbar on (work area is smaller than the monitor on that side)?
    let edge = if wy > my {
        Edge::Top
    } else if wx > mx {
        Edge::Left
    } else if wx + ww < mx + mw {
        Edge::Right
    } else {
        let _ = mh;
        Edge::Bottom
    };
    let gap = (4.0 * scale).round() as i32;
    let (ax, ay) = (ax.round() as i32, ay.round() as i32);
    let (right, bottom) = (wx + ww, wy + wh);

    let (mut x, mut y) = match keep {
        Some((ox, oy, ow, oh)) => {
            // The panel is right-aligned in its window and side menus grow it leftward, so the
            // right edge stays put; vertically keep the edge nearest the cursor.
            let x = ox + ow - pw;
            let y = if oy + oh / 2 <= ay { oy + oh - ph } else { oy };
            (x, y)
        }
        None => {
            // Horizontal: open to the left of the cursor if it fits, else to the right.
            let x = if ax - pw >= wx { ax - pw } else { ax };
            // Vertical: open upward from the cursor if it fits, else downward.
            let y = if ay - ph >= wy { ay - ph } else { ay };
            match edge {
                // Cursor is on the taskbar: sit just above / below / beside it.
                Edge::Bottom => (x, y.min(bottom - ph - gap)),
                Edge::Top => (x, ay.max(wy + gap)),
                Edge::Left => (ax.max(wx + gap), y),
                Edge::Right => ((ax - pw).min(right - pw - gap), y),
            }
        }
    };
    x = x.clamp(wx, (right - pw).max(wx));
    y = y.clamp(wy, (bottom - ph).max(wy));
    log::debug!("tray panel at ({x},{y}) size {pw}x{ph}, work area ({wx},{wy},{ww},{wh}), edge {edge:?}");
    // Position first so a DPI change between monitors is applied before sizing, then size in
    // physical px for the target monitor, then position again in case the resize moved it.
    let _ = w.set_position(PhysicalPosition::new(x, y));
    let _ = w.set_size(PhysicalSize::new(pw as u32, ph as u32));
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

/// Frontend reports its content size (CSS px). Keeps the bottom-right corner fixed.
pub fn set_tray_panel_size(app: &AppHandle, width: f64, height: f64) {
    let st = state(app);
    let width = width.clamp(200.0, 1200.0);
    let height = height.clamp(120.0, 1400.0);
    st.tray_ui.lock().size = (width, height);
    if let Some(w) = app.get_webview_window("tray") {
        let keep = match (w.outer_position(), w.outer_size()) {
            (Ok(p), Ok(s)) if w.is_visible().unwrap_or(false) => Some((p.x, p.y, s.width as i32, s.height as i32)),
            _ => None,
        };
        place_tray_panel(app, &w, keep);
    }
}

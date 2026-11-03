//! Window management: dashboard ("main"), tray popup ("tray"), settings ("settings").

use serde::Serialize;
use std::time::Instant;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::state::state;

#[derive(Clone, Serialize)]
struct NavigatePayload {
    page: String,
}

pub fn create_main(app: &AppHandle, visible: bool) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("main") {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html#/overview".into()))
        .title("ClashWin")
        .inner_size(1240.0, 800.0)
        .min_inner_size(960.0, 620.0)
        .decorations(false)
        .shadow(true)
        .resizable(true)
        .center()
        .visible(visible)
        .build()?;
    let handle = w.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = handle.hide();
        }
    });
    Ok(w)
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
        .focused(true)
        .visible(false)
        .build()?;
    let handle = w.clone();
    let app2 = app.clone();
    w.on_window_event(move |e| match e {
        WindowEvent::Focused(false) => {
            if handle.is_visible().unwrap_or(false) {
                let _ = handle.hide();
                state(&app2).tray_ui.lock().hidden_at = Some(Instant::now());
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = handle.hide();
        }
        _ => {}
    });
    Ok(w)
}

pub fn hide_tray_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("tray") {
        let _ = w.hide();
        state(app).tray_ui.lock().hidden_at = Some(Instant::now());
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
    let _ = w.show();
    let _ = w.set_focus();
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

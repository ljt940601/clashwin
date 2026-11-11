//! TEMPORARY repro harness, only active with CLASHWIN_SELFTEST set (used by a CI workflow on a
//! Windows runner): right-click the tray icon, click "Settings" in the popup with real mouse
//! input, and log what happens to the windows (z-order, visibility, foreground, events).

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

static POINT: Mutex<Option<(f64, f64)>> = Mutex::new(None);

#[tauri::command]
pub fn selftest_point(x: f64, y: f64) {
    *POINT.lock().unwrap() = Some((x, y));
}

pub fn start(app: &AppHandle) {
    if std::env::var_os("CLASHWIN_SELFTEST").is_none() {
        return;
    }
    std::panic::set_hook(Box::new(|info| log::error!("SELFTEST PANIC: {info}")));
    #[cfg(windows)]
    {
        let app = app.clone();
        std::thread::spawn(move || imp::run(app));
    }
    #[cfg(not(windows))]
    let _ = app;
}

fn sleep_ms(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    fn text(h: HWND, class: bool) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe {
            if class {
                GetClassNameW(h, buf.as_mut_ptr(), 256)
            } else {
                GetWindowTextW(h, buf.as_mut_ptr(), 256)
            }
        };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn pid_of(h: HWND) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h, &mut pid) };
        pid
    }

    fn describe(h: HWND) -> String {
        if h.is_null() {
            return "null".into();
        }
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        unsafe { GetWindowRect(h, &mut r) };
        let ours = pid_of(h) == std::process::id();
        unsafe {
            format!(
                "{:?} '{}' class={} {} vis={} iconic={} rect=({},{} {}x{}) ex={:#x}",
                h,
                text(h, false),
                text(h, true),
                if ours { "OURS" } else { "other" },
                IsWindowVisible(h),
                IsIconic(h),
                r.left,
                r.top,
                r.right - r.left,
                r.bottom - r.top,
                GetWindowLongPtrW(h, GWL_EXSTYLE)
            )
        }
    }

    fn webview_hwnd(app: &AppHandle, label: &str) -> Option<HWND> {
        app.get_webview_window(label).and_then(|w| w.hwnd().ok()).map(|h| h.0 as HWND)
    }

    /// Foreground window, our windows, and (optionally) the top of the z-order.
    fn report(app: &AppHandle, tag: &str, zorder: bool) {
        let fg = unsafe { GetForegroundWindow() };
        log::info!("SELFTEST [{tag}] foreground: {}", describe(fg));
        let settings = webview_hwnd(app, "settings");
        log::info!(
            "SELFTEST [{tag}] tauri settings window: {}",
            match settings {
                Some(h) => format!("{} iswindow={}", describe(h), unsafe { IsWindow(h) }),
                None => "none".into(),
            }
        );
        if let Some(h) = webview_hwnd(app, "tray") {
            log::info!("SELFTEST [{tag}] tray: vis={}", unsafe { IsWindowVisible(h) });
        }
        if zorder {
            let mut h = unsafe { GetTopWindow(std::ptr::null_mut()) };
            let mut i = 0;
            let mut shown = 0;
            while !h.is_null() && shown < 8 && i < 2000 {
                let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                unsafe { GetWindowRect(h, &mut r) };
                if unsafe { IsWindowVisible(h) } != 0 && r.right > r.left && r.bottom > r.top {
                    log::info!("SELFTEST [{tag}] z{i}: {}", describe(h));
                    shown += 1;
                }
                h = unsafe { GetWindow(h, GW_HWNDNEXT) };
                i += 1;
            }
        }
    }

    fn click(x: i32, y: i32, right: bool) {
        let (down, up) = if right { (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) } else { (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP) };
        unsafe { SetCursorPos(x, y) };
        sleep_ms(150);
        for flags in [down, up] {
            let input = INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
            };
            let n = unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) };
            log::info!("SELFTEST SendInput {} {} at ({x},{y}) -> {n}", if right { "right" } else { "left" }, if flags == down { "down" } else { "up" });
            sleep_ms(80);
        }
    }

    fn tray_visible(app: &AppHandle) -> bool {
        webview_hwnd(app, "tray").is_some_and(|h| unsafe { IsWindowVisible(h) } != 0)
    }

    /// Click the middle of another app's window (Notepad, started by the workflow) so it is
    /// the foreground app, like a user working in another program.
    fn focus_other_app() {
        let mut h = unsafe { GetTopWindow(std::ptr::null_mut()) };
        while !h.is_null() {
            let title = text(h, false);
            if unsafe { IsWindowVisible(h) } != 0 && (title.contains("Notepad") || title.contains("记事本")) {
                let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                unsafe { GetWindowRect(h, &mut r) };
                log::info!("SELFTEST clicking other app: {}", describe(h));
                click((r.left + r.right) / 2, (r.top + r.bottom) / 2, false);
                sleep_ms(500);
                return;
            }
            h = unsafe { GetWindow(h, GW_HWNDNEXT) };
        }
        log::warn!("SELFTEST no Notepad window found");
    }

    fn icon_rect(app: &AppHandle) -> Option<(i32, i32, i32, i32)> {
        let r = app.tray_by_id("main").and_then(|t| t.rect().ok().flatten())?;
        let p = r.position.to_physical::<f64>(1.0);
        let s = r.size.to_physical::<f64>(1.0);
        Some((p.x as i32, p.y as i32, s.width as i32, s.height as i32))
    }

    /// Like a user whose icon sits in the hidden-icons overflow: open the overflow ("^"),
    /// then right-click the ClashWin icon inside it.
    fn open_popup(app: &AppHandle) {
        let before = icon_rect(app);
        log::info!("SELFTEST icon rect (overflow closed): {before:?}");
        if let Some((x, y, w, h)) = before {
            click(x + w / 2, y + h / 2, false);
            sleep_ms(1200);
            log::info!("SELFTEST after clicking the chevron, foreground: {}", describe(unsafe { GetForegroundWindow() }));
            let after = icon_rect(app);
            log::info!("SELFTEST icon rect (overflow open?): {after:?}");
            if let Some((x, y, w, h)) = after.filter(|a| Some(*a) != before) {
                click(x + w / 2, y + h / 2, true);
                sleep_ms(1200);
                if tray_visible(app) {
                    log::info!("SELFTEST popup opened from the overflow icon");
                    return;
                }
                log::warn!("SELFTEST right-click on the overflow icon did not open the popup");
            }
        }
        // Fallback: what the right-click handler does (the overflow may still be open).
        let a = app.clone();
        let _ = app.run_on_main_thread(move || {
            let p = a.cursor_position().unwrap_or_default();
            crate::windows::toggle_tray_panel(&a, p);
        });
        sleep_ms(1200);
        log::info!("SELFTEST popup opened directly, visible={}", tray_visible(app));
    }

    fn settings_row_point(app: &AppHandle) -> Option<(i32, i32)> {
        let w = app.get_webview_window("tray")?;
        *POINT.lock().unwrap() = None;
        let _ = w.eval(
            r#"(() => {
                const r = [...document.querySelectorAll('.tr-row')].find((e) => e.textContent.includes('Ctrl+,'));
                if (!r) return;
                const b = r.getBoundingClientRect();
                window.__TAURI_INTERNALS__.invoke('selftest_point', { x: b.left + b.width / 2, y: b.top + b.height / 2 });
            })()"#,
        );
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(3) {
            if let Some((x, y)) = *POINT.lock().unwrap() {
                let pos = w.inner_position().ok()?;
                let scale = w.scale_factor().unwrap_or(1.0);
                log::info!("SELFTEST settings row css ({x},{y}), window inner {pos:?}, scale {scale}");
                return Some(((pos.x as f64 + x * scale) as i32, (pos.y as f64 + y * scale) as i32));
            }
            sleep_ms(50);
        }
        None
    }

    /// Tray menu -> Settings with real clicks, then watch the window for 2 s.
    fn tray_to_settings(app: &AppHandle, tag: &str) {
        focus_other_app();
        open_popup(app);
        let Some((x, y)) = settings_row_point(app) else {
            log::error!("SELFTEST [{tag}] settings row not found");
            return;
        };
        click(x, y, false);
        for i in 0..10 {
            sleep_ms(200);
            report(app, &format!("{tag} +{}ms", (i + 1) * 200), i == 9);
        }
    }

    /// The pre-fix code path: a window with its own new WebView2 environment, shown at once.
    fn old_style_settings(app: &AppHandle) {
        let r = tauri::WebviewWindowBuilder::new(app, "settings_old", tauri::WebviewUrl::App("index.html#/settings/general".into()))
            .title("ClashWin Settings (old way)")
            .inner_size(680.0, 560.0)
            .decorations(false)
            .center()
            .visible(true)
            .build();
        match &r {
            Ok(_) => log::info!("SELFTEST [old way] window created OK"),
            Err(e) => log::info!("SELFTEST [old way] build failed: {e}"),
        }
        for i in 0..5 {
            sleep_ms(200);
            let w = webview_hwnd(app, "settings_old");
            log::info!("SELFTEST [old way +{}ms] tauri window: {}", (i + 1) * 200, w.map(describe).unwrap_or_else(|| "none".into()));
        }
        if let Some(w) = app.get_webview_window("settings_old") {
            let _ = w.destroy();
        }
    }

    pub fn run(app: AppHandle) {
        sleep_ms(12000);
        log::info!("SELFTEST ===== A: normal, tray -> Settings =====");
        tray_to_settings(&app, "A");
        if let Some(w) = app.get_webview_window("settings") {
            let _ = w.destroy();
        }
        sleep_ms(1000);
        log::info!("SELFTEST settings window after destroy: {}", app.get_webview_window("settings").is_some());

        // Make every new WebView2 environment incompatible with the running browser process,
        // like after a background runtime update.
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-features=msWebOOUI --lang=fr");
        log::info!("SELFTEST ===== B: old code path, new environment =====");
        old_style_settings(&app);
        sleep_ms(800);
        log::info!("SELFTEST ===== C: fixed code, tray -> Settings =====");
        tray_to_settings(&app, "C");

        log::info!("SELFTEST DONE");
        sleep_ms(500);
        app.exit(0);
    }
}

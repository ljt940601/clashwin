//! Tray popup behaviour that matches a native Windows tray menu.
//!
//! - The popup is shown without taking activation, so the taskbar's hidden-icons
//!   overflow stays open while the popup is up (activating our window made Windows
//!   collapse it immediately and left the popup behind).
//! - Since it never gets focus, dismissal can't rely on focus loss: a watcher closes it
//!   on any mouse press outside the popup, on Esc, or when the foreground window changes
//!   (Alt+Tab, the overflow closing, another app activating).
//! - The window keeps a fixed size; only the visible panel/flyout shapes are clickable
//!   (window region), so transparent space never blocks clicks and nothing jumps.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::state::state;

static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Clickable rectangle in physical px relative to the window: (x, y, w, h, corner radius).
pub type RegionRect = (i32, i32, i32, i32, i32);

#[cfg(windows)]
fn hwnd(w: &WebviewWindow) -> Option<windows_sys::Win32::Foundation::HWND> {
    w.hwnd().ok().map(|h| h.0 as windows_sys::Win32::Foundation::HWND)
}

/// Mark the popup as a non-activating tool window (clicks don't activate it).
#[cfg(windows)]
pub fn make_non_activating(w: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW};
    let Some(h) = hwnd(w) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, ex | (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) as isize);
    }
}

/// Show topmost without activating (keeps the overflow / current foreground window active).
#[cfg(windows)]
pub fn show_without_activation(w: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
    };
    let Some(h) = hwnd(w) else {
        let _ = w.show();
        return;
    };
    unsafe {
        ShowWindow(h, SW_SHOWNOACTIVATE);
        SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    }
}

/// Hide with Win32 directly (counterpart of `show_without_activation`).
#[cfg(windows)]
pub fn hide_raw(w: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
    if let Some(h) = hwnd(w) {
        unsafe { ShowWindow(h, SW_HIDE) };
    }
}

/// Limit the window's visible and clickable area to the given rounded rects.
/// An empty list removes the region (whole window clickable), e.g. while a dialog is open.
#[cfg(windows)]
pub fn set_region(w: &WebviewWindow, rects: &[RegionRect]) {
    use windows_sys::Win32::Graphics::Gdi::{CombineRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, RGN_OR};
    let Some(h) = hwnd(w) else { return };
    unsafe {
        if rects.is_empty() {
            SetWindowRgn(h, std::ptr::null_mut(), 1);
            return;
        }
        let mut total: windows_sys::Win32::Graphics::Gdi::HRGN = std::ptr::null_mut();
        for &(x, y, rw, rh, r) in rects {
            // +1: CreateRoundRectRgn excludes the right/bottom edge
            let rgn = CreateRoundRectRgn(x, y, x + rw + 1, y + rh + 1, r * 2, r * 2);
            if total.is_null() {
                total = rgn;
            } else {
                CombineRgn(total, total, rgn, RGN_OR);
                DeleteObject(rgn);
            }
        }
        // The system owns the region after this call.
        SetWindowRgn(h, total, 1);
    }
}

#[cfg(windows)]
fn foreground() -> isize {
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as isize }
}



/// Is the screen point inside one of the region rects of a window at `origin`?
pub fn hit(rects: &[RegionRect], origin: (i32, i32), p: (i32, i32)) -> bool {
    rects.iter().any(|&(x, y, w, h, _)| {
        let (lx, ly) = (p.0 - origin.0, p.1 - origin.1);
        lx >= x && lx < x + w && ly >= y && ly < y + h
    })
}

/// State shared with the low-level hook procedures (they run on the watcher thread).
#[cfg(windows)]
#[derive(Default)]
struct HookState {
    popup: isize,
    region: Vec<RegionRect>,
    thread_id: u32,
    /// The press that dismissed the popup was swallowed; swallow its release too.
    swallow_mouse_up: Option<u32>,
    swallow_key_up: Option<u32>,
}

#[cfg(windows)]
static HOOK: once_cell::sync::Lazy<parking_lot::Mutex<HookState>> = once_cell::sync::Lazy::new(Default::default);

#[cfg(windows)]
const WM_APP_DISMISS: u32 = windows_sys::Win32::UI::WindowsAndMessaging::WM_APP + 1;

#[cfg(windows)]
fn inside_popup(popup: isize, region: &[RegionRect], pt: (i32, i32)) -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if unsafe { GetWindowRect(popup as _, &mut r) } == 0 {
        return false;
    }
    if region.is_empty() {
        return pt.0 >= r.left && pt.0 < r.right && pt.1 >= r.top && pt.1 < r.bottom;
    }
    hit(region, (r.left, r.top), pt)
}

#[cfg(windows)]
unsafe extern "system" fn mouse_proc(code: i32, wparam: usize, lparam: isize) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    if code >= 0 {
        let msg = wparam as u32;
        let info = &*(lparam as *const MSLLHOOKSTRUCT);
        if let Some(mut st) = HOOK.try_lock() {
            let up = match msg {
                WM_LBUTTONDOWN => Some(WM_LBUTTONUP),
                WM_RBUTTONDOWN => Some(WM_RBUTTONUP),
                WM_MBUTTONDOWN => Some(WM_MBUTTONUP),
                WM_XBUTTONDOWN => Some(WM_XBUTTONUP),
                _ => None,
            };
            if let Some(up) = up {
                if st.swallow_mouse_up.is_none() && !inside_popup(st.popup, &st.region, (info.pt.x, info.pt.y)) {
                    // Like a native menu: this press only dismisses; nothing underneath sees it.
                    st.swallow_mouse_up = Some(up);
                    PostThreadMessageW(st.thread_id, WM_APP_DISMISS, 0, 0);
                    return 1;
                }
            } else if st.swallow_mouse_up == Some(msg) {
                st.swallow_mouse_up = None;
                PostThreadMessageW(st.thread_id, WM_QUIT, 0, 0);
                return 1;
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(windows)]
unsafe extern "system" fn keyboard_proc(code: i32, wparam: usize, lparam: isize) -> isize {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    if code >= 0 {
        let msg = wparam as u32;
        let info = &*(lparam as *const KBDLLHOOKSTRUCT);
        if info.vkCode == VK_ESCAPE as u32 {
            if let Some(mut st) = HOOK.try_lock() {
                if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) && st.swallow_key_up.is_none() {
                    // Esc closes only the popup; the overflow area never sees it.
                    st.swallow_key_up = Some(info.vkCode);
                    PostThreadMessageW(st.thread_id, WM_APP_DISMISS, 0, 0);
                    return 1;
                }
                if (msg == WM_KEYUP || msg == WM_SYSKEYUP) && st.swallow_key_up == Some(info.vkCode) {
                    st.swallow_key_up = None;
                    PostThreadMessageW(st.thread_id, WM_QUIT, 0, 0);
                    return 1;
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

/// Push the latest clickable region to a running watcher.
#[cfg(windows)]
pub fn update_hook_region(region: &[RegionRect]) {
    HOOK.lock().region = region.to_vec();
}
#[cfg(not(windows))]
pub fn update_hook_region(_region: &[RegionRect]) {}

/// Close the popup like a native menu would: a press outside it, or Esc, dismisses it and is
/// swallowed (so the hidden-icons overflow and other windows don't react to it); switching
/// to another window also closes it. Runs until the popup hides or is reshown.
#[cfg(windows)]
pub fn watch_dismiss(app: &AppHandle) {
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    let gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    // Stop a previous watcher, if any.
    {
        let st = HOOK.lock();
        if st.thread_id != 0 {
            unsafe { PostThreadMessageW(st.thread_id, WM_QUIT, 0, 0) };
        }
    }
    let Some(popup) = app.get_webview_window("tray").and_then(|w| hwnd(&w)) else { return };
    let popup = popup as isize;
    let region = state(app).tray_ui.lock().region.clone();
    let app = app.clone();
    std::thread::spawn(move || unsafe {
        let tid = GetCurrentThreadId();
        *HOOK.lock() = HookState { popup, region, thread_id: tid, swallow_mouse_up: None, swallow_key_up: None };
        let module = GetModuleHandleW(std::ptr::null());
        let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0);
        let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0);
        let timer = SetTimer(std::ptr::null_mut(), 0, 50, None);
        let started = Instant::now();
        let start_fg = foreground();
        let ours: Vec<isize> = app.webview_windows().values().filter_map(|w| hwnd(w).map(|h| h as isize)).collect();
        let mut dismissed = false;
        let mut dismissed_at = Instant::now();

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            match msg.message {
                m if m == WM_APP_DISMISS => {
                    if !dismissed {
                        dismissed = true;
                        dismissed_at = Instant::now();
                        crate::windows::hide_tray_panel(&app);
                    }
                    // keep the hooks until the swallowed release arrives (WM_QUIT from the hook)
                }
                WM_TIMER => {
                    if dismissed {
                        // Don't hold the hooks if the release never comes.
                        if dismissed_at.elapsed() > Duration::from_secs(3) {
                            break;
                        }
                        continue;
                    }
                    if GENERATION.load(Ordering::SeqCst) != gen {
                        break; // reshown or hidden elsewhere
                    }
                    if IsWindowVisible(popup as _) == 0 {
                        break;
                    }
                    // Another window became active (Alt+Tab, app switch, overflow closed).
                    if started.elapsed() > Duration::from_millis(300) {
                        let fg = foreground();
                        if fg != start_fg && !ours.contains(&fg) {
                            crate::windows::hide_tray_panel(&app);
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
        KillTimer(std::ptr::null_mut(), timer);
        if !mouse.is_null() {
            UnhookWindowsHookEx(mouse);
        }
        if !keyboard.is_null() {
            UnhookWindowsHookEx(keyboard);
        }
        let mut st = HOOK.lock();
        if st.thread_id == tid {
            *st = HookState::default();
        }
    });
}

/// Stop any running watcher (popup hidden).
pub fn cancel_watch() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

#[cfg(not(windows))]
pub fn make_non_activating(_w: &WebviewWindow) {}
#[cfg(not(windows))]
pub fn show_without_activation(w: &WebviewWindow) {
    let _ = w.show();
}
#[cfg(not(windows))]
pub fn hide_raw(w: &WebviewWindow) {
    let _ = w.hide();
}
#[cfg(not(windows))]
pub fn set_region(_w: &WebviewWindow, _rects: &[RegionRect]) {}
#[cfg(not(windows))]
pub fn watch_dismiss(_app: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_test_uses_window_origin() {
        let rects = [(276, 0, 320, 600, 12), (0, 200, 270, 300, 12)];
        let origin = (1000, 300);
        assert!(hit(&rects, origin, (1000 + 300, 300 + 10))); // in panel
        assert!(hit(&rects, origin, (1000 + 10, 300 + 250))); // in flyout
        assert!(!hit(&rects, origin, (1000 + 10, 300 + 50))); // transparent gap above flyout
        assert!(!hit(&rects, origin, (900, 300))); // outside window
    }
}

//! Windows system proxy (WinINet / "Internet Settings") for the current user.

use crate::util::Res;

const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

#[derive(Debug, Clone, PartialEq)]
pub struct ProxyState {
    pub enabled: bool,
    pub server: String,
    pub bypass: String,
}

/// Bypass list in WinINet format: entries joined by ';'.
pub fn bypass_string(list: &[String]) -> String {
    let mut v: Vec<String> = list.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    v.dedup();
    v.join(";")
}

#[cfg(windows)]
pub fn current() -> Res<ProxyState> {
    use winreg::enums::HKEY_CURRENT_USER;
    let hk = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey(KEY)?;
    let enabled: u32 = hk.get_value("ProxyEnable").unwrap_or(0);
    let server: String = hk.get_value("ProxyServer").unwrap_or_default();
    let bypass: String = hk.get_value("ProxyOverride").unwrap_or_default();
    Ok(ProxyState { enabled: enabled != 0, server, bypass })
}

#[cfg(windows)]
pub fn apply(state: &ProxyState) -> Res<()> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    let hk = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(KEY, KEY_READ | KEY_WRITE)?;
    hk.set_value("ProxyEnable", &(state.enabled as u32))?;
    if state.enabled || !state.server.is_empty() {
        hk.set_value("ProxyServer", &state.server)?;
    }
    hk.set_value("ProxyOverride", &state.bypass)?;
    notify();
    Ok(())
}

/// Tell WinINet (and apps listening for it) that settings changed.
#[cfg(windows)]
fn notify() {
    use windows_sys::Win32::Networking::WinInet::{InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED};
    unsafe {
        InternetSetOptionW(std::ptr::null_mut(), INTERNET_OPTION_SETTINGS_CHANGED, std::ptr::null_mut(), 0);
        InternetSetOptionW(std::ptr::null_mut(), INTERNET_OPTION_REFRESH, std::ptr::null_mut(), 0);
    }
}

/// Point the system proxy at the local mixed port.
pub fn enable(port: u16, bypass: &[String]) -> Res<()> {
    apply(&ProxyState { enabled: true, server: format!("127.0.0.1:{port}"), bypass: bypass_string(bypass) })
}

/// Turn off the system proxy only if it still points at us.
pub fn disable(port: u16) -> Res<()> {
    let cur = current()?;
    let ours = cur.server.contains(&format!("127.0.0.1:{port}")) || cur.server.is_empty();
    if cur.enabled && ours {
        apply(&ProxyState { enabled: false, server: cur.server, bypass: cur.bypass })?;
    } else if cur.enabled && !ours {
        log::info!("system proxy points elsewhere ({}); leaving it", cur.server);
    }
    Ok(())
}

pub fn is_ours(port: u16) -> bool {
    current().map(|c| c.enabled && c.server.contains(&format!("127.0.0.1:{port}"))).unwrap_or(false)
}

#[cfg(not(windows))]
pub fn current() -> Res<ProxyState> {
    Ok(ProxyState { enabled: false, server: String::new(), bypass: String::new() })
}
#[cfg(not(windows))]
pub fn apply(_state: &ProxyState) -> Res<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bypass() {
        assert_eq!(bypass_string(&["localhost".into(), " 127.* ".into(), "".into(), "<local>".into()]), "localhost;127.*;<local>");
    }
}

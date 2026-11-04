//! Windows system proxy (WinINet / "Internet Settings") for the current user.

use crate::util::Res;

const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
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

/// Point the system proxy at the local mixed port. Returns the state that was written.
pub fn enable(port: u16, bypass: &[String]) -> Res<ProxyState> {
    let st = ProxyState { enabled: true, server: format!("127.0.0.1:{port}"), bypass: bypass_string(bypass) };
    apply(&st)?;
    Ok(st)
}

/// Give the system proxy back after we set it.
///
/// Only touches the registry when it still holds exactly what we wrote; if another program
/// (e.g. another Clash client) has changed it since, it is left alone. When the settings we
/// replaced pointed at a proxy that is still listening, they are restored; otherwise the
/// proxy is switched off.
pub fn release(written: &ProxyState, previous: Option<&ProxyState>) -> Res<()> {
    let cur = current()?;
    if !(cur.enabled && cur.server == written.server) {
        log::info!("system proxy was changed by another program ({}); leaving it", cur.server);
        return Ok(());
    }
    if let Some(prev) = previous {
        if prev.enabled && prev.server != written.server && proxy_alive(&prev.server) {
            log::info!("restoring previous system proxy {}", prev.server);
            return apply(prev);
        }
    }
    apply(&ProxyState { enabled: false, server: cur.server, bypass: cur.bypass })
}

/// Is a proxy at "host:port" (or WinINet "http=host:port;https=...") accepting connections?
/// Unparseable values are assumed alive so they are restored as they were.
fn proxy_alive(server: &str) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    let first = server.split(';').next().unwrap_or("").trim();
    let addr = first.rsplit_once('=').map(|(_, a)| a).unwrap_or(first);
    let Some(sock) = addr.to_socket_addrs().ok().and_then(|mut a| a.next()) else { return true };
    TcpStream::connect_timeout(&sock, std::time::Duration::from_millis(400)).is_ok()
}

/// PID of the process listening on 127.0.0.1/0.0.0.0:`port` (IPv4 TCP), if any.
#[cfg(windows)]
pub fn listener_pid(port: u16) -> Option<u32> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER};
    use windows_sys::Win32::Networking::WinSock::AF_INET;
    unsafe {
        let mut size: u32 = 0;
        GetExtendedTcpTable(std::ptr::null_mut(), &mut size, 0, AF_INET as u32, TCP_TABLE_OWNER_PID_LISTENER, 0);
        if size == 0 {
            return None;
        }
        // u32-aligned buffer for the table header and rows
        let mut buf = vec![0u32; (size as usize + 3) / 4];
        if GetExtendedTcpTable(buf.as_mut_ptr() as *mut _, &mut size, 0, AF_INET as u32, TCP_TABLE_OWNER_PID_LISTENER, 0) != 0 {
            return None;
        }
        let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        let rows = std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
        rows.iter()
            .find(|r| {
                // port is in network byte order in the low 16 bits
                let p = (((r.dwLocalPort & 0xff) << 8) | ((r.dwLocalPort >> 8) & 0xff)) as u16;
                p == port
            })
            .map(|r| r.dwOwningPid)
    }
}
#[cfg(not(windows))]
pub fn listener_pid(_port: u16) -> Option<u32> {
    None
}

/// First free localhost TCP port at or after `start` (checked by binding).
pub fn free_port(start: u16) -> u16 {
    (start..start.saturating_add(200)).find(|p| std::net::TcpListener::bind(("127.0.0.1", *p)).is_ok()).unwrap_or(start)
}

pub fn is_ours(written: Option<&ProxyState>) -> bool {
    match (written, current()) {
        (Some(w), Ok(c)) => c.enabled && c.server == w.server,
        _ => false,
    }
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
    fn proxy_alive_checks_listener() {
        let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        assert!(proxy_alive(&format!("127.0.0.1:{port}")));
        assert!(proxy_alive(&format!("http=127.0.0.1:{port};https=127.0.0.1:{port}")));
        drop(l);
        assert!(!proxy_alive(&format!("127.0.0.1:{port}")));
        assert!(proxy_alive("not a host"));
    }

    #[test]
    fn listener_pid_finds_us() {
        let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        #[cfg(windows)]
        assert_eq!(listener_pid(port), Some(std::process::id()));
        let busy = free_port(port);
        assert_ne!(busy, port);
    }

    #[test]
    fn bypass() {
        assert_eq!(bypass_string(&["localhost".into(), " 127.* ".into(), "".into(), "<local>".into()]), "localhost;127.*;<local>");
    }
}

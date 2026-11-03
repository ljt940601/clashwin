//! Small Windows integrations: process icons, network adapters, Wi-Fi SSID,
//! memory usage, Job Object for child processes, user PATH for the CLI.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::util::Res;

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/* ---------------- Job object: children die with us ---------------- */

pub struct Job(isize);
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    #[cfg(windows)]
    pub fn new() -> Option<Job> {
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if h.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                h,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            Some(Job(h as isize))
        }
    }
    #[cfg(not(windows))]
    pub fn new() -> Option<Job> {
        None
    }

    #[cfg(windows)]
    pub fn assign(&self, child: &std::process::Child) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
        unsafe {
            AssignProcessToJobObject(self.0 as _, child.as_raw_handle() as _);
        }
    }
    #[cfg(not(windows))]
    pub fn assign(&self, _child: &std::process::Child) {}
}

/* ---------------- Process icon → PNG data URL ---------------- */

#[cfg(windows)]
pub fn process_icon_png(path: &str) -> Option<Vec<u8>> {
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows_sys::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    if path.is_empty() || !Path::new(path).exists() {
        return None;
    }
    unsafe {
        CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        let wpath = wide(path);
        let mut info: SHFILEINFOW = std::mem::zeroed();
        let r = SHGetFileInfoW(wpath.as_ptr(), 0, &mut info, std::mem::size_of::<SHFILEINFOW>() as u32, SHGFI_ICON | SHGFI_LARGEICON);
        if r == 0 || info.hIcon.is_null() {
            return None;
        }
        let hicon = info.hIcon;
        let mut ii: ICONINFO = std::mem::zeroed();
        if GetIconInfo(hicon, &mut ii) == 0 {
            DestroyIcon(hicon);
            return None;
        }
        let mut bm: BITMAP = std::mem::zeroed();
        let color = ii.hbmColor;
        let mask = ii.hbmMask;
        let result = (|| {
            if color.is_null() {
                return None;
            }
            if GetObjectW(color as HGDIOBJ, std::mem::size_of::<BITMAP>() as i32, &mut bm as *mut _ as *mut _) == 0 {
                return None;
            }
            let (w, h) = (bm.bmWidth, bm.bmHeight);
            if w <= 0 || h <= 0 || w > 256 || h > 256 {
                return None;
            }
            let read = |hbm: HBITMAP| -> Option<Vec<u8>> {
                let mut bi: BITMAPINFO = std::mem::zeroed();
                bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
                bi.bmiHeader.biWidth = w;
                bi.bmiHeader.biHeight = -h; // top-down
                bi.bmiHeader.biPlanes = 1;
                bi.bmiHeader.biBitCount = 32;
                bi.bmiHeader.biCompression = BI_RGB as u32;
                let mut buf = vec![0u8; (w * h * 4) as usize];
                let dc = GetDC(std::ptr::null_mut());
                let n = GetDIBits(dc, hbm, 0, h as u32, buf.as_mut_ptr() as *mut _, &mut bi, DIB_RGB_COLORS);
                ReleaseDC(std::ptr::null_mut(), dc);
                (n != 0).then_some(buf)
            };
            let mut px = read(color)?;
            let has_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
            if !has_alpha {
                if let Some(m) = (!mask.is_null()).then(|| read(mask)).flatten() {
                    for (p, mp) in px.chunks_exact_mut(4).zip(m.chunks_exact(4)) {
                        p[3] = if mp[0] == 0 { 255 } else { 0 };
                    }
                } else {
                    px.chunks_exact_mut(4).for_each(|p| p[3] = 255);
                }
            }
            // BGRA → RGBA
            for p in px.chunks_exact_mut(4) {
                p.swap(0, 2);
            }
            encode_png(&px, w as u32, h as u32)
        })();
        if !color.is_null() {
            DeleteObject(color as HGDIOBJ);
        }
        if !mask.is_null() {
            DeleteObject(mask as HGDIOBJ);
        }
        DestroyIcon(hicon);
        result
    }
}
#[cfg(not(windows))]
pub fn process_icon_png(_path: &str) -> Option<Vec<u8>> {
    None
}

pub fn encode_png(rgba: &[u8], w: u32, h: u32) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(rgba).ok()?;
    }
    Some(out)
}

/* ---------------- Network adapters ---------------- */

#[cfg(windows)]
pub fn list_interfaces() -> Vec<String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::*;
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;
    let mut out = vec![];
    unsafe {
        let mut size: u32 = 32 * 1024;
        let mut buf: Vec<u8>;
        let mut tries = 0;
        loop {
            buf = vec![0u8; size as usize];
            let r = GetAdaptersAddresses(
                AF_UNSPEC as u32,
                GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
                std::ptr::null(),
                buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            );
            if r == 0 {
                break;
            }
            tries += 1;
            if r != 111 || tries > 3 {
                // 111 = ERROR_BUFFER_OVERFLOW
                return out;
            }
        }
        let mut p = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
        while !p.is_null() {
            let a = &*p;
            // 24 = IF_TYPE_SOFTWARE_LOOPBACK
            if a.OperStatus == IfOperStatusUp && a.IfType != 24 && !a.FriendlyName.is_null() {
                let mut len = 0;
                while *a.FriendlyName.add(len) != 0 {
                    len += 1;
                }
                let name = String::from_utf16_lossy(std::slice::from_raw_parts(a.FriendlyName, len));
                if !name.is_empty() && !out.contains(&name) {
                    out.push(name);
                }
            }
            p = a.Next;
        }
    }
    out
}
#[cfg(not(windows))]
pub fn list_interfaces() -> Vec<String> {
    vec![]
}

/// Primary LAN IPv4: first adapter that is up, not loopback/tunnel/virtual, and has a default gateway.
#[cfg(windows)]
pub fn lan_address() -> Option<String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::*;
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_UNSPEC, SOCKADDR_IN};
    unsafe {
        let mut size: u32 = 32 * 1024;
        let mut buf: Vec<u8>;
        let mut tries = 0;
        loop {
            buf = vec![0u8; size as usize];
            let r = GetAdaptersAddresses(
                AF_UNSPEC as u32,
                GAA_FLAG_INCLUDE_GATEWAYS | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
                std::ptr::null(),
                buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            );
            if r == 0 {
                break;
            }
            tries += 1;
            if r != 111 || tries > 3 {
                return None;
            }
        }
        let read_w = |p: *const u16| -> String {
            if p.is_null() {
                return String::new();
            }
            let mut len = 0;
            while *p.add(len) != 0 {
                len += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
        };
        let mut p = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
        while !p.is_null() {
            let a = &*p;
            p = a.Next;
            // 24 loopback, 131 tunnel, 53 prop virtual
            if a.OperStatus != IfOperStatusUp || matches!(a.IfType, 24 | 131 | 53) || a.FirstGatewayAddress.is_null() {
                continue;
            }
            let desc = format!("{} {}", read_w(a.Description), read_w(a.FriendlyName)).to_ascii_lowercase();
            if ["wintun", "clashwin", "meta", "virtual", "vmware", "hyper-v", "vethernet", "tap-", "wireguard", "loopback"]
                .iter()
                .any(|k| desc.contains(k))
            {
                continue;
            }
            let mut u = a.FirstUnicastAddress;
            while !u.is_null() {
                let ua = &*u;
                let sa = ua.Address.lpSockaddr;
                if !sa.is_null() && (*sa).sa_family == AF_INET {
                    let sin = &*(sa as *const SOCKADDR_IN);
                    let b = sin.sin_addr.S_un.S_addr.to_ne_bytes();
                    let ip = std::net::Ipv4Addr::new(b[0], b[1], b[2], b[3]);
                    if !ip.is_loopback() && !ip.is_link_local() {
                        return Some(ip.to_string());
                    }
                }
                u = ua.Next;
            }
        }
        None
    }
}
#[cfg(not(windows))]
pub fn lan_address() -> Option<String> {
    None
}

/* ---------------- Wi-Fi SSID ---------------- */

#[cfg(windows)]
pub fn wifi_ssid() -> Option<String> {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::NetworkManagement::WiFi::*;
    unsafe {
        let mut ver = 0u32;
        let mut h: HANDLE = std::ptr::null_mut();
        if WlanOpenHandle(2, std::ptr::null(), &mut ver, &mut h) != 0 {
            return None;
        }
        let mut result = None;
        let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        if WlanEnumInterfaces(h, std::ptr::null(), &mut list) == 0 && !list.is_null() {
            let n = (*list).dwNumberOfItems as usize;
            let items = std::slice::from_raw_parts((*list).InterfaceInfo.as_ptr(), n);
            for it in items {
                if it.isState != wlan_interface_state_connected {
                    continue;
                }
                let mut size = 0u32;
                let mut data: *mut core::ffi::c_void = std::ptr::null_mut();
                let mut vt: WLAN_OPCODE_VALUE_TYPE = 0;
                if WlanQueryInterface(h, &it.InterfaceGuid, wlan_intf_opcode_current_connection, std::ptr::null(), &mut size, &mut data, &mut vt) == 0
                    && !data.is_null()
                {
                    let attrs = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
                    let ssid = &attrs.wlanAssociationAttributes.dot11Ssid;
                    let len = (ssid.uSSIDLength as usize).min(32);
                    let s = String::from_utf8_lossy(&ssid.ucSSID[..len]).to_string();
                    WlanFreeMemory(data);
                    if !s.is_empty() {
                        result = Some(s);
                        break;
                    }
                }
            }
            WlanFreeMemory(list as *mut _);
        }
        WlanCloseHandle(h, std::ptr::null());
        result
    }
}
#[cfg(not(windows))]
pub fn wifi_ssid() -> Option<String> {
    None
}

/* ---------------- Memory ---------------- */

/// Resident memory of this process plus its WebView2 descendants (excluding the core).
pub fn app_memory() -> u64 {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new().with_memory().with_exe(UpdateKind::OnlyIfNotSet));
    let me = Pid::from_u32(std::process::id());
    let mut set: HashSet<Pid> = HashSet::from([me]);
    loop {
        let before = set.len();
        for (pid, p) in sys.processes() {
            if set.contains(pid) {
                continue;
            }
            if let Some(parent) = p.parent() {
                let is_core = p.name().to_string_lossy().to_ascii_lowercase().starts_with("mihomo");
                if set.contains(&parent) && !is_core {
                    set.insert(*pid);
                }
            }
        }
        if set.len() == before {
            break;
        }
    }
    // Private working set (what Task Manager shows); falls back to RSS if the query fails.
    set.iter()
        .filter_map(|p| sys.process(*p))
        .map(|p| private_working_set(p.pid().as_u32()).unwrap_or_else(|| p.memory()))
        .sum()
}

#[cfg(windows)]
fn private_working_set(pid: u32) -> Option<u64> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX2};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ};
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut c: PROCESS_MEMORY_COUNTERS_EX2 = std::mem::zeroed();
        c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32;
        let ok = GetProcessMemoryInfo(h, &mut c as *mut _ as *mut PROCESS_MEMORY_COUNTERS, c.cb);
        CloseHandle(h);
        if ok == 0 || c.PrivateWorkingSetSize == 0 {
            None
        } else {
            Some(c.PrivateWorkingSetSize as u64)
        }
    }
}
#[cfg(not(windows))]
fn private_working_set(_pid: u32) -> Option<u64> {
    None
}

/// Kill stray core processes started from our core directory (e.g. after a crash).
pub fn kill_processes_with_exe(exe: &Path) -> usize {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new().with_exe(UpdateKind::Always));
    let target = exe.to_string_lossy().to_ascii_lowercase();
    let mut n = 0;
    for p in sys.processes().values() {
        if let Some(e) = p.exe() {
            if e.to_string_lossy().to_ascii_lowercase() == target && p.pid().as_u32() != std::process::id() {
                if p.kill() {
                    n += 1;
                }
            }
        }
    }
    n
}

/* ---------------- CLI on PATH ---------------- */

/// Add `dir` to the user's PATH (HKCU\Environment) and broadcast the change.
#[cfg(windows)]
pub fn add_to_user_path(dir: &Path) -> Res<()> {
    use winreg::enums::{RegType, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegValue;
    let env = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)?;
    let cur: String = env.get_value("Path").unwrap_or_default();
    let d = dir.to_string_lossy().to_string();
    if cur.split(';').any(|p| p.trim().trim_end_matches('\\').eq_ignore_ascii_case(d.trim_end_matches('\\'))) {
        return Ok(());
    }
    let next = if cur.trim().is_empty() { d } else { format!("{};{}", cur.trim_end_matches(';'), d) };
    let bytes: Vec<u8> = next.encode_utf16().chain(std::iter::once(0)).flat_map(|u| u.to_le_bytes()).collect();
    env.set_raw_value("Path", &RegValue { vtype: RegType::REG_EXPAND_SZ, bytes })?;
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};
        let s = wide("Environment");
        let mut res = 0usize;
        SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, s.as_ptr() as isize, SMTO_ABORTIFHUNG, 3000, &mut res);
    }
    Ok(())
}
#[cfg(not(windows))]
pub fn add_to_user_path(_dir: &Path) -> Res<()> {
    Err(crate::util::AppError::io("unsupported"))
}

/// Locate the CLI executable next to the app (bundled as `clashwin-cli.exe`).
pub fn cli_exe() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["clashwin-cli.exe", "clashwin-cli"] {
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Install the CLI: `%LOCALAPPDATA%\ClashWin\bin` with `clashwin.cmd` and `cw.cmd` shims, on PATH.
/// Shims call `clashwin-cli.exe` when it sits next to the app, else `ClashWin.exe --cli`.
pub fn install_cli() -> Res<String> {
    let invoke = match cli_exe() {
        Some(cli) => format!("\"{}\"", cli.display()),
        None => format!("\"{}\" --cli", std::env::current_exe()?.display()),
    };
    let bin = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("ClashWin").join("bin");
    std::fs::create_dir_all(&bin)?;
    let shim = format!("@echo off\r\n{invoke} %*\r\n");
    std::fs::write(bin.join("clashwin.cmd"), &shim)?;
    std::fs::write(bin.join("cw.cmd"), &shim)?;
    add_to_user_path(&bin)?;
    Ok(bin.to_string_lossy().to_string())
}

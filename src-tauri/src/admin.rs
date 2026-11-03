//! Elevation helpers: detect admin rights, relaunch elevated, and the optional
//! "helper" (a scheduled task with highest privileges that relaunches ClashWin
//! elevated without a UAC prompt, so Enhanced Mode/TUN works after one authorization).

use crate::util::{hidden_command, AppError, Res};
use std::path::Path;

pub const HELPER_TASK: &str = "ClashWin Elevated";
pub const HELPER_VERSION: &str = "1.0.0";

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elev = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elev as *mut _ as *mut _,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        );
        CloseHandle(token);
        ok != 0 && elev.TokenIsElevated != 0
    }
}
#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// ShellExecuteEx with the "runas" verb. When `wait` is true, blocks until the process exits
/// and returns its exit code. Errors with code "CANCELLED" if the user declines UAC.
#[cfg(windows)]
pub fn run_elevated(exe: &Path, params: &str, wait: bool, hidden: bool) -> Res<u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_CANCELLED};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{SW_HIDE, SW_SHOWNORMAL};
    let verb = wide("runas");
    let file = wide(&exe.to_string_lossy());
    let p = wide(params);
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = p.as_ptr();
        info.nShow = if hidden { SW_HIDE } else { SW_SHOWNORMAL };
        if ShellExecuteExW(&mut info) == 0 {
            let err = GetLastError();
            if err == ERROR_CANCELLED {
                return Err(AppError::new("CANCELLED", "Administrator authorization was cancelled"));
            }
            return Err(AppError::io(format!("ShellExecuteEx failed ({err})")));
        }
        let mut code = 0u32;
        if !info.hProcess.is_null() {
            if wait {
                WaitForSingleObject(info.hProcess, INFINITE);
                GetExitCodeProcess(info.hProcess, &mut code);
            }
            CloseHandle(info.hProcess);
        }
        Ok(code)
    }
}
#[cfg(not(windows))]
pub fn run_elevated(_exe: &Path, _params: &str, _wait: bool, _hidden: bool) -> Res<u32> {
    Err(AppError::io("unsupported platform"))
}

/// Quote one command-line argument for CreateProcess-style parsing.
pub fn quote_arg(a: &str) -> String {
    if !a.is_empty() && !a.contains([' ', '\t', '"']) {
        return a.to_string();
    }
    let mut out = String::from("\"");
    let mut bs = 0;
    for ch in a.chars() {
        match ch {
            '\\' => bs += 1,
            '"' => {
                out.push_str(&"\\".repeat(bs * 2 + 1));
                out.push('"');
                bs = 0;
            }
            c => {
                out.push_str(&"\\".repeat(bs));
                bs = 0;
                out.push(c);
            }
        }
    }
    out.push_str(&"\\".repeat(bs * 2));
    out.push('"');
    out
}

/* ---------------- Helper (scheduled task) ---------------- */

pub fn helper_installed() -> bool {
    hidden_command("schtasks")
        .args(["/Query", "/TN", HELPER_TASK])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Task definition: manual-run only, highest privileges, interactive, no battery/time limits.
pub fn helper_task_xml(exe: &Path) -> String {
    let user = std::env::var("USERDOMAIN")
        .ok()
        .zip(std::env::var("USERNAME").ok())
        .map(|(d, u)| format!("{d}\\{u}"))
        .unwrap_or_default();
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Starts ClashWin with administrator rights so Enhanced Mode (TUN) works without UAC prompts.</Description>
  </RegistrationInfo>
  <Triggers />
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{cmd}</Command>
      <Arguments>--elevated</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        user = xml_escape(&user),
        cmd = xml_escape(&exe.to_string_lossy())
    )
}

/// Create the helper task (prompts UAC once).
pub fn helper_install(data_dir: &Path) -> Res<()> {
    let exe = std::env::current_exe()?;
    let xml = helper_task_xml(&exe);
    let path = data_dir.join("helper-task.xml");
    // schtasks expects UTF-16 LE with BOM for /XML
    let mut bytes = vec![0xFF, 0xFE];
    for u in xml.encode_utf16() {
        bytes.extend_from_slice(&u.to_le_bytes());
    }
    std::fs::write(&path, bytes)?;
    let params = format!("/Create /TN {} /XML {} /F", quote_arg(HELPER_TASK), quote_arg(&path.to_string_lossy()));
    let code = run_elevated(Path::new("schtasks.exe"), &params, true, true)?;
    let _ = std::fs::remove_file(&path);
    if code != 0 || !helper_installed() {
        return Err(AppError::io(format!("Failed to register the helper task (exit {code})")));
    }
    Ok(())
}

pub fn helper_uninstall() -> Res<()> {
    let params = format!("/Delete /TN {} /F", quote_arg(HELPER_TASK));
    let code = run_elevated(Path::new("schtasks.exe"), &params, true, true)?;
    if code != 0 && helper_installed() {
        return Err(AppError::io(format!("Failed to remove the helper task (exit {code})")));
    }
    Ok(())
}

/// Start the helper task (relaunches ClashWin elevated, no UAC).
pub fn helper_run() -> Res<()> {
    let out = hidden_command("schtasks").args(["/Run", "/TN", HELPER_TASK]).output()?;
    if !out.status.success() {
        return Err(AppError::io(format!(
            "Failed to start the helper task: {}",
            crate::util::decode_console(&out.stderr).trim()
        )));
    }
    Ok(())
}

/* ---------------- Relaunch coordination ---------------- */

/// Before relaunching, record our pid so the new instance waits for us to exit
/// (otherwise the single-instance guard would hand off to the dying process).
pub fn write_relaunch_marker(marker: &Path) {
    let _ = std::fs::write(marker, std::process::id().to_string());
}

/// Called very early at startup: wait (max 15 s) for a previous instance that is relaunching us.
pub fn wait_for_previous_instance(marker: &Path) {
    let Ok(s) = std::fs::read_to_string(marker) else { return };
    let _ = std::fs::remove_file(marker);
    let Ok(pid) = s.trim().parse::<u32>() else { return };
    if pid == std::process::id() {
        return;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while std::time::Instant::now() < deadline && process_alive(pid) {
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
}

#[cfg(windows)]
pub fn process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code);
        CloseHandle(h);
        ok != 0 && code == STILL_ACTIVE as u32
    }
}
#[cfg(not(windows))]
pub fn process_alive(_pid: u32) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quoting() {
        assert_eq!(quote_arg("abc"), "abc");
        assert_eq!(quote_arg("C:\\Program Files\\x.exe"), "\"C:\\Program Files\\x.exe\"");
        assert_eq!(quote_arg("a\"b"), "\"a\\\"b\"");
    }
    #[test]
    fn task_xml_has_highest_level() {
        let x = helper_task_xml(Path::new("C:\\A & B\\clashwin.exe"));
        assert!(x.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(x.contains("C:\\A &amp; B\\clashwin.exe"));
        assert!(x.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
    }
}

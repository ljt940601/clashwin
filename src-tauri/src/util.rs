//! Shared helpers: error type, data paths, logging, small utilities.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Error returned to the frontend as `{ code, message }`.
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }
    pub fn io(message: impl Into<String>) -> Self {
        Self::new("IO", message)
    }
    pub fn network(message: impl Into<String>) -> Self {
        Self::new("NETWORK", message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("NOT_FOUND", message)
    }
    pub fn invalid_config(message: impl Into<String>) -> Self {
        Self::new("INVALID_CONFIG", message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::io(e.to_string())
    }
}
impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        match e.downcast::<AppError>() {
            Ok(a) => a,
            Err(e) => Self::new("IO", format!("{e:#}")),
        }
    }
}
impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        Self::network(e.to_string())
    }
}
impl From<serde_yaml::Error> for AppError {
    fn from(e: serde_yaml::Error) -> Self {
        Self::invalid_config(e.to_string())
    }
}
impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::io(e.to_string())
    }
}
impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::io(format!("database: {e}"))
    }
}
impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        Self::io(e.to_string())
    }
}

pub type Res<T> = Result<T, AppError>;

/// All on-disk locations used by the app.
#[derive(Debug, Clone)]
pub struct Paths {
    pub data: PathBuf,
    pub settings: PathBuf,
    pub profiles_json: PathBuf,
    pub profiles: PathBuf,
    pub core: PathBuf,
    pub versions: PathBuf,
    pub home: PathBuf,
    pub history_db: PathBuf,
    pub logs: PathBuf,
}

impl Paths {
    /// `%APPDATA%\ClashWin`, or `CLASHWIN_DATA_DIR` when set (dev/testing).
    pub fn new() -> Self {
        if let Some(d) = std::env::var_os("CLASHWIN_DATA_DIR").filter(|d| !d.is_empty()) {
            return Self::at(PathBuf::from(d));
        }
        let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
        Self::at(base.join("ClashWin"))
    }

    pub fn at(data: PathBuf) -> Self {
        Self {
            settings: data.join("settings.json"),
            profiles_json: data.join("profiles.json"),
            profiles: data.join("profiles"),
            core: data.join("core"),
            versions: data.join("core").join("versions"),
            home: data.join("home"),
            history_db: data.join("history.db"),
            logs: data.join("logs"),
            data,
        }
    }

    pub fn ensure(&self) -> std::io::Result<()> {
        for d in [&self.data, &self.profiles, &self.core, &self.versions, &self.home, &self.logs] {
            std::fs::create_dir_all(d)?;
        }
        std::fs::create_dir_all(self.home.join("providers"))?;
        Ok(())
    }

    pub fn core_exe(&self) -> PathBuf {
        self.core.join("mihomo.exe")
    }
    pub fn core_version_file(&self) -> PathBuf {
        self.core.join("version.txt")
    }
    pub fn runtime_config(&self) -> PathBuf {
        self.home.join("runtime.yaml")
    }
    pub fn profile_file(&self, id: &str) -> PathBuf {
        self.profiles.join(format!("{id}.yaml"))
    }
    pub fn rules_override_file(&self, id: &str) -> PathBuf {
        self.profiles.join(format!("{id}.rules.json"))
    }
    pub fn relaunch_marker(&self) -> PathBuf {
        self.data.join("relaunch.pid")
    }
}

/// Write a file atomically (tmp + rename).
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = path.with_extension("tmp~");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all().ok();
    }
    std::fs::rename(&tmp, path)
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn random_hex(n: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..n).map(|_| format!("{:x}", rng.gen_range(0..16u8))).collect()
}

/// Deep merge `patch` into `base` (objects merge recursively; everything else replaces).
pub fn json_merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(b), serde_json::Value::Object(p)) => {
            for (k, v) in p {
                if v.is_null() {
                    // explicit null means "set to null" for optional fields
                    b.insert(k.clone(), serde_json::Value::Null);
                    continue;
                }
                match b.get_mut(k) {
                    Some(bv) if bv.is_object() && v.is_object() => json_merge(bv, v),
                    _ => {
                        b.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (b, p) => *b = p.clone(),
    }
}

/// Hidden-window process creation flag for console tools.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Build a std Command that never flashes a console window.
pub fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Decode console output (UTF-8, falling back to lossy).
pub fn decode_console(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => String::from_utf8_lossy(bytes).to_string(),
    }
}

/// Is the UI language Chinese? Used for backend-originated notifications.
pub fn ui_is_zh(lang_setting: &str) -> bool {
    match lang_setting {
        "zh" => true,
        "en" => false,
        _ => system_ui_is_zh(),
    }
}

#[cfg(windows)]
pub fn system_ui_is_zh() -> bool {
    let lang = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
    (lang & 0x3ff) == 0x04
}
#[cfg(not(windows))]
pub fn system_ui_is_zh() -> bool {
    false
}

/* ---------------- Simple file logger ---------------- */

struct FileLogger {
    file: parking_lot::Mutex<Option<std::fs::File>>,
}

impl log::Log for FileLogger {
    fn enabled(&self, m: &log::Metadata) -> bool {
        m.level() <= log::Level::Info || m.target().starts_with("clashwin")
    }
    fn log(&self, r: &log::Record) {
        if !self.enabled(r.metadata()) {
            return;
        }
        let line = format!(
            "{} {:<5} [{}] {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            r.level(),
            r.target(),
            r.args()
        );
        #[cfg(debug_assertions)]
        eprint!("{line}");
        if let Some(f) = self.file.lock().as_mut() {
            let _ = f.write_all(line.as_bytes());
        }
    }
    fn flush(&self) {}
}

pub fn init_logger(dir: &Path) {
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join("clashwin.log");
    // keep the log small: truncate when over 5 MB
    if std::fs::metadata(&path).map(|m| m.len() > 5 * 1024 * 1024).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("clashwin.old.log"));
    }
    let file = std::fs::OpenOptions::new().create(true).append(true).open(&path).ok();
    let logger = Box::leak(Box::new(FileLogger { file: parking_lot::Mutex::new(file) }));
    if log::set_logger(logger).is_ok() {
        log::set_max_level(log::LevelFilter::Debug);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn merge_nested() {
        let mut a = serde_json::json!({"a": 1, "b": {"c": 2, "d": 3}, "e": [1, 2]});
        json_merge(&mut a, &serde_json::json!({"b": {"c": 9}, "e": [3]}));
        assert_eq!(a, serde_json::json!({"a": 1, "b": {"c": 9, "d": 3}, "e": [3]}));
    }
}

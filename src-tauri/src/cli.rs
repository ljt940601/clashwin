//! CLI used by the `clashwin-cli` binary and by `ClashWin.exe --cli` (aliases `clashwin` / `cw` via PATH shims): control the running
//! mihomo core from a terminal. Reads %APPDATA%\ClashWin\settings.json for the
//! controller address/secret. Output is JSON (compact; `--pretty` to indent).

use crate::profiles;
use crate::settings::AppSettings;
use crate::util::Paths;
use futures_util::StreamExt;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

const USAGE: &str = "clashwin-cli — control ClashWin's mihomo core

USAGE: clashwin-cli <command> [args] [--pretty]

  version                  Core version
  status                   Running state, mode and version
  app-status               Status plus active profile and proxy switches
  configs                  Current core configuration
  mode [rule|global|direct]  Show or switch the outbound mode
  proxies                  Policy groups and nodes with latest delay
  select <group> <proxy>   Select a node in a group
  delay <proxy> [url]      Test a node's latency
  connections              Active connections
  close <id>               Close one connection
  close-all                Close all connections
  traffic                  Stream per-second traffic (Ctrl+C to stop)
  logs [level]             Stream logs: debug|info|warning|error (default info)
  reload                   Hot-reload the runtime configuration
  restart                  Restart the core in place
  providers                Proxy and rule providers
  profile list             Profiles and which one is active
";

struct Cli {
    url: String,
    secret: String,
    settings: AppSettings,
    paths: Paths,
    pretty: bool,
    http: reqwest::Client,
}

fn enc(s: &str) -> String {
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

impl Cli {
    fn print(&self, v: &Value) {
        let s = if self.pretty { serde_json::to_string_pretty(v) } else { serde_json::to_string(v) };
        println!("{}", s.unwrap_or_default());
    }

    async fn api(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
        let mut req = self.http.request(method, format!("{}{}", self.url, path));
        if !self.secret.is_empty() {
            req = req.bearer_auth(&self.secret);
        }
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req.send().await.map_err(|e| {
            if e.is_connect() {
                "ClashWin core is not running (controller unreachable)".to_string()
            } else {
                e.to_string()
            }
        })?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            let msg = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
                .unwrap_or_else(|| format!("HTTP {status}"));
            return Err(msg);
        }
        Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) })
    }

    async fn stream(&self, path: &str) -> Result<(), String> {
        let url = format!("{}{}", self.url.replacen("http", "ws", 1), path);
        let mut req = url.as_str().into_client_request().map_err(|e| e.to_string())?;
        if !self.secret.is_empty() {
            req.headers_mut().insert("Authorization", format!("Bearer {}", self.secret).parse().map_err(|_| "bad secret".to_string())?);
        }
        let (mut ws, _) = tokio_tungstenite::connect_async(req).await.map_err(|_| "ClashWin core is not running (controller unreachable)".to_string())?;
        while let Some(msg) = ws.next().await {
            match msg {
                Ok(Message::Text(t)) => {
                    if self.pretty {
                        if let Ok(v) = serde_json::from_str::<Value>(&t) {
                            self.print(&v);
                            continue;
                        }
                    }
                    println!("{}", t.trim_end());
                }
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
        Ok(())
    }
}

/// Run the CLI with `args` (without the program name). Returns the process exit code.
pub fn main_with_args(mut args: Vec<String>) -> i32 {
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("{}", json!({ "error": e.to_string() }));
            return 1;
        }
    };
    rt.block_on(main_async(std::mem::take(&mut args)))
}

/// When the GUI exe is used as a CLI (`ClashWin.exe --cli ...`), write to the parent console.
pub fn attach_parent_console() {
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::System::Console::AttachConsole(windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS);
    }
}

async fn main_async(mut args: Vec<String>) -> i32 {
    let pretty = args.iter().any(|a| a == "--pretty");
    args.retain(|a| a != "--pretty");
    let paths = Paths::new();
    let settings = AppSettings::load(&paths.settings);
    let cli = Cli {
        url: settings.controller_url(),
        secret: settings.controller.secret.clone(),
        settings,
        paths,
        pretty,
        http: reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(30)).build().expect("http client"),
    };
    match run(&cli, &args).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{}", json!({ "error": e }));
            1
        }
    }
}

async fn run(cli: &Cli, args: &[String]) -> Result<(), String> {
    use reqwest::Method as M;
    let a = |i: usize| args.get(i).map(|s| s.as_str());
    match a(0).unwrap_or("help") {
        "help" | "-h" | "--help" => {
            print!("{USAGE}");
        }
        "version" => {
            let v = cli.api(M::GET, "/version", None).await?;
            cli.print(&json!({ "version": v.get("version") }));
        }
        "status" | "app-status" => {
            let detailed = a(0) == Some("app-status");
            let mut out = match cli.api(M::GET, "/version", None).await {
                Ok(v) => {
                    let c = cli.api(M::GET, "/configs", None).await.unwrap_or(Value::Null);
                    json!({ "status": "running", "mode": c.get("mode"), "version": v.get("version") })
                }
                Err(_) => json!({ "status": "stopped" }),
            };
            if detailed {
                let list = profiles::load(&cli.paths.profiles_json);
                let active = cli.settings.active_profile_id.as_ref().and_then(|id| list.iter().find(|p| &p.id == id)).map(|p| p.name.clone());
                out["profile"] = json!(active);
                out["systemProxy"] = json!(cli.settings.system_proxy);
                out["tunMode"] = json!(cli.settings.tun_mode);
                out["mixedPort"] = json!(cli.settings.engine.network.mixed_port);
            }
            cli.print(&out);
        }
        "configs" => {
            let v = cli.api(M::GET, "/configs", None).await?;
            cli.print(&v);
        }
        "mode" => match a(1) {
            None => {
                let c = cli.api(M::GET, "/configs", None).await?;
                cli.print(&json!({ "mode": c.get("mode") }));
            }
            Some(m) if matches!(m, "rule" | "global" | "direct") => {
                cli.api(M::PATCH, "/configs", Some(json!({ "mode": m }))).await?;
                cli.print(&json!({ "action": "mode", "mode": m }));
            }
            Some(m) => return Err(format!("unknown mode '{m}' (rule|global|direct)")),
        },
        "proxies" => {
            let v = cli.api(M::GET, "/proxies", None).await?;
            let map = v.get("proxies").and_then(|p| p.as_object()).cloned().unwrap_or_default();
            let delay_of = |p: &Value| p.get("history").and_then(|h| h.as_array()).and_then(|h| h.last()).and_then(|l| l.get("delay")).cloned();
            let mut groups = vec![];
            let mut nodes = vec![];
            for (name, p) in &map {
                if p.get("all").is_some() {
                    groups.push(json!({ "name": name, "type": p.get("type"), "now": p.get("now"), "all": p.get("all"), "hidden": p.get("hidden") }));
                } else {
                    nodes.push(json!({ "name": name, "type": p.get("type"), "delay": delay_of(p), "alive": p.get("alive") }));
                }
            }
            cli.print(&json!({ "groups": groups, "proxies": nodes }));
        }
        "select" => {
            let (Some(g), Some(p)) = (a(1), a(2)) else { return Err("usage: select <group> <proxy>".into()) };
            cli.api(M::PUT, &format!("/proxies/{}", enc(g)), Some(json!({ "name": p }))).await?;
            cli.print(&json!({ "action": "selected", "group": g, "proxy": p }));
        }
        "delay" => {
            let Some(p) = a(1) else { return Err("usage: delay <proxy> [url]".into()) };
            let url = a(2).map(|s| s.to_string()).unwrap_or_else(|| cli.settings.delay_test_url.clone());
            let v = cli.api(M::GET, &format!("/proxies/{}/delay?url={}&timeout={}", enc(p), enc(&url), cli.settings.delay_timeout), None).await?;
            cli.print(&json!({ "delay": v.get("delay"), "proxy": p }));
        }
        "connections" => {
            let v = cli.api(M::GET, "/connections", None).await?;
            let list: Vec<Value> = v
                .get("connections")
                .and_then(|c| c.as_array())
                .map(|a| {
                    a.iter()
                        .map(|c| {
                            let md = c.get("metadata").cloned().unwrap_or(Value::Null);
                            json!({
                                "id": c.get("id"),
                                "network": md.get("network"),
                                "host": md.get("host").filter(|h| h.as_str() != Some("")).or(md.get("destinationIP")),
                                "port": md.get("destinationPort"),
                                "process": md.get("process"),
                                "chains": c.get("chains"),
                                "rule": c.get("rule"),
                                "rulePayload": c.get("rulePayload"),
                                "upload": c.get("upload"),
                                "download": c.get("download"),
                                "start": c.get("start"),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            cli.print(&json!({ "uploadTotal": v.get("uploadTotal"), "downloadTotal": v.get("downloadTotal"), "connections": list }));
        }
        "close" => {
            let Some(id) = a(1) else { return Err("usage: close <id>".into()) };
            cli.api(M::DELETE, &format!("/connections/{}", enc(id)), None).await?;
            cli.print(&json!({ "action": "closed", "id": id }));
        }
        "close-all" => {
            cli.api(M::DELETE, "/connections", None).await?;
            cli.print(&json!({ "action": "closed-all" }));
        }
        "traffic" => {
            eprintln!("Watching traffic (Ctrl+C to stop)...");
            cli.stream("/traffic").await?;
        }
        "logs" => {
            let level = a(1).unwrap_or("info");
            if !matches!(level, "debug" | "info" | "warning" | "error") {
                return Err(format!("unknown level '{level}'"));
            }
            eprintln!("Streaming {level} logs (Ctrl+C to stop)...");
            cli.stream(&format!("/logs?level={level}")).await?;
        }
        "reload" => {
            let path = cli.paths.runtime_config();
            if !path.exists() {
                return Err("runtime.yaml not found; start ClashWin first".into());
            }
            cli.api(M::PUT, "/configs?force=true", Some(json!({ "path": path.to_string_lossy() }))).await?;
            cli.print(&json!({ "action": "reload", "status": "ok" }));
        }
        "restart" => {
            cli.api(M::POST, "/restart", Some(json!({}))).await?;
            cli.print(&json!({ "action": "restart", "status": "ok" }));
        }
        "providers" => {
            let px = cli.api(M::GET, "/providers/proxies", None).await?;
            let rx = cli.api(M::GET, "/providers/rules", None).await?;
            let proxies: Vec<Value> = px
                .get("providers")
                .and_then(|p| p.as_object())
                .map(|m| {
                    m.iter()
                        .filter(|(_, p)| p.get("vehicleType").and_then(|v| v.as_str()) != Some("Compatible"))
                        .map(|(n, p)| json!({ "name": n, "vehicleType": p.get("vehicleType"), "count": p.get("proxies").and_then(|x| x.as_array()).map(|a| a.len()), "updatedAt": p.get("updatedAt"), "subscriptionInfo": p.get("subscriptionInfo") }))
                        .collect()
                })
                .unwrap_or_default();
            let rules: Vec<Value> = rx
                .get("providers")
                .and_then(|p| p.as_object())
                .map(|m| m.iter().map(|(n, p)| json!({ "name": n, "vehicleType": p.get("vehicleType"), "behavior": p.get("behavior"), "count": p.get("ruleCount"), "updatedAt": p.get("updatedAt") })).collect())
                .unwrap_or_default();
            cli.print(&json!({ "proxies": proxies, "rules": rules }));
        }
        "profile" => match a(1) {
            Some("list") | None => {
                let list = profiles::load(&cli.paths.profiles_json);
                let active = cli.settings.active_profile_id.clone();
                let out: Vec<Value> = list
                    .iter()
                    .map(|p| {
                        json!({
                            "active": Some(&p.id) == active.as_ref(),
                            "fileName": format!("{}.yaml", p.id),
                            "name": p.name,
                            "type": p.kind,
                            "updatedAt": p.updated_at,
                        })
                    })
                    .collect();
                cli.print(&Value::Array(out));
            }
            Some(other) => return Err(format!("unknown profile command '{other}' (supported: list; switch profiles in the app)")),
        },
        other => return Err(format!("unknown command '{other}'; run `clashwin-cli help`")),
    }
    Ok(())
}

//! Traffic history: per-connection byte deltas from the controller's /connections
//! stream are aggregated in memory and flushed to SQLite every few seconds.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Timelike};
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::geo::detect_country;
use crate::util::Res;

/* ---------------- Frontend types ---------------- */

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsSummary {
    pub download: u64,
    pub upload: u64,
    pub connections: u64,
    pub destinations: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rank {
    pub name: String,
    pub value: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Split {
    pub direct: u64,
    pub proxy: u64,
    pub reject: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePoint {
    pub label: String,
    pub value: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsPeriod {
    pub period: String,
    pub total: u64,
    pub prev_total: u64,
    pub split: Split,
    pub timeline: Vec<TimelinePoint>,
    pub top_rules: Vec<Rank>,
    pub top_domains: Vec<Rank>,
    pub top_nodes: Vec<Rank>,
    pub top_policies: Vec<Rank>,
    pub top_processes: Vec<Rank>,
    pub top_countries: Vec<Rank>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RouteAgg {
    pub proxy_country: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    pub bytes: u64,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryInfo {
    pub records: u64,
    pub bytes: u64,
}

/* ---------------- Ingest types ---------------- */

/// What the collector extracts from each controller connection.
#[derive(Debug, Clone, Default)]
pub struct ConnSample {
    pub id: String,
    pub host: String,
    pub dst_ip: String,
    pub process: String,
    pub chains: Vec<String>,
    pub rule: String,
    pub rule_payload: String,
    pub upload: u64,
    pub download: u64,
}

impl ConnSample {
    pub fn from_json(c: &serde_json::Value) -> Option<Self> {
        let md = c.get("metadata")?;
        // node speed tests aren't the user's browsing: keep them out of the history
        if md.get("inboundName").and_then(|v| v.as_str()) == Some(crate::speedtest::LISTENER) {
            return None;
        }
        let s = |v: Option<&serde_json::Value>| v.and_then(|x| x.as_str()).unwrap_or("").to_string();
        Some(ConnSample {
            id: s(c.get("id")),
            host: {
                let h = s(md.get("host"));
                if h.is_empty() {
                    s(md.get("sniffHost"))
                } else {
                    h
                }
            },
            dst_ip: s(md.get("destinationIP")),
            process: s(md.get("process")),
            chains: c
                .get("chains")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default(),
            rule: s(c.get("rule")),
            rule_payload: s(c.get("rulePayload")),
            upload: c.get("upload").and_then(|v| v.as_u64()).unwrap_or(0),
            download: c.get("download").and_then(|v| v.as_u64()).unwrap_or(0),
        })
    }

    pub fn node(&self) -> &str {
        self.chains.first().map(|s| s.as_str()).unwrap_or("DIRECT")
    }
    pub fn policy(&self) -> &str {
        self.chains.last().map(|s| s.as_str()).unwrap_or("DIRECT")
    }
    pub fn split_class(&self) -> &'static str {
        let n = self.node().to_ascii_uppercase();
        if n == "DIRECT" {
            "direct"
        } else if n.starts_with("REJECT") {
            "reject"
        } else {
            "proxy"
        }
    }
    /// Rule label as shown in "Top Rules": rule-set name, "Match", or "Type(payload)".
    pub fn rule_key(&self) -> String {
        let r = self.rule.as_str();
        if r.eq_ignore_ascii_case("ruleset") || r.eq_ignore_ascii_case("rule-set") {
            if !self.rule_payload.is_empty() {
                return self.rule_payload.clone();
            }
        }
        if self.rule_payload.is_empty() {
            if r.is_empty() {
                "Match".into()
            } else {
                r.to_string()
            }
        } else {
            format!("{}({})", r, self.rule_payload)
        }
    }
    pub fn destination(&self) -> String {
        if self.host.is_empty() {
            self.dst_ip.clone()
        } else {
            self.host.clone()
        }
    }
}

#[derive(Default)]
struct Pending {
    hourly: HashMap<i64, (u64, u64)>,
    dims: HashMap<(String, &'static str, String), (u64, u64)>,
    routes: HashMap<(String, String, String, String), (u64, u64)>,
    destinations: HashSet<(String, String)>, // (day, key)
}

impl Pending {
    fn is_empty(&self) -> bool {
        self.hourly.is_empty() && self.dims.is_empty() && self.routes.is_empty() && self.destinations.is_empty()
    }
}

#[derive(Clone)]
struct LiveRoute {
    proxy_cc: String,
    target_cc: Option<String>,
    node: String,
    bytes: u64,
}

pub struct Stats {
    path: Option<PathBuf>,
    db: Mutex<Option<Connection>>,
    pending: Mutex<Pending>,
    seen: Mutex<HashMap<String, (u64, u64)>>,
    live: Mutex<Vec<LiveRoute>>,
    /// node name → detected country (regex detection is too costly per connection per second)
    node_cc: Mutex<HashMap<String, String>>,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS hourly (ts INTEGER PRIMARY KEY, up INTEGER NOT NULL DEFAULT 0, down INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS dims (day TEXT NOT NULL, dim TEXT NOT NULL, key TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, dim, key));
CREATE TABLE IF NOT EXISTS routes (day TEXT NOT NULL, proxy_cc TEXT NOT NULL, target_cc TEXT NOT NULL, node TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, proxy_cc, target_cc, node));
CREATE TABLE IF NOT EXISTS destinations (key TEXT PRIMARY KEY, first_day TEXT NOT NULL, last_day TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS dims_dim_day ON dims(dim, day);
";

fn day_str(d: &DateTime<Local>) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn hour_start(d: &DateTime<Local>) -> i64 {
    d.with_minute(0).and_then(|x| x.with_second(0)).and_then(|x| x.with_nanosecond(0)).map(|x| x.timestamp()).unwrap_or(d.timestamp())
}

fn local_midnight(date: NaiveDate) -> DateTime<Local> {
    let naive = date.and_hms_opt(0, 0, 0).unwrap();
    Local.from_local_datetime(&naive).earliest().unwrap_or_else(|| Local.from_utc_datetime(&naive))
}

impl Stats {
    pub fn open(path: &Path) -> Self {
        let conn = Connection::open(path)
            .and_then(|c| {
                c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
                c.execute_batch(SCHEMA)?;
                Ok(c)
            })
            .map_err(|e| log::error!("history db open failed: {e}"))
            .ok();
        Self { path: Some(path.to_path_buf()), db: Mutex::new(conn), pending: Default::default(), seen: Default::default(), live: Default::default(), node_cc: Default::default() }
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        Self { path: None, db: Mutex::new(Some(c)), pending: Default::default(), seen: Default::default(), live: Default::default(), node_cc: Default::default() }
    }

    /// Forget per-connection counters (core restarted).
    pub fn reset_seen(&self) {
        self.seen.lock().clear();
        self.live.lock().clear();
    }

    /// Feed one /connections snapshot.
    pub fn ingest(&self, conns: &[ConnSample], target_country: &dyn Fn(&str) -> Option<String>, now: DateTime<Local>) {
        let day = day_str(&now);
        let hour = hour_start(&now);
        let mut seen = self.seen.lock();
        let mut next: HashMap<String, (u64, u64)> = HashMap::with_capacity(conns.len());
        let mut p = self.pending.lock();
        let mut live = Vec::with_capacity(conns.len());

        for c in conns {
            next.insert(c.id.clone(), (c.upload, c.download));
            let prev = seen.get(&c.id).copied();
            let is_new = prev.is_none();
            let (pu, pd) = prev.unwrap_or((0, 0));
            let du = c.upload.saturating_sub(pu);
            let dd = c.download.saturating_sub(pd);
            let bytes = du + dd;
            let class = c.split_class();
            let node = c.node().to_string();
            let tcc = target_country(&c.dst_ip);
            let pcc = if class == "proxy" {
                let mut cache = self.node_cc.lock();
                if cache.len() > 4096 {
                    cache.clear();
                }
                match cache.get(&node) {
                    Some(c) => c.clone(),
                    None => {
                        // Name hint first, then the node's server IP; misses aren't cached so a
                        // later server lookup can still fill them in.
                        let c = detect_country(&node).or_else(|| crate::nodegeo::get(&node));
                        if let Some(c) = &c {
                            cache.insert(node.clone(), c.clone());
                        }
                        c.unwrap_or_default()
                    }
                }
            } else {
                String::new()
            };

            if class == "proxy" {
                live.push(LiveRoute { proxy_cc: pcc.clone(), target_cc: tcc.clone(), node: node.clone(), bytes: c.upload + c.download });
            }

            if !is_new && bytes == 0 {
                continue;
            }
            let cnt = if is_new { 1 } else { 0 };
            let e = p.hourly.entry(hour).or_insert((0, 0));
            e.0 += du;
            e.1 += dd;

            let mut add = |dim: &'static str, key: String, b: u64, n: u64| {
                if key.is_empty() {
                    return;
                }
                let e = p.dims.entry((day.clone(), dim, key)).or_insert((0, 0));
                e.0 += b;
                e.1 += n;
            };
            add("conn", "all".into(), bytes, cnt);
            add("domain", c.destination(), bytes, cnt);
            add("node", node.clone(), bytes, cnt);
            add("policy", c.policy().to_string(), bytes, cnt);
            add("rule", c.rule_key(), bytes, cnt);
            add("process", if c.process.is_empty() { "Unknown".into() } else { c.process.clone() }, bytes, cnt);
            add("split", class.to_string(), bytes, cnt);
            if let Some(cc) = &tcc {
                add("country", cc.clone(), bytes, cnt);
            }
            if class == "proxy" {
                let e = p.routes.entry((day.clone(), pcc.clone(), tcc.clone().unwrap_or_default(), node.clone())).or_insert((0, 0));
                e.0 += bytes;
                e.1 += cnt;
            }
            if is_new {
                let d = c.destination();
                if !d.is_empty() {
                    p.destinations.insert((day.clone(), d));
                }
            }
        }
        *seen = next;
        *self.live.lock() = live;
    }

    /// Write pending aggregates to the database.
    pub fn flush(&self) -> Res<()> {
        let pending = {
            let mut p = self.pending.lock();
            if p.is_empty() {
                return Ok(());
            }
            std::mem::take(&mut *p)
        };
        let mut g = self.db.lock();
        let Some(db) = g.as_mut() else { return Ok(()) };
        let tx = db.transaction()?;
        {
            let mut st = tx.prepare_cached("INSERT INTO hourly(ts, up, down) VALUES (?1, ?2, ?3) ON CONFLICT(ts) DO UPDATE SET up = up + excluded.up, down = down + excluded.down")?;
            for (ts, (u, d)) in &pending.hourly {
                st.execute(params![ts, *u as i64, *d as i64])?;
            }
            let mut st = tx.prepare_cached("INSERT INTO dims(day, dim, key, bytes, count) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(day, dim, key) DO UPDATE SET bytes = bytes + excluded.bytes, count = count + excluded.count")?;
            for ((day, dim, key), (b, n)) in &pending.dims {
                st.execute(params![day, dim, key, *b as i64, *n as i64])?;
            }
            let mut st = tx.prepare_cached("INSERT INTO routes(day, proxy_cc, target_cc, node, bytes, count) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(day, proxy_cc, target_cc, node) DO UPDATE SET bytes = bytes + excluded.bytes, count = count + excluded.count")?;
            for ((day, pcc, tcc, node), (b, n)) in &pending.routes {
                st.execute(params![day, pcc, tcc, node, *b as i64, *n as i64])?;
            }
            let mut st = tx.prepare_cached("INSERT INTO destinations(key, first_day, last_day) VALUES (?1, ?2, ?2) ON CONFLICT(key) DO UPDATE SET last_day = excluded.last_day")?;
            for (day, key) in &pending.destinations {
                st.execute(params![key, day])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn with_db<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>, default: T) -> Res<T> {
        let _ = self.flush();
        let g = self.db.lock();
        match g.as_ref() {
            Some(db) => Ok(f(db)?),
            None => Ok(default),
        }
    }

    pub fn summary(&self) -> Res<StatsSummary> {
        self.with_db(
            |db| {
                let (up, down): (i64, i64) = db.query_row("SELECT COALESCE(SUM(up),0), COALESCE(SUM(down),0) FROM hourly", [], |r| Ok((r.get(0)?, r.get(1)?)))?;
                let conns: i64 = db.query_row("SELECT COALESCE(SUM(count),0) FROM dims WHERE dim='conn'", [], |r| r.get(0))?;
                let dests: i64 = db.query_row("SELECT COUNT(*) FROM destinations", [], |r| r.get(0))?;
                Ok(StatsSummary { upload: up as u64, download: down as u64, connections: conns as u64, destinations: dests as u64 })
            },
            StatsSummary::default(),
        )
    }

    fn sum_hourly(db: &Connection, from: i64, to: i64) -> rusqlite::Result<u64> {
        let v: i64 = db.query_row("SELECT COALESCE(SUM(up + down), 0) FROM hourly WHERE ts >= ?1 AND ts < ?2", params![from, to], |r| r.get(0))?;
        Ok(v as u64)
    }

    fn top(db: &Connection, dim: &str, from_day: &str, to_day: &str, by_count: bool, limit: usize) -> rusqlite::Result<Vec<Rank>> {
        let order = if by_count { "c" } else { "b" };
        let sql = format!(
            "SELECT key, SUM(bytes) AS b, SUM(count) AS c FROM dims WHERE dim = ?1 AND day >= ?2 AND day <= ?3 GROUP BY key ORDER BY {order} DESC LIMIT ?4"
        );
        let mut st = db.prepare(&sql)?;
        let rows = st.query_map(params![dim, from_day, to_day, limit as i64], |r| {
            let key: String = r.get(0)?;
            let b: i64 = r.get(1)?;
            let c: i64 = r.get(2)?;
            Ok(if by_count { Rank { name: key, value: c as u64, count: Some(c as u64) } } else { Rank { name: key, value: b as u64, count: Some(c as u64) } })
        })?;
        rows.collect()
    }

    pub fn period(&self, period: &str, now: DateTime<Local>) -> Res<StatsPeriod> {
        let today = now.date_naive();
        let is_month = period == "month";
        let (start, prev_start, from_day) = if is_month {
            let ms = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap();
            let pm = if today.month() == 1 { NaiveDate::from_ymd_opt(today.year() - 1, 12, 1) } else { NaiveDate::from_ymd_opt(today.year(), today.month() - 1, 1) }.unwrap();
            (local_midnight(ms), local_midnight(pm), ms)
        } else {
            (local_midnight(today), local_midnight(today - Duration::days(1)), today)
        };
        let elapsed = now.timestamp() - start.timestamp();
        let from_s = from_day.format("%Y-%m-%d").to_string();
        let to_s = today.format("%Y-%m-%d").to_string();
        let now_ts = now.timestamp() + 1;

        self.with_db(
            |db| {
                let total = Self::sum_hourly(db, start.timestamp(), now_ts)?;
                let prev_total = Self::sum_hourly(db, prev_start.timestamp(), prev_start.timestamp() + elapsed.max(1))?;
                let mut split = Split::default();
                {
                    let mut st = db.prepare("SELECT key, SUM(bytes) FROM dims WHERE dim='split' AND day >= ?1 AND day <= ?2 GROUP BY key")?;
                    let rows = st.query_map(params![from_s, to_s], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
                    for row in rows {
                        let (k, v) = row?;
                        match k.as_str() {
                            "direct" => split.direct = v as u64,
                            "reject" => split.reject = v as u64,
                            _ => split.proxy += v as u64,
                        }
                    }
                }
                let timeline = if is_month {
                    let days_in_month = {
                        let next = if today.month() == 12 { NaiveDate::from_ymd_opt(today.year() + 1, 1, 1) } else { NaiveDate::from_ymd_opt(today.year(), today.month() + 1, 1) }.unwrap();
                        (next - from_day).num_days()
                    };
                    (0..days_in_month)
                        .map(|i| {
                            let d = from_day + Duration::days(i);
                            let s = local_midnight(d).timestamp();
                            let e = local_midnight(d + Duration::days(1)).timestamp();
                            let v = if d <= today { Self::sum_hourly(db, s, e).unwrap_or(0) } else { 0 };
                            TimelinePoint { label: (i + 1).to_string(), value: v }
                        })
                        .collect()
                } else {
                    let base = start.timestamp();
                    let mut buckets = vec![0u64; 24];
                    let mut st = db.prepare("SELECT ts, up + down FROM hourly WHERE ts >= ?1 AND ts < ?2")?;
                    let rows = st.query_map(params![base, base + 86400 + 3600], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
                    for row in rows {
                        let (ts, v) = row?;
                        let h = Local.timestamp_opt(ts, 0).single().map(|d| d.hour() as usize).unwrap_or(0);
                        if Local.timestamp_opt(ts, 0).single().map(|d| d.date_naive() == today).unwrap_or(false) {
                            buckets[h] += v as u64;
                        }
                    }
                    buckets.into_iter().enumerate().map(|(h, v)| TimelinePoint { label: format!("{h:02}"), value: v }).collect()
                };
                Ok(StatsPeriod {
                    period: if is_month { "month".into() } else { "today".into() },
                    total,
                    prev_total,
                    split,
                    timeline,
                    top_rules: Self::top(db, "rule", &from_s, &to_s, true, 10)?,
                    top_domains: Self::top(db, "domain", &from_s, &to_s, false, 10)?,
                    top_nodes: Self::top(db, "node", &from_s, &to_s, false, 10)?,
                    top_policies: Self::top(db, "policy", &from_s, &to_s, false, 10)?,
                    top_processes: Self::top(db, "process", &from_s, &to_s, false, 10)?,
                    top_countries: Self::top(db, "country", &from_s, &to_s, false, 10)?,
                })
            },
            StatsPeriod {
                period: period.into(),
                total: 0,
                prev_total: 0,
                split: Split::default(),
                timeline: vec![],
                top_rules: vec![],
                top_domains: vec![],
                top_nodes: vec![],
                top_policies: vec![],
                top_processes: vec![],
                top_countries: vec![],
            },
        )
    }

    pub fn routes(&self, range: &str, now: DateTime<Local>) -> Res<Vec<RouteAgg>> {
        if range == "realtime" {
            let mut agg: HashMap<(String, Option<String>, String), (u64, u64)> = HashMap::new();
            for r in self.live.lock().iter() {
                let e = agg.entry((r.proxy_cc.clone(), r.target_cc.clone(), r.node.clone())).or_insert((0, 0));
                e.0 += r.bytes;
                e.1 += 1;
            }
            let mut v: Vec<RouteAgg> = agg
                .into_iter()
                .map(|((p, t, n), (b, c))| RouteAgg { proxy_country: p, target_country: t, node: Some(n), bytes: b, count: c })
                .collect();
            v.sort_by(|a, b| b.bytes.cmp(&a.bytes));
            return Ok(v);
        }
        let today = now.date_naive();
        let from = match range {
            "week" => today - Duration::days(6),
            "month" => NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap(),
            _ => today,
        };
        let from_s = from.format("%Y-%m-%d").to_string();
        let to_s = today.format("%Y-%m-%d").to_string();
        self.with_db(
            |db| {
                let mut st = db.prepare(
                    "SELECT proxy_cc, target_cc, node, SUM(bytes) b, SUM(count) c FROM routes WHERE day >= ?1 AND day <= ?2 GROUP BY proxy_cc, target_cc, node ORDER BY b DESC LIMIT 200",
                )?;
                let rows = st.query_map(params![from_s, to_s], |r| {
                    let t: String = r.get(1)?;
                    Ok(RouteAgg {
                        proxy_country: r.get(0)?,
                        target_country: if t.is_empty() { None } else { Some(t) },
                        node: Some(r.get(2)?),
                        bytes: r.get::<_, i64>(3)? as u64,
                        count: r.get::<_, i64>(4)? as u64,
                    })
                })?;
                rows.collect()
            },
            vec![],
        )
    }

    pub fn info(&self) -> Res<HistoryInfo> {
        let records = self.with_db(
            |db| {
                let mut n = 0i64;
                for t in ["hourly", "dims", "routes", "destinations"] {
                    n += db.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get::<_, i64>(0))?;
                }
                Ok(n as u64)
            },
            0,
        )?;
        let mut bytes = 0;
        if let Some(p) = &self.path {
            for suffix in ["", "-wal", "-shm"] {
                let f = PathBuf::from(format!("{}{}", p.display(), suffix));
                bytes += std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
            }
        }
        Ok(HistoryInfo { records, bytes })
    }

    pub fn clear(&self) -> Res<()> {
        *self.pending.lock() = Pending::default();
        let g = self.db.lock();
        if let Some(db) = g.as_ref() {
            db.execute_batch("DELETE FROM hourly; DELETE FROM dims; DELETE FROM routes; DELETE FROM destinations;")?;
            db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        }
        Ok(())
    }

    /// Drop data older than `days` (0 = keep forever).
    pub fn prune(&self, days: u32, now: DateTime<Local>) -> Res<()> {
        if days == 0 {
            return Ok(());
        }
        let cutoff = now.date_naive() - Duration::days(days as i64);
        let cutoff_s = cutoff.format("%Y-%m-%d").to_string();
        let cutoff_ts = local_midnight(cutoff).timestamp();
        self.with_db(
            |db| {
                db.execute("DELETE FROM hourly WHERE ts < ?1", params![cutoff_ts])?;
                db.execute("DELETE FROM dims WHERE day < ?1", params![cutoff_s])?;
                db.execute("DELETE FROM routes WHERE day < ?1", params![cutoff_s])?;
                db.execute("DELETE FROM destinations WHERE last_day < ?1", params![cutoff_s])?;
                Ok(())
            },
            (),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(id: &str, host: &str, chains: &[&str], rule: &str, payload: &str, up: u64, down: u64) -> ConnSample {
        ConnSample {
            id: id.into(),
            host: host.into(),
            dst_ip: "8.8.8.8".into(),
            process: "chrome.exe".into(),
            chains: chains.iter().map(|s| s.to_string()).collect(),
            rule: rule.into(),
            rule_payload: payload.into(),
            upload: up,
            download: down,
        }
    }

    #[test]
    fn rule_keys() {
        assert_eq!(conn("1", "a", &["DIRECT"], "RuleSet", "China", 0, 0).rule_key(), "China");
        assert_eq!(conn("1", "a", &["DIRECT"], "Match", "", 0, 0).rule_key(), "Match");
        assert_eq!(conn("1", "a", &["DIRECT"], "DomainSuffix", "github.com", 0, 0).rule_key(), "DomainSuffix(github.com)");
        assert_eq!(conn("1", "a", &["REJECT", "AdBlock"], "RuleSet", "Reject", 0, 0).split_class(), "reject");
    }

    #[test]
    fn aggregates_deltas_and_periods() {
        let s = Stats::in_memory();
        let now = Local::now();
        let geo = |_: &str| Some("US".to_string());
        s.ingest(&[conn("a", "github.com", &["🇺🇸 US 1", "Proxy"], "RuleSet", "Proxy", 100, 1000), conn("b", "baidu.com", &["DIRECT"], "RuleSet", "China", 10, 20)], &geo, now);
        // second snapshot: a grows, b closed, c new
        s.ingest(&[conn("a", "github.com", &["🇺🇸 US 1", "Proxy"], "RuleSet", "Proxy", 150, 1500), conn("c", "github.com", &["🇺🇸 US 1", "Proxy"], "RuleSet", "Proxy", 5, 5)], &geo, now);
        let sum = s.summary().unwrap();
        assert_eq!(sum.upload, 150 + 10 + 5);
        assert_eq!(sum.download, 1500 + 20 + 5);
        assert_eq!(sum.connections, 3);
        assert_eq!(sum.destinations, 2);

        let p = s.period("today", now).unwrap();
        assert_eq!(p.total, 165 + 1525);
        assert_eq!(p.timeline.len(), 24);
        assert_eq!(p.split.direct, 30);
        assert_eq!(p.split.proxy, 1660);
        assert_eq!(p.top_rules[0].name, "Proxy");
        assert_eq!(p.top_rules[0].value, 2);
        assert_eq!(p.top_domains[0].name, "github.com");
        assert_eq!(p.top_nodes[0].name, "🇺🇸 US 1");
        assert_eq!(p.top_policies[0].name, "Proxy");
        assert_eq!(p.top_countries[0].name, "US");

        let m = s.period("month", now).unwrap();
        assert_eq!(m.total, p.total);
        assert!(m.timeline.len() >= 28);

        let r = s.routes("day", now).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].proxy_country, "US");
        assert_eq!(r[0].count, 2);
        let live = s.routes("realtime", now).unwrap();
        assert_eq!(live[0].count, 2);

        assert!(s.info().unwrap().records > 0);
        s.prune(30, now).unwrap();
        assert_eq!(s.summary().unwrap().connections, 3);
        s.clear().unwrap();
        assert_eq!(s.summary().unwrap().connections, 0);
    }
}

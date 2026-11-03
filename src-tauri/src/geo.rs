//! Country helpers: node-name country detection (port of src/lib/countries.ts),
//! GeoIP lookups via the core's Country.mmdb, and the approximate local location.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde::Serialize;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// (code, en name, city, lat, lon) — representative city per country (map route endpoints).
pub const COUNTRIES: &[(&str, &str, &str, f64, f64)] = &[
    ("CN", "China", "Shanghai", 31.23, 121.47),
    ("HK", "Hong Kong", "Hong Kong", 22.32, 114.17),
    ("MO", "Macao", "Macao", 22.2, 113.54),
    ("TW", "Taiwan", "Taipei", 25.03, 121.56),
    ("JP", "Japan", "Tokyo", 35.68, 139.69),
    ("KR", "South Korea", "Seoul", 37.57, 126.98),
    ("SG", "Singapore", "Singapore", 1.35, 103.82),
    ("MY", "Malaysia", "Kuala Lumpur", 3.14, 101.69),
    ("TH", "Thailand", "Bangkok", 13.76, 100.5),
    ("VN", "Vietnam", "Ho Chi Minh City", 10.82, 106.63),
    ("PH", "Philippines", "Manila", 14.6, 120.98),
    ("ID", "Indonesia", "Jakarta", -6.21, 106.85),
    ("IN", "India", "Mumbai", 19.08, 72.88),
    ("AE", "United Arab Emirates", "Dubai", 25.2, 55.27),
    ("TR", "Turkey", "Istanbul", 41.01, 28.98),
    ("RU", "Russia", "Moscow", 55.76, 37.62),
    ("UA", "Ukraine", "Kyiv", 50.45, 30.52),
    ("GB", "United Kingdom", "London", 51.51, -0.13),
    ("IE", "Ireland", "Dublin", 53.35, -6.26),
    ("FR", "France", "Paris", 48.86, 2.35),
    ("DE", "Germany", "Frankfurt", 50.11, 8.68),
    ("NL", "Netherlands", "Amsterdam", 52.37, 4.9),
    ("CH", "Switzerland", "Zurich", 47.38, 8.54),
    ("IT", "Italy", "Milan", 45.46, 9.19),
    ("ES", "Spain", "Madrid", 40.42, -3.7),
    ("SE", "Sweden", "Stockholm", 59.33, 18.07),
    ("PL", "Poland", "Warsaw", 52.23, 21.01),
    ("US", "United States", "Los Angeles", 34.05, -118.24),
    ("CA", "Canada", "Toronto", 43.65, -79.38),
    ("MX", "Mexico", "Mexico City", 19.43, -99.13),
    ("BR", "Brazil", "São Paulo", -23.55, -46.63),
    ("AR", "Argentina", "Buenos Aires", -34.6, -58.38),
    ("AU", "Australia", "Sydney", -33.87, 151.21),
    ("NZ", "New Zealand", "Auckland", -36.85, 174.76),
    ("ZA", "South Africa", "Johannesburg", -26.2, 28.05),
    ("IL", "Israel", "Tel Aviv", 32.09, 34.78),
    ("SA", "Saudi Arabia", "Riyadh", 24.71, 46.68),
    ("EG", "Egypt", "Cairo", 30.04, 31.24),
    ("NG", "Nigeria", "Lagos", 6.52, 3.38),
    ("KE", "Kenya", "Nairobi", -1.29, 36.82),
];

static KEYWORDS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    let raw: &[(&str, &str)] = &[
        (r"(?i)香港|港|hong\s?kong|\bhk(g)?\b", "HK"),
        (r"(?i)澳门|macao|macau|\bmo\b", "MO"),
        (r"(?i)台湾|台北|臺|taiwan|\btw\b", "TW"),
        (r"(?i)日本|东京|大阪|japan|tokyo|osaka|\bjp\b", "JP"),
        (r"(?i)韩国|首尔|korea|seoul|\bkr\b", "KR"),
        (r"(?i)新加坡|狮城|singapore|\bsg\b", "SG"),
        (
            r"(?i)美国|洛杉矶|圣何塞|硅谷|西雅图|纽约|芝加哥|达拉斯|united states|america|\bus(a)?\b|los angeles|san jose|seattle|new york|chicago|dallas",
            "US",
        ),
        (r"(?i)英国|伦敦|united kingdom|britain|london|\buk\b|\bgb\b", "GB"),
        (r"(?i)德国|法兰克福|germany|frankfurt|\bde\b", "DE"),
        (r"(?i)法国|巴黎|france|paris|\bfr\b", "FR"),
        (r"(?i)荷兰|阿姆斯特丹|netherlands|amsterdam|\bnl\b", "NL"),
        (r"(?i)加拿大|多伦多|温哥华|canada|toronto|vancouver|\bca\b", "CA"),
        (r"(?i)澳大利亚|澳洲|悉尼|australia|sydney|\bau\b", "AU"),
        (r"(?i)俄罗斯|莫斯科|russia|moscow|\bru\b", "RU"),
        (r"(?i)印度尼西亚|印尼|indonesia|jakarta|\bid\b", "ID"),
        (r"(?i)印度|india|mumbai|\bin\b", "IN"),
        (r"(?i)马来西亚|吉隆坡|malaysia|\bmy\b", "MY"),
        (r"(?i)泰国|曼谷|thailand|bangkok|\bth\b", "TH"),
        (r"(?i)越南|vietnam|\bvn\b", "VN"),
        (r"(?i)菲律宾|philippines|manila|\bph\b", "PH"),
        (r"(?i)土耳其|伊斯坦布尔|turkey|türkiye|istanbul|\btr\b", "TR"),
        (r"(?i)阿联酋|迪拜|emirates|dubai|\bae\b", "AE"),
        (r"(?i)巴西|brazil|\bbr\b", "BR"),
        (r"(?i)阿根廷|argentina|\bar\b", "AR"),
        (r"(?i)墨西哥|mexico|\bmx\b", "MX"),
        (r"(?i)瑞士|switzerland|zurich|\bch\b", "CH"),
        (r"(?i)瑞典|sweden|\bse\b", "SE"),
        (r"(?i)意大利|italy|milan|\bit\b", "IT"),
        (r"(?i)西班牙|spain|madrid|\bes\b", "ES"),
        (r"(?i)爱尔兰|ireland|dublin|\bie\b", "IE"),
        (r"(?i)波兰|poland|\bpl\b", "PL"),
        (r"(?i)乌克兰|ukraine|\bua\b", "UA"),
        (r"(?i)以色列|israel|\bil\b", "IL"),
        (r"(?i)南非|south africa|\bza\b", "ZA"),
        (r"(?i)新西兰|new zealand|\bnz\b", "NZ"),
        (r"(?i)中国|回国|china|\bcn\b", "CN"),
    ];
    raw.iter().map(|(r, c)| (Regex::new(r).expect("bad country regex"), *c)).collect()
});

/// Regional-indicator flag emoji → ISO code.
fn code_from_flag(s: &str) -> Option<String> {
    let mut prev: Option<char> = None;
    for ch in s.chars() {
        let cp = ch as u32;
        if (0x1F1E6..=0x1F1FF).contains(&cp) {
            if let Some(p) = prev {
                let a = (p as u32 - 0x1F1E6 + 65) as u8 as char;
                let b = (cp - 0x1F1E6 + 65) as u8 as char;
                return Some(format!("{a}{b}"));
            }
            prev = Some(ch);
        } else {
            prev = None;
        }
    }
    None
}

/// Best-effort country of a proxy node from its name.
pub fn detect_country(name: &str) -> Option<String> {
    if name.is_empty() {
        return None;
    }
    if let Some(c) = code_from_flag(name) {
        return Some(c);
    }
    KEYWORDS.iter().find(|(re, _)| re.is_match(name)).map(|(_, c)| c.to_string())
}

/* ---------------- GeoIP ---------------- */

pub struct GeoDb {
    home: PathBuf,
    reader: Mutex<Option<(PathBuf, SystemTime, maxminddb::Reader<Vec<u8>>)>>,
}

impl GeoDb {
    pub fn new(home: &Path) -> Self {
        Self { home: home.to_path_buf(), reader: Mutex::new(None) }
    }

    fn candidate(&self) -> Option<(PathBuf, SystemTime)> {
        for name in ["Country.mmdb", "country.mmdb", "geoip.metadb"] {
            let p = self.home.join(name);
            if let Ok(m) = std::fs::metadata(&p) {
                if m.len() > 1024 {
                    return Some((p, m.modified().unwrap_or(SystemTime::UNIX_EPOCH)));
                }
            }
        }
        None
    }

    /// (Re)open the database when the file appears or changes.
    fn ensure(&self) {
        let Some((path, mtime)) = self.candidate() else {
            *self.reader.lock() = None;
            return;
        };
        let mut g = self.reader.lock();
        if let Some((p, t, _)) = g.as_ref() {
            if *p == path && *t == mtime {
                return;
            }
        }
        match maxminddb::Reader::open_readfile(&path) {
            Ok(r) => *g = Some((path, mtime, r)),
            Err(e) => {
                log::warn!("geoip open failed: {e}");
                *g = None;
            }
        }
    }

    pub fn refresh(&self) {
        self.ensure();
    }

    pub fn lookup(&self, ip: &str) -> Option<String> {
        let ip: IpAddr = ip.trim().parse().ok()?;
        if is_private(&ip) {
            return None;
        }
        let g = self.reader.lock();
        let (_, _, r) = g.as_ref()?;
        // geoip.metadb mixes country codes with tags like "google"/"cloudflare"; keep only ISO codes.
        let iso = |s: &str| (s.len() == 2 && s.chars().all(|c| c.is_ascii_alphabetic())).then(|| s.to_ascii_uppercase());
        // MaxMind-style "country" record
        if let Ok(c) = r.lookup::<maxminddb::geoip2::Country>(ip) {
            if let Some(code) = c.country.and_then(|c| c.iso_code).and_then(iso).or_else(|| c.registered_country.and_then(|c| c.iso_code).and_then(iso)) {
                return Some(code);
            }
        }
        // sing-geoip: a plain string per network
        if let Ok(s) = r.lookup::<String>(ip) {
            if let Some(code) = iso(&s) {
                return Some(code);
            }
        }
        // Meta-geoip0: a list of codes/tags per network
        if let Ok(list) = r.lookup::<Vec<String>>(ip) {
            if let Some(code) = list.iter().find_map(|s| iso(s)) {
                return Some(code);
            }
        }
        None
    }
}

pub fn is_private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || (v.octets()[0] == 198 && (v.octets()[1] & 0xfe) == 18) // fake-ip 198.18/15
                || (v.octets()[0] == 100 && (v.octets()[1] & 0xc0) == 64) // CGNAT
        }
        IpAddr::V6(v) => v.is_loopback() || v.is_unspecified() || (v.segments()[0] & 0xfe00) == 0xfc00 || (v.segments()[0] & 0xffc0) == 0xfe80,
    }
}

/* ---------------- Local location ---------------- */

#[derive(Debug, Clone, Serialize)]
pub struct LocalLocation {
    pub country: String,
    pub city: String,
    pub lat: f64,
    pub lon: f64,
}

/// Windows timezone key → (country, city, lat, lon)
const TZ_CITIES: &[(&str, &str, &str, f64, f64)] = &[
    ("China Standard Time", "CN", "Shanghai", 31.23, 121.47),
    ("Taipei Standard Time", "TW", "Taipei", 25.03, 121.56),
    ("Tokyo Standard Time", "JP", "Tokyo", 35.68, 139.69),
    ("Korea Standard Time", "KR", "Seoul", 37.57, 126.98),
    ("Singapore Standard Time", "SG", "Singapore", 1.35, 103.82),
    ("SE Asia Standard Time", "TH", "Bangkok", 13.76, 100.5),
    ("India Standard Time", "IN", "Mumbai", 19.08, 72.88),
    ("Arabian Standard Time", "AE", "Dubai", 25.2, 55.27),
    ("Russian Standard Time", "RU", "Moscow", 55.76, 37.62),
    ("GMT Standard Time", "GB", "London", 51.51, -0.13),
    ("W. Europe Standard Time", "DE", "Berlin", 52.52, 13.4),
    ("Romance Standard Time", "FR", "Paris", 48.86, 2.35),
    ("Central Europe Standard Time", "HU", "Budapest", 47.5, 19.04),
    ("Pacific Standard Time", "US", "Los Angeles", 34.05, -118.24),
    ("Mountain Standard Time", "US", "Denver", 39.74, -104.99),
    ("Central Standard Time", "US", "Chicago", 41.88, -87.63),
    ("Eastern Standard Time", "US", "New York", 40.71, -74.01),
    ("AUS Eastern Standard Time", "AU", "Sydney", -33.87, 151.21),
    ("New Zealand Standard Time", "NZ", "Auckland", -36.85, 174.76),
    ("E. South America Standard Time", "BR", "São Paulo", -23.55, -46.63),
];

pub fn country_city(code: &str) -> Option<(&'static str, f64, f64)> {
    COUNTRIES.iter().find(|c| c.0 == code).map(|c| (c.2, c.3, c.4))
}

#[cfg(windows)]
fn windows_tz_key() -> Option<String> {
    use windows_sys::Win32::System::Time::{GetDynamicTimeZoneInformation, DYNAMIC_TIME_ZONE_INFORMATION};
    unsafe {
        let mut info: DYNAMIC_TIME_ZONE_INFORMATION = std::mem::zeroed();
        GetDynamicTimeZoneInformation(&mut info);
        let key = &info.TimeZoneKeyName;
        let len = key.iter().position(|&c| c == 0).unwrap_or(key.len());
        let s = String::from_utf16_lossy(&key[..len]);
        (!s.is_empty()).then_some(s)
    }
}
#[cfg(not(windows))]
fn windows_tz_key() -> Option<String> {
    None
}

#[cfg(windows)]
fn user_geo_code() -> Option<String> {
    use windows_sys::Win32::Globalization::GetUserDefaultGeoName;
    unsafe {
        let mut buf = [0u16; 16];
        let n = GetUserDefaultGeoName(buf.as_mut_ptr(), buf.len() as i32);
        if n <= 1 {
            return None;
        }
        let s = String::from_utf16_lossy(&buf[..(n as usize - 1)]);
        (s.len() == 2).then(|| s.to_uppercase())
    }
}
#[cfg(not(windows))]
fn user_geo_code() -> Option<String> {
    None
}

/// Approximate location of this machine without any network access:
/// region setting for the country, timezone for the city.
pub fn local_location() -> LocalLocation {
    let tz = windows_tz_key().and_then(|k| TZ_CITIES.iter().find(|t| t.0 == k).copied());
    let region = user_geo_code();
    if let Some(t) = tz {
        if region.as_deref().map(|r| r == t.1).unwrap_or(true) {
            return LocalLocation { country: t.1.into(), city: t.2.into(), lat: t.3, lon: t.4 };
        }
    }
    if let Some(r) = region {
        if let Some((city, lat, lon)) = country_city(&r) {
            return LocalLocation { country: r, city: city.into(), lat, lon };
        }
    }
    if let Some(t) = tz {
        return LocalLocation { country: t.1.into(), city: t.2.into(), lat: t.3, lon: t.4 };
    }
    // UTC offset fallback
    let off = chrono::Local::now().offset().local_minus_utc() / 3600;
    let code = match off {
        8 => "CN",
        9 => "JP",
        7 => "TH",
        5 => "IN",
        3 => "RU",
        1 | 2 => "DE",
        0 => "GB",
        -5 | -4 => "US",
        -8 | -7 | -6 => "US",
        10 | 11 => "AU",
        _ => "CN",
    };
    let (city, lat, lon) = country_city(code).unwrap_or(("Shanghai", 31.23, 121.47));
    LocalLocation { country: code.into(), city: city.into(), lat, lon }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_countries() {
        assert_eq!(detect_country("🇯🇵 OC JP1-anytls").as_deref(), Some("JP"));
        assert_eq!(detect_country("🇺🇸 GCP US-trojan").as_deref(), Some("US"));
        assert_eq!(detect_country("香港 01").as_deref(), Some("HK"));
        assert_eq!(detect_country("Singapore-02").as_deref(), Some("SG"));
        assert_eq!(detect_country("US West").as_deref(), Some("US"));
        assert_eq!(detect_country("DIRECT"), None);
        assert_eq!(detect_country("Auto"), None);
    }
    #[test]
    fn private_ips() {
        assert!(is_private(&"192.168.1.1".parse().unwrap()));
        assert!(is_private(&"198.18.0.5".parse().unwrap()));
        assert!(!is_private(&"8.8.8.8".parse().unwrap()));
    }
}

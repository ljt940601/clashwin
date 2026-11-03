/**
 * Country helpers: detect a country from a proxy node name, flag emoji,
 * localized names and a representative city coordinate (for the map).
 */

export interface CountryInfo {
  en: string;
  zh: string;
  city: string;
  lat: number;
  lon: number;
}

// Representative city per country (major hub, used as route endpoint on the map).
export const COUNTRIES: Record<string, CountryInfo> = {
  CN: { en: "China", zh: "中国", city: "Shanghai", lat: 31.23, lon: 121.47 },
  HK: { en: "Hong Kong", zh: "香港", city: "Hong Kong", lat: 22.32, lon: 114.17 },
  MO: { en: "Macao", zh: "澳门", city: "Macao", lat: 22.2, lon: 113.54 },
  TW: { en: "Taiwan", zh: "台湾", city: "Taipei", lat: 25.03, lon: 121.56 },
  JP: { en: "Japan", zh: "日本", city: "Tokyo", lat: 35.68, lon: 139.69 },
  KR: { en: "South Korea", zh: "韩国", city: "Seoul", lat: 37.57, lon: 126.98 },
  SG: { en: "Singapore", zh: "新加坡", city: "Singapore", lat: 1.35, lon: 103.82 },
  MY: { en: "Malaysia", zh: "马来西亚", city: "Kuala Lumpur", lat: 3.14, lon: 101.69 },
  TH: { en: "Thailand", zh: "泰国", city: "Bangkok", lat: 13.76, lon: 100.5 },
  VN: { en: "Vietnam", zh: "越南", city: "Ho Chi Minh City", lat: 10.82, lon: 106.63 },
  PH: { en: "Philippines", zh: "菲律宾", city: "Manila", lat: 14.6, lon: 120.98 },
  ID: { en: "Indonesia", zh: "印度尼西亚", city: "Jakarta", lat: -6.21, lon: 106.85 },
  IN: { en: "India", zh: "印度", city: "Mumbai", lat: 19.08, lon: 72.88 },
  PK: { en: "Pakistan", zh: "巴基斯坦", city: "Karachi", lat: 24.86, lon: 67.0 },
  BD: { en: "Bangladesh", zh: "孟加拉国", city: "Dhaka", lat: 23.81, lon: 90.41 },
  KH: { en: "Cambodia", zh: "柬埔寨", city: "Phnom Penh", lat: 11.56, lon: 104.92 },
  MN: { en: "Mongolia", zh: "蒙古", city: "Ulaanbaatar", lat: 47.89, lon: 106.91 },
  KZ: { en: "Kazakhstan", zh: "哈萨克斯坦", city: "Almaty", lat: 43.24, lon: 76.89 },
  AE: { en: "United Arab Emirates", zh: "阿联酋", city: "Dubai", lat: 25.2, lon: 55.27 },
  SA: { en: "Saudi Arabia", zh: "沙特阿拉伯", city: "Riyadh", lat: 24.71, lon: 46.68 },
  IL: { en: "Israel", zh: "以色列", city: "Tel Aviv", lat: 32.09, lon: 34.78 },
  TR: { en: "Turkey", zh: "土耳其", city: "Istanbul", lat: 41.01, lon: 28.98 },
  IR: { en: "Iran", zh: "伊朗", city: "Tehran", lat: 35.69, lon: 51.39 },
  RU: { en: "Russia", zh: "俄罗斯", city: "Moscow", lat: 55.76, lon: 37.62 },
  UA: { en: "Ukraine", zh: "乌克兰", city: "Kyiv", lat: 50.45, lon: 30.52 },
  GB: { en: "United Kingdom", zh: "英国", city: "London", lat: 51.51, lon: -0.13 },
  IE: { en: "Ireland", zh: "爱尔兰", city: "Dublin", lat: 53.35, lon: -6.26 },
  FR: { en: "France", zh: "法国", city: "Paris", lat: 48.86, lon: 2.35 },
  DE: { en: "Germany", zh: "德国", city: "Frankfurt", lat: 50.11, lon: 8.68 },
  NL: { en: "Netherlands", zh: "荷兰", city: "Amsterdam", lat: 52.37, lon: 4.9 },
  BE: { en: "Belgium", zh: "比利时", city: "Brussels", lat: 50.85, lon: 4.35 },
  LU: { en: "Luxembourg", zh: "卢森堡", city: "Luxembourg", lat: 49.61, lon: 6.13 },
  CH: { en: "Switzerland", zh: "瑞士", city: "Zurich", lat: 47.38, lon: 8.54 },
  AT: { en: "Austria", zh: "奥地利", city: "Vienna", lat: 48.21, lon: 16.37 },
  IT: { en: "Italy", zh: "意大利", city: "Milan", lat: 45.46, lon: 9.19 },
  ES: { en: "Spain", zh: "西班牙", city: "Madrid", lat: 40.42, lon: -3.7 },
  PT: { en: "Portugal", zh: "葡萄牙", city: "Lisbon", lat: 38.72, lon: -9.14 },
  SE: { en: "Sweden", zh: "瑞典", city: "Stockholm", lat: 59.33, lon: 18.07 },
  NO: { en: "Norway", zh: "挪威", city: "Oslo", lat: 59.91, lon: 10.75 },
  FI: { en: "Finland", zh: "芬兰", city: "Helsinki", lat: 60.17, lon: 24.94 },
  DK: { en: "Denmark", zh: "丹麦", city: "Copenhagen", lat: 55.68, lon: 12.57 },
  IS: { en: "Iceland", zh: "冰岛", city: "Reykjavik", lat: 64.15, lon: -21.94 },
  PL: { en: "Poland", zh: "波兰", city: "Warsaw", lat: 52.23, lon: 21.01 },
  CZ: { en: "Czechia", zh: "捷克", city: "Prague", lat: 50.08, lon: 14.44 },
  HU: { en: "Hungary", zh: "匈牙利", city: "Budapest", lat: 47.5, lon: 19.04 },
  RO: { en: "Romania", zh: "罗马尼亚", city: "Bucharest", lat: 44.43, lon: 26.1 },
  BG: { en: "Bulgaria", zh: "保加利亚", city: "Sofia", lat: 42.7, lon: 23.32 },
  GR: { en: "Greece", zh: "希腊", city: "Athens", lat: 37.98, lon: 23.73 },
  RS: { en: "Serbia", zh: "塞尔维亚", city: "Belgrade", lat: 44.79, lon: 20.45 },
  LT: { en: "Lithuania", zh: "立陶宛", city: "Vilnius", lat: 54.69, lon: 25.28 },
  LV: { en: "Latvia", zh: "拉脱维亚", city: "Riga", lat: 56.95, lon: 24.11 },
  EE: { en: "Estonia", zh: "爱沙尼亚", city: "Tallinn", lat: 59.44, lon: 24.75 },
  MD: { en: "Moldova", zh: "摩尔多瓦", city: "Chisinau", lat: 47.01, lon: 28.86 },
  US: { en: "United States", zh: "美国", city: "Los Angeles", lat: 34.05, lon: -118.24 },
  CA: { en: "Canada", zh: "加拿大", city: "Toronto", lat: 43.65, lon: -79.38 },
  MX: { en: "Mexico", zh: "墨西哥", city: "Mexico City", lat: 19.43, lon: -99.13 },
  BR: { en: "Brazil", zh: "巴西", city: "São Paulo", lat: -23.55, lon: -46.63 },
  AR: { en: "Argentina", zh: "阿根廷", city: "Buenos Aires", lat: -34.6, lon: -58.38 },
  CL: { en: "Chile", zh: "智利", city: "Santiago", lat: -33.45, lon: -70.67 },
  CO: { en: "Colombia", zh: "哥伦比亚", city: "Bogotá", lat: 4.71, lon: -74.07 },
  PE: { en: "Peru", zh: "秘鲁", city: "Lima", lat: -12.05, lon: -77.04 },
  AU: { en: "Australia", zh: "澳大利亚", city: "Sydney", lat: -33.87, lon: 151.21 },
  NZ: { en: "New Zealand", zh: "新西兰", city: "Auckland", lat: -36.85, lon: 174.76 },
  ZA: { en: "South Africa", zh: "南非", city: "Johannesburg", lat: -26.2, lon: 28.05 },
  EG: { en: "Egypt", zh: "埃及", city: "Cairo", lat: 30.04, lon: 31.24 },
  NG: { en: "Nigeria", zh: "尼日利亚", city: "Lagos", lat: 6.52, lon: 3.38 },
  KE: { en: "Kenya", zh: "肯尼亚", city: "Nairobi", lat: -1.29, lon: 36.82 },
  MA: { en: "Morocco", zh: "摩洛哥", city: "Casablanca", lat: 33.57, lon: -7.59 },
  // Additional coverage for GeoIP destinations on the flight map.
  QA: { en: "Qatar", zh: "卡塔尔", city: "Doha", lat: 25.29, lon: 51.53 },
  KW: { en: "Kuwait", zh: "科威特", city: "Kuwait City", lat: 29.38, lon: 47.99 },
  BH: { en: "Bahrain", zh: "巴林", city: "Manama", lat: 26.23, lon: 50.59 },
  OM: { en: "Oman", zh: "阿曼", city: "Muscat", lat: 23.59, lon: 58.41 },
  JO: { en: "Jordan", zh: "约旦", city: "Amman", lat: 31.95, lon: 35.93 },
  LB: { en: "Lebanon", zh: "黎巴嫩", city: "Beirut", lat: 33.89, lon: 35.5 },
  IQ: { en: "Iraq", zh: "伊拉克", city: "Baghdad", lat: 33.31, lon: 44.36 },
  AZ: { en: "Azerbaijan", zh: "阿塞拜疆", city: "Baku", lat: 40.41, lon: 49.87 },
  GE: { en: "Georgia", zh: "格鲁吉亚", city: "Tbilisi", lat: 41.72, lon: 44.79 },
  AM: { en: "Armenia", zh: "亚美尼亚", city: "Yerevan", lat: 40.18, lon: 44.51 },
  UZ: { en: "Uzbekistan", zh: "乌兹别克斯坦", city: "Tashkent", lat: 41.3, lon: 69.24 },
  KG: { en: "Kyrgyzstan", zh: "吉尔吉斯斯坦", city: "Bishkek", lat: 42.87, lon: 74.59 },
  NP: { en: "Nepal", zh: "尼泊尔", city: "Kathmandu", lat: 27.72, lon: 85.32 },
  LK: { en: "Sri Lanka", zh: "斯里兰卡", city: "Colombo", lat: 6.93, lon: 79.86 },
  MM: { en: "Myanmar", zh: "缅甸", city: "Yangon", lat: 16.84, lon: 96.17 },
  LA: { en: "Laos", zh: "老挝", city: "Vientiane", lat: 17.97, lon: 102.63 },
  BN: { en: "Brunei", zh: "文莱", city: "Bandar Seri Begawan", lat: 4.9, lon: 114.94 },
  MV: { en: "Maldives", zh: "马尔代夫", city: "Malé", lat: 4.18, lon: 73.51 },
  BY: { en: "Belarus", zh: "白俄罗斯", city: "Minsk", lat: 53.9, lon: 27.56 },
  SK: { en: "Slovakia", zh: "斯洛伐克", city: "Bratislava", lat: 48.15, lon: 17.11 },
  SI: { en: "Slovenia", zh: "斯洛文尼亚", city: "Ljubljana", lat: 46.06, lon: 14.51 },
  HR: { en: "Croatia", zh: "克罗地亚", city: "Zagreb", lat: 45.81, lon: 15.98 },
  BA: { en: "Bosnia and Herzegovina", zh: "波黑", city: "Sarajevo", lat: 43.86, lon: 18.41 },
  AL: { en: "Albania", zh: "阿尔巴尼亚", city: "Tirana", lat: 41.33, lon: 19.82 },
  MK: { en: "North Macedonia", zh: "北马其顿", city: "Skopje", lat: 42.0, lon: 21.43 },
  ME: { en: "Montenegro", zh: "黑山", city: "Podgorica", lat: 42.44, lon: 19.26 },
  CY: { en: "Cyprus", zh: "塞浦路斯", city: "Nicosia", lat: 35.19, lon: 33.38 },
  MT: { en: "Malta", zh: "马耳他", city: "Valletta", lat: 35.9, lon: 14.51 },
  TN: { en: "Tunisia", zh: "突尼斯", city: "Tunis", lat: 36.81, lon: 10.18 },
  DZ: { en: "Algeria", zh: "阿尔及利亚", city: "Algiers", lat: 36.75, lon: 3.06 },
  GH: { en: "Ghana", zh: "加纳", city: "Accra", lat: 5.6, lon: -0.19 },
  CI: { en: "Côte d'Ivoire", zh: "科特迪瓦", city: "Abidjan", lat: 5.36, lon: -4.01 },
  SN: { en: "Senegal", zh: "塞内加尔", city: "Dakar", lat: 14.72, lon: -17.47 },
  ET: { en: "Ethiopia", zh: "埃塞俄比亚", city: "Addis Ababa", lat: 9.03, lon: 38.74 },
  TZ: { en: "Tanzania", zh: "坦桑尼亚", city: "Dar es Salaam", lat: -6.79, lon: 39.21 },
  UG: { en: "Uganda", zh: "乌干达", city: "Kampala", lat: 0.35, lon: 32.58 },
  AO: { en: "Angola", zh: "安哥拉", city: "Luanda", lat: -8.84, lon: 13.23 },
  ZW: { en: "Zimbabwe", zh: "津巴布韦", city: "Harare", lat: -17.83, lon: 31.05 },
  EC: { en: "Ecuador", zh: "厄瓜多尔", city: "Quito", lat: -0.18, lon: -78.47 },
  VE: { en: "Venezuela", zh: "委内瑞拉", city: "Caracas", lat: 10.48, lon: -66.9 },
  UY: { en: "Uruguay", zh: "乌拉圭", city: "Montevideo", lat: -34.9, lon: -56.16 },
  PY: { en: "Paraguay", zh: "巴拉圭", city: "Asunción", lat: -25.26, lon: -57.58 },
  BO: { en: "Bolivia", zh: "玻利维亚", city: "La Paz", lat: -16.49, lon: -68.12 },
  CR: { en: "Costa Rica", zh: "哥斯达黎加", city: "San José", lat: 9.93, lon: -84.08 },
  PA: { en: "Panama", zh: "巴拿马", city: "Panama City", lat: 8.98, lon: -79.52 },
  GT: { en: "Guatemala", zh: "危地马拉", city: "Guatemala City", lat: 14.63, lon: -90.51 },
  DO: { en: "Dominican Republic", zh: "多米尼加", city: "Santo Domingo", lat: 18.49, lon: -69.93 },
  PR: { en: "Puerto Rico", zh: "波多黎各", city: "San Juan", lat: 18.47, lon: -66.11 },
  JM: { en: "Jamaica", zh: "牙买加", city: "Kingston", lat: 18.02, lon: -76.8 },
  FJ: { en: "Fiji", zh: "斐济", city: "Suva", lat: -18.14, lon: 178.44 },
  PG: { en: "Papua New Guinea", zh: "巴布亚新几内亚", city: "Port Moresby", lat: -9.44, lon: 147.18 },
  GU: { en: "Guam", zh: "关岛", city: "Hagåtña", lat: 13.47, lon: 144.75 },
};

// Keyword → ISO code. Order matters for ambiguous short codes; longer keywords first.
const KEYWORDS: [RegExp, string][] = [
  [/香港|港|hong\s?kong|\bhk(g)?\b|🇭🇰/i, "HK"],
  [/澳门|macao|macau|\bmo\b/i, "MO"],
  [/台湾|台北|臺|taiwan|\btw\b|🇹🇼/i, "TW"],
  [/日本|东京|大阪|japan|tokyo|osaka|\bjp\b/i, "JP"],
  [/韩国|首尔|korea|seoul|\bkr\b/i, "KR"],
  [/新加坡|狮城|singapore|\bsg\b/i, "SG"],
  [/美国|洛杉矶|圣何塞|硅谷|西雅图|纽约|芝加哥|达拉斯|united states|america|\bus(a)?\b|los angeles|san jose|seattle|new york|chicago|dallas/i, "US"],
  [/英国|伦敦|united kingdom|britain|london|\buk\b|\bgb\b/i, "GB"],
  [/德国|法兰克福|germany|frankfurt|\bde\b/i, "DE"],
  [/法国|巴黎|france|paris|\bfr\b/i, "FR"],
  [/荷兰|阿姆斯特丹|netherlands|amsterdam|\bnl\b/i, "NL"],
  [/加拿大|多伦多|温哥华|canada|toronto|vancouver|\bca\b/i, "CA"],
  [/澳大利亚|澳洲|悉尼|australia|sydney|\bau\b/i, "AU"],
  [/俄罗斯|莫斯科|russia|moscow|\bru\b/i, "RU"],
  [/印度尼西亚|印尼|indonesia|jakarta|\bid\b/i, "ID"],
  [/印度|india|mumbai|\bin\b/i, "IN"],
  [/马来西亚|吉隆坡|malaysia|\bmy\b/i, "MY"],
  [/泰国|曼谷|thailand|bangkok|\bth\b/i, "TH"],
  [/越南|vietnam|\bvn\b/i, "VN"],
  [/菲律宾|philippines|manila|\bph\b/i, "PH"],
  [/土耳其|伊斯坦布尔|turkey|türkiye|istanbul|\btr\b/i, "TR"],
  [/阿联酋|迪拜|emirates|dubai|\bae\b/i, "AE"],
  [/巴西|brazil|\bbr\b/i, "BR"],
  [/阿根廷|argentina|\bar\b/i, "AR"],
  [/墨西哥|mexico|\bmx\b/i, "MX"],
  [/瑞士|switzerland|zurich|\bch\b/i, "CH"],
  [/瑞典|sweden|\bse\b/i, "SE"],
  [/意大利|italy|milan|\bit\b/i, "IT"],
  [/西班牙|spain|madrid|\bes\b/i, "ES"],
  [/爱尔兰|ireland|dublin|\bie\b/i, "IE"],
  [/波兰|poland|\bpl\b/i, "PL"],
  [/乌克兰|ukraine|\bua\b/i, "UA"],
  [/以色列|israel|\bil\b/i, "IL"],
  [/南非|south africa|\bza\b/i, "ZA"],
  [/新西兰|new zealand|\bnz\b/i, "NZ"],
  [/中国|回国|china|\bcn\b/i, "CN"],
];

/** Regional-indicator flag emoji → ISO code */
function codeFromFlag(s: string): string | null {
  const m = s.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
  if (!m) return null;
  const cps = Array.from(m[0]).map((c) => c.codePointAt(0)! - 0x1f1e6 + 65);
  return String.fromCharCode(...cps);
}

/** Best-effort country of a proxy node from its name. */
export function detectCountry(name: string | undefined | null): string | null {
  if (!name) return null;
  const f = codeFromFlag(name);
  if (f) return f === "TW" ? "TW" : f;
  for (const [re, code] of KEYWORDS) if (re.test(name)) return code;
  return null;
}

export function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Node name already has a leading flag emoji? */
export function hasFlag(name: string): boolean {
  return /[\u{1F1E6}-\u{1F1FF}]{2}/u.test(name);
}

export function countryName(code: string | null | undefined, lang: "zh" | "en"): string {
  if (!code) return lang === "zh" ? "未知" : "Unknown";
  return COUNTRIES[code]?.[lang] ?? code;
}

export function countryCoord(code: string | null | undefined): [number, number] | null {
  const c = code ? COUNTRIES[code] : undefined;
  return c ? [c.lon, c.lat] : null;
}

/** Built-in policy names that are not real nodes */
export const SPECIAL_POLICIES = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", "GLOBAL"]);

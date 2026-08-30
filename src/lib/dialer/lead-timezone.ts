import { areaCodeOf } from "./rotation";

// ─────────────────────────────────────────────────────────────────────────────
// Resolve a lead's local timezone for TCPA calling-window enforcement.
//
// TCPA governs the CALLED PARTY's local time (calls only 8am–9pm there), so the
// dialer must evaluate windows in the LEAD's timezone, not the org's. We prefer a
// stored IANA timezone on the lead, then fall back to the number's NANP area code,
// then to the org default.
//
// The area-code → timezone map below is a pragmatic approximation: a handful of
// area codes straddle a zone boundary, but it is accurate for the states this
// product targets (CA = Pacific, TX = Central + El Paso Mountain) and errs toward
// the predominant zone elsewhere. Unknown/foreign codes return null and the
// caller falls back to the org default.
// ─────────────────────────────────────────────────────────────────────────────

// Area codes grouped by IANA zone. Each code appears once.
const ZONE_AREA_CODES: Record<string, string[]> = {
  "America/New_York": [
    // CT, DE, DC, FL(E), GA, IN, KY(E), ME, MD, MA, MI, NH, NJ, NY, NC, OH, PA,
    // RI, SC, TN(E), VT, VA, WV
    "203", "475", "860", "959", "302", "202", "771",
    "305", "786", "321", "407", "689", "561", "772", "954", "754", "904", "386",
    "352", "813", "727", "941", "239", "863", "656",
    "404", "470", "678", "770", "762", "706", "478", "229", "912", "943",
    "317", "463", "219", "260", "574", "765", "812", "930",
    "502", "859", "606",
    "207", "240", "301", "410", "443", "667", "227",
    "339", "351", "413", "508", "617", "774", "781", "857", "978",
    "231", "248", "269", "313", "517", "586", "616", "679", "734", "810", "906",
    "947", "989",
    "603", "201", "551", "609", "640", "732", "848", "856", "862", "908", "973",
    "212", "315", "332", "347", "516", "518", "585", "607", "631", "646", "680",
    "716", "718", "838", "845", "914", "917", "929", "934",
    "252", "336", "704", "743", "828", "910", "919", "980", "984",
    "216", "220", "234", "283", "326", "330", "380", "419", "440", "513", "567",
    "614", "740", "937",
    "215", "223", "267", "272", "412", "445", "484", "570", "582", "610", "717",
    "724", "814", "878",
    "401", "803", "839", "843", "854", "864", "423", "865", "802",
    "276", "434", "540", "571", "703", "757", "804", "826", "948", "304", "681",
  ],
  "America/Chicago": [
    // AL, AR, FL(panhandle), IL, IA, KS, KY(W), LA, MN, MS, MO, NE, ND, OK, SD,
    // TN(W), TX(most), WI
    "205", "251", "256", "334", "659", "938",
    "479", "501", "870", "850",
    "217", "224", "309", "312", "331", "447", "464", "618", "630", "708", "730",
    "773", "779", "815", "847", "872",
    "319", "515", "563", "641", "712",
    "316", "620", "785", "913", "270", "364",
    "225", "318", "337", "504", "985",
    "218", "320", "507", "612", "651", "763", "952",
    "228", "601", "662", "769",
    "314", "417", "573", "636", "660", "816", "975",
    "402", "531", "701", "405", "539", "572", "580", "918", "605",
    "615", "629", "731", "901", "931",
    "210", "214", "254", "281", "325", "346", "361", "409", "430", "432", "469",
    "512", "682", "713", "726", "737", "806", "817", "830", "832", "903", "936",
    "940", "945", "956", "972", "979",
    "262", "274", "414", "534", "608", "715", "920",
  ],
  "America/Denver": [
    // CO, ID, MT, NM, UT, WY, TX(El Paso), NE(W)
    "303", "719", "720", "970", "983",
    "208", "986", "406", "505", "575", "385", "435", "801", "307", "915", "308",
  ],
  "America/Phoenix": ["480", "520", "602", "623", "928"], // AZ (no DST)
  "America/Los_Angeles": [
    // CA, NV, OR, WA
    "209", "213", "279", "310", "323", "341", "350", "408", "415", "424", "442",
    "510", "530", "559", "562", "619", "626", "628", "650", "657", "661", "669",
    "707", "714", "747", "760", "805", "818", "820", "831", "840", "858", "909",
    "916", "925", "949", "951",
    "702", "725", "775", "458", "503", "541", "971", "206", "253", "360", "425",
    "509", "564",
  ],
  "America/Anchorage": ["907"],
  "Pacific/Honolulu": ["808"],
};

const AREA_CODE_TZ: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [zone, codes] of Object.entries(ZONE_AREA_CODES)) {
    for (const code of codes) map[code] = zone;
  }
  return map;
})();

/** IANA timezone for a NANP area code, or null when unknown. */
export function timezoneForAreaCode(areaCode: string | null): string | null {
  return areaCode ? AREA_CODE_TZ[areaCode] ?? null : null;
}

/**
 * Best available timezone for a lead: a stored IANA zone, then the number's area
 * code, then the org fallback. Note: schedule.ts's zonedDayHour tolerates an
 * invalid zone (it falls back to UTC), so a slightly-off stored value never throws.
 */
export function resolveLeadTimezone(
  phone: string,
  storedTz: string | null | undefined,
  fallback: string,
): string {
  const stored = (storedTz ?? "").trim();
  if (stored.includes("/")) return stored; // looks like an IANA zone — trust it
  return timezoneForAreaCode(areaCodeOf(phone)) || fallback;
}

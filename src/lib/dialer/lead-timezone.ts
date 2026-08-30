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

// ─────────────────────────────────────────────────────────────────────────────
// …and what a rep can actually read.
//
// The resolver above has driven server-side TCPA enforcement for a long time,
// and no surface in the product ever showed a rep the number it produces. So a
// rep in Phoenix worked down a list of New Jersey contacts at what was, to
// them, a reasonable hour — and watched lanes cancel one after another with no
// idea why until they read the refusal. The clock has to be on the row.
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadClock {
  /** "4:12 PM" in the contact's own zone. */
  time: string;
  /** The zone it was computed in — the resolver's answer, not a guess. */
  timezone: string;
  /** True when this contact is OUTSIDE the window right now. */
  outsideWindow: boolean;
  /** Whether the zone came from a stored value or the number's area code. */
  source: "stored" | "areaCode" | "fallback";
}

/**
 * What time it is where this contact is, and whether that is a problem.
 *
 * `hours` is the ORG's configured calling window, evaluated in the CONTACT's
 * zone — which is the rule TCPA actually states and the rule the dial routes
 * already enforce. Pass null to skip the window check entirely.
 *
 * Returns null when the time cannot be formatted at all (an unusable zone
 * string), because a made-up clock is worse than no clock.
 */
export function leadLocalTime(
  phone: string,
  storedTz: string | null | undefined,
  fallback: string,
  now: Date,
  hours?: { startHour: number; endHour: number; days?: number[] } | null,
): LeadClock | null {
  const stored = (storedTz ?? "").trim();
  const areaZone = timezoneForAreaCode(areaCodeOf(phone));
  const timezone = resolveLeadTimezone(phone, storedTz, fallback);
  const source: LeadClock["source"] = stored.includes("/")
    ? "stored"
    : areaZone
      ? "areaCode"
      : "fallback";

  let time: string;
  try {
    time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(now);
  } catch {
    // An unusable stored zone. Say nothing rather than show the rep's own clock
    // and let them believe it is the contact's.
    return null;
  }

  let outsideWindow = false;
  if (hours) {
    const start = Number(hours.startHour);
    const end = Number(hours.endHour);
    if (Number.isFinite(start) && Number.isFinite(end) && start !== end) {
      const parts = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        weekday: "short",
        timeZone: timezone,
      }).formatToParts(now);
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
      const dayName = parts.find((p) => p.type === "weekday")?.value ?? "";
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayName);
      const inDays =
        !Array.isArray(hours.days) || !hours.days.length || hours.days.includes(day);
      // Overnight windows wrap: 20 → 6 means 8pm through 5:59am.
      const inHours = start < end ? hour >= start && hour < end : hour >= start || hour < end;
      outsideWindow = !(inDays && inHours);
    }
  }

  return { time, timezone, outsideWindow, source };
}

/** "4:12 PM their time" / "8:50 PM their time — outside calling hours". */
export function describeLeadClock(clock: LeadClock): string {
  return clock.outsideWindow
    ? `${clock.time} their time — outside calling hours`
    : `${clock.time} their time`;
}

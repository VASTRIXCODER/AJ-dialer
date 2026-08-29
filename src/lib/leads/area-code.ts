import { areaCodeOf } from "../dialer/rotation";
import { timezoneForAreaCode } from "../dialer/lead-timezone";

// ─────────────────────────────────────────────────────────────────────────────
// Number location — NANP area-code → state/region/timezone inference.
//
// PRODUCT RULE: this is an inference about the PHONE NUMBER, never the person's
// physical location. Numbers are portable — a lead with a 415 number may live in
// Miami. Every surface that shows this MUST label it "Number location" (or
// equivalent) and never present it as where the lead actually is. That is also
// why `region` is deliberately coarse (a metro or sub-state area, never a city
// or address): precision we cannot honestly claim must not be implied.
//
// The timezone layer is NOT duplicated here — `timezoneForAreaCode`
// (src/lib/dialer/lead-timezone.ts) is the single source of truth the TCPA
// window enforcement already trusts, so both surfaces always agree. This module
// only adds the state/region words on top, covering the same code set.
// ─────────────────────────────────────────────────────────────────────────────

export interface NumberLocation {
  /** Two-letter USPS state code ("CA", "TX", …). */
  state: string;
  /** Coarse sub-state label ("San Francisco Bay Area") — never city-precise. */
  region: string;
  /** IANA timezone, from the dialer's area-code table. */
  tz: string;
}

// Area codes grouped by state + coarse region. Each code appears exactly once,
// and every code must also exist in lead-timezone's table (a test enforces it).
const STATE_REGION_CODES: ReadonlyArray<
  readonly [state: string, region: string, codes: readonly string[]]
> = [
  // ── Pacific ────────────────────────────────────────────────────────────────
  ["CA", "San Francisco Bay Area", ["415", "628", "510", "341", "650", "408", "669", "925"]],
  ["CA", "North Bay & North Coast", ["707"]],
  ["CA", "Sacramento area", ["916", "279"]],
  ["CA", "Northern California", ["530"]],
  ["CA", "Central Valley", ["209", "350", "559"]],
  ["CA", "Central Coast", ["805", "820", "831"]],
  ["CA", "Los Angeles area", ["213", "323", "310", "424", "818", "747", "626", "562"]],
  ["CA", "Northern Los Angeles County", ["661"]],
  ["CA", "Orange County", ["714", "657", "949"]],
  ["CA", "Inland Empire", ["909", "840", "951"]],
  ["CA", "Southern California desert", ["760", "442"]],
  ["CA", "San Diego area", ["619", "858"]],
  ["NV", "Las Vegas area", ["702", "725"]],
  ["NV", "Northern Nevada", ["775"]],
  ["OR", "Portland area", ["503", "971"]],
  ["OR", "Oregon outside Portland", ["541", "458"]],
  ["WA", "Seattle area", ["206", "425", "253"]],
  ["WA", "Western Washington", ["360", "564"]],
  ["WA", "Eastern Washington", ["509"]],
  // ── Mountain ───────────────────────────────────────────────────────────────
  ["AZ", "Phoenix metro", ["602", "623", "480"]],
  ["AZ", "Tucson area", ["520"]],
  ["AZ", "Northern & Western Arizona", ["928"]],
  ["CO", "Denver metro", ["303", "720", "983"]],
  ["CO", "Southern Colorado", ["719"]],
  ["CO", "Northern & Western Colorado", ["970"]],
  ["UT", "Wasatch Front", ["801", "385"]],
  ["UT", "Southern & Eastern Utah", ["435"]],
  ["ID", "Idaho", ["208", "986"]],
  ["MT", "Montana", ["406"]],
  ["NM", "Northern New Mexico", ["505"]],
  ["NM", "Southern New Mexico", ["575"]],
  ["WY", "Wyoming", ["307"]],
  // ── Central ────────────────────────────────────────────────────────────────
  ["TX", "Dallas area", ["214", "469", "972", "945"]],
  ["TX", "Fort Worth area", ["817", "682"]],
  ["TX", "Houston area", ["713", "281", "832", "346"]],
  ["TX", "Austin area", ["512", "737"]],
  ["TX", "San Antonio area", ["210", "726"]],
  ["TX", "Texas Hill Country", ["830"]],
  ["TX", "Coastal Bend", ["361"]],
  ["TX", "Rio Grande Valley", ["956"]],
  ["TX", "El Paso area", ["915"]], // Mountain time — the tz table already knows
  ["TX", "West Texas", ["432", "325"]],
  ["TX", "Texas Panhandle", ["806"]],
  ["TX", "Northeast Texas", ["903", "430"]],
  ["TX", "East Texas", ["936"]],
  ["TX", "Southeast Texas", ["409"]],
  ["TX", "Central Texas", ["254"]],
  ["TX", "North Texas", ["940"]],
  ["TX", "Brazos Valley", ["979"]],
  ["IL", "Chicago", ["312", "773", "872"]],
  ["IL", "Chicago suburbs", ["708", "630", "331", "847", "224", "464"]],
  ["IL", "Northern Illinois", ["815", "779"]],
  ["IL", "Central Illinois", ["217", "309", "447"]],
  ["IL", "Southern Illinois", ["618", "730"]],
  ["MN", "Twin Cities", ["612", "651", "763", "952"]],
  ["MN", "Northern Minnesota", ["218"]],
  ["MN", "Central Minnesota", ["320"]],
  ["MN", "Southern Minnesota", ["507"]],
  ["WI", "Milwaukee area", ["414", "274"]],
  ["WI", "Southeast Wisconsin", ["262"]],
  ["WI", "Southwest Wisconsin", ["608"]],
  ["WI", "Northeast Wisconsin", ["920"]],
  ["WI", "Northern Wisconsin", ["715", "534"]],
  ["MO", "St. Louis area", ["314", "636"]],
  ["MO", "Kansas City area", ["816", "975"]],
  ["MO", "Southwest Missouri", ["417"]],
  ["MO", "Central & Eastern Missouri", ["573"]],
  ["MO", "Northern Missouri", ["660"]],
  ["IA", "Central Iowa", ["515"]],
  ["IA", "Eastern Iowa", ["319", "563"]],
  ["IA", "Southern Iowa", ["641"]],
  ["IA", "Western Iowa", ["712"]],
  ["KS", "Kansas City area", ["913"]],
  ["KS", "Northern Kansas", ["785"]],
  ["KS", "Wichita area", ["316"]],
  ["KS", "Southern Kansas", ["620"]],
  ["NE", "Eastern Nebraska", ["402", "531"]],
  ["NE", "Western Nebraska", ["308"]], // Mountain time
  ["ND", "North Dakota", ["701"]],
  ["SD", "South Dakota", ["605"]],
  ["OK", "Oklahoma City area", ["405", "572"]],
  ["OK", "Tulsa area", ["918", "539"]],
  ["OK", "Southern & Western Oklahoma", ["580"]],
  ["AR", "Central Arkansas", ["501"]],
  ["AR", "Northwest Arkansas", ["479"]],
  ["AR", "Eastern & Southern Arkansas", ["870"]],
  ["LA", "New Orleans area", ["504"]],
  ["LA", "Southeast Louisiana", ["985"]],
  ["LA", "Baton Rouge area", ["225"]],
  ["LA", "Northern Louisiana", ["318"]],
  ["LA", "Southwest Louisiana", ["337"]],
  ["MS", "Central Mississippi", ["601", "769"]],
  ["MS", "Mississippi Gulf Coast", ["228"]],
  ["MS", "Northern Mississippi", ["662"]],
  ["AL", "Birmingham area", ["205", "659"]],
  ["AL", "Northern Alabama", ["256", "938"]],
  ["AL", "Southeast Alabama", ["334"]],
  ["AL", "Mobile area", ["251"]],
  ["TN", "Nashville area", ["615", "629"]],
  ["TN", "Middle Tennessee", ["931"]],
  ["TN", "West Tennessee", ["731"]],
  ["TN", "Memphis area", ["901"]],
  ["KY", "Western Kentucky", ["270", "364"]],
  // ── Eastern ────────────────────────────────────────────────────────────────
  ["FL", "Miami area", ["305", "786"]],
  ["FL", "Fort Lauderdale area", ["954", "754"]],
  ["FL", "Palm Beach area", ["561"]],
  ["FL", "Treasure Coast", ["772"]],
  ["FL", "Orlando & Space Coast", ["407", "689", "321"]],
  ["FL", "Tampa Bay", ["813", "656", "727"]],
  ["FL", "Sarasota area", ["941"]],
  ["FL", "Southwest Florida", ["239"]],
  ["FL", "Central Florida heartland", ["863"]],
  ["FL", "Jacksonville area", ["904"]],
  ["FL", "Northeast Florida", ["386"]],
  ["FL", "North Central Florida", ["352"]],
  ["FL", "Florida Panhandle", ["850"]], // Central time
  ["NY", "New York City", ["212", "646", "332", "718", "347", "929", "917"]],
  ["NY", "Long Island", ["516", "631", "934"]],
  ["NY", "Hudson Valley", ["914", "845"]],
  ["NY", "Capital Region", ["518", "838"]],
  ["NY", "Central New York", ["315", "680"]],
  ["NY", "Rochester area", ["585"]],
  ["NY", "Buffalo area", ["716"]],
  ["NY", "Southern Tier", ["607"]],
  ["GA", "Atlanta metro", ["404", "470", "678", "770", "943"]],
  ["GA", "North Georgia", ["706", "762"]],
  ["GA", "Middle Georgia", ["478"]],
  ["GA", "Southwest Georgia", ["229"]],
  ["GA", "Coastal Georgia", ["912"]],
  ["NC", "Charlotte area", ["704", "980"]],
  ["NC", "Raleigh-Durham", ["919", "984"]],
  ["NC", "Piedmont Triad", ["336", "743"]],
  ["NC", "Eastern North Carolina", ["252"]],
  ["NC", "Southeastern North Carolina", ["910"]],
  ["NC", "Western North Carolina", ["828"]],
  ["PA", "Philadelphia", ["215", "267", "445"]],
  ["PA", "Philadelphia suburbs", ["610", "484"]],
  ["PA", "Pittsburgh area", ["412", "878"]],
  ["PA", "Western Pennsylvania", ["724"]],
  ["PA", "South Central Pennsylvania", ["717", "223"]],
  ["PA", "Northeast Pennsylvania", ["570", "272"]],
  ["PA", "Central & Northwest Pennsylvania", ["814", "582"]],
  ["OH", "Cleveland area", ["216", "440"]],
  ["OH", "Akron-Canton", ["330", "234"]],
  ["OH", "Columbus area", ["614", "380"]],
  ["OH", "Cincinnati area", ["513", "283"]],
  ["OH", "Northwest Ohio", ["419", "567"]],
  ["OH", "Dayton area", ["937", "326"]],
  ["OH", "Southeast Ohio", ["740", "220"]],
  ["MI", "Detroit area", ["313", "679"]],
  ["MI", "Metro Detroit suburbs", ["248", "947", "586", "734", "810"]],
  ["MI", "Lansing area", ["517"]],
  ["MI", "West Michigan", ["616", "231"]],
  ["MI", "Southwest Michigan", ["269"]],
  ["MI", "Mid-Michigan", ["989"]],
  ["MI", "Upper Peninsula", ["906"]],
  ["NJ", "North Jersey", ["201", "551", "973", "862", "908"]],
  ["NJ", "Central Jersey & Shore", ["732", "848", "609", "640"]],
  ["NJ", "South Jersey", ["856"]],
  ["MA", "Boston area", ["617", "857"]],
  ["MA", "Boston suburbs", ["781", "339", "978", "351"]],
  ["MA", "Central & Southeastern Massachusetts", ["508", "774"]],
  ["MA", "Western Massachusetts", ["413"]],
  ["VA", "Northern Virginia", ["703", "571"]],
  ["VA", "Shenandoah Valley", ["540", "826"]],
  ["VA", "Hampton Roads", ["757", "948"]],
  ["VA", "Richmond area", ["804"]],
  ["VA", "Southern Virginia", ["434"]],
  ["VA", "Southwest Virginia", ["276"]],
  ["MD", "Maryland - DC suburbs", ["301", "240", "227"]],
  ["MD", "Baltimore & Eastern Maryland", ["410", "443", "667"]],
  ["SC", "Midlands", ["803", "839"]],
  ["SC", "Lowcountry", ["843", "854"]],
  ["SC", "Upstate South Carolina", ["864"]],
  ["TN", "Knoxville area", ["865"]],
  ["TN", "Southeast Tennessee", ["423"]],
  ["KY", "Louisville area", ["502"]],
  ["KY", "Lexington area", ["859"]],
  ["KY", "Eastern Kentucky", ["606"]],
  ["IN", "Indianapolis area", ["317", "463"]],
  ["IN", "Northwest Indiana", ["219"]],
  ["IN", "Northeast Indiana", ["260"]],
  ["IN", "North Central Indiana", ["574"]],
  ["IN", "East Central Indiana", ["765"]],
  ["IN", "Southern Indiana", ["812", "930"]],
  ["CT", "Southwestern Connecticut", ["203", "475"]],
  ["CT", "Hartford & Eastern Connecticut", ["860", "959"]],
  ["WV", "West Virginia", ["304", "681"]],
  ["DC", "Washington, DC", ["202", "771"]],
  ["DE", "Delaware", ["302"]],
  ["ME", "Maine", ["207"]],
  ["NH", "New Hampshire", ["603"]],
  ["VT", "Vermont", ["802"]],
  ["RI", "Rhode Island", ["401"]],
  // ── Alaska / Hawaii ────────────────────────────────────────────────────────
  ["AK", "Alaska", ["907"]],
  ["HI", "Hawaii", ["808"]],
];

/** Flat lookup, exported so tests can enforce the tz-table invariant. */
export const AREA_CODE_LOCATIONS: Readonly<
  Record<string, { state: string; region: string }>
> = (() => {
  const map: Record<string, { state: string; region: string }> = {};
  for (const [state, region, codes] of STATE_REGION_CODES) {
    for (const code of codes) map[code] = { state, region };
  }
  return map;
})();

/**
 * Infer the location of a phone NUMBER from its NANP area code. Returns null
 * for non-NANP/short/garbage input or an area code we don't know. Accepts
 * E.164, 11-digit 1-led, bare 10-digit, and formatted numbers.
 *
 * Remember the product rule above: this describes the number, not the person —
 * the UI must always label it as an inference (e.g. "Number location").
 */
export function inferNumberLocation(phone: string): NumberLocation | null {
  const code = areaCodeOf(phone);
  if (!code) return null;
  const loc = AREA_CODE_LOCATIONS[code];
  const tz = timezoneForAreaCode(code);
  if (!loc || !tz) return null;
  return { state: loc.state, region: loc.region, tz };
}

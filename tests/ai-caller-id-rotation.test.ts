import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The reported bug: "why is it calling from a 920 number, the AI dialing should
// call from all the numbers".
//
// The caller-ID pool and ElevenLabs are two separate lists. Rotation picks a
// number from the org's pool, but in DIRECT mode ElevenLabs places the call and
// can only originate from a number IMPORTED into its own account. Anything else
// resolved to "" and fell through to ELEVENLABS_AGENT_PHONE_NUMBER_ID.
//
// That fallback was silent AND the app still reported the *rotated* number as
// the caller ID — so a pool of eight numbers looked perfectly healthy while
// every single AI call left on one. These pin both halves: the audit that names
// the unimported numbers, and the honest reporting of what was really used.
//
// Note: pointing a number's Twilio VOICE webhook at the app does nothing here.
// That governs inbound + the human dialer, not ElevenLabs origination.
// ─────────────────────────────────────────────────────────────────────────────

/** Only these are imported into the (fake) ElevenLabs account. */
const IMPORTED = [
  { phone_number_id: "phnum_920", phone_number: "+19205551000", label: "default" },
  { phone_number_id: "phnum_817a", phone_number: "+18175082598", label: "vicc a" },
];

let fetchCalls = 0;

function stubElevenLabs(numbers = IMPORTED) {
  fetchCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetchCalls += 1;
      if (String(url).includes("/v1/convai/phone-numbers")) {
        return new Response(JSON.stringify({ phone_numbers: numbers }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }),
  );
}

/** Fresh module per test — the phone-number lookup memoises at module scope. */
async function freshModule() {
  vi.resetModules();
  return import("@/lib/elevenlabs");
}

beforeEach(() => {
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_test");
  vi.stubEnv("ELEVENLABS_AGENT_PHONE_NUMBER_ID", "phnum_920");
  stubElevenLabs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resolvePhoneNumberId", () => {
  it("maps an imported E.164 number to its ElevenLabs id", async () => {
    const { resolvePhoneNumberId } = await freshModule();
    expect(await resolvePhoneNumberId("+18175082598")).toBe("phnum_817a");
  });

  it("ignores formatting when matching", async () => {
    const { resolvePhoneNumberId } = await freshModule();
    expect(await resolvePhoneNumberId("(817) 508-2598")).toBe("phnum_817a");
  });

  it("matches a 10-digit number against an 11-digit E.164 import", async () => {
    // Found by this test: the lookup compared raw digit strings, so "8175082598"
    // never matched an imported "+18175082598" and fell back to the default.
    const { resolvePhoneNumberId } = await freshModule();
    expect(await resolvePhoneNumberId("8175082598")).toBe("phnum_817a");
  });

  it("keeps a non-NANP country code intact", async () => {
    // +44 numbers must not have a leading digit stripped the way +1 does.
    const { resolvePhoneNumberId } = await freshModule();
    expect(await resolvePhoneNumberId("+442071838750")).toBe("");
  });

  it("returns empty for a number that was never imported", async () => {
    // This is the whole bug: the second 817 number is in the dialing pool but
    // not in ElevenLabs, so it can never place a call.
    const { resolvePhoneNumberId } = await freshModule();
    expect(await resolvePhoneNumberId("+18179526891")).toBe("");
  });

  it("passes an ElevenLabs id straight through without a lookup", async () => {
    const { resolvePhoneNumberId } = await freshModule();
    expect(await resolvePhoneNumberId("phnum_already_an_id")).toBe("phnum_already_an_id");
    expect(fetchCalls).toBe(0);
  });

  it("caches the lookup instead of re-listing per call", async () => {
    const { resolvePhoneNumberId } = await freshModule();
    await resolvePhoneNumberId("+18175082598");
    const after = fetchCalls;
    await resolvePhoneNumberId("+18175082598");
    expect(fetchCalls).toBe(after);
  });
});

describe("phoneNumberForId — naming the number actually used", () => {
  it("reverses an id back to its E.164", async () => {
    const { phoneNumberForId } = await freshModule();
    expect(await phoneNumberForId("phnum_920")).toBe("+19205551000");
  });

  it("returns null for an id the account doesn't have", async () => {
    const { phoneNumberForId } = await freshModule();
    expect(await phoneNumberForId("phnum_nope")).toBeNull();
  });

  it("is populated by a forward lookup — one list serves both directions", async () => {
    const { resolvePhoneNumberId, phoneNumberForId } = await freshModule();
    await resolvePhoneNumberId("+18175082598");
    const after = fetchCalls;
    expect(await phoneNumberForId("phnum_817a")).toBe("+18175082598");
    expect(fetchCalls).toBe(after);
  });
});

describe("auditRotationPool — which pool numbers actually dial", () => {
  it("splits the pool into imported and missing", async () => {
    const { auditRotationPool } = await freshModule();
    const { imported, missing } = await auditRotationPool([
      "+19205551000",
      "+18175082598",
      "+18179526891", // added to the pool, never imported
    ]);
    expect(imported).toEqual(["+19205551000", "+18175082598"]);
    expect(missing).toEqual(["+18179526891"]);
  });

  it("reports an all-missing pool — the reported symptom", async () => {
    // Every pool number unimported ⇒ every AI call falls back to the default,
    // which is exactly "why is it always calling from the 920 number".
    const { auditRotationPool } = await freshModule();
    const { imported, missing } = await auditRotationPool([
      "+18175559999",
      "+18179526891",
    ]);
    expect(imported).toEqual([]);
    expect(missing).toHaveLength(2);
  });

  it("de-dupes and drops blanks", async () => {
    const { auditRotationPool } = await freshModule();
    const { imported, missing } = await auditRotationPool([
      "+18175082598",
      "+18175082598",
      "",
      "   ",
    ]);
    expect(imported).toEqual(["+18175082598"]);
    expect(missing).toEqual([]);
  });

  it("says nothing is missing when the pool is empty", async () => {
    const { auditRotationPool } = await freshModule();
    expect(await auditRotationPool([])).toEqual({ imported: [], missing: [] });
  });
});

describe("placeOutboundCall reports the number it REALLY used", () => {
  async function place(from: string | undefined) {
    const { placeOutboundCall } = await freshModule();
    return placeOutboundCall({ toNumber: "+15125550123", agentPhoneNumberId: from });
  }

  it("uses the rotated number when it is imported", async () => {
    const r = await place("+18175082598");
    expect(r.fromNumber).toBe("+18175082598");
    expect(r.callerIdFellBack).toBe(false);
  });

  it("falls back to the default AND says so when it is not imported", async () => {
    const r = await place("+18179526891");
    expect(r.callerIdFellBack).toBe(true);
    // The honest answer — the 920 default placed this call, not the 817 we asked
    // for. Before the fix this reported "+18179526891" and the pool looked fine.
    expect(r.fromNumber).toBe("+19205551000");
    expect(r.fromNumber).not.toBe("+18179526891");
  });

  it("is not a fallback when no rotation number was requested", async () => {
    const r = await place(undefined);
    expect(r.callerIdFellBack).toBe(false);
    expect(r.fromNumber).toBe("+19205551000");
  });
});

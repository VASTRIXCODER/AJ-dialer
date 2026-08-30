import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Which webhook URLs count as "reaching this app".
//
// This deployment answers on more than one host: callbacks are PINNED to the
// Vercel origin on purpose, but the same app also serves the Cloudflare-fronted
// custom domain, and a webhook pointed at either genuinely works —
// verifyTwilioSignature reconstructs the URL from several candidate origins and
// accepts if any validates.
//
// The first version of this check prefix-matched ONE canonical origin, so a
// perfectly good custom-domain webhook would have been reported as "replies go
// elsewhere" with a button offering to repoint it. A false alarm in the one
// panel whose entire value is being trusted about this is worse than no panel.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => false,
  createAdminClient: () => ({}),
}));
vi.mock("@/lib/twilio", () => ({
  getPublicBaseUrl: () => "https://aiatworkdialer.vercel.app",
  getRestClient: async () => null,
}));

import {
  classifyWebhook,
  getMessagingReadiness,
  knownHosts,
} from "@/lib/messaging/readiness";

describe("which webhook URLs count as reaching this app", () => {
  const hosts = new Set(["aiatworkdialer.vercel.app", "www.aiatworkdialer.com"]);

  it("accepts the pinned Vercel origin", () => {
    expect(
      classifyWebhook("https://aiatworkdialer.vercel.app/api/twilio/sms", hosts),
    ).toBe("here");
  });

  it("ALSO accepts the custom domain — the bug this fixes", () => {
    // Both genuinely work: verifyTwilioSignature tries several candidate
    // origins. A prefix match against one canonical origin would have flagged
    // this as broken and offered to "fix" a webhook that was already right.
    expect(
      classifyWebhook("https://www.aiatworkdialer.com/api/twilio/sms", hosts),
    ).toBe("here");
  });

  it("ignores a trailing slash and a query string — console noise, not meaning", () => {
    expect(
      classifyWebhook("https://www.aiatworkdialer.com/api/twilio/sms/", hosts),
    ).toBe("here");
    expect(
      classifyWebhook("https://www.aiatworkdialer.com/api/twilio/sms?x=1", hosts),
    ).toBe("here");
  });

  it("calls out ElevenLabs for what it is: somewhere else entirely", () => {
    // The real, current production state — and the reason dnc_numbers holds
    // zero rows sourced from a text message.
    expect(
      classifyWebhook("https://api.elevenlabs.io/twilio/inbound-sms", hosts),
    ).toBe("elsewhere");
  });

  it("distinguishes a DIFFERENT environment of this same app", () => {
    // Right route, wrong host. Completely different fix from the case above,
    // so it must not be reported as the same thing.
    expect(
      classifyWebhook("https://aj-dialer-staging.vercel.app/api/twilio/sms", hosts),
    ).toBe("other_environment");
  });

  it("does not accept a different route on a host we do own", () => {
    expect(
      classifyWebhook("https://www.aiatworkdialer.com/api/twilio/voice", hosts),
    ).toBe("elsewhere");
  });

  it("reports an unset webhook as unset, not as wrong", () => {
    expect(classifyWebhook("", hosts)).toBe("unset");
    expect(classifyWebhook("   ", hosts)).toBe("unset");
  });

  it("treats a malformed URL as elsewhere rather than throwing", () => {
    expect(classifyWebhook("not a url", hosts)).toBe("elsewhere");
  });

  it("is case-insensitive about the host", () => {
    expect(
      classifyWebhook("https://WWW.AIATWORKDIALER.COM/api/twilio/sms", hosts),
    ).toBe("here");
  });

  it("collects every origin this deployment answers on", () => {
    const found = knownHosts();
    expect(found.has("aiatworkdialer.vercel.app")).toBe(true);
    expect(found.has("www.aiatworkdialer.com")).toBe(true);
  });
});

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://www.aiatworkdialer.com";
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("a check that cannot run has not passed", () => {
  it("reports the webhooks as UNKNOWN without credentials, never ok", async () => {
    const r = await getMessagingReadiness(null);
    const webhooks = r.checks.find((c) => c.id === "webhooks");
    expect(webhooks?.state).toBe("unknown");
    // And the whole thing is not "ready" just because a check was skipped.
    expect(r.ready).toBe(false);
  });

  it("fails outright when the credentials are missing", async () => {
    const r = await getMessagingReadiness(null);
    expect(r.checks.find((c) => c.id === "credentials")?.state).toBe("fail");
  });
});

describe("the workspace's own settings are judged, not assumed", () => {
  const org = (messaging: Record<string, unknown>) =>
    ({
      id: "org-a",
      settings: {
        messaging,
        dialing: { callerId: "", callerIds: [] },
      },
    }) as unknown as Parameters<typeof getMessagingReadiness>[0];

  it("fails a degenerate quiet-hours window that would hold every message", async () => {
    const r = await getMessagingReadiness(
      org({ enabled: true, quietHours: { startHour: 9, endHour: 9 }, dailyOrgCap: 100 }),
    );
    expect(r.checks.find((c) => c.id === "quiet_hours")?.state).toBe("fail");
  });

  it("accepts a real window and says what it is", async () => {
    const r = await getMessagingReadiness(
      org({ enabled: true, quietHours: { startHour: 9, endHour: 20 }, dailyOrgCap: 100 }),
    );
    const q = r.checks.find((c) => c.id === "quiet_hours");
    expect(q?.state).toBe("ok");
    // States the fact, rather than restating its own label.
    expect(q?.detail).toContain("9am");
    expect(q?.detail).toContain("8pm");
    expect(q?.detail.toLowerCase()).toContain("recipient");
  });

  it("warns rather than fails on no daily cap, and says what that risks", async () => {
    const r = await getMessagingReadiness(
      org({ enabled: true, quietHours: { startHour: 9, endHour: 20 }, dailyOrgCap: 0 }),
    );
    const cap = r.checks.find((c) => c.id === "daily_cap");
    expect(cap?.state).toBe("warn");
    expect(cap?.detail.toLowerCase()).toContain("nothing stopping it");
  });

  it("fails when the workspace switch is off", async () => {
    const r = await getMessagingReadiness(
      org({ enabled: false, quietHours: { startHour: 9, endHour: 20 }, dailyOrgCap: 100 }),
    );
    expect(r.checks.find((c) => c.id === "org_enabled")?.state).toBe("fail");
  });
});

describe("simulation and the allow-list are surfaced, not hidden", () => {
  it("warns when simulation is on, because nothing reaches a real phone", async () => {
    process.env.MESSAGING_SIMULATION = "true";
    const r = await getMessagingReadiness(null);
    const sim = r.checks.find((c) => c.id === "simulation");
    expect(sim?.state).toBe("warn");
    expect(sim?.detail.toLowerCase()).toContain("real phone");
    delete process.env.MESSAGING_SIMULATION;
  });

  it("warns when an allow-list is fencing recipients", async () => {
    process.env.MESSAGING_ALLOWLIST = "+15555550123";
    const r = await getMessagingReadiness(null);
    expect(r.checks.find((c) => c.id === "allowlist")?.state).toBe("warn");
    delete process.env.MESSAGING_ALLOWLIST;
  });

  it("says nothing about either when neither is set", async () => {
    const r = await getMessagingReadiness(null);
    expect(r.checks.find((c) => c.id === "simulation")).toBeUndefined();
    expect(r.checks.find((c) => c.id === "allowlist")).toBeUndefined();
  });
});

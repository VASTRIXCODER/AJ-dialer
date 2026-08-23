import { describe, expect, it } from "vitest";
import { navGroups, navLabel, type NavItem } from "@/components/layout/nav";
import { DEFAULT_ORG_SETTINGS } from "@/lib/org/settings";
import { TEMPLATE_PROFILES } from "@/lib/org/templates";
import { DEFAULT_VOCABULARY, orgVocabulary } from "@/lib/org/vocabulary";
import {
  outcomeConfig,
  resolveLeadStatusConfig,
  resolveOutcomeConfig,
  resolveOutcomeOptions,
} from "@/lib/status";
import type { CallOutcome } from "@/lib/types";
import { leadDisplayName } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The words a workspace sees. Three implementations of this precedence used to
// exist and disagreed with each other; these lock the single one down.
// ─────────────────────────────────────────────────────────────────────────────

describe("orgVocabulary", () => {
  it("gives an org with no vertical the NEUTRAL nouns, never solar's", () => {
    const v = orgVocabulary(null);
    expect(v.leadNoun).toBe("lead");
    expect(v.leadNounPlural).toBe("leads");
    expect(v.isSolar).toBe(false);
    expect(v.appointmentNoun).toBe("appointment");
    expect(v.noNeedLabel).toBe("No need right now");
  });

  it("keeps the solar tenant's exact wording", () => {
    const v = orgVocabulary({ dialerTemplate: "solar" });
    expect(v.leadNoun).toBe("homeowner");
    expect(v.LeadNoun).toBe("Homeowner");
    expect(v.LeadNounPlural).toBe("Homeowners");
    expect(v.appointmentNoun).toBe("account review");
    expect(v.noNeedLabel).toBe("Bills are fine");
    expect(v.tagline).toBe("Solar Resolution");
  });

  it("gives each vertical its own nouns", () => {
    expect(orgVocabulary({ dialerTemplate: "recruiting" }).leadNoun).toBe("candidate");
    expect(orgVocabulary({ dialerTemplate: "recruiting" }).appointmentNoun).toBe("interview");
    expect(orgVocabulary({ dialerTemplate: "healthcare" }).leadNoun).toBe("patient");
    expect(orgVocabulary({ dialerTemplate: "real_estate" }).appointmentNoun).toBe("showing");
    expect(orgVocabulary({ dialerTemplate: "insurance" }).leadNoun).toBe("policyholder");
  });

  it("lets an admin's own noun beat the vertical's", () => {
    const v = orgVocabulary({
      dialerTemplate: "solar",
      settings: { leadNoun: "member", leadNounPlural: "members" },
    });
    expect(v.leadNoun).toBe("member");
    expect(v.LeadNounPlural).toBe("Members");
  });

  it("treats the seeded default as 'never chose one' and falls through", () => {
    // mergeSettings back-fills every org with leadNoun "lead", so a presence
    // test would read as a deliberate choice and rename the solar tenant's
    // homeowners. This is the exact regression the shared resolver prevents.
    const v = orgVocabulary({
      dialerTemplate: "solar",
      settings: {
        leadNoun: DEFAULT_ORG_SETTINGS.leadNoun,
        leadNounPlural: DEFAULT_ORG_SETTINGS.leadNounPlural,
      },
    });
    expect(v.leadNoun).toBe("homeowner");
    expect(v.leadNounPlural).toBe("homeowners");
  });

  it("falls back to the vertical when the stored noun is blank", () => {
    const v = orgVocabulary({
      dialerTemplate: "insurance",
      settings: { leadNoun: "   ", leadNounPlural: "" },
    });
    expect(v.leadNoun).toBe("policyholder");
    expect(v.leadNounPlural).toBe("policyholders");
  });

  it("uses the org's product name as the tagline for a non-solar vertical", () => {
    expect(orgVocabulary({ dialerTemplate: "finance", productName: "Vantage" }).tagline).toBe(
      "Vantage",
    );
    expect(orgVocabulary({ dialerTemplate: "finance" }).tagline).toBe("Sales Dialer");
  });

  it("every shipped template resolves a complete vocabulary", () => {
    for (const t of TEMPLATE_PROFILES) {
      const v = orgVocabulary({ dialerTemplate: t.value });
      expect(v.leadNoun, t.value).toBeTruthy();
      expect(v.leadNounPlural, t.value).toBeTruthy();
      expect(v.appointmentNoun, t.value).toBeTruthy();
      expect(v.appointmentNounPlural, t.value).toBeTruthy();
      expect(v.noNeedLabel, t.value).toBeTruthy();
      // Only the solar vertical may speak solar.
      if (t.value !== "solar") {
        expect(`${v.leadNoun} ${v.appointmentNoun} ${v.noNeedLabel}`.toLowerCase()).not.toContain(
          "solar",
        );
      }
    }
  });
});

describe("status labels follow the workspace", () => {
  it("relabels only the industry-specific disposition", () => {
    const solar = resolveOutcomeConfig(orgVocabulary({ dialerTemplate: "solar" }));
    expect(solar.bills_fine.label).toBe("Bills are fine");
    expect(solar.appointment_booked.label).toBe("Appointment");

    const recruiting = resolveOutcomeConfig(orgVocabulary({ dialerTemplate: "recruiting" }));
    expect(recruiting.bills_fine.label).toBe("Not looking right now");
    // Everything else is already vertical-neutral and must not move.
    expect(recruiting.no_answer.label).toBe("No answer");
    expect(recruiting.do_not_call.label).toBe("Do not call");
  });

  it("keeps the stored KEY stable while the words change", () => {
    // The key is on historical call records — renaming it would orphan them.
    const cfg = resolveOutcomeConfig(orgVocabulary({ dialerTemplate: "healthcare" }));
    expect(Object.keys(cfg)).toContain("bills_fine");
  });

  it("relabels the matching lead status too", () => {
    const cfg = resolveLeadStatusConfig(orgVocabulary({ dialerTemplate: "real_estate" }));
    expect(cfg.bills_fine.label).toBe("Not moving right now");
    expect(cfg.qualified.label).toBe("Qualified");
  });

  it("with no vocabulary in scope, returns the neutral defaults unchanged", () => {
    expect(resolveOutcomeConfig(null).bills_fine.label).toBe("No need right now");
    expect(resolveLeadStatusConfig(undefined).bills_fine.label).toBe("No need right now");
  });
});

describe("disposition buttons follow the workspace", () => {
  it("describes the booking in the vertical's own words", () => {
    const solar = resolveOutcomeOptions(orgVocabulary({ dialerTemplate: "solar" }));
    expect(solar.find((o) => o.value === "appointment_booked")!.description).toBe(
      "Account review scheduled",
    );

    const recruiting = resolveOutcomeOptions(
      orgVocabulary({ dialerTemplate: "recruiting" }),
    );
    expect(recruiting.find((o) => o.value === "appointment_booked")!.description).toBe(
      "Interview scheduled",
    );
    expect(recruiting.find((o) => o.value === "callback_scheduled")!.description).toBe(
      "The candidate asked to be called back",
    );
    expect(recruiting.find((o) => o.value === "bills_fine")!.label).toBe(
      "Not looking right now",
    );
  });

  it("covers every stored outcome, so no disposition is unreachable", () => {
    const values = resolveOutcomeOptions(null).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    for (const key of Object.keys(outcomeConfig) as CallOutcome[]) {
      expect(values, key).toContain(key);
    }
  });

  it("never speaks solar for a non-solar workspace", () => {
    const text = resolveOutcomeOptions(orgVocabulary({ dialerTemplate: "insurance" }))
      .map((o) => `${o.label} ${o.description}`)
      .join(" ")
      .toLowerCase();
    expect(text).not.toContain("solar");
    expect(text).not.toContain("homeowner");
    expect(text).not.toContain("account review");
  });
});

describe("nav labels follow the workspace", () => {
  const leads = navGroups.flatMap((g) => g.items).find((i) => i.href === "/leads") as NavItem;
  const setAside = navGroups
    .flatMap((g) => g.items)
    .find((i) => i.href === "/bills-fine") as NavItem;

  it("renames the Leads and set-aside tabs per vertical", () => {
    const rec = orgVocabulary({ dialerTemplate: "recruiting" });
    expect(navLabel(leads, rec)).toBe("Candidates");
    expect(navLabel(setAside, rec)).toBe("Not looking right now");
  });

  it("keeps the solar tenant's tabs", () => {
    const solar = orgVocabulary({ dialerTemplate: "solar" });
    expect(navLabel(leads, solar)).toBe("Homeowners");
    expect(navLabel(setAside, solar)).toBe("Bills are fine");
  });

  it("falls back to the static label with no vocabulary", () => {
    expect(navLabel(leads)).toBe(DEFAULT_VOCABULARY.LeadNounPlural);
    expect(navLabel({ label: "Dashboard", href: "/dashboard", icon: leads.icon })).toBe(
      "Dashboard",
    );
  });
});

describe("leadDisplayName", () => {
  it("prefers the name", () => {
    expect(leadDisplayName("Ada Lovelace", "+14155550123", "homeowner")).toBe("Ada Lovelace");
  });

  it("falls back to the PHONE, which is what a rep can actually act on", () => {
    expect(leadDisplayName("", "+14155550123", "homeowner")).toBe("(415) 555-0123");
    expect(leadDisplayName("   ", "4155550123")).toBe("(415) 555-0123");
  });

  it("only then falls back to the workspace's noun", () => {
    expect(leadDisplayName(null, null, "policyholder")).toBe("Unknown policyholder");
    expect(leadDisplayName(undefined, "123")).toBe("Unknown lead");
  });
});

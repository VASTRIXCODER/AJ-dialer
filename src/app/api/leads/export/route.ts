import { csvCell } from "@/lib/csv-safety";
import { getLeads } from "@/lib/db/leads";
import {
  leadFieldValue,
  resolveLeadFields,
  type LeadFieldDef,
} from "@/lib/leads/field-schema";
import { getViewer } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const bool = (v: unknown) => (v ? "Yes" : "No");

// Header text is chosen so the file RE-IMPORTS through /api/leads/import: each
// of these maps back to the right field in mapHeader() (src/lib/leads/csv.ts).
// The trailing metadata columns intentionally map to nothing and are ignored on
// re-import. Note "Uploaded By" rather than "Owner" — mapHeader() reads "owner"
// as the homeowner's NAME, which would overwrite first/last name on re-import.
type Column = {
  header: string;
  value: (l: Lead) => unknown;
  /**
   * The core schema slot this column carries, when it has one. Columns whose
   * slot the org's vertical HIDES are dropped from the file: a recruiting
   * workspace's export shipped "Solar Provider" and "Solar Payment" columns
   * that were empty in every single row.
   *
   * The header TEXT deliberately does not follow the org's label — it is the
   * interchange key mapHeader() reads on re-import (see above), not UI copy.
   */
  slot?: string;
};

const COLUMNS: Column[] = [
  { header: "First Name", value: (l) => l.firstName },
  { header: "Last Name", value: (l) => l.lastName },
  { header: "Phone", value: (l) => l.phone },
  { header: "Email", value: (l) => l.email ?? "" },
  { header: "Address", value: (l) => l.address },
  { header: "City", value: (l) => l.city },
  { header: "State", value: (l) => l.state },
  { header: "Zip", value: (l) => l.zip },
  { header: "Utility Provider", value: (l) => l.utilityProvider, slot: "utilityProvider" },
  { header: "Solar Provider", value: (l) => l.solarProvider, slot: "solarProvider" },
  { header: "Utility Bill", value: (l) => l.utilityBill ?? "", slot: "utilityBill" },
  { header: "Solar Payment", value: (l) => l.solarPayment ?? "", slot: "solarPayment" },
  { header: "Notes", value: (l) => l.notes ?? "" },
  // ── metadata (not re-imported) ──
  { header: "Status", value: (l) => l.status },
  { header: "Lead Group", value: (l) => l.leadGroup ?? "" },
  // Derived from Zip at import time (src/lib/leads/zip-county.ts) — not a
  // re-import source column, same as Lead Group/AI Score above; mapHeader()
  // has no "county" mapping so this is safely ignored if the file comes back.
  { header: "County", value: (l) => l.county ?? "" },
  { header: "Has EV", value: (l) => bool(l.hasEV), slot: "hasEV" },
  { header: "Has Pool", value: (l) => bool(l.hasPool), slot: "hasPool" },
  { header: "Has Battery", value: (l) => bool(l.hasBattery), slot: "hasBattery" },
  { header: "Multiple Systems", value: (l) => bool(l.multipleSystems), slot: "multipleSystems" },
  { header: "AI Score", value: (l) => l.aiScore ?? "" },
  { header: "Timezone", value: (l) => l.timezone },
  { header: "Last Contacted", value: (l) => l.lastContactedAt ?? "" },
  { header: "Created At", value: (l) => l.createdAt },
  { header: "Uploaded By", value: (l) => (l as { ownerName?: string }).ownerName ?? "" },
];

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/**
 * One export column per CUSTOM field in the org's resolved schema, appended
 * after the fixed columns (whose headers already cover every core slot). The
 * header is the def's label; values are emitted in re-importable form —
 * booleans as Yes/No (detected back to boolean), numbers raw — so the file
 * round-trips through /api/leads/import with the same keys and types (the defs
 * already exist in settings.leadFields, which a re-import never overwrites).
 */
function customColumns(defs: LeadFieldDef[]): Column[] {
  return defs
    .filter((d) => d.source === "custom")
    .map((def) => ({
      header: def.label,
      value: (l: Lead) => {
        const v = leadFieldValue(l, def);
        if (v == null) return "";
        return typeof v === "boolean" ? (v ? "Yes" : "No") : v;
      },
    }));
}

/**
 * Download every lead the viewer can see as a CSV.
 *
 * Scope is getLeads()' scope — a rep gets their own uploads + assignments, a
 * supervisor gets the org pool — so exporting reveals nothing the Leads tab
 * doesn't already show on screen. Gated on `leads.import` (owner/admin/manager)
 * because pulling the whole book down as one file is a bulk-data action rather
 * than ordinary lead work: the same people who can load the book can take it
 * out, and a rep can't quietly walk off with the org's list.
 */
export async function GET() {
  const viewer = await getViewer();
  // Demo mode has no auth user (getViewer returns user: null, isDemo: true) but
  // is a full owner of the demo org — every surface stays explorable without
  // Supabase, so don't 401 it out.
  if (!viewer.user && !viewer.isDemo) {
    return new Response("You must be signed in to export leads.", { status: 401 });
  }
  if (!viewer.permissions.includes("leads.import")) {
    return new Response("You don't have permission to export leads.", { status: 403 });
  }

  const leads = await getLeads();

  // Schema-driven tail: the org's custom fields (discovered by imports or added
  // in Admin) export as columns after the fixed set. resolveLeadFields already
  // handles the empty-settings case, and custom defs come only from settings,
  // so no template overrides are needed here.
  // The org's effective schema, template relabels/hides included — the same
  // resolution the leads table and the dialer use.
  const defs = resolveLeadFields(
    viewer.org?.settings?.leadFields,
    templateProfile(viewer.org?.dialerTemplate).fields,
  );
  // Which slots to drop comes from the template's HIDE list, not from
  // showInTable/showInQualify. Several core slots (utility provider, solar
  // provider, multiple systems) are false on BOTH flags by default and are
  // still exported — filtering on the flags would have silently dropped three
  // real columns of solar data out of every export.
  //
  // An org that explicitly saved a core def wins over the template's hide, the
  // same precedence resolveLeadFields itself uses.
  const hidden = new Set(templateProfile(viewer.org?.dialerTemplate).fields?.hidden ?? []);
  const savedCore = new Set(
    (viewer.org?.settings?.leadFields ?? [])
      .filter((f) => f.source === "core")
      .map((f) => f.key),
  );
  const columns = [
    // Everything without a slot (name, phone, the metadata tail) always ships.
    ...COLUMNS.filter((c) => !c.slot || savedCore.has(c.slot) || !hidden.has(c.slot)),
    ...customColumns(defs),
  ];

  const lines = [
    columns.map((c) => csvCell(c.header)).join(","),
    ...leads.map((l) => columns.map((c) => csvCell(c.value(l))).join(",")),
  ];
  // CRLF + a UTF-8 BOM so Excel opens accented names and °/€ correctly instead
  // of mojibake, which is the single most common complaint about CSV exports.
  const body = `﻿${lines.join("\r\n")}\r\n`;

  const date = new Date().toISOString().slice(0, 10);
  const name = `${slug(viewer.org?.name ?? "leads") || "leads"}-leads-${date}.csv`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}

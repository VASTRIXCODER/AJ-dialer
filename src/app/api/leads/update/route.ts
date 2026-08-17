import { NextResponse } from "next/server";
import { type LeadPatch, updateLead } from "@/lib/db/leads";
import { normalizeFieldKey } from "@/lib/leads/field-schema";
import { getViewer } from "@/lib/org/membership";
import type { LeadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// Statuses settable from the general edit form. "appointment"/"callback" are
// excluded — updateLead() rejects them too (belt and suspenders): those need
// the disposition-override flow so the appointments/callbacks table stays in
// sync with the lead's status.
const EDITABLE_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "not_interested",
  "no_answer",
  "bills_fine",
  "dnc",
];

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate a customFields patch: a plain object of normalized snake_case keys
 * (≤64 of them) mapping to scalars — strings ≤500 chars, finite numbers, or
 * booleans. `null` deletes a key (updateLead merges per key). Anything else —
 * arrays, nested objects, un-normalized keys — is rejected outright rather
 * than silently coerced, so junk can never land in the jsonb column.
 */
function parseCustomFields(
  raw: unknown,
): { ok: true; value: Record<string, string | number | boolean | null> } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "customFields must be an object." };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 64) {
    return { ok: false, error: "Too many custom fields (max 64 per update)." };
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    if (!key || key !== normalizeFieldKey(key)) {
      return { ok: false, error: `Invalid custom field key "${key}".` };
    }
    if (value === null) {
      out[key] = null; // delete this key
    } else if (typeof value === "string") {
      if (value.length > 500) {
        return {
          ok: false,
          error: `Custom field "${key}" is too long (max 500 characters).`,
        };
      }
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else {
      return {
        ok: false,
        error: `Custom field "${key}" must be text, a number, or true/false.`,
      };
    }
  }
  return { ok: true, value: out };
}

/**
 * Edit a single lead's fields. Any signed-in member can edit a lead they own;
 * supervisors (owner/admin/manager) can edit any lead in their org —
 * updateLead() enforces this via canActOn(), the same row-level check every
 * other lead write in this app uses. Not gated on a blanket permission, same
 * as the disposition-override flow: owning the lead is enough.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.user) {
    return NextResponse.json({ ok: false, error: "You must be signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "A lead id is required." }, { status: 400 });
  }

  const patch: LeadPatch = {};
  if (typeof body.firstName === "string") patch.firstName = body.firstName;
  if (typeof body.lastName === "string") patch.lastName = body.lastName;
  if (typeof body.phone === "string") patch.phone = body.phone;
  if ("email" in body) patch.email = typeof body.email === "string" ? body.email : null;
  if (typeof body.address === "string") patch.address = body.address;
  if (typeof body.city === "string") patch.city = body.city;
  if (typeof body.state === "string") patch.state = body.state;
  if (typeof body.zip === "string") patch.zip = body.zip;
  if (typeof body.utilityProvider === "string") patch.utilityProvider = body.utilityProvider;
  if (typeof body.solarProvider === "string") patch.solarProvider = body.solarProvider;
  if (typeof body.status === "string") {
    if (!EDITABLE_STATUSES.includes(body.status as LeadStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Use "Change disposition" on the Appointments/Callbacks tab to move a lead to Appointment or Callback.',
        },
        { status: 400 },
      );
    }
    patch.status = body.status as LeadStatus;
  }
  if ("utilityBill" in body) patch.utilityBill = toNumOrNull(body.utilityBill);
  if ("solarPayment" in body) patch.solarPayment = toNumOrNull(body.solarPayment);
  if (typeof body.hasEV === "boolean") patch.hasEV = body.hasEV;
  if (typeof body.hasPool === "boolean") patch.hasPool = body.hasPool;
  if (typeof body.hasBattery === "boolean") patch.hasBattery = body.hasBattery;
  if (typeof body.multipleSystems === "boolean") patch.multipleSystems = body.multipleSystems;
  if ("notes" in body) patch.notes = typeof body.notes === "string" ? body.notes : null;
  if ("customFields" in body && body.customFields !== undefined) {
    const parsed = parseCustomFields(body.customFields);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    if (Object.keys(parsed.value).length > 0) patch.customFields = parsed.value;
  }

  const result = await updateLead(id, patch);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

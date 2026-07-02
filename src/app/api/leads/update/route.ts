import { NextResponse } from "next/server";
import { type LeadPatch, updateLead } from "@/lib/db/leads";
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

  const result = await updateLead(id, patch);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

import { NextResponse } from "next/server";
import {
  addManyToDnc,
  addToDnc,
  listDnc,
  removeFromDnc,
} from "@/lib/db/dnc";
import { getViewer, viewerCan } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Managing the suppression list is an org-compliance action — gate on org.edit
// (the same permission that governs the org's compliance settings).
async function requireManager() {
  const viewer = await getViewer();
  if (!viewer.org) return { error: NextResponse.json({ error: "No organization." }, { status: 403 }) };
  if (!(await viewerCan("org.edit")))
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { viewer };
}

/** List the org's suppression entries. */
export async function GET() {
  const gate = await requireManager();
  if (gate.error) return gate.error;
  // A failed read is not an empty list. listDnc throws now, so the screen can
  // say it could not ask rather than showing a reassuring empty table.
  try {
    const entries = await listDnc(gate.viewer!.org!.id);
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json(
      { error: "Couldn't read the Do-Not-Call list just now. This is a database read — the list itself is unchanged." },
      { status: 503 },
    );
  }
}

/** Add one number ({ phone, reason }) or import many ({ phones: string[] }). */
export async function POST(req: Request) {
  const gate = await requireManager();
  if (gate.error) return gate.error;
  const orgId = gate.viewer!.org!.id;
  const createdBy = gate.viewer!.user?.id ?? null;

  const rl = rateLimit(`dnc:${createdBy ?? clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests — wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    phone?: string;
    phones?: string[];
    reason?: string;
  };

  if (Array.isArray(body.phones) && body.phones.length) {
    // Guard against a pasted mega-list: cap the batch.
    const phones = body.phones.slice(0, 50_000);
    const added = await addManyToDnc({ orgId, phones, source: "import", createdBy });
    return NextResponse.json({ ok: true, added });
  }

  if (body.phone && body.phone.trim()) {
    const ok = await addToDnc({
      orgId,
      phone: body.phone,
      reason: body.reason ?? null,
      source: "manual",
      createdBy,
    });
    return NextResponse.json(
      ok ? { ok: true, added: 1 } : { ok: false, error: "Enter a valid phone number." },
      { status: ok ? 200 : 400 },
    );
  }

  return NextResponse.json({ error: "phone or phones[] required." }, { status: 400 });
}

/** Remove one number from the suppression list (?phone=…). */
export async function DELETE(req: Request) {
  const gate = await requireManager();
  if (gate.error) return gate.error;
  const phone = new URL(req.url).searchParams.get("phone") ?? "";
  if (!phone) return NextResponse.json({ error: "phone required." }, { status: 400 });
  const ok = await removeFromDnc(gate.viewer!.org!.id, phone);
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}

import { NextResponse } from "next/server";
import { getDialQueue, getLeads } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Diagnostic for the dialer queue. Visit /api/leads/debug to see exactly what
 * the leads layer returns for the signed-in viewer:
 *   totalVisible  — leads the Leads tab shows (getLeads)
 *   dialable      — leads the Power Dialer queue shows (getDialQueue)
 *   statusCounts  — why leads might be excluded (only new/no_answer/callback dial)
 *   sample        — first few with phone digit counts (need 10+ to dial)
 *   serviceRole   — whether cross-account sharing can bypass RLS
 */
export async function GET() {
  const [viewer, all, dial] = await Promise.all([
    getViewer(),
    getLeads(),
    getDialQueue(),
  ]);
  const statusCounts: Record<string, number> = {};
  let noPhone = 0;
  for (const l of all) {
    statusCounts[l.status] = (statusCounts[l.status] ?? 0) + 1;
    if (l.phone.replace(/\D/g, "").length < 10) noPhone++;
  }
  return NextResponse.json({
    supabaseConfigured: isSupabaseConfigured(),
    serviceRoleConfigured: isAdminConfigured(),
    signedIn: Boolean(viewer.user),
    orgId: viewer.org?.id ?? null,
    orgName: viewer.org?.name ?? null,
    totalVisible: all.length,
    dialable: dial.length,
    excludedNoPhone: noPhone,
    statusCounts,
    sample: all.slice(0, 5).map((l) => ({
      name: `${l.firstName} ${l.lastName}`.trim() || "(no name)",
      status: l.status,
      phone: l.phone,
      phoneDigits: l.phone.replace(/\D/g, "").length,
      dialableStatus: ["new", "no_answer", "callback"].includes(l.status),
    })),
  });
}

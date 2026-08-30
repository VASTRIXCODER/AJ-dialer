import { NextResponse } from "next/server";
import { getDialQueue, getLeads } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

/**
 * "Where did my leads go?" — separates ROWS THAT NO LONGER EXIST from rows that
 * still exist but have fallen outside the viewer's scope.
 *
 * Every lead read in this app is scoped to the viewer's ACTIVE org
 * (`profiles.org_id`) and matched against the lead's own `org_id`, stamped at
 * insert time from the uploader's profile. So if a user's active org changes —
 * switching orgs in the Hub, being re-invited, an org being recreated — leads
 * uploaded under the previous org_id stay in the table but stop appearing
 * ANYWHERE in the UI. That reads to the user as "all my leads are gone" while
 * every row is still safely on disk.
 *
 * This reports the counts needed to tell those two cases apart. It is scoped to
 * the caller: lead counts for orgs the caller is an active member of, plus rows
 * the caller personally owns. It never exposes another tenant's leads.
 */
export async function GET() {
  const [viewer, all, dial] = await Promise.all([getViewer(), getLeads(), getDialQueue()]);

  const statusCounts: Record<string, number> = {};
  let noPhone = 0;
  for (const l of all) {
    statusCounts[l.status] = (statusCounts[l.status] ?? 0) + 1;
    if (l.phone.replace(/\D/g, "").length < 10) noPhone++;
  }

  // Rows this user OWNS, grouped by the org they're stamped with — the direct
  // test for "still in the table, just not in my active org".
  let ownedByOrg: { orgId: string | null; orgName: string; count: number; isActiveOrg: boolean }[] = [];
  let ownedTotalAnyOrg: number | null = null;
  let activeOrgTotal: number | null = null;
  let probeError: string | null = null;

  if (isAdminConfigured() && viewer.user?.id) {
    try {
      const admin = createAdminClient();
      const activeOrgId = viewer.org?.id ?? null;

      // Counted, not fetched. This is the "where did my leads go?" probe, and
      // its decision rule below turns on `ownedTotalAnyOrg === 0` meaning "the
      // rows really are gone". That was evaluated against a PAGE LENGTH:
      // `.limit(100_000)` with no `.range()` is capped at the PostgREST
      // response ceiling, and seven owners here hold more than that, the
      // largest 13,347. A saturating number sat next to an exact one, in the
      // one endpoint somebody opens when they think data has been lost.
      //
      // Only org_id is grouped, so this can't return anyone's contact data.
      const { data: grouped, error } = await admin.rpc("app_owned_lead_counts", {
        p_owner: viewer.user.id,
      });
      if (error) throw new Error(error.message);

      const counts = new Map<string | null, number>();
      let owned = 0;
      for (const r of (grouped ?? []) as Row[]) {
        const key = r.org_id ? String(r.org_id) : null;
        const n = Number(r.n ?? 0);
        counts.set(key, (counts.get(key) ?? 0) + n);
        owned += n;
      }
      ownedTotalAnyOrg = owned;

      // Name only the orgs this caller actually belongs to.
      const { data: memberships } = await admin
        .from("organization_members")
        .select("org_id, organizations(name)")
        .eq("user_id", viewer.user.id)
        .eq("status", "active");
      const nameByOrg = new Map<string, string>();
      for (const m of (memberships ?? []) as Row[]) {
        const orgs = m.organizations as { name?: string } | null;
        if (m.org_id) nameByOrg.set(String(m.org_id), orgs?.name ?? "");
      }

      ownedByOrg = [...counts.entries()]
        .map(([orgId, count]) => ({
          orgId,
          orgName: orgId ? (nameByOrg.get(orgId) ?? "(not a member of this org)") : "(no org — pre-org rows)",
          count,
          isActiveOrg: orgId === activeOrgId,
        }))
        .sort((a, b) => b.count - a.count);

      if (activeOrgId) {
        const { count, error: cntErr } = await admin
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("org_id", activeOrgId);
        if (cntErr) throw new Error(cntErr.message);
        activeOrgTotal = count ?? 0;
      }
    } catch (e) {
      probeError = e instanceof Error ? e.message : "probe failed";
    }
  }

  return NextResponse.json({
    supabaseConfigured: isSupabaseConfigured(),
    serviceRoleConfigured: isAdminConfigured(),
    signedIn: Boolean(viewer.user),
    userId: viewer.user?.id ?? null,
    orgId: viewer.org?.id ?? null,
    orgName: viewer.org?.name ?? null,
    role: viewer.role ?? null,

    totalVisible: all.length,
    dialable: dial.length,
    excludedNoPhone: noPhone,
    statusCounts,

    // ── "gone" vs "hidden" ──────────────────────────────────────────────────
    // ownedTotalAnyOrg > 0 while totalVisible === 0 ⇒ the rows still exist and
    // are stamped with an org_id that isn't the viewer's active org. Nothing was
    // deleted; re-point profiles.org_id (or restamp the leads) to recover them.
    // ownedTotalAnyOrg === 0 ⇒ the rows really are gone from the table.
    activeOrgTotal,
    ownedTotalAnyOrg,
    ownedByOrg,
    probeError,

    sample: all.slice(0, 5).map((l) => ({
      name: `${l.firstName} ${l.lastName}`.trim() || "(no name)",
      status: l.status,
      phone: l.phone,
      phoneDigits: l.phone.replace(/\D/g, "").length,
      dialableStatus: ["new", "no_answer", "callback"].includes(l.status),
    })),
  });
}

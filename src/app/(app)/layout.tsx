import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { isSolarVertical } from "@/lib/org/vertical";
import { MaintenanceScreen } from "@/components/layout/maintenance-screen";
import { PaywallScreen } from "@/components/layout/paywall-screen";
import { isAIConfigured } from "@/lib/ai/claude";
import { getAppSettings, isAccountDisabled } from "@/lib/db/app-control";
import { listLeadGroups } from "@/lib/db/lead-groups";
import { getPlatformPool } from "@/lib/dialer/rotation-server";
import { agentLabels, isElevenLabsConfigured, isSecondAgentConfigured } from "@/lib/elevenlabs";
import { resolveLeadFields, type LeadFieldDef } from "@/lib/leads/field-schema";
import { getViewer } from "@/lib/org/membership";
import {
  DEFAULT_DIALER_LAYOUT,
  DEFAULT_FEATURES,
  resolveDialerAccess,
} from "@/lib/org/settings";
import { templateProfile } from "@/lib/org/templates";
import { isSuperadmin } from "@/lib/superadmin";
import { isVoiceConfigured } from "@/lib/twilio";
import { MAX_PARALLEL_HUMAN } from "@/lib/use-dialer";
import { initials } from "@/lib/utils";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();

  // Signed out (and not demo) → sign in. Signed in but no active org → the Hub.
  if (!viewer.isDemo && !viewer.user) redirect("/login");
  if (!viewer.isDemo && !viewer.org) redirect("/hub");

  // Superadmins are also normal users (hidden) — they use the app like anyone,
  // and reach the Control Center through a discreet entry. They're exempt from
  // the kill switch / suspension so they can never lock themselves out.
  const superadmin = await isSuperadmin();

  if (viewer.user && !superadmin) {
    // These two gates are independent — resolve them concurrently instead of
    // serially (the app settings read and the per-user suspension check have no
    // data dependency on each other).
    const [settings, disabled] = await Promise.all([
      getAppSettings(),
      isAccountDisabled(viewer.user.id),
    ]);
    if (settings.maintenance) {
      return <MaintenanceScreen message={settings.message} />;
    }
    if (disabled) {
      return <MaintenanceScreen suspended />;
    }
  }

  // Per-org paywall: if this workspace is gated and not yet activated by the
  // platform owner, lock it for everyone but the superadmin (who grants access).
  const billing = viewer.org?.settings.billing;
  if (!superadmin && billing?.paywall && !billing.active) {
    return (
      <PaywallScreen
        orgName={viewer.org?.name ?? "This workspace"}
        productName={viewer.org?.productName}
        billing={billing}
      />
    );
  }

  const account = {
    name: viewer.displayName,
    email: viewer.email,
    initials: initials(viewer.displayName) || "·",
  };

  // Config for the app-wide dialer engine (lives in AppShell so calls survive
  // navigation). Same resolution the dialer page uses for its access gates.
  const { manualEnabled, aiEnabled, aiLockReason } = resolveDialerAccess(
    viewer.org?.settings.features ?? DEFAULT_FEATURES,
    viewer.permissions.includes("dialer.ai"),
  );
  // Supervisors dial the whole org pool; reps dial only their own uploads
  // (mirrors getDialQueue's server-side scoping).
  const dialScope: "org" | "own" =
    viewer.role && ["owner", "admin", "manager"].includes(viewer.role) ? "org" : "own";
  // The effective caller-ID pool (org settings, or the platform-locked env pool
  // when TWILIO_CALLER_IDS is set) — lets the dialer's caller-ID picker offer
  // exactly the numbers nextCallerId*() will actually validate an override against.
  const { pool: callerIdPool, rotateEvery: callerIdRotateEvery } = getPlatformPool(
    viewer.org?.settings ?? null,
  );
  // The org's intake groups drive the dialer's group filter. Labels only — the
  // dialer never needs the AI rule text.
  const orgLeadGroups = (await listLeadGroups(viewer.org?.id ?? null)).map((g) => ({
    key: g.key,
    label: g.label,
  }));

  // ── Template-driven dialer shape ───────────────────────────────────────────
  // The vertical template presets the field schema, the qualify field list and
  // the page layout; org settings override the preset key-by-key. Resolved here
  // (server-side, per request) so switching the template in Admin re-derives
  // everything the org never explicitly overrode.
  const orgSettings = viewer.org?.settings;
  const profile = templateProfile(viewer.org?.dialerTemplate);
  const savedCoreKeys = new Set(
    (orgSettings?.leadFields ?? []).filter((f) => f.source === "core").map((f) => f.key),
  );
  let leadFields = resolveLeadFields(orgSettings?.leadFields, profile.fields);
  // Legacy double-gate, kept: solar slots appear only for the solar vertical
  // with the qualify toggle on — unless the org's own schema explicitly
  // overrides a slot (explicit org config wins, same as resolveLeadFields).
  const solarAllowed =
    isSolarVertical(viewer.org?.dialerTemplate) &&
    (orgSettings?.qualify?.showSolarPayment ?? true);
  if (!solarAllowed) {
    leadFields = leadFields.filter(
      (f) => savedCoreKeys.has(f.key) || (f.key !== "solarPayment" && f.key !== "solarProvider"),
    );
  }
  // Slots the template hides are dropped from the dialer's schema entirely
  // (rather than carried along with both visibility flags off), so the lead
  // panel and search never surface another vertical's fields.
  const templateHidden = new Set(profile.fields?.hidden ?? []);
  leadFields = leadFields.filter((f) => savedCoreKeys.has(f.key) || !templateHidden.has(f.key));
  // Legacy third-toggle label: an admin-customized label (anything beyond the
  // two seed defaults) still renames the Battery slot, unless the org's schema
  // already overrides that slot explicitly.
  const legacyOtherLabel = orgSettings?.qualify?.otherToggleLabel?.trim();
  if (
    legacyOtherLabel &&
    legacyOtherLabel !== "Battery" &&
    legacyOtherLabel !== "Other" &&
    !savedCoreKeys.has("hasBattery")
  ) {
    leadFields = leadFields.map((f) =>
      f.key === "hasBattery" ? { ...f, label: legacyOtherLabel } : f,
    );
  }
  // Which fields the qualify panel renders: org qualify.fields → template
  // preset → every schema field flagged showInQualify. Unknown keys drop out.
  const fieldByKey = new Map(leadFields.map((f) => [f.key, f]));
  const qualifyKeys = orgSettings?.qualify?.fields?.length
    ? orgSettings.qualify.fields
    : profile.qualifyFields;
  const qualifyFields = qualifyKeys
    ? qualifyKeys
        .map((k) => fieldByKey.get(k))
        .filter((f): f is LeadFieldDef => Boolean(f))
    : leadFields.filter((f) => f.showInQualify);
  // Effective page layout: default all-on ⊕ template preset ⊕ org toggles.
  const dialerLayout = {
    ...DEFAULT_DIALER_LAYOUT,
    ...(profile.dialerLayout ?? {}),
    ...(orgSettings?.dialerLayout ?? {}),
  };

  const dialerConfig = {
    userId: viewer.user?.id,
    voiceConfigured: isVoiceConfigured(),
    aiAgentConfigured: isElevenLabsConfigured(),
    // A second AI persona the rep can pick in the dialer (feature is hidden unless set).
    secondAgentConfigured: isSecondAgentConfigured(),
    agentNames: agentLabels(),
    manualEnabled,
    aiEnabled,
    aiLockReason,
    dialScope,
    // The org's voice-plan concurrency allowance — the dialer holds itself to it.
    maxAiConcurrency: viewer.org?.settings.ai.maxConcurrentCalls ?? 10,
    // Admin → Dialing → "Max lines". This was editable but never read, so every
    // workspace got the platform maximum of 3 whatever it had been set to; a
    // team that wants single-line dialing sets it to 1 and 2X/3X disappears.
    maxHumanLines: viewer.org?.settings.dialing.maxLines ?? MAX_PARALLEL_HUMAN,
    callerIdPool,
    callerIdRotateEvery,
    // Double-dial (double-tap): AI bot re-rings a no-answer once after a short gap.
    doubleDial: viewer.org?.settings.dialing.doubleDial ?? false,
    doubleDialGapSec: viewer.org?.settings.dialing.doubleDialGapSec ?? 15,
    // Per-tenant qualification-panel shape (solar field + third toggle label).
    // A non-solar vertical drops the solar field regardless of the qualify
    // setting, so a tenant never has to switch off solar wording in two places.
    qualifyShowSolarPayment: solarAllowed,
    qualifyOtherLabel: viewer.org?.settings.qualify?.otherToggleLabel ?? "Battery",
    // The template-resolved dialer shape (see the block above).
    dialerLayout,
    leadFields,
    qualifyFields,
    // Per-org "dropbox" label overrides (display only).
    leadGroupLabels: viewer.org?.settings.leadGroupLabels ?? {},
    leadGroups: orgLeadGroups,
  };

  return (
    <AppShell
      voiceConfigured={isVoiceConfigured()}
      aiConfigured={isAIConfigured()}
      account={account}
      permissions={viewer.permissions}
      features={viewer.org?.settings.features ?? null}
      orgName={viewer.org?.name ?? null}
      productName={viewer.org?.productName || null}
      dialerTemplate={viewer.org?.dialerTemplate ?? null}
      brandColor={viewer.org?.brandColor || null}
      role={viewer.role}
      superadmin={superadmin}
      dialerConfig={dialerConfig}
    >
      {children}
    </AppShell>
  );
}

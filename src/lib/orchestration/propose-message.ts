import "server-only";

import { buildSendContext, ensureThread, judgeSend, proposeMessage } from "../db/messages";
import { renderTemplate, renderValues, withOptOut } from "../messaging/render";
import { isDeferrable, type SendDenial } from "../messaging/send-gate";
import { getOrgById } from "../org/membership";
import { orgVocabulary } from "../org/vocabulary";
import type { createAdminClient } from "../supabase/admin";
import { count } from "../telemetry";

// ─────────────────────────────────────────────────────────────────────────────
// What a playbook's `send_message` step actually does.
//
// It PROPOSES. Nothing here can send, and nothing it imports can reach the
// transport — tests/messaging-architecture.test.ts proves that through the
// whole import graph, not just the first hop.
//
// The body is rendered ONCE, here, and frozen on the row. Re-rendering at send
// would deliver words nobody approved: the approver read a specific sentence to
// a specific person, and if the underlying data moved in between, the sentence
// they approved is the one that should go — or none at all.
// ─────────────────────────────────────────────────────────────────────────────

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export interface ProposeStepResult {
  /** A human has something to decide, so give them a task saying so. */
  workItemNeeded: boolean;
  messageId: string | null;
  /** Non-empty when the message was recorded as blocked rather than proposed. */
  blocked: SendDenial[];
}

const NOTHING: ProposeStepResult = { workItemNeeded: false, messageId: null, blocked: [] };

export async function proposeStepMessage(
  admin: Admin,
  input: {
    inst: { id: string; org_id: string; opportunity_id: string; playbook_id: string };
    step: { id: string; templateKey: string; scope?: "transactional" | "promotional" };
    leadId: string | null;
    ownerId: string | null;
    now: Date;
  },
): Promise<ProposeStepResult> {
  const { inst, step, leadId, now } = input;
  // No lead means no phone and no person. Nothing to propose, and nothing
  // worth telling a human about.
  if (!leadId) return NOTHING;

  try {
    const [{ data: lead }, { data: template }, org] = await Promise.all([
      admin
        .from("leads")
        .select("id, first_name, last_name, phone, timezone")
        .eq("id", leadId)
        .maybeSingle(),
      admin
        .from("message_templates")
        .select("id, key, version, body, scope, channel")
        .eq("org_id", inst.org_id)
        .eq("key", step.templateKey)
        .eq("status", "published")
        .maybeSingle(),
      getOrgById(inst.org_id),
    ]);
    if (!lead) return NOTHING;

    const phone = s((lead as Row).phone);
    const vocab = orgVocabulary(org);
    const scope = step.scope ?? (template ? (s(template.scope) as "transactional") : "transactional");

    // A template that was published when the playbook was and has since been
    // unpublished. Recorded as a blocked message rather than skipped silently,
    // so the gap is visible on the record instead of being a playbook that
    // quietly stopped doing its job.
    if (!template) {
      const thread = await ensureThread({
        orgId: inst.org_id,
        phone,
        leadId,
        opportunityId: inst.opportunity_id,
      });
      if (!thread) return NOTHING;
      const blocked: SendDenial[] = ["template_not_published"];
      const msg = await proposeMessage({
        orgId: inst.org_id,
        threadId: thread.id,
        leadId,
        opportunityId: inst.opportunity_id,
        toNumber: phone,
        fromNumber: thread.senderNumber,
        body: "",
        scope,
        createdBy: null,
        templateKey: step.templateKey,
        idempotencyKey: `${inst.id}:${step.id}`,
        sourceKind: "playbook",
        sourceId: inst.playbook_id,
        blockedReasons: blocked,
      });
      count("messaging.template_missing", 1, { orgId: inst.org_id });
      return { workItemNeeded: false, messageId: msg?.id ?? null, blocked };
    }

    // ── Render once, and refuse loudly. ──────────────────────────────────────
    const rendered = renderTemplate(
      s(template.body),
      renderValues({
        firstName: s((lead as Row).first_name),
        lastName: s((lead as Row).last_name),
        appointmentNoun: vocab.appointmentNoun,
        orgName: org?.name ?? "",
        replyNumber: "",
      }),
    );

    const senderNumber =
      org?.settings.dialing.callerId?.trim() ||
      org?.settings.dialing.callerIds?.[0] ||
      null;
    const thread = await ensureThread({
      orgId: inst.org_id,
      phone,
      leadId,
      opportunityId: inst.opportunity_id,
      senderNumber,
    });
    if (!thread) return NOTHING;

    // Every message carries a way out, appended here rather than trusted to
    // each template author.
    const body = rendered.ok ? withOptOut(rendered.body) : "";

    const ctx = await buildSendContext({
      org,
      orgId: inst.org_id,
      toPhone: phone,
      senderNumber: thread.senderNumber ?? senderNumber,
      leadTimezone: s((lead as Row).timezone) || null,
      now,
    });
    const verdict = judgeSend(ctx, {
      now,
      body,
      requiredScope: scope,
      // Null on purpose. The proposal has no approver by definition, and the
      // gate is being asked "would this be allowed if someone approved it?".
      approvedBy: null,
      templateRequired: true,
      templatePublished: true,
      unresolvedVariables: rendered.unresolved,
    });

    // `needs_human_approval` is not a blocker here — it is the entire design.
    // A deferrable reason is not one either: quiet hours at 9pm say nothing
    // about whether a human should approve this for the morning, and the drain
    // re-checks the clock anyway.
    const blocking = verdict.denials.filter(
      (d) => d !== "needs_human_approval" && !isDeferrable(d),
    );

    const message = await proposeMessage({
      orgId: inst.org_id,
      threadId: thread.id,
      leadId,
      opportunityId: inst.opportunity_id,
      toNumber: phone,
      fromNumber: thread.senderNumber ?? senderNumber,
      body,
      scope,
      // The automation has no user. `created_by` stays null and the approvals
      // inbox reads that as "Automation", which is the truth.
      createdBy: null,
      templateId: s(template.id),
      templateKey: s(template.key),
      templateVersion: Number(template.version ?? 1) || 1,
      // Exactly-once: a replayed tick hits this key and creates nothing.
      idempotencyKey: `${inst.id}:${step.id}`,
      sourceKind: "playbook",
      sourceId: inst.playbook_id,
      blockedReasons: blocking.length ? blocking : undefined,
    });

    if (blocking.length) {
      count("messaging.proposal_blocked", 1, { orgId: inst.org_id });
      // Nothing for a human to approve — there is no version of this message
      // that may go — so no review task either.
      return { workItemNeeded: false, messageId: message?.id ?? null, blocked: blocking };
    }

    // A null message here means the idempotency key already existed: the
    // proposal was made by an earlier tick and its review task with it.
    return {
      workItemNeeded: message != null,
      messageId: message?.id ?? null,
      blocked: [],
    };
  } catch {
    count("messaging.propose_step_fail", 1, { orgId: inst.org_id });
    return NOTHING;
  }
}

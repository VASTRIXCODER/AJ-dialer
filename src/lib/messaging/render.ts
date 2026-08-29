// ─────────────────────────────────────────────────────────────────────────────
// Turning a template into the words a specific person receives — PURE.
//
// The whole module exists to make one failure impossible: nobody has ever been
// texted "Hi {{firstName}}" by a system that treated an unresolved placeholder
// as an empty string. Rendering REFUSES on any variable it cannot fill, and the
// refusal names them, so the failure happens at proposal time in front of the
// person who can fix it rather than on a stranger's phone.
//
// Rendering happens ONCE, at proposal, and the result is frozen on the message
// row. Re-rendering at send would deliver words nobody approved: the approver
// read a specific sentence to a specific person, and if the underlying data
// moved between approval and send, the sentence they approved is the one that
// should go — or none at all.
// ─────────────────────────────────────────────────────────────────────────────

/** `{{ firstName }}` — whitespace tolerated, names are word characters + dots. */
const VARIABLE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export interface RenderResult {
  ok: boolean;
  /** The finished message. Empty when it could not be fully rendered. */
  body: string;
  /** Every variable the template wanted and the data could not supply. */
  unresolved: string[];
  /** Segment count at GSM-7 sizes — what the send will actually cost. */
  segments: number;
}

/** Every variable a template references, in first-appearance order. */
export function templateVariables(body: string): string[] {
  const found: string[] = [];
  for (const m of String(body ?? "").matchAll(VARIABLE)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/**
 * A value counts as supplied only when it is a non-empty, non-whitespace
 * string. An empty first name is exactly the case that produces "Hi ," — it is
 * missing data wearing the costume of present data.
 */
function usable(value: unknown): value is string | number {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim().length > 0;
}

export function renderTemplate(
  body: string,
  values: Record<string, unknown>,
): RenderResult {
  const unresolved: string[] = [];
  const rendered = String(body ?? "").replace(VARIABLE, (_match, name: string) => {
    const value = values[name];
    if (!usable(value)) {
      if (!unresolved.includes(name)) unresolved.push(name);
      // Left in place rather than blanked, so a caller that ignores `ok` and
      // sends anyway produces something obviously broken instead of something
      // subtly wrong. Failing loudly beats failing plausibly.
      return `{{${name}}}`;
    }
    return String(value).trim();
  });

  if (unresolved.length) {
    return { ok: false, body: "", unresolved, segments: 0 };
  }
  const clean = rendered.trim();
  return { ok: true, body: clean, unresolved: [], segments: countSegments(clean) };
}

// GSM-7 is 160 characters in one segment, 153 per segment when concatenated.
// A single character outside the alphabet forces the whole message to UCS-2,
// which is 70 and 67 — so one stray curly quote nearly halves the capacity and
// can silently double the cost.
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7.includes(ch) && !GSM7_EXTENDED.includes(ch)) return false;
  }
  return true;
}

export function countSegments(text: string): number {
  const body = String(text ?? "");
  if (!body.length) return 0;
  if (isGsm7(body)) {
    // Extended characters occupy two positions each.
    let units = 0;
    for (const ch of body) units += GSM7_EXTENDED.includes(ch) ? 2 : 1;
    return units <= 160 ? 1 : Math.ceil(units / 153);
  }
  // UCS-2. Count UTF-16 code units, because that is what the carrier counts —
  // an emoji outside the BMP is a surrogate pair and costs two.
  const units = body.length;
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

/**
 * Values a template may reference. Deliberately small and explicit: a renderer
 * that could reach any column would let an author put a lead's internal notes
 * or a competitor's name into a customer's message by typing a field name.
 */
export interface RenderContext {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  /** The workspace's own word for a booking, already resolved. */
  appointmentNoun?: string | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  repName?: string | null;
  orgName?: string | null;
  /** Where they reply to reach a human. */
  replyNumber?: string | null;
}

export function renderValues(ctx: RenderContext): Record<string, unknown> {
  return {
    firstName: ctx.firstName ?? "",
    lastName: ctx.lastName ?? "",
    fullName:
      ctx.fullName ?? [ctx.firstName, ctx.lastName].filter(Boolean).join(" "),
    appointmentNoun: ctx.appointmentNoun ?? "",
    appointmentDate: ctx.appointmentDate ?? "",
    appointmentTime: ctx.appointmentTime ?? "",
    repName: ctx.repName ?? "",
    orgName: ctx.orgName ?? "",
    replyNumber: ctx.replyNumber ?? "",
  };
}

/**
 * Every message must carry a way out. This is a legal requirement for
 * promotional messages and simple decency for the rest, and appending it here
 * rather than trusting each template author means it cannot be forgotten.
 */
export const OPT_OUT_SUFFIX = "Reply STOP to opt out.";

export function withOptOut(body: string): string {
  const text = body.trim();
  // Already says it, in whatever wording the author chose.
  if (/\bstop\b/i.test(text)) return text;
  return `${text} ${OPT_OUT_SUFFIX}`;
}

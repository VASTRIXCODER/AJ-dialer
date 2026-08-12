import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// The app's only way to send an email. Resend's REST API over plain `fetch` —
// no SDK, matching how this codebase already talks to ElevenLabs and Anthropic.
//
// Like every other integration here, it degrades: with no key configured,
// `isEmailConfigured()` is false and callers file the notification as `skipped`
// rather than failing. Nothing crashes, and an org that never wanted email never
// sees a red banner about it.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://api.resend.com/emails";

const API_KEY = () => process.env.RESEND_API_KEY ?? "";
/** e.g. `AIATWORK Dialer <dialer@yourdomain.com>` — must be a verified domain. */
const FROM = () => process.env.RESEND_FROM ?? "";

export function isEmailConfigured(): boolean {
  return Boolean(API_KEY() && FROM());
}

/** Why email isn't working, in words an admin can act on. */
export function emailConfigProblem(): string | null {
  if (!API_KEY()) return "RESEND_API_KEY is not set.";
  if (!FROM()) return "RESEND_FROM is not set (e.g. \"Dialer <dialer@yourdomain.com>\").";
  return null;
}

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Overrides the display name on the From line; the address always comes from env. */
  fromName?: string;
  /**
   * Stable key (e.g. the outbox row id) so Resend dedupes a resend of the same
   * message — belt-and-suspenders with the atomic claim, covering the window
   * where a send succeeded but we crashed before recording it.
   */
  idempotencyKey?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/** Swap the display name in a `Name <addr@host>` From line, keeping the address. */
function withFromName(from: string, name?: string): string {
  if (!name) return from;
  const m = /<([^>]+)>/.exec(from);
  const address = m ? m[1] : from;
  return `${name} <${address}>`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // The failure path this feature promises has to be TESTABLE, and the only
  // honest way to test it is to actually make a send fail. Flipping this in
  // .env.local is how the retry + alert path gets proven end-to-end without
  // waiting for a real outage. It is deliberately loud in the error message so
  // nobody mistakes a simulated failure for a real one in production.
  if (process.env.EMAIL_SIMULATE_FAILURE === "true") {
    return { ok: false, error: "Simulated failure (EMAIL_SIMULATE_FAILURE=true)." };
  }

  const problem = emailConfigProblem();
  if (problem) return { ok: false, error: problem };

  const recipients = input.to.map((t) => t.trim()).filter(Boolean);
  if (!recipients.length) return { ok: false, error: "No recipients." };

  try {
    const res = await fetch(API, {
      method: "POST",
      // Cap the request so a hung Resend call can't consume the whole drain
      // budget (which would starve every other queued notification this tick).
      signal: AbortSignal.timeout(8_000),
      headers: {
        authorization: `Bearer ${API_KEY()}`,
        "content-type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: withFromName(FROM(), input.fromName),
        to: recipients,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    const body = (await res.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;

    if (!res.ok) {
      // Resend puts the useful part in `message` ("domain is not verified",
      // "invalid api key"). Surface it verbatim — it lands in the outbox row and
      // then in front of an admin, so a vague "send failed" helps nobody.
      const detail = body?.message || body?.name || `HTTP ${res.status}`;
      return { ok: false, error: `Resend: ${detail}` };
    }
    return { ok: true, id: body?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error." };
  }
}

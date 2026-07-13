import { NextResponse } from "next/server";
import { renderAppointmentEmail } from "@/lib/email/templates/appointment";
import { emailConfigProblem, isEmailConfigured, sendEmail } from "@/lib/email/resend";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Send a real appointment email to the configured recipients, right now.
 *
 * This is how ticket 6.2's "verified by a real test send" gets satisfied without
 * having to fake a booking: an admin adds Brock's address, clicks the button, and
 * either an email lands in his inbox or the provider's actual error comes back on
 * screen ("domain is not verified", "invalid api key") instead of being buried in
 * a serverless log.
 *
 * It renders the SAME template the outbox does, with a clearly-fake homeowner, so
 * what arrives is exactly what a real booking will look like.
 */
export async function POST() {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("org.edit")) {
    return NextResponse.json(
      { ok: false, error: "You don't have permission to change notification settings." },
      { status: 403 },
    );
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { ok: false, error: emailConfigProblem() ?? "Email is not configured." },
      { status: 400 },
    );
  }

  const settings = viewer.org?.settings.notifications;
  const to = settings?.appointmentEmails?.length
    ? settings.appointmentEmails
    : (process.env.APPOINTMENT_NOTIFY_EMAILS ?? "")
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .filter(Boolean);

  if (!to.length) {
    return NextResponse.json(
      { ok: false, error: "Add at least one recipient first." },
      { status: 400 },
    );
  }

  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(18, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const floating =
    `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}` +
    `T${pad(start.getHours())}:00:00`;

  const email = renderAppointmentEmail({
    kind: "appointment_set",
    payload: {
      leadName: "Test Homeowner (this is a test)",
      scheduledAt: floating,
      durationMin: 60,
      timezone: viewer.org?.timezone ?? "",
      location: "1234 Sample St, Anytown",
      notes: "This is a test send from Admin → Notifications. No appointment was created.",
      source: "rep",
      phone: "+15555550123",
      utilityBill: 240,
      solarPayment: 180,
      utilityProvider: "Sample Electric",
    },
    repName: viewer.displayName,
    orgName: viewer.org?.name ?? "",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  });

  const result = await sendEmail({
    to,
    subject: `[Test] ${email.subject}`,
    html: email.html,
    text: email.text,
    fromName: settings?.fromName || viewer.org?.name || undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Send failed." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, to, id: result.id });
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Returns TwiML that plays hold music when a conference participant is put on hold.
 * Twilio calls this URL when `Hold=true` is set on a participant.
 */
export async function GET() {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play loop="10">https://demo.twilio.com/docs/classic.mp3</Play>
</Response>`;
  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

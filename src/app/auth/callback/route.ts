import { NextResponse } from "next/server";
import { clientIpFrom, recordLegalAcceptance } from "@/lib/legal/record-acceptance";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Exchanges the email-confirmation / OAuth code for a session, then redirects.
 *
 * `tos=1` is appended to the redirectTo URL only by the SIGNUP page's "Continue
 * with Google" button (after the rep has checked the clickwrap box) — the
 * browser round-trips through Google in between, so recording the acceptance
 * has to happen here, once we're back with a real session, rather than before
 * the redirect. Harmless no-op for a plain login: that button never sets it.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only allow a same-origin relative path. Without this, `?next=//evil.com` (or
  // `?next=https://evil.com`) makes this an open redirect off the trusted domain.
  const rawNext = searchParams.get("next") ?? "/hub";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/hub";
  const tosAccepted = searchParams.get("tos") === "1";

  if (code && isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.exchangeCodeForSession(code);
      if (tosAccepted && data.user) {
        await recordLegalAcceptance({
          userId: data.user.id,
          email: data.user.email ?? "",
          ip: clientIpFrom(request),
          userAgent: request.headers.get("user-agent") ?? "",
        });
      }
    } catch {
      /* fall through to redirect */
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}

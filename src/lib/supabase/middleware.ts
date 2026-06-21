import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

const PROTECTED = [
  "/dashboard",
  "/dialer",
  "/leads",
  "/appointments",
  "/callbacks",
  "/monitor",
  "/leaderboard",
  "/campaigns",
  "/reports",
  "/ai-agent",
  "/admin",
  "/settings",
];

/**
 * Refreshes the Supabase auth session on every request and guards the app
 * routes. No-ops entirely when Supabase isn't configured (demo mode).
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const onAuthPage = path === "/login" || path === "/signup";
  const onConsole = path === "/console" || path.startsWith("/console/");
  const isProtected = PROTECTED.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  // Superadmin sessions are a signed httpOnly cookie, separate from Supabase.
  // The Edge runtime can't run Node crypto, so here we only check presence and
  // route accordingly — the cookie's HMAC is verified server-side by the page
  // and API routes it reaches (a forged cookie is bounced back to /login there).
  const hasSuperadmin = Boolean(request.cookies.get("sa_session")?.value);

  // ── Superadmin routing (works even in demo mode, before Supabase loads) ──
  // The console demands a superadmin session; everyone else is sent to sign in.
  if (onConsole && !hasSuperadmin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // A superadmin belongs in the standalone console — never the dialer app.
  if (hasSuperadmin && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/console";
    url.search = "";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured()) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A superadmin reaching here was already routed above, so a protected route
  // without a Supabase user means an unauthenticated visitor → sign in.
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
  }

  if (user && onAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

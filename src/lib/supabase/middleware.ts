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
  "/app-management",
];

/**
 * Refreshes the Supabase auth session on every request and guards the app
 * routes. No-ops entirely when Supabase isn't configured (demo mode).
 */
export async function updateSession(request: NextRequest) {
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

  const path = request.nextUrl.pathname;
  const onAuthPage = path === "/login" || path === "/signup";

  // Superadmin sessions (a signed httpOnly cookie) bypass the Supabase guard —
  // their access is HMAC-verified by the server components/routes they hit.
  const hasSuperadmin = Boolean(request.cookies.get("sa_session")?.value);

  if (
    !user &&
    !hasSuperadmin &&
    PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))
  ) {
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

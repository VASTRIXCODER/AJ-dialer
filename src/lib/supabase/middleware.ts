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
  // The console requires a signed-in user; whether they're actually a superadmin
  // is verified server-side in the page (identity-based, not a cookie).
  const needsAuth = isProtected || onConsole;

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

  // Unauthenticated visitor hitting a protected route or the console → sign in.
  if (!user && needsAuth) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
  }

  if (user && onAuthPage) {
    // Land signed-in users on the Hub (the org gateway), not straight in the app.
    const url = request.nextUrl.clone();
    url.pathname = "/hub";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

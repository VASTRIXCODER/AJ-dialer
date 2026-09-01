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
 * How long the session lookup may take before middleware stops waiting.
 *
 * This runs on EVERY request, so a hanging auth call here doesn't slow one
 * page down — it takes the whole site offline with a Vercel 504
 * (MIDDLEWARE_INVOCATION_TIMEOUT), including pages that need no identity at
 * all. Whatever the auth provider is doing, the site has to keep answering.
 */
export const AUTH_TIMEOUT_MS = 2_500;

/**
 * Resolve the signed-in user, but never wait forever.
 *
 * Returns `conclusive: false` when the provider didn't answer in time or
 * errored — which is NOT the same as "no user", and the caller must not treat
 * it as one. Extracted and exported so the timeout behaviour is testable
 * without standing up Supabase or the edge runtime.
 */
export async function resolveUserWithTimeout<T>(
  fetchUser: () => Promise<T | null>,
  timeoutMs: number = AUTH_TIMEOUT_MS,
): Promise<{ user: T | null; conclusive: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchUser().then((user) => ({ user, conclusive: true })),
      new Promise<{ user: null; conclusive: false }>((resolve) => {
        timer = setTimeout(() => resolve({ user: null, conclusive: false }), timeoutMs);
      }),
    ]);
  } catch {
    // A provider error is as inconclusive as a timeout — we still don't know
    // whether this visitor is signed in.
    return { user: null, conclusive: false };
  } finally {
    // Don't leave a pending timer holding the invocation open.
    if (timer) clearTimeout(timer);
  }
}

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

  const { user, conclusive } = await resolveUserWithTimeout(async () => {
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  });

  // The auth provider didn't answer. Let the request through rather than hang
  // or guess: middleware is a convenience gate, not the enforcement boundary.
  // Every protected surface re-checks server-side — (app)/layout.tsx redirects
  // to /login when there's no viewer, and /console verifies superadmin from
  // identity — so failing OPEN costs one extra hop and nothing else, while
  // failing closed would bounce signed-in reps to /login (and failing to
  // decide at all is what returned 504 for the entire site).
  if (!conclusive) return response;

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

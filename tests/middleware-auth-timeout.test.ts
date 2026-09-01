import { describe, expect, it, vi } from "vitest";
import { AUTH_TIMEOUT_MS, resolveUserWithTimeout } from "@/lib/supabase/middleware";

const never = () => new Promise<never>(() => {});

describe("resolveUserWithTimeout", () => {
  it("returns the user when auth answers", async () => {
    const r = await resolveUserWithTimeout(async () => ({ id: "u1" }));
    expect(r).toEqual({ user: { id: "u1" }, conclusive: true });
  });

  it("reports a genuine signed-out visitor as CONCLUSIVE", async () => {
    // This is the case that must still redirect to /login.
    const r = await resolveUserWithTimeout(async () => null);
    expect(r).toEqual({ user: null, conclusive: true });
  });

  it("gives up instead of hanging the whole site", async () => {
    // The outage: getUser() never settles, middleware never returns, Vercel
    // answers 504 for every route.
    const r = await resolveUserWithTimeout(never, 20);
    expect(r).toEqual({ user: null, conclusive: false });
  });

  it("marks a timeout as INCONCLUSIVE, never as signed-out", async () => {
    // The distinction that keeps a slow provider from bouncing signed-in reps
    // to /login: "we don't know" must not be read as "no user".
    const { user, conclusive } = await resolveUserWithTimeout(never, 20);
    expect(user).toBeNull();
    expect(conclusive).toBe(false);
  });

  it("treats a provider error as inconclusive too", async () => {
    const r = await resolveUserWithTimeout(async () => {
      throw new Error("supabase unreachable");
    });
    expect(r).toEqual({ user: null, conclusive: false });
  });

  it("resolves as soon as auth answers, without waiting out the timeout", async () => {
    const started = Date.now();
    const r = await resolveUserWithTimeout(async () => ({ id: "u2" }), 5_000);
    expect(r.conclusive).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("clears its timer so a pending timeout can't hold the invocation open", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    await resolveUserWithTimeout(async () => ({ id: "u3" }), 5_000);
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it("keeps the default well under Vercel's middleware limit", () => {
    expect(AUTH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(AUTH_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });
});

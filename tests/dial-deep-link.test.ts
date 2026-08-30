import { describe, expect, it } from "vitest";
import { dialDeepLink } from "../src/lib/dialer/deep-link";

// ─────────────────────────────────────────────────────────────────────────────
// The dialer deep link. Two invariants worth a test:
//
// 1. The name is encoded EXACTLY ONCE. Next.js decodes searchParams before the
//    page sees them, so a page that decoded again threw URIError on a literal
//    "%" in a lead name — a 500 on the one screen a rep can't work without.
// 2. A callback-sourced call carries its callback id, because that id is what
//    CLOSES the promise when the disposition is filed. Drop it and the rep is
//    recommended the same person forever.
// ─────────────────────────────────────────────────────────────────────────────

/** What the RSC page actually receives: Next.js decodes each param once. */
function asNextWouldParse(href: string): Record<string, string> {
  const qs = href.split("?")[1] ?? "";
  return Object.fromEntries(new URLSearchParams(qs).entries());
}

describe("dialDeepLink", () => {
  it("survives a name containing a literal percent sign", () => {
    const href = dialDeepLink({ phone: "+15105550143", name: "50% Off Corp" });
    const parsed = asNextWouldParse(href);
    expect(parsed.name).toBe("50% Off Corp");
    // The old double-decode crashed on exactly this value.
    expect(() => decodeURIComponent(parsed.name)).toThrow(URIError);
  });

  it("round-trips names with spaces, ampersands and unicode", () => {
    for (const name of ["Ana Ruiz", "Smith & Sons", "Zoë O'Brien", "北京 Ltd"]) {
      const parsed = asNextWouldParse(dialDeepLink({ phone: "+15105550143", name }));
      expect(parsed.name).toBe(name);
    }
  });

  it("carries a valid callback id so the promise gets closed", () => {
    const id = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const parsed = asNextWouldParse(
      dialDeepLink({ phone: "+15105550143", name: "Ana", callbackId: id }),
    );
    expect(parsed.callback).toBe(id);
  });

  it("drops a non-uuid callback id instead of forwarding junk", () => {
    const parsed = asNextWouldParse(
      dialDeepLink({ phone: "+15105550143", callbackId: "../../admin" }),
    );
    expect(parsed.callback).toBeUndefined();
  });

  it("omits an absent name and caps a very long one", () => {
    expect(asNextWouldParse(dialDeepLink({ phone: "+15105550143" })).name).toBeUndefined();
    const long = asNextWouldParse(
      dialDeepLink({ phone: "+15105550143", name: "x".repeat(200) }),
    );
    expect(long.name).toHaveLength(80);
  });

  it("degrades to the plain dialer when there is no number", () => {
    expect(dialDeepLink({ phone: "", name: "Ana" })).toBe("/dialer");
    expect(dialDeepLink({ phone: "   " })).toBe("/dialer");
  });
});

import { describe, expect, it } from "vitest";
import { deepLinkChannel, dialDeepLink } from "../src/lib/dialer/deep-link";

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

// ─────────────────────────────────────────────────────────────────────────────
// …and who places the call once the link is followed.
//
// The bug: the auto-dial bailed out silently whenever the dialer was in AI mode
// — which is the BOOT mode on every AI-configured workspace. The rep pressed
// "Call" on a person they had just searched for, landed on a dialer sitting
// under a "Dialing now…" banner that described nothing, and did the natural
// thing: pressed Start. Start opens a session on whoever the loaded queue is
// parked on. A completely different person answered.
// ─────────────────────────────────────────────────────────────────────────────

describe("deepLinkChannel — who is going to dial this number", () => {
  it("uses manual dialing whenever the workspace allows it", () => {
    // Even on an AI-configured workspace booting into AI mode: the rep is at
    // the keyboard, having just pressed Call on one specific person.
    expect(
      deepLinkChannel({ manualEnabled: true, aiAgentConfigured: true, aiEnabled: true }),
    ).toBe("manual");
    expect(
      deepLinkChannel({ manualEnabled: true, aiAgentConfigured: false, aiEnabled: false }),
    ).toBe("manual");
  });

  it("hands an AI-only workspace's link to the agent", () => {
    expect(
      deepLinkChannel({ manualEnabled: false, aiAgentConfigured: true, aiEnabled: true }),
    ).toBe("ai");
  });

  it("says nobody can dial it rather than promising a hand-off that never happens", () => {
    // Real states: an AI-only workspace whose agent isn't wired up yet, and one
    // whose plan lapsed. Both used to sit forever under "Handing this number to
    // the AI agent…".
    expect(
      deepLinkChannel({ manualEnabled: false, aiAgentConfigured: false, aiEnabled: true }),
    ).toBe("none");
    expect(
      deepLinkChannel({ manualEnabled: false, aiAgentConfigured: true, aiEnabled: false }),
    ).toBe("none");
  });

  it("never returns a channel the workspace has switched off", () => {
    for (const aiAgentConfigured of [true, false]) {
      for (const aiEnabled of [true, false]) {
        const channel = deepLinkChannel({ manualEnabled: false, aiAgentConfigured, aiEnabled });
        expect(channel).not.toBe("manual");
      }
    }
  });
});

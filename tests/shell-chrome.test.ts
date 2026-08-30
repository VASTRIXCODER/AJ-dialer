import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The app shell's header is chrome: it reports state, opens the palette, and
// gets out of the way. Three things it was getting wrong, each invisible until
// somebody used the product on the wrong device or scrolled a long table.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const TOPBAR = read("src/components/layout/topbar.tsx");
const PALETTE = read("src/components/ai/command-palette.tsx");

describe("the command palette has a door on every device", () => {
  it("is opened by an event the header actually dispatches", () => {
    expect(PALETTE).toMatch(/addEventListener\("open-command-palette"/);
    expect(TOPBAR).toMatch(/dispatchEvent\(new Event\("open-command-palette"\)\)/);
  });

  it("has a trigger that is not hidden below 640px", () => {
    // The palette is mounted on every page. Its only trigger used to be
    // `hidden … sm:flex`, and the other way in is ⌘K — which a phone cannot
    // produce. Mounted, and unreachable, on every phone in the field.
    const triggers = [...TOPBAR.matchAll(/<button[\s\S]{0,600}?<\/button>/g)]
      .map((m) => m[0])
      .filter((b) => b.includes("openPalette"));
    expect(triggers.length, "no palette trigger in the header").toBeGreaterThan(0);
    // Tailwind is mobile-first: a bare `hidden` is hidden ON a phone, while
    // `sm:hidden` is hidden everywhere ELSE — which is what a phone-only
    // control looks like. The lookbehind is what tells the two apart.
    const hiddenOnAPhone = /(?<![:\w-])hidden(?![\w-])/;
    const reachableOnAPhone = triggers.some((b) => !hiddenOnAPhone.test(b));
    expect(reachableOnAPhone, "every palette trigger is hidden below sm").toBe(true);
  });

  it("that trigger has an accessible name", () => {
    const iconOnly = TOPBAR.includes('aria-label="Search or ask AI"');
    expect(iconOnly, "the icon-only trigger announces nothing").toBe(true);
  });
});

describe("the header is a solid edge", () => {
  it("the sticky element carries the fill, not the card inside it", () => {
    // The sticky element was a transparent wrapper with 12–16px of padding, so
    // rows scrolled visibly through the band above the floating header.
    const sticky = TOPBAR.match(/className="sticky top-0[^"]*"/);
    expect(sticky, "no sticky wrapper found").toBeTruthy();
    expect(sticky![0]).toMatch(/bg-\w/);
  });

  it("carries no primary action", () => {
    // Chrome, not a place to start work: a brand-filled pill in the header
    // competes with the actual primary action of the page underneath it.
    // `buttonVariants` defaults to `primary`, so the variant must be explicit.
    const calls = [...TOPBAR.matchAll(/buttonVariants\(\{[\s\S]{0,200}?\}\)/g)].map((m) => m[0]);
    for (const call of calls) {
      expect(call, "a header button defaults to the primary variant").toMatch(
        /variant:\s*"(outline|ghost|secondary)"/,
      );
    }
  });
});

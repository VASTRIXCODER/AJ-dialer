import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { decideKeystroke, isEditableTarget } from "@/lib/dialer/use-kbd";
import {
  __resetOverlayCount,
  anyOverlayOpen,
  markOverlayOpen,
} from "@/lib/overlay-open";

// ─────────────────────────────────────────────────────────────────────────────
// The dialer listens at the WINDOW. That is the only way a shortcut can work
// from anywhere on the page — and it is also why the dialer heard keystrokes
// aimed at whatever was layered on top of it.
//
// Two ways it went wrong, both reported as "it did something I didn't ask for":
//
//   · A rep presses [?] during wrap-up to remind themselves what the number
//     keys do, presses [1] to find out — and a real disposition is filed and
//     the queue advances behind the open sheet.
//   · A rep opens the booking dialog's duration picker and types "m" for
//     "min". No option starts with m, the key falls through the listbox, and
//     the live call mutes.
//
// Nothing here needs a browser: the gate is a pure function over the shape of
// a keyboard event, which is the point.
// ─────────────────────────────────────────────────────────────────────────────

/** A DOM element as this decision actually reads one. */
function el(tagName: string, opts: { roles?: string[]; contentEditable?: boolean } = {}) {
  const roles = opts.roles ?? [];
  return {
    tagName,
    isContentEditable: opts.contentEditable ?? false,
    // `closest` matches when the selector names any role this node sits under.
    closest: (selector: string) =>
      roles.some((r) => selector.includes(`"${r}"`)) ? {} : null,
  } as unknown as EventTarget;
}

const press = (key: string, over: Partial<Parameters<typeof decideKeystroke>[0]> = {}) => ({
  key,
  ...over,
});

beforeEach(() => __resetOverlayCount());

describe("a keystroke reaches the dialer only when nothing else wants it", () => {
  it("passes a plain shortcut through when the page is quiet", () => {
    expect(decideKeystroke(press("m"), false)).toEqual({ kind: "shortcut", key: "m" });
    expect(decideKeystroke(press("1"), false)).toEqual({ kind: "shortcut", key: "1" });
    expect(decideKeystroke(press("?"), false)).toEqual({ kind: "shortcut", key: "?" });
  });

  it("stands down completely while a dialog is open", () => {
    // The exact reported sequence: the shortcut sheet is up, and [1] must not
    // file a disposition on the call behind it.
    for (const key of ["1", "9", "c", "m", ".", "n", "?"]) {
      expect(decideKeystroke(press(key), true), key).toEqual({ kind: "ignore" });
    }
  });

  it("still lets Escape out of a dialog — it is the universal put-this-away", () => {
    expect(decideKeystroke(press("Escape"), true)).toEqual({ kind: "escape" });
    expect(decideKeystroke(press("Escape", { target: el("TEXTAREA") }), false)).toEqual({
      kind: "escape",
    });
  });

  it("stands down for text entry", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(decideKeystroke(press("m", { target: el(tag) }), false), tag).toEqual({
        kind: "ignore",
      });
    }
    expect(
      decideKeystroke(press("m", { target: el("DIV", { contentEditable: true }) }), false),
    ).toEqual({ kind: "ignore" });
  });

  it("stands down inside a widget that does its own typeahead", () => {
    // SelectMenu's popup is role=listbox with role=option children; Menu is
    // role=menu with role=menuitem. Typing in any of them is typing.
    for (const role of ["listbox", "option", "combobox", "menu", "menuitem"]) {
      expect(decideKeystroke(press("m", { target: el("DIV", { roles: [role] }) }), false), role)
        .toEqual({ kind: "ignore" });
    }
  });

  it("leaves modifier chords, repeats and already-handled keys alone", () => {
    expect(decideKeystroke(press("c", { metaKey: true }), false)).toEqual({ kind: "ignore" });
    expect(decideKeystroke(press("c", { ctrlKey: true }), false)).toEqual({ kind: "ignore" });
    expect(decideKeystroke(press("c", { altKey: true }), false)).toEqual({ kind: "ignore" });
    // Cmd+K is the command palette — the dialer must never intercept it.
    expect(decideKeystroke(press("k", { metaKey: true }), false)).toEqual({ kind: "ignore" });
    expect(decideKeystroke(press("1", { repeat: true }), false)).toEqual({ kind: "ignore" });
    // SelectMenu's typeahead calls preventDefault on every printable key it
    // consumes, matched or not — this is the other half of that contract.
    expect(decideKeystroke(press("m", { defaultPrevented: true }), false)).toEqual({
      kind: "ignore",
    });
  });

  it("survives a target that isn't an element", () => {
    expect(decideKeystroke(press("m", { target: null }), false)).toEqual({
      kind: "shortcut",
      key: "m",
    });
    expect(isEditableTarget({} as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("reads lowercase tag names too (an element from an XML-ish realm)", () => {
    expect(isEditableTarget(el("input"))).toBe(true);
  });
});

describe("the overlay counter", () => {
  it("locks while anything is open and unlocks when the last one closes", () => {
    expect(anyOverlayOpen()).toBe(false);
    const closeDrawer = markOverlayOpen();
    expect(anyOverlayOpen()).toBe(true);
    // Overlays nest: a confirmation opened from inside a drawer.
    const closeConfirm = markOverlayOpen();
    closeConfirm();
    expect(anyOverlayOpen(), "the drawer is still open").toBe(true);
    closeDrawer();
    expect(anyOverlayOpen()).toBe(false);
  });

  it("ignores a repeated release — React can run a cleanup twice", () => {
    const closeA = markOverlayOpen();
    const closeB = markOverlayOpen();
    closeA();
    closeA();
    closeA();
    expect(anyOverlayOpen(), "B is still open").toBe(true);
    closeB();
    expect(anyOverlayOpen()).toBe(false);
  });

  it("never goes negative", () => {
    markOverlayOpen()();
    markOverlayOpen()();
    expect(anyOverlayOpen()).toBe(false);
  });
});

// ── Source-level: the wiring the pure tests above cannot see ──────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("the guard is actually wired up", () => {
  it("the one Overlay primitive registers with the counter", () => {
    // If this ever stops being true, every pure test above still passes and
    // the bug is back.
    const overlay = read("src/components/ui/overlay.tsx");
    expect(overlay).toMatch(/markOverlayOpen\(\)/);
    expect(overlay).toMatch(/releaseOverlayLock\(\)/);
  });

  it("the dialer's listener asks the counter before acting", () => {
    expect(read("src/lib/dialer/use-kbd.ts")).toMatch(
      /decideKeystroke\(e,\s*anyOverlayOpen\(\)\)/,
    );
  });

  it("SelectMenu's typeahead swallows printable keys whether or not they match", () => {
    const source = read("src/components/ui/select-menu.tsx");
    // The block that handles a single printable character must prevent the
    // default BEFORE it knows whether anything matched.
    const block = source.slice(source.indexOf("e.key.length === 1"));
    const prevented = block.indexOf("e.preventDefault()");
    const matched = block.indexOf("const hit =");
    expect(prevented, "no preventDefault in the typeahead branch").toBeGreaterThan(-1);
    expect(prevented, "prevented only on a match — an unmatched key still leaks").toBeLessThan(
      matched,
    );
  });

  // Every other place in the product that listens for keys at the window. Each
  // needs a reason, because a second ungated listener puts the whole bug class
  // back somewhere else in the app.
  const KEYDOWN_ALLOWED: Record<string, string> = {
    "src/lib/dialer/use-kbd.ts": "the gate itself",
    "src/components/ui/overlay.tsx": "the focus trap — Escape and Tab, only while open",
    "src/components/ai/command-palette.tsx": "Cmd/Ctrl+K, a chord every gate lets through",
    "src/components/appointments/use-appointment-drag.ts": "Escape cancels a drag in flight",
    "src/components/layout/notifications-bell.tsx": "Escape closes the popover",
    "src/components/pipeline/row-actions.tsx": "Escape closes the row menu",
    "src/components/ui/tooltip.tsx": "Escape dismisses a keyboard-opened tooltip",
  };

  const windowKeydownFiles = execSync(
    'git ls-files --cached --others --exclude-standard "src/**/*.tsx" "src/**/*.ts"',
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((p) => /window\.addEventListener\(\s*["']keydown["']/.test(read(p)));

  it("every window-level keydown listener is accounted for", () => {
    const undeclared = windowKeydownFiles.filter((p) => !KEYDOWN_ALLOWED[p]);
    expect(undeclared, undeclared.join("\n")).toEqual([]);
    const stale = Object.keys(KEYDOWN_ALLOWED).filter((p) => !windowKeydownFiles.includes(p));
    expect(stale, stale.join("\n")).toEqual([]);
  });

  it("none of them claims a bare printable key — only Escape, or a chord", () => {
    // This is the substantive rule. Escape is safe from anywhere (it means
    // "put this away"); a chord is safe because every gate ignores modifiers.
    // A bare letter or digit is what collides with the dialer, and with typing.
    const offenders: string[] = [];
    for (const path of windowKeydownFiles) {
      if (path === "src/lib/dialer/use-kbd.ts") continue; // the gate defines the rule
      const source = read(path);
      const bare = [...source.matchAll(/\.key\s*===\s*["'](.)["']/g)].map((m) => m[1]);
      if (bare.length && !/metaKey|ctrlKey/.test(source)) {
        offenders.push(`${path}: claims ${bare.map((k) => `"${k}"`).join(", ")} unmodified`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// A call must survive the rest of the app.
//
// The dialer engine lives in the (app) shell so a rep can work a lead record,
// check Reports, or look something up mid-call. Three ways that promise was
// being broken, all of them silent:
//
//   · Two sidebar links — "Switch organization" and "Control Center" — go to
//     route groups that do NOT mount DialerProvider. Following one unmounts
//     useDialer, whose cleanup calls device.destroy(). The homeowner is cut off
//     mid-sentence.
//   · The dialer's own "Booked" tab replaced the entire three-column grid,
//     CallCockpit included, with no guard. One click and there was no timer, no
//     mute, no End call — while the call was still up.
//   · Cmd-W or a refresh dropped the call and the un-filed disposition with no
//     prompt at all.
//
// And one thing the bar itself was not saying: an AI session is a first-class
// running status, but the bar only recognised dialing/live/wrap-up — so an AI
// campaign running under the rep's identity became invisible, and unstoppable,
// the moment they left /dialer.
//
// Source-level, in the idiom of tests/token-discipline.test.ts: these are
// wiring facts about specific files, and the repo has no browser test runner.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const BAR = "src/components/dialer/global-call-bar.tsx";
const SHELL = "src/components/layout/app-shell.tsx";
const SIDEBAR = "src/components/layout/sidebar.tsx";
const TOAST = "src/components/ui/toast.tsx";
const DIALER = "src/components/dialer/dialer-client.tsx";
const ENGINE = "src/lib/use-dialer.ts";

describe("the call follows the rep", () => {
  it("the bar is mounted by the shell, not by a page", () => {
    expect(read(SHELL)).toMatch(/<GlobalCallBar\s*\/>/);
  });

  it("the bar shows EVERY status that isn't idle", () => {
    // It used to enumerate three of the four running statuses and drop "ai".
    // An open-ended test rather than a list, so adding a status to the engine
    // cannot silently fall out of the bar again.
    expect(read(BAR)).toMatch(/const inProgress = state\.status !== "idle"/);
  });

  it("leaving the shell during a call asks first", () => {
    const sidebar = read(SIDEBAR);
    for (const href of ["/hub", "/console"]) {
      // A bare <Link href="/hub"> is the bug. Both exits go through ExitLink,
      // which confirms while a call is up.
      const bare = new RegExp(`<Link\\s+href="${href}"`);
      expect(bare.test(sidebar), `${href} is a bare Link — it hangs up the call`).toBe(false);
      expect(sidebar).toMatch(new RegExp(`<ExitLink\\s+href="${href}"`));
    }
    expect(sidebar).toMatch(/useDialerContextOptional\(\)/);
    expect(sidebar).toMatch(/useConfirm\(\)/);
  });

  it("closing the tab during a call asks first", () => {
    const engine = read(ENGINE);
    expect(engine).toMatch(/addEventListener\("beforeunload"/);
    expect(engine).toMatch(/removeEventListener\("beforeunload"/);
  });

  it("the Booked tab cannot take the call surface away with it", () => {
    const source = read(DIALER);
    const tab = source.slice(source.indexOf('onClick={() => setTab("booked")}'));
    expect(tab.slice(0, 400)).toMatch(/disabled=\{state\.status !== "idle"\}/);
    // …and a round that starts while the rep is already on the tab pulls them
    // back, because disabling a control does not move anybody.
    expect(source).toMatch(/if \(state\.status !== "idle"\) setTab\("queue"\)/);
  });
});

describe("the bar occupies space instead of covering it", () => {
  it("publishes its height only while it is up", () => {
    const bar = read(BAR);
    expect(bar).toMatch(/setProperty\("--callbar-h"/);
    expect(bar).toMatch(/removeProperty\("--callbar-h"\)/);
  });

  it("page content clears it", () => {
    expect(read(SHELL)).toMatch(/pb-\[var\(--callbar-h,0px\)\]/);
  });

  it("a toast never lands on the hang-up button", () => {
    // Below `sm` the toast stack is centred — exactly where the bar sits.
    const toast = read(TOAST);
    expect(toast).toMatch(/var\(--callbar-h, 0px\)/);
    expect(toast, "a fixed bottom-4 would put it back on top of the bar").not.toMatch(
      /fixed inset-x-0 bottom-4/,
    );
  });

  it("focus never parks under the top bar or the call bar", () => {
    expect(read("src/app/globals.css")).toMatch(
      /scroll-padding-block:\s*76px calc\(16px \+ var\(--callbar-h, 0px\)\)/,
    );
  });
});

describe("the bar is an Instrument surface", () => {
  const bar = read(BAR);

  it("does not move", () => {
    // It used to slide 24px up the screen on every call and shrink its
    // hang-up button on press — motion on the one control that has to feel
    // immovable.
    for (const pattern of [/whileHover/, /whileTap/, /\by:\s*-?\d/, /\bscale:\s*[\d.]/]) {
      expect(pattern.test(bar), `${pattern} in the call bar`).toBe(false);
    }
    expect(bar).not.toMatch(/active:scale-/);
    expect(bar).not.toMatch(/transition-transform/);
  });

  it("sits no higher than elevation 2", () => {
    expect(bar).not.toMatch(/shadow-lift|shadow-3\b/);
    expect(bar).toMatch(/shadow-2\b/);
  });

  it("has no dead exit animation promising a fade-out that never runs", () => {
    // The shell renders the bar bare, not inside <AnimatePresence>, so an
    // `exit` prop here is a lie to whoever edits the file next.
    expect(bar).not.toMatch(/\bexit=\{/);
  });
});

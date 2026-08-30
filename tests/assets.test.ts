import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATE_PROFILES, templatePlate } from "@/lib/org/templates";

// ─────────────────────────────────────────────────────────────────────────────
// The generated art has to stay small, complete, and in a format that does not
// quietly cost something.
//
// Before this phase `public/` held exactly one file — hold-music.wav — and the
// product shipped with no favicon, no app icon and no social card, so every
// browser tab showed a blank page glyph and every shared link an empty box.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const PUBLIC = join(ROOT, "public");

/** Every raster asset served from public/, with its size. */
function rasters(dir: string, acc: { path: string; size: number }[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) rasters(full, acc);
    else if ([".webp", ".png", ".jpg", ".jpeg", ".avif", ".gif"].includes(extname(entry.name))) {
      acc.push({ path: full.slice(PUBLIC.length + 1), size: statSync(full).size });
    }
  }
  return acc;
}

describe("generated assets", () => {
  it("every vertical template has a plate, and no plate is orphaned", () => {
    const dir = join(PUBLIC, "verticals");
    const onDisk = new Set(readdirSync(dir).map((f) => f.replace(/\.webp$/, "")));
    const wanted = new Set(TEMPLATE_PROFILES.map((t) => t.value));
    for (const v of wanted) {
      expect(onDisk.has(v), `missing plate for vertical "${v}"`).toBe(true);
    }
    for (const f of onDisk) {
      expect(wanted.has(f), `plate "${f}" matches no template`).toBe(true);
    }
  });

  it("an unknown template falls back rather than 404s", () => {
    // dialerTemplate is free text on the org row, so this is reachable.
    expect(templatePlate("not_a_vertical")).toBe("/verticals/general.webp");
    expect(templatePlate(null)).toBe("/verticals/general.webp");
    expect(templatePlate("solar")).toBe("/verticals/solar.webp");
  });

  it("all six ambient plates exist — three per theme", () => {
    for (const theme of ["dark", "light"]) {
      for (const n of [1, 2, 3]) {
        const p = join(PUBLIC, "ambient", `${theme}-${n}.webp`);
        expect(existsSync(p), `missing /ambient/${theme}-${n}.webp`).toBe(true);
      }
    }
  });

  it("the icon, apple icon and social card exist", () => {
    for (const f of ["icon.svg", "apple-icon.png", "opengraph-image.jpg"]) {
      expect(existsSync(join(ROOT, "src", "app", f)), `missing src/app/${f}`).toBe(true);
    }
  });

  it("nothing is served as .avif", () => {
    // src/middleware.ts excludes svg|png|jpg|jpeg|gif|webp|ico from the Supabase
    // session refresh but NOT avif, so an .avif asset would run every request
    // through auth middleware for nothing.
    const avif = rasters(PUBLIC).filter((r) => extname(r.path) === ".avif");
    expect(avif.map((a) => a.path)).toEqual([]);
  });

  it("stays inside the weight budget", () => {
    const all = rasters(PUBLIC);
    const total = all.reduce((n, r) => n + r.size, 0);
    const biggest = all.sort((a, b) => b.size - a.size).slice(0, 3);
    expect(
      total,
      `public/ raster payload is ${(total / 1024).toFixed(0)}KB. Largest:\n` +
        biggest.map((b) => `  ${b.path} ${(b.size / 1024).toFixed(0)}KB`).join("\n"),
    ).toBeLessThan(2_560_000);
  });
});

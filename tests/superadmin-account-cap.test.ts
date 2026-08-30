import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The Console's "Accounts" tile renders one page of auth users. Past that page
// size it reads the same number forever — a page size presented as a platform
// total. The tile now says "≥" and "first page only" when it has saturated,
// which only works while the two numbers agree.
//
// They cannot be one constant: src/lib/db/app-control.ts is `server-only`, and
// super-console.tsx is a client component. Importing a VALUE across that
// boundary type-checks fine and breaks the production bundle — this repo has
// shipped that exact failure before. So the constant is declared twice, in
// lockstep, and this is the lockstep.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("the account page size is one number in two places", () => {
  it("the query and the tile agree", () => {
    const server = read("src/lib/db/app-control.ts").match(/ACCOUNT_PAGE = (\d+)/)?.[1];
    const client = read("src/components/superadmin/super-console.tsx").match(
      /ACCOUNT_PAGE = (\d+)/,
    )?.[1];
    expect(server, "app-control.ts no longer declares ACCOUNT_PAGE").toBeTruthy();
    expect(client, "super-console.tsx no longer declares ACCOUNT_PAGE").toBeTruthy();
    expect(client).toBe(server);
  });

  it("the query actually uses it", () => {
    expect(read("src/lib/db/app-control.ts")).toMatch(/perPage: ACCOUNT_PAGE/);
  });

  it("the tile says when it has saturated", () => {
    const console_ = read("src/components/superadmin/super-console.tsx");
    expect(console_).toMatch(/accounts\.length >= ACCOUNT_PAGE \? "≥" : ""/);
  });

  it("the client never imports the server-only module", () => {
    // The whole reason for the duplication.
    expect(read("src/components/superadmin/super-console.tsx")).not.toMatch(
      /from "@\/lib\/db\/app-control"/,
    );
  });
});

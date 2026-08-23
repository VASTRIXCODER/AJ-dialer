/**
 * Claude connection check — `npm run verify:ai`.
 *
 * Answers, in order, the three questions that "the AI isn't working" actually
 * means, so you never have to guess which one you're looking at:
 *
 *   1. Is a key present?                → configured
 *   2. Can this server reach the model? → pingAI (a real, tiny request)
 *   3. Does structured output work?     → a real generateJSON round-trip
 *
 * Exit code 0 = live intelligence works. 1 = it doesn't, and the reason is
 * printed in plain English rather than as a raw SDK stack.
 *
 * Reads .env.local the same way `next dev` does, so it tests the credentials the
 * app will actually run with.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `import "server-only"` is a Next.js build-time marker, aliased away by the
// bundler; the package isn't installed, so a plain Node run can't resolve it.
// Resolve it to an empty module here — the guarantee it encodes (this file only
// ever runs on a server) is exactly what this script is doing.
{
  const require = createRequire(import.meta.url);
  const Module = require("node:module") as {
    _resolveFilename: (req: string, ...rest: unknown[]) => string;
  };
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === "server-only") return resolve(import.meta.dirname, "server-only-shim.cjs");
    return original.call(this, request, ...rest);
  };
}

// Load .env.local → process.env BEFORE importing the AI module (its client is
// constructed lazily, but AI_MODEL is read at module scope).
for (const file of [".env.local", ".env"]) {
  try {
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (process.env[key]) continue; // a real env var always wins
      const value = rawValue.trim().replace(/^["']|["']$/g, "");
      if (value) process.env[key] = value;
    }
  } catch {
    /* file absent — fine */
  }
}

async function main() {
  const { AI_MODEL, isAIConfigured, pingAI, generateJSON } = await import(
    "@/lib/ai/claude"
  );

  console.log(`\nClaude check — AI_MODEL = ${AI_MODEL}\n`);

  if (!isAIConfigured()) {
    console.log("  ✗ ANTHROPIC_API_KEY is not set.");
    console.log(
      "    Add it to .env.local (local) or your hosting platform's env (production).",
    );
    console.log(
      "    Until then every AI surface renders simulated output with a 'Demo AI' badge —",
    );
    console.log("    which is by design, but it is NOT live intelligence.\n");
    process.exit(1);
  }
  console.log("  ✓ ANTHROPIC_API_KEY is set");

  const health = await pingAI();
  if (!health.ok) {
    console.log(`  ✗ Connection failed: ${health.error}`);
    if (health.stopReason) console.log(`    stop_reason: ${health.stopReason}`);
    console.log("");
    process.exit(1);
  }
  console.log(
    `  ✓ Reached ${health.model} in ${health.latencyMs}ms — replied ${JSON.stringify(
      health.reply,
    )}`,
  );

  // The real shape every AI surface uses: a system prompt, a schema, and a
  // parsed object back. A key that pings fine can still fail here if the model
  // doesn't support structured outputs, which is exactly what we want to catch.
  try {
    const out = await generateJSON<{ ok: boolean; note: string }>({
      system: "You are a health probe. Answer only with the requested JSON.",
      prompt: 'Return {"ok": true, "note": "structured outputs work"}.',
      schemaName: "probe",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" }, note: { type: "string" } },
        required: ["ok", "note"],
        additionalProperties: false,
      },
      maxTokens: 256,
      effort: "low",
    });
    console.log(`  ✓ Structured output round-trip: ${JSON.stringify(out)}`);
  } catch (e) {
    console.log(
      `  ✗ Structured output failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    console.log("");
    process.exit(1);
  }

  // `--full` exercises every real AI surface with its production prompt and
  // schema. Structured outputs are strict — a schema the API rejects fails HERE
  // rather than silently degrading a live workspace to simulated output.
  if (process.argv.includes("--full")) {
    const { orgAIContext } = await import("@/lib/ai/org-context");
    const services = await import("@/lib/ai/services");
    const { leads } = await import("@/lib/sample-data");
    const lead = leads[0];
    const ctx = orgAIContext(null);

    const surfaces: [string, () => Promise<{ source: string; error?: string }>][] = [
      ["lead briefing", () => services.getLeadBriefing(lead, ctx.isSolar, ctx)],
      ["live copilot", () => services.getCallCopilot(lead, ctx.isSolar, undefined, ctx)],
      [
        "call summary",
        () =>
          services.getCallSummary(
            lead,
            "appointment_booked",
            ctx.isSolar,
            { notes: "Asked about pricing; agreed to Tuesday 6pm.", durationSec: 214 },
            ctx,
          ),
      ],
      [
        "semantic search",
        () => services.getSemanticSearch("who is worth calling first", leads.slice(0, 12), ctx.isSolar, ctx),
      ],
      [
        "conversation analysis",
        () =>
          services.analyzeConversation({
            transcript:
              "agent: Hi, is this a good time?\nuser: Sure, go ahead.\n" +
              "agent: Could we book a review Tuesday at 6pm?\nuser: Tuesday at six works.",
            lead,
            ctx,
          }),
      ],
      [
        "executive report",
        async () => {
          const { metrics } = await import("@/lib/sample-data");
          return services.getExecutiveReport(metrics, ctx.isSolar, ctx);
        },
      ],
    ];

    console.log("\n  Exercising every AI surface (--full):");
    let failed = 0;
    for (const [name, run] of surfaces) {
      const started = Date.now();
      const res = await run();
      const ms = Date.now() - started;
      if (res.source === "claude") {
        console.log(`    ✓ ${name} — live (${ms}ms)`);
      } else {
        failed++;
        console.log(`    ✗ ${name} — fell back to demo: ${res.error ?? "unknown"}`);
      }
    }
    if (failed) {
      console.log(
        `\n  ${failed} surface(s) fell back to simulated output despite a working key.\n`,
      );
      process.exit(1);
    }
  }

  const degraded = (await pingAI()).degraded;
  if (degraded?.length) {
    console.log(`\n  ! Parameters this deployment can't use: ${degraded.join(", ")}`);
    if (degraded.includes("fast"))
      console.log(
        "    fast — AI_FAST_MODE is on but this org/model has no fast-mode access. " +
          "Requests ran at standard speed; unset AI_FAST_MODE to stop asking.",
      );
    for (const knob of degraded.filter((k) => k !== "fast"))
      console.log(
        `    ${knob} — not accepted by ${process.env.AI_MODEL || "the configured model"}. ` +
          "Everything still works; output quality may be lower than on a current model.",
      );
  }

  console.log("\n  Live Claude intelligence is working.\n");
}

main().catch((e) => {
  console.error("\n  ✗ verify:ai crashed:", e instanceof Error ? e.message : e, "\n");
  process.exit(1);
});

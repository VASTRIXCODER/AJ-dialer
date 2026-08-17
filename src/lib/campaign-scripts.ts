// ─────────────────────────────────────────────────────────────────────────────
// Pure campaign script A/B assignment. No DB or React imports so it can be
// unit-tested directly and imported from both server and client code.
//
// A campaign carries up to two scripts (scriptA / scriptB, empty string =
// unset). When both are set, an A/B test is running: each lead is assigned a
// variant by a deterministic hash of its id, so the SAME homeowner always
// hears the SAME script across attempts — no coin-flip drift between calls.
// ─────────────────────────────────────────────────────────────────────────────

export type ScriptVariant = "a" | "b";

/** The slice of a campaign this module cares about. */
export interface CampaignScripts {
  scriptA: string;
  scriptB: string;
}

/** Same 31-hash idiom as ui/avatar.tsx's toneForSeed — stable per id. */
function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * Which script variant this lead gets on this campaign.
 * - null when the campaign has no scripts (nothing to show);
 * - "a"/"b" when only one script is set (single-script campaign);
 * - deterministic hash of lead.id when both are set (a running A/B test).
 */
export function scriptVariantForLead(
  lead: { id: string },
  campaign: CampaignScripts | null | undefined,
): ScriptVariant | null {
  if (!campaign) return null;
  const hasA = campaign.scriptA.trim().length > 0;
  const hasB = campaign.scriptB.trim().length > 0;
  if (!hasA && !hasB) return null;
  if (hasA && !hasB) return "a";
  if (!hasA && hasB) return "b";
  return hashSeed(lead.id) % 2 === 0 ? "a" : "b";
}

/** The assigned variant's text ("" when no script applies). */
export function scriptTextForVariant(
  campaign: CampaignScripts,
  variant: ScriptVariant | null,
): string {
  if (variant === "a") return campaign.scriptA.trim();
  if (variant === "b") return campaign.scriptB.trim();
  return "";
}

/** Both scripts set ⇒ an A/B test is actively splitting leads. */
export function isScriptTestRunning(campaign: CampaignScripts): boolean {
  return campaign.scriptA.trim().length > 0 && campaign.scriptB.trim().length > 0;
}

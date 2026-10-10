/**
 * The "still open" paragraph, written by a model from facts it is given.
 *
 * The contract, which is the whole reason this is safe to put in front of
 * an owner: pendingFacts() in dailyBrief.ts computes and RANKS the loose
 * ends, and the model only prioritises and phrases them. It is never asked
 * to count anything, and generateLeadershipDigestJson's own prompt says so
 * too ("use ONLY the numbers given — never invent, estimate, or restate a
 * figure that wasn't provided").
 *
 * Three failure modes, all ending in something true on the page:
 *   - no facts        → empty string, and the section is omitted entirely
 *   - no API key      → the deterministic list, which is the same facts in
 *                       plainer words
 *   - the model errs  → the same fallback, and the reason is logged
 *
 * A brief is worth more with a slightly duller paragraph than with none,
 * and worth nothing at all with an invented one.
 */

import "server-only";

import { generateLeadershipDigestJson } from "@/lib/aiLlm.server";
import {
  composePendingFallback,
  pendingFacts,
  pendingFactsBlock,
  type DailyBrief,
} from "@/lib/dailyBrief";

/** Sentences, not bullets: this is read on a phone, in a paragraph. */
function stitch(headline: string, highlights: string[]): string {
  const parts = [headline.trim(), ...highlights.map((h) => h.trim())]
    .filter(Boolean)
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));
  return parts.join(" ");
}

export async function generateBriefPendingNote(
  brief: DailyBrief,
): Promise<string> {
  const facts = pendingFacts(brief);
  // Nothing is open. An AI paragraph inventing something to worry about is
  // exactly what this must not do, so it says nothing.
  if (facts.length === 0) return "";

  const fallback = composePendingFallback(brief);

  try {
    const r = await generateLeadershipDigestJson({
      schoolName: brief.schoolName || "the school",
      // Deliberately labelled as what is UNFINISHED rather than "today's
      // numbers": the same helper serves the KPI digest, and unlabelled
      // facts would come back phrased as achievements.
      metricsSummary: [
        `Unfinished business at the end of ${brief.date}, most urgent first:`,
        pendingFactsBlock(brief),
        "",
        "Write it as what still needs doing. Do not congratulate. Do not add any number that is not listed above.",
      ].join("\n"),
    });
    if (!r.ok) {
      console.warn("[dailyBriefAi] digest unavailable —", r.error);
      return fallback;
    }
    const text = stitch(r.headline, r.highlights);
    // A model that answers with nothing usable is a model that did not
    // answer. The facts still deserve their section.
    if (text.replace(/\s/g, "").length < 20) return fallback;
    return text;
  } catch (e) {
    console.warn(
      "[dailyBriefAi] digest threw —",
      e instanceof Error ? e.message : e,
    );
    return fallback;
  }
}

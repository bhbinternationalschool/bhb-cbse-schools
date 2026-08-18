/**
 * Fire-and-forget report of what a human did with an AI draft — closes the
 * ai_generations loop. Never throws, never blocks the save that triggered
 * it: a failed report is a lost statistic, not a lost remark.
 */
export type AiOutcomeReport = {
  ids: string[];
  outcome: "accepted" | "edited" | "rejected";
  targetType?: string;
  targetId?: string;
};

export function reportAiOutcome(input: AiOutcomeReport): void {
  const ids = input.ids.filter(Boolean);
  if (ids.length === 0 || typeof window === "undefined") return;
  void fetch("/api/ai/generations/outcome", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, ids }),
    keepalive: true,
  }).catch(() => {
    /* statistic only */
  });
}

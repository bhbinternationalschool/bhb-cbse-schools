/**
 * ai_generations — the one place every server-side LLM call is recorded.
 *
 * Written by the router (lib/aiLlm.server.ts) after each provider attempt;
 * updated by /api/ai/generations/outcome when the UI reports what the
 * human did with the draft. Text is never stored — only sha256 hashes of
 * the input and output — because prompts carry student facts and the
 * per-module tables already hold the accepted text with provenance.
 *
 * Writes are best-effort and never block a generation: a failed insert is
 * logged loudly (same rule as audit_events) but the draft still returns.
 */

import { createHash, randomUUID } from "crypto";
import { getServerTenantContext } from "@/lib/serverTenant";

export type AiTier = "flash" | "pro";
export type AiOutcome = "accepted" | "edited" | "rejected";

export type AiGenerationRecord = {
  route: string;
  promptVersion: string;
  tier: AiTier;
  engine: "openai" | "gemini";
  model: string;
  status: "ok" | "error";
  error?: string;
  inputText: string;
  outputText: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs: number;
  requester: string;
};

export function hashAiText(text: string): string {
  return text ? createHash("sha256").update(text).digest("hex").slice(0, 32) : "";
}

export function newAiGenerationId(): string {
  return `aig_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Insert one attempt row. Returns the id (pre-generated, so callers can
 * hand it to the UI even if the insert itself fails). */
export async function recordAiGeneration(
  rec: AiGenerationRecord,
  id: string = newAiGenerationId(),
): Promise<string> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    console.error("[ai_generations] NOT RECORDED — no tenant context:", rec.route);
    return id;
  }
  const { sb, tenantId } = ctx;
  const { error } = await sb.from("ai_generations").insert({
    id,
    tenant_id: tenantId,
    route: rec.route,
    prompt_version: rec.promptVersion,
    tier: rec.tier,
    engine: rec.engine,
    model: rec.model,
    status: rec.status,
    error: (rec.error || "").slice(0, 500),
    input_hash: hashAiText(rec.inputText),
    output_hash: hashAiText(rec.outputText),
    prompt_tokens: rec.promptTokens ?? null,
    completion_tokens: rec.completionTokens ?? null,
    latency_ms: Math.max(0, Math.round(rec.latencyMs)),
    requester: rec.requester || "system",
  });
  if (error) {
    console.error("[ai_generations] NOT RECORDED —", error.message, "|", rec.route);
  }
  return id;
}

/** UI reports what happened to a draft. Only rows of this tenant; unknown
 * ids are a no-op (the row may have failed to insert). */
export async function setAiGenerationOutcome(input: {
  id: string;
  outcome: AiOutcome;
  targetType?: string;
  targetId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { sb, tenantId } = ctx;
  const { error } = await sb
    .from("ai_generations")
    .update({
      outcome: input.outcome,
      outcome_at: new Date().toISOString(),
      target_type: (input.targetType || "").slice(0, 60),
      target_id: (input.targetId || "").slice(0, 120),
    })
    .eq("tenant_id", tenantId)
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

import "server-only";

/**
 * Server side of the admissions knowledge base: index the office-approved
 * entries (module_local_state "admissions_kb") into school_kb_chunks with
 * audience "prospects", retrieve them for a prospective parent's question,
 * and answer ONLY from what was retrieved (grounding gate — ungrounded
 * answers never reach the parent). Unanswered questions are kept in a
 * server-only module state ("admissions_kb_gaps") for the office to turn
 * into new entries.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { embedText, embeddingsConfigured } from "@/lib/embeddings.server";
import { admissionsKbChunks, emptyAdmissionsKb, normalizeAdmissionsKb, type AdmissionsKbState } from "@/lib/admissionsKb";
import { retrieveRelevantKb, type KbMatch, invalidateKbPresence } from "@/lib/schoolKb.server";
import { generateAdmissionsAnswerJson, type LlmEngine } from "@/lib/aiLlm.server";
import { TENANT } from "@/lib/types";
import { sarvamConfigured, sarvamTranslate } from "@/lib/sarvam.server";

const MODULE_KEY = "admissions_kb";
const GAPS_KEY = "admissions_kb_gaps";
const SOURCE_TYPE = "admissions_kb";
export const PROSPECT_AUDIENCE = "prospects";
const GAPS_MAX = 200;

export async function readAdmissionsKbState(): Promise<AdmissionsKbState> {
  const ctx = await getServerTenantContext();
  if (!ctx) return emptyAdmissionsKb();
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", MODULE_KEY)
    .maybeSingle();
  if (error || !data?.state) return emptyAdmissionsKb();
  return normalizeAdmissionsKb(data.state);
}

/** Embeds and upserts every live entry; removes chunks for entries that are gone or no longer live. */
export async function indexAdmissionsKb(): Promise<
  { ok: true; indexed: number; skipped: number; removed: number } | { ok: false; error: string }
> {
  if (!embeddingsConfigured()) return { ok: false, error: "OPENAI_API_KEY not configured — embeddings need it" };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { sb, tenantId } = ctx;
  const state = await readAdmissionsKbState();
  const chunks = admissionsKbChunks(state);
  let indexed = 0;
  let skipped = 0;
  for (const c of chunks) {
    const emb = await embedText(c.content);
    if (!emb.ok) {
      console.warn("[admissionsKb] embed failed", c.id, emb.error);
      skipped += 1;
      continue;
    }
    const { error } = await sb.from("school_kb_chunks").upsert(
      {
        tenant_id: tenantId,
        source_type: SOURCE_TYPE,
        source_id: c.id,
        chunk_index: 0,
        title: c.title,
        content: c.content,
        audience: PROSPECT_AUDIENCE,
        source_published_at: new Date().toISOString(),
        embedding: emb.vector,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,source_type,source_id,chunk_index" },
    );
    if (error) {
      console.warn("[admissionsKb] upsert failed", c.id, error.message);
      skipped += 1;
      continue;
    }
    indexed += 1;
  }
  const live = new Set(chunks.map((c) => c.id));
  const { data: rows } = await sb
    .from("school_kb_chunks")
    .select("id, source_id")
    .eq("tenant_id", tenantId)
    .eq("source_type", SOURCE_TYPE);
  const stale = (rows || []).filter((r) => !live.has(String(r.source_id))).map((r) => r.id as string);
  let removed = 0;
  if (stale.length) {
    const { error } = await sb.from("school_kb_chunks").delete().in("id", stale);
    if (!error) removed = stale.length;
  }
  invalidateKbPresence();
  return { ok: true, indexed, skipped, removed };
}

export async function admissionsKbIndexedCount(): Promise<number> {
  const ctx = await getServerTenantContext();
  if (!ctx) return 0;
  const { count } = await ctx.sb
    .from("school_kb_chunks")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("source_type", SOURCE_TYPE);
  return count || 0;
}

/* ─── Gaps (questions the KB could not answer) ─────────────────────── */

export type KbGap = { id: string; question: string; channel: string; at: string; count: number };

type GapsState = { version: 1; gaps: KbGap[] };

function normGaps(raw: unknown): GapsState {
  const r = (raw ?? {}) as Partial<GapsState>;
  const gaps = Array.isArray(r.gaps)
    ? r.gaps
        .map((g) => {
          const x = (g ?? {}) as Partial<KbGap>;
          const question = String(x.question ?? "").trim().slice(0, 300);
          if (!question) return null;
          return {
            id: String(x.id ?? "").slice(0, 40) || `gap_${Math.random().toString(36).slice(2, 10)}`,
            question,
            channel: String(x.channel ?? "").slice(0, 20),
            at: String(x.at ?? "").slice(0, 40),
            count: Math.max(1, Math.floor(Number(x.count) || 1)),
          };
        })
        .filter((g): g is KbGap => !!g)
    : [];
  return { version: 1, gaps };
}

export async function listKbGaps(): Promise<KbGap[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", GAPS_KEY)
    .maybeSingle();
  return normGaps(data?.state).gaps.sort((a, b) => b.at.localeCompare(a.at));
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** Merge-write: same question (normalised) bumps count instead of duplicating. */
export async function recordKbGap(question: string, channel: string): Promise<void> {
  const q = question.trim().slice(0, 300);
  if (q.length < 4) return;
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const cur = await listKbGaps();
  const key = norm(q);
  const now = new Date().toISOString();
  const hit = cur.find((g) => norm(g.question) === key);
  const next = hit
    ? cur.map((g) => (g.id === hit.id ? { ...g, at: now, count: g.count + 1 } : g))
    : [{ id: `gap_${Math.random().toString(36).slice(2, 10)}`, question: q, channel, at: now, count: 1 }, ...cur];
  const state: GapsState = { version: 1, gaps: next.slice(0, GAPS_MAX) };
  const { error } = await ctx.sb.from("module_local_state").upsert(
    { tenant_id: ctx.tenantId, module_key: GAPS_KEY, state, updated_at: now },
    { onConflict: "tenant_id,module_key" },
  );
  if (error) console.warn("[admissionsKb] gap write failed", error.message);
}

export async function clearKbGap(id: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const cur = await listKbGaps();
  const state: GapsState = { version: 1, gaps: cur.filter((g) => g.id !== id) };
  await ctx.sb.from("module_local_state").upsert(
    { tenant_id: ctx.tenantId, module_key: GAPS_KEY, state, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,module_key" },
  );
}

/* ─── Answering ────────────────────────────────────────────────────── */

export type AdmissionsAnswer = {
  grounded: boolean;
  reply: string;
  /** KB entry ids the answer drew on (empty when ungrounded) */
  sources: { id: string; title: string }[];
  engine: LlmEngine;
  generationId: string;
  matches: number;
};

export const HANDOFF_TEXT =
  "I don't have that on record. Reply *HUMAN* and the admissions office will call you back, or visit the school office.";

/**
 * Answer a prospective parent's question from the admissions KB only.
 * No matches → not grounded, no model call. Model says ungrounded → its
 * words are discarded. Either way an ungrounded question is logged as a gap.
 */
export async function answerAdmissionsQuestion(opts: {
  question: string;
  channel: "wa" | "widget" | "staff_test";
  language?: "en" | "hi";
  lead?: { childName: string; enquiryNo: string; stageLabel: string } | null;
  registerUrl?: string;
}): Promise<AdmissionsAnswer> {
  const question = opts.question.trim().slice(0, 600);
  // Entries are English; a Devanagari / Urdu / Bengali question embeds far
  // from them. Retrieve with an English rendering of the question (Sarvam)
  // and let the model answer in the parent's language. Fails open to the
  // original text when translation is unavailable.
  let retrievalQuery = question;
  let detectedHindi = false;
  if (/[\u0900-\u097F]/.test(question)) detectedHindi = true;
  if (/[\u0900-\u097F\u0600-\u06FF\u0980-\u09FF]/.test(question) && sarvamConfigured()) {
    const from = /[\u0600-\u06FF]/.test(question) ? "ur-IN" : /[\u0980-\u09FF]/.test(question) ? "bn-IN" : "hi-IN";
    const t = await sarvamTranslate({ text: question, from, to: "en-IN", mode: "formal" });
    if (t.ok && t.text.trim()) retrievalQuery = t.text.trim();
    else console.warn("[admissionsKb] query translate failed", t.ok ? "empty" : t.error);
  }
  const language = opts.language ?? (detectedHindi ? "hi" : "en");
  const matches: KbMatch[] = await retrieveRelevantKb(retrievalQuery, { audiences: [PROSPECT_AUDIENCE], limit: 5 });
  if (matches.length === 0) {
    if (opts.channel !== "staff_test") await recordKbGap(question, opts.channel);
    return { grounded: false, reply: HANDOFF_TEXT, sources: [], engine: "none", generationId: "", matches: 0 };
  }
  const facts = matches.map((m, i) => `[${i + 1}] ${m.title}\n${m.content}`).join("\n\n");
  const system = `You answer prospective parents' questions for ${TENANT.nameDisplay} admissions on WhatsApp/chat.
You may state ONLY facts that appear in the numbered KB entries below. Fees, dates, documents, seats, transport, policies: if the entries do not say it, you do not know it — never guess, never use general knowledge about schools.
Keep the reply under 500 characters, warm, plain text (no markdown headers; *bold* is fine), in ${language === "hi" ? "simple Hindi (Devanagari)" : "simple English"}.
If the question is partly answered, answer that part and say the office will confirm the rest.${opts.registerUrl ? `\nRegistration link you may share: ${opts.registerUrl}` : ""}

KB entries:
${facts}`;
  const userMessage = `${
    opts.lead ? `Enquiry on file: ${opts.lead.childName || "child"} · ${opts.lead.enquiryNo} · stage ${opts.lead.stageLabel}\n` : ""
  }Parent's question: "${question}"`;
  const r = await generateAdmissionsAnswerJson({ system, userMessage });
  if (!r.ok) {
    return { grounded: false, reply: HANDOFF_TEXT, sources: [], engine: r.engine, generationId: "", matches: matches.length };
  }
  if (!r.grounded || !r.reply) {
    if (opts.channel !== "staff_test") await recordKbGap(question, opts.channel);
    return { grounded: false, reply: HANDOFF_TEXT, sources: [], engine: r.engine, generationId: r.generationId, matches: matches.length };
  }
  const used = r.sources.length ? r.sources : matches.map((_, i) => i + 1);
  const sources = used
    .map((n) => matches[n - 1])
    .filter((m): m is KbMatch => !!m)
    .map((m) => ({ id: m.sourceId, title: m.title }));
  return { grounded: true, reply: r.reply, sources, engine: r.engine, generationId: r.generationId, matches: matches.length };
}

import "server-only";

/**
 * The answer book: capturing what was asked, and publishing what the school
 * approves. See answerBook.ts and the migration for why it is a book rather
 * than a trained model.
 *
 * Publishing writes into school_kb_chunks, which the parent bot ALREADY
 * searches before it answers — so an approved answer starts being used with
 * no change to the bot's reply path at all. Retiring or expiring an entry
 * takes the chunk back out, which is the part a fine-tune could never do.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { embedText, embeddingsConfigured } from "@/lib/embeddings.server";
import { invalidateKbPresence } from "@/lib/schoolKb.server";
import {
  ANSWER_MAX,
  QUESTION_MAX,
  entryIsLive,
  kbChunkFor,
  questionKey,
  tidy,
  type AnswerEntry,
} from "@/lib/answerBook";

const KB_SOURCE = "answer_book";

type Row = {
  id: string;
  question: string;
  variants: string[] | null;
  answer: string;
  language: string;
  category: string;
  status: string;
  source: string;
  source_ref: string;
  valid_until: string | null;
  asked_count: number;
  approved_by: string;
  approved_at: string | null;
  updated_at: string;
};

function toEntry(r: Row): AnswerEntry {
  return {
    id: r.id,
    question: r.question,
    variants: Array.isArray(r.variants) ? r.variants : [],
    answer: r.answer || "",
    language: (r.language === "hi" || r.language === "en" ? r.language : "both"),
    category: r.category || "general",
    status: (r.status === "approved" || r.status === "retired" ? r.status : "proposed"),
    source: (r.source === "office_reply" || r.source === "unanswered" ? r.source : "written"),
    sourceRef: r.source_ref || "",
    validUntil: r.valid_until,
    askedCount: Number(r.asked_count) || 1,
    approvedBy: r.approved_by || "",
    approvedAt: r.approved_at,
    updatedAt: r.updated_at,
  };
}

export async function listAnswerBook(opts: { status?: string } = {}): Promise<AnswerEntry[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  let q = ctx.sb
    .from("wa_answer_book")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) {
    console.warn("[answerBook] list failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => toEntry(r as Row));
}

/**
 * Record a question and, when there is one, the answer somebody gave it.
 *
 * Always PROPOSED: nothing captured from a chat answers anybody until it has
 * been approved. Asking the same thing again raises the count on the entry
 * that is already there rather than filling the book with duplicates.
 */
export async function captureAnswerPair(input: {
  question: string;
  answer?: string;
  category?: string;
  source: "office_reply" | "unanswered";
  sourceRef?: string;
}): Promise<{ ok: boolean; id?: string; merged?: boolean; error?: string }> {
  const question = tidy(input.question, QUESTION_MAX);
  if (!question) return { ok: false, error: "no question" };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "no database" };

  const key = questionKey(question);
  const { data: existing, error: readErr } = await ctx.sb
    .from("wa_answer_book")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .neq("status", "retired")
    .limit(500);
  if (readErr) {
    // Unreadable is not empty: writing now would duplicate an entry someone
    // has already approved, and a second copy can disagree with the first.
    console.warn("[answerBook] capture read failed", readErr.message);
    return { ok: false, error: readErr.message };
  }
  const match = (existing ?? [])
    .map((r) => toEntry(r as Row))
    .find((e) => questionKey(e.question) === key || e.variants.some((v) => questionKey(v) === key));

  const answer = tidy(input.answer, ANSWER_MAX);
  if (match) {
    const variants = question.toLowerCase() === match.question.toLowerCase()
      ? match.variants
      : [...new Set([...match.variants, question])].slice(0, 12);
    const patch: Record<string, unknown> = {
      asked_count: match.askedCount + 1,
      variants,
      updated_at: new Date().toISOString(),
    };
    // An answer only fills a blank. An approved answer is never overwritten
    // by the next thing somebody happens to type into WhatsApp.
    if (answer && !tidy(match.answer, ANSWER_MAX) && match.status !== "approved") {
      patch.answer = answer;
      patch.source = input.source;
      patch.source_ref = tidy(input.sourceRef, 120);
    }
    const { error } = await ctx.sb
      .from("wa_answer_book")
      .update(patch)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", match.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: match.id, merged: true };
  }

  const { data, error } = await ctx.sb
    .from("wa_answer_book")
    .insert({
      tenant_id: ctx.tenantId,
      question,
      answer,
      category: tidy(input.category, 40) || "general",
      status: "proposed",
      source: input.source,
      source_ref: tidy(input.sourceRef, 120),
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id as string | undefined };
}

/** Write or change an entry by hand, from the desk. Never approves. */
export async function saveAnswerEntry(input: {
  id?: string;
  question: string;
  answer: string;
  category?: string;
  language?: string;
  validUntil?: string | null;
  by: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "no database" };
  const question = tidy(input.question, QUESTION_MAX);
  if (!question) return { ok: false, error: "A question is needed" };
  const row = {
    question,
    answer: tidy(input.answer, ANSWER_MAX),
    category: tidy(input.category, 40) || "general",
    language: input.language === "hi" || input.language === "en" ? input.language : "both",
    valid_until: input.validUntil || null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await ctx.sb
      .from("wa_answer_book")
      .update(row)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    // The words changed, so what is on the shelf is now the old words.
    await republish(input.id);
    return { ok: true, id: input.id };
  }
  const { data, error } = await ctx.sb
    .from("wa_answer_book")
    .insert({
      tenant_id: ctx.tenantId,
      ...row,
      status: "proposed",
      source: "written",
      created_by: tidy(input.by, 120),
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id as string | undefined };
}

/**
 * Approve an entry and put it on the shelf the bot reads.
 *
 * The embedding is what makes it findable; without one the entry is stored
 * but silent, so a failure here is reported rather than swallowed — an
 * approval that quietly did nothing is the worst outcome for the person who
 * pressed the button and now believes parents are being answered.
 */
export async function approveAnswerEntry(input: {
  id: string;
  by: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "no database" };
  const { data, error } = await ctx.sb
    .from("wa_answer_book")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.id)
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message || "Not found" };
  const entry = toEntry(data as Row);
  if (!tidy(entry.answer, ANSWER_MAX)) {
    return { ok: false, error: "Write the answer before approving it" };
  }

  const { error: upErr } = await ctx.sb
    .from("wa_answer_book")
    .update({
      status: "approved",
      approved_by: tidy(input.by, 120),
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.id);
  if (upErr) return { ok: false, error: upErr.message };

  const published = await republish(input.id);
  if (!published.ok) return { ok: false, error: `Approved, but not searchable yet: ${published.error}` };
  return { ok: true };
}

export async function retireAnswerEntry(input: { id: string }): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "no database" };
  const { error } = await ctx.sb
    .from("wa_answer_book")
    .update({ status: "retired", updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await removeChunk(input.id);
  return { ok: true };
}

/**
 * Put an entry on the shelf, or take it off — whichever its state now says.
 *
 * Also the expiry sweep's one job: an entry whose date has passed is no
 * longer live, so its chunk goes, and the bot stops finding it.
 */
export async function republish(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "no database" };
  const { data, error } = await ctx.sb
    .from("wa_answer_book")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message || "Not found" };
  const entry = toEntry(data as Row);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (!entryIsLive(entry, today)) {
    await removeChunk(id);
    return { ok: true };
  }
  if (!embeddingsConfigured()) {
    return { ok: false, error: "OPENAI_API_KEY is not set, so nothing can be searched" };
  }
  const chunk = kbChunkFor(entry);
  const embedding = await embedText(`${chunk.title}\n\n${chunk.content}`);
  if (!embedding.ok) return { ok: false, error: embedding.error };
  const { error: kbErr } = await ctx.sb.from("school_kb_chunks").upsert(
    {
      tenant_id: ctx.tenantId,
      source_type: KB_SOURCE,
      source_id: id,
      chunk_index: 0,
      title: chunk.title,
      content: chunk.content,
      audience: "parents",
      source_published_at: entry.approvedAt || new Date().toISOString(),
      embedding: embedding.vector,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,source_type,source_id,chunk_index" },
  );
  if (kbErr) return { ok: false, error: kbErr.message };
  invalidateKbPresence();
  return { ok: true };
}

async function removeChunk(id: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const { error } = await ctx.sb
    .from("school_kb_chunks")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("source_type", KB_SOURCE)
    .eq("source_id", id);
  if (error) console.warn("[answerBook] could not remove chunk", error.message);
  else invalidateKbPresence();
}

/**
 * Nightly: take down every answer whose date has passed.
 *
 * Without this an entry expires only in the rules and stays on the shelf —
 * findable, quotable, and wrong.
 */
export async function sweepExpiredAnswers(todayIso: string): Promise<{ checked: number; removed: number }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { checked: 0, removed: 0 };
  const { data, error } = await ctx.sb
    .from("wa_answer_book")
    .select("id, valid_until, status, answer")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "approved")
    .not("valid_until", "is", null);
  if (error) {
    console.warn("[answerBook] expiry sweep read failed", error.message);
    return { checked: 0, removed: 0 };
  }
  let removed = 0;
  for (const r of (data ?? []) as { id: string; valid_until: string | null; status: string; answer: string }[]) {
    if (r.valid_until && r.valid_until < todayIso) {
      await removeChunk(r.id);
      removed += 1;
    }
  }
  return { checked: (data ?? []).length, removed };
}

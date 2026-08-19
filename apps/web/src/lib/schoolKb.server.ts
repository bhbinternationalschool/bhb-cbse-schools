/**
 * RAG over the school corpus (§5.1 item 5) — indexes published notices
 * into school_kb_chunks (pgvector) and retrieves the closest matches to
 * ground the ERP AI chatbot and the WhatsApp parent bot. Only notices
 * are indexed today — policies/fee circulars/CBSE circulars have no
 * structured source in this codebase yet to embed.
 *
 * Indexing is staff-triggered (a "Sync to AI" action), not automatic on
 * publish — keeps this additive and out of the notices save/desk-sync
 * path entirely.
 */
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchSchoolCommsDeskFromDb } from "@/lib/schoolCommsNormalized.server";
import type { CommsAudience, SchoolNotice } from "@/lib/schoolComms";
import { embedText, embeddingsConfigured } from "@/lib/embeddings.server";

export type KbMatch = {
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  similarity: number;
};

// text-embedding-3-small cosine similarities run lower than intuition
// suggests — a genuinely relevant short-notice match measured 0.65 in
// testing, so a 0.72 floor silently dropped every real match. 0.45 still
// excludes unrelated content while keeping true matches.
const MIN_SIMILARITY = 0.45;

function noticeContent(n: SchoolNotice): string {
  return `${n.title}\n\n${n.body}`.trim();
}

/** Embeds and upserts every currently-published notice. Chunking is a
 * no-op today (one chunk per notice) — notices are short; this is the
 * seam to split at if a future source type needs it. */
export async function indexPublishedNotices(): Promise<
  | { ok: true; indexed: number; skipped: number; removed: number }
  | { ok: false; error: string }
> {
  if (!embeddingsConfigured()) {
    return { ok: false, error: "OPENAI_API_KEY not configured — embeddings need it" };
  }
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { sb, tenantId } = ctx;

  const { bundle, ok } = await fetchSchoolCommsDeskFromDb();
  if (!ok) return { ok: false, error: "Failed to read notices" };

  const published = bundle.notices.filter((n) => n.status === "published");
  let indexed = 0;
  let skipped = 0;

  for (const notice of published) {
    const content = noticeContent(notice);
    if (!content) {
      skipped += 1;
      continue;
    }
    const emb = await embedText(content);
    if (!emb.ok) {
      console.warn("[schoolKb] embed failed for notice", notice.id, emb.error);
      skipped += 1;
      continue;
    }
    const { error } = await sb.from("school_kb_chunks").upsert(
      {
        tenant_id: tenantId,
        source_type: "notice",
        source_id: notice.id,
        chunk_index: 0,
        title: notice.title,
        content,
        audience: notice.audience,
        source_published_at: notice.publishedAt || notice.createdAt || null,
        embedding: emb.vector,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,source_type,source_id,chunk_index" },
    );
    if (error) {
      console.warn("[schoolKb] upsert failed for notice", notice.id, error.message);
      skipped += 1;
      continue;
    }
    indexed += 1;
  }

  const publishedIds = new Set(published.map((n) => n.id));
  const { data: existingRows } = await sb
    .from("school_kb_chunks")
    .select("id, source_id")
    .eq("tenant_id", tenantId)
    .eq("source_type", "notice");
  const staleIds = (existingRows || [])
    .filter((r) => !publishedIds.has(String(r.source_id)))
    .map((r) => r.id as string);
  let removed = 0;
  if (staleIds.length > 0) {
    const { error } = await sb.from("school_kb_chunks").delete().in("id", staleIds);
    if (!error) removed = staleIds.length;
  }

  return { ok: true, indexed, skipped, removed };
}

export async function schoolKbStats(): Promise<{
  chunkCount: number;
  embeddingsConfigured: boolean;
}> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { chunkCount: 0, embeddingsConfigured: embeddingsConfigured() };
  const { sb, tenantId } = ctx;
  const { count } = await sb
    .from("school_kb_chunks")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  return { chunkCount: count || 0, embeddingsConfigured: embeddingsConfigured() };
}

/**
 * Retrieves the closest indexed notice chunks to a query. Fails open —
 * an embedding/DB error returns an empty match list, never throws, so a
 * bot's reply flow degrades to its pre-RAG behavior rather than breaking.
 */
export async function retrieveRelevantKb(
  query: string,
  // Audience strings beyond CommsAudience exist for non-notice sources
  // (e.g. "prospects" for the admissions KB) — the RPC filters by string.
  opts?: { audiences?: (CommsAudience | string)[]; limit?: number },
): Promise<KbMatch[]> {
  try {
    if (!embeddingsConfigured()) return [];
    const ctx = await getServerTenantContext();
    if (!ctx) return [];
    const { sb, tenantId } = ctx;

    const emb = await embedText(query);
    if (!emb.ok) return [];

    const { data, error } = await sb.rpc("match_school_kb_chunks", {
      query_embedding: emb.vector,
      match_tenant_id: tenantId,
      match_audiences: opts?.audiences?.length ? opts.audiences : null,
      match_count: opts?.limit ?? 4,
    });
    if (error) {
      console.warn("[schoolKb] retrieval failed", error.message);
      return [];
    }
    return ((data || []) as {
      source_type: string;
      source_id: string;
      title: string;
      content: string;
      similarity: number;
    }[])
      .filter((r) => r.similarity >= MIN_SIMILARITY)
      .map((r) => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        title: r.title,
        content: r.content,
        similarity: r.similarity,
      }));
  } catch (e) {
    console.warn("[schoolKb] retrieveRelevantKb threw", e);
    return [];
  }
}

/** Formats matches as a prompt-ready block, or "" when there are none. */
export function formatKbContext(matches: KbMatch[]): string {
  if (matches.length === 0) return "";
  return matches
    .map((m, i) => `[Notice ${i + 1}: ${m.title}]\n${m.content}`)
    .join("\n\n");
}

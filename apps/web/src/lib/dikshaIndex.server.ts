/**
 * Sync the NCERT chapter index from DIKSHA (rules: dikshaIndex.ts, tables:
 * migration 20260916140000). Weekly from Cloud Scheduler; a full first run
 * reads 87 books — about 26 MB of hierarchy — in under half a minute.
 *
 * Each changed book is written through diksha_replace_textbook(), one
 * transaction per book, so a failure part-way leaves every book either as it
 * was or fully rewritten. A dry run reads DIKSHA and the stored index and
 * reports what it would write, writing nothing.
 */
import "server-only";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  DIKSHA_HIERARCHY_URL,
  DIKSHA_SEARCH_URL,
  needsRefetch,
  parseTextbookHierarchy,
  selectCurrentTextbooks,
  textbookSearchBody,
  textbooksToRetire,
  type DikshaTextbookHit,
  type IndexTextbook,
  type StoredTextbook,
} from "@/lib/dikshaIndex";

const HIERARCHY_CONCURRENCY = 4;

export type DikshaIndexSyncResult = {
  dryRun: boolean;
  catalogue: { listed: number; read: number; complete: boolean };
  selected: number;
  written: { id: string; grade: number; medium: string; name: string; chapters: number; resources: number }[];
  unchanged: number;
  failed: { id: string; name: string; error: string }[];
  retired: string[];
  retireRefused: string | null;
  byGrade: Record<string, { books: number; chapters: number }>;
};

export async function syncDikshaIndex(opts: { dryRun?: boolean; force?: boolean } = {}): Promise<DikshaIndexSyncResult> {
  const dryRun = !!opts.dryRun;
  const ctx = await getServerTenantContext();
  if (!ctx && !dryRun) throw new Error("No database: the chapter index cannot be written");

  const catalogue = await readCatalogue();
  const books = selectCurrentTextbooks(catalogue.hits);

  let stored: StoredTextbook[] = [];
  if (ctx) {
    const read = await fetchAllPages<StoredTextbook>((from, to) =>
      ctx.sb
        .from("diksha_textbooks")
        .select("id, published_at, chapter_count, retired_at")
        .eq("tenant_id", ctx.tenantId)
        .order("id", { ascending: true })
        .range(from, to),
    );
    // Not knowing what is stored must not read as "nothing stored": every
    // book would be refetched and, worse, none could ever be retired.
    if (read.error) throw new Error(`diksha_textbooks not readable: ${read.error}`);
    stored = read.rows;
  }
  const storedById = new Map(stored.map((s) => [s.id, s]));

  const result: DikshaIndexSyncResult = {
    dryRun,
    catalogue: { listed: catalogue.listed, read: catalogue.hits.length, complete: catalogue.complete },
    selected: books.length,
    written: [],
    unchanged: 0,
    failed: [],
    retired: [],
    retireRefused: null,
    byGrade: {},
  };

  const queue = books.filter((b) => {
    if (needsRefetch(storedById.get(b.id), b, opts.force)) return true;
    result.unchanged += 1;
    return false;
  });

  await Promise.all(
    Array.from({ length: HIERARCHY_CONCURRENCY }, async () => {
      for (let book = queue.shift(); book; book = queue.shift()) {
        await syncOne(book, ctx, dryRun, result);
      }
    }),
  );

  const retire = textbooksToRetire(stored, books, catalogue.complete);
  result.retireRefused = retire.refused;
  if (retire.refused) console.warn("[diksha-index] not retiring:", retire.refused);
  if (retire.ids.length && ctx && !dryRun) {
    const { error } = await ctx.sb
      .from("diksha_textbooks")
      .update({ retired_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .in("id", retire.ids);
    if (error) result.failed.push({ id: "(retire)", name: retire.ids.join(", "), error: error.message });
    else result.retired = retire.ids;
  } else if (dryRun) {
    result.retired = retire.ids;
  }

  for (const b of result.written) {
    const g = (result.byGrade[`Class ${b.grade}`] ??= { books: 0, chapters: 0 });
    g.books += 1;
    g.chapters += b.chapters;
  }
  result.written.sort((a, b) => a.grade - b.grade || a.medium.localeCompare(b.medium) || a.name.localeCompare(b.name));
  return result;
}

async function readCatalogue(): Promise<{ hits: DikshaTextbookHit[]; listed: number; complete: boolean }> {
  const hits: DikshaTextbookHit[] = [];
  let listed = 0;
  for (let offset = 0; offset === 0 || offset < listed; offset += 100) {
    const res = await fetch(DIKSHA_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(textbookSearchBody(offset)),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { result?: { count?: number; content?: DikshaTextbookHit[] } };
    if (!res.ok || typeof json.result?.count !== "number") {
      // The first page is the whole job; a later page failing only makes the
      // catalogue incomplete, which stops retirement but not the update.
      if (offset === 0) throw new Error(`DIKSHA search failed: HTTP ${res.status}`);
      break;
    }
    listed = json.result.count;
    const page = json.result.content ?? [];
    hits.push(...page);
    if (!page.length) break;
  }
  return { hits, listed, complete: listed > 0 && hits.length >= listed };
}

async function syncOne(
  book: IndexTextbook,
  ctx: Awaited<ReturnType<typeof getServerTenantContext>>,
  dryRun: boolean,
  result: DikshaIndexSyncResult,
): Promise<void> {
  try {
    const res = await fetch(DIKSHA_HIERARCHY_URL + encodeURIComponent(book.id), { signal: AbortSignal.timeout(45_000) });
    const json = (await res.json().catch(() => ({}))) as { result?: { content?: Parameters<typeof parseTextbookHierarchy>[1] } };
    const content = json.result?.content;
    if (!res.ok || !content) throw new Error(`hierarchy HTTP ${res.status}`);
    const payload = parseTextbookHierarchy(book, content);
    // A book DIKSHA serves with no chapters is a broken read, not a book to
    // empty — keep what is stored.
    if (!payload.chapters.length) throw new Error("DIKSHA returned the book with no chapters");

    if (!dryRun && ctx) {
      const { error } = await ctx.sb.rpc("diksha_replace_textbook", {
        p_tenant_id: ctx.tenantId,
        p_textbook: payload.textbook,
        p_chapters: payload.chapters,
        p_resources: payload.resources,
      });
      if (error) throw new Error(`not saved (nothing changed): ${error.message}`);
    }
    result.written.push({
      id: book.id,
      grade: book.grade,
      medium: book.medium,
      name: book.name,
      chapters: payload.chapters.length,
      resources: payload.resources.length,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[diksha-index] ${book.id} ${book.name}:`, error);
    result.failed.push({ id: book.id, name: book.name, error });
  }
}

import "server-only";

/**
 * The Smart Teach asset index (lib/pinnacleAssets.ts) in module_local_state,
 * and the lookup every teacher screen uses: class + subject + chapter
 * positions → that chapter's publisher assets. Reads return null when the
 * store cannot be read — unknown is never "no assets".
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { indexGrade, subjectKeyFor } from "@/lib/tutorSyllabus";
import { schoolBooksForClass } from "@/lib/tutorSyllabus.server";
import { assetsForChapter, type ChapterAssets, type PinnacleAssetBook } from "@/lib/pinnacleAssets";

export const PINNACLE_ASSETS_KEY = "pinnacle_assets";

export type PinnacleAssetState = { books: PinnacleAssetBook[]; fetchedAt: string; fetchedBy: string };

export async function readPinnacleAssets(): Promise<PinnacleAssetState | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", PINNACLE_ASSETS_KEY)
    .maybeSingle();
  if (error) return null;
  const st = (data?.state ?? {}) as Partial<PinnacleAssetState>;
  return {
    books: Array.isArray(st.books) ? st.books : [],
    fetchedAt: String(st.fetchedAt || ""),
    fetchedBy: String(st.fetchedBy || ""),
  };
}

/**
 * Keep the robot's scan. Books it read replace their earlier entries; books
 * it did not read this time (a scan stopped half-way) are kept, never dropped.
 */
export async function writePinnacleAssets(
  books: PinnacleAssetBook[],
  by: string,
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const prev = await readPinnacleAssets();
  if (!prev) return { ok: false, error: "Could not read the earlier asset list — nothing was replaced." };
  const fresh = new Set(books.map((b) => b.bookId));
  const merged = [...prev.books.filter((b) => !fresh.has(b.bookId)), ...books];
  const now = new Date().toISOString();
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        module_key: PINNACLE_ASSETS_KEY,
        state: { books: merged, fetchedAt: now, fetchedBy: by },
        updated_at: now,
      },
      { onConflict: "tenant_id,module_key" },
    );
  return error ? { ok: false, error: error.message } : { ok: true, total: merged.length };
}

/**
 * Publisher assets for chapters of one class + subject, keyed by chapter
 * position in the school's book. Positions without assets are absent. Empty
 * when the class, subject or index is unknown — the screens then show nothing.
 */
export async function publisherAssetsFor(
  className: string,
  subjectName: string,
  positions: number[] | "all",
  index?: PinnacleAssetBook[] | null,
): Promise<Map<number, ChapterAssets>> {
  const out = new Map<number, ChapterAssets>();
  const grade = indexGrade(className);
  const asked = subjectKeyFor(subjectName);
  if (grade === null || !asked) return out;
  const books = index ?? (await readPinnacleAssets())?.books ?? [];
  // Classes 1–5 may call Social Studies "EVS / World Around Us" in Masters;
  // its Smart Teach book is New Longman Vistas, indexed as social (as
  // lib/smartTeach does).
  const key = [asked, ...(asked === "evs" && grade <= 5 ? ["social"] : [])].find((k) =>
    books.some((b) => b.grade === grade && b.subjectKey === k),
  );
  if (!key) return out;
  const school = await schoolBooksForClass(className);
  const book = school.books.find((b) => b.subjects.some((s) => subjectKeyFor(s) === key));
  const chapters = book ? school.chapters.filter((c) => c.textbookId === book.id) : [];
  const want = positions === "all" ? chapters.map((c) => c.position) : positions;
  for (const p of want) {
    const name = chapters.find((c) => c.position === p)?.name ?? "";
    const hit = assetsForChapter(books, grade, key, name, p);
    if (hit) out.set(p, hit);
  }
  return out;
}

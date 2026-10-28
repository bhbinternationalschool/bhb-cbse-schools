import "server-only";

/**
 * Server reads for the Office Robot's Propel panel (lib/propelRobot.ts).
 * Every reader returns null when a read fails — unknown is never "nothing".
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  addProgressSnapshot,
  type PropelBook,
  type PropelProgressRecord,
  type PropelProgressSnapshot,
  type PropelTestRecord,
} from "@/lib/propelRobot";

export const PROPEL_TESTS_KEY = "propel_tests";
export const PROPEL_PROGRESS_KEY = "propel_teacher_progress";
export const PROPEL_BOOKS_KEY = "propel_books";
/** Pinnacle Smart Teach's full book contents as of the last check. */
export const PINNACLE_BOOKS_KEY = "pinnacle_books";

/** A book list as of the last check (Propel's pre-primary units by default,
 * or Pinnacle's books); null = read failed. */
export async function readPropelBooks(key: string = PROPEL_BOOKS_KEY): Promise<PropelBook[] | "none" | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", key)
    .maybeSingle();
  if (error) return null;
  const books = (data?.state as { books?: unknown } | null)?.books;
  return Array.isArray(books) ? (books as PropelBook[]) : "none";
}

export async function writePropelBooks(
  books: PropelBook[],
  by: string,
  key: string = PROPEL_BOOKS_KEY,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const now = new Date().toISOString();
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert(
      { tenant_id: ctx.tenantId, module_key: key, state: { books, fetchedAt: now, fetchedBy: by }, updated_at: now },
      { onConflict: "tenant_id,module_key" },
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export type PropelProgressState = {
  rows: PropelProgressRecord[];
  history: PropelProgressSnapshot[];
  fetchedAt: string;
  fetchedBy: string;
};

/** Teacher progress as last brought in by the robot; null = read failed. */
export async function readPropelProgress(): Promise<PropelProgressState | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", PROPEL_PROGRESS_KEY)
    .maybeSingle();
  if (error) return null;
  const st = (data?.state ?? {}) as Partial<PropelProgressState>;
  return {
    rows: Array.isArray(st.rows) ? st.rows : [],
    history: Array.isArray(st.history) ? st.history : [],
    fetchedAt: String(st.fetchedAt || ""),
    fetchedBy: String(st.fetchedBy || ""),
  };
}

/** Replace the latest rows and add today's snapshot to the trend. */
export async function writePropelProgress(
  rows: PropelProgressRecord[],
  by: string,
  today: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const prev = await readPropelProgress();
  if (!prev) return { ok: false, error: "Could not read the earlier progress — nothing was replaced." };
  const now = new Date().toISOString();
  const state: PropelProgressState = {
    rows,
    history: addProgressSnapshot(prev.history, today, rows),
    fetchedAt: now,
    fetchedBy: by,
  };
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert(
      { tenant_id: ctx.tenantId, module_key: PROPEL_PROGRESS_KEY, state, updated_at: now },
      { onConflict: "tenant_id,module_key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** The school's loaded books, as `grade|subject_key` → chapter names. */
export async function readErpBookChapters(): Promise<Map<string, string[]> | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const books = await fetchAllPages<{ id: string; grade: number; subject_key: string }>((from, to) =>
    ctx.sb
      .from("school_textbooks")
      .select("id, grade, subject_key")
      .eq("tenant_id", ctx.tenantId)
      .is("retired_at", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (books.error) return null;
  const chapters = await fetchAllPages<{ textbook_id: string; name: string }>((from, to) =>
    ctx.sb
      .from("school_textbook_chapters")
      .select("textbook_id, name")
      .eq("tenant_id", ctx.tenantId)
      .order("textbook_id", { ascending: true })
      .order("position", { ascending: true })
      .range(from, to),
  );
  if (chapters.error) return null;
  const bookKey = new Map(books.rows.map((b) => [b.id, `${b.grade}|${b.subject_key}`]));
  const out = new Map<string, string[]>();
  for (const c of chapters.rows) {
    const k = bookKey.get(c.textbook_id);
    if (!k) continue;
    const list = out.get(k) ?? [];
    list.push(c.name);
    out.set(k, list);
  }
  return out;
}

/** Propel class name ("Nursery", "Class3") → the books' grade (Nursery = -2). */
export function propelClassGrade(className: string): number | null {
  const n = className.toLowerCase().replace(/\s+/g, "");
  if (n === "nursery") return -2;
  if (n === "lkg") return -1;
  if (n === "ukg") return 0;
  const m = n.match(/^class(\d{1,2})$/);
  return m ? Number(m[1]) : null;
}

/** Propel subject name → the books' subject_key ("" = no book kind for it). */
export function propelSubjectKey(subject: string): string {
  const s = subject.toLowerCase();
  if (/hindi/.test(s)) return "hindi";
  if (/english/.test(s)) return "english";
  if (/math|numeracy/.test(s)) return "maths";
  if (/\bevs\b|understanding our world/.test(s)) return "evs";
  if (/social/.test(s)) return "social";
  if (/science/.test(s)) return "science";
  if (/computer|code/.test(s)) return "computer";
  if (/general knowledge|know and grow/.test(s)) return "gk";
  return "";
}

/** Propel's tests as last brought in by the robot (module_local_state). */
export async function writePropelTests(
  tests: PropelTestRecord[],
  by: string,
): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const now = new Date().toISOString();
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        module_key: PROPEL_TESTS_KEY,
        state: { tests, fetchedAt: now, fetchedBy: by },
        updated_at: now,
      },
      { onConflict: "tenant_id,module_key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true, updatedAt: now };
}

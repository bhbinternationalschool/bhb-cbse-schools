import "server-only";

/**
 * The school's e-book shelves (Propel / FlipHTML5 bookcases), kept on the
 * server (director, 12 Oct 2026).
 *
 * Until now they lived only in the browser that catalogued them: the library
 * desk save never wrote `ebooks`, and the apps' reader looked in a blob that
 * has had none since 5 Aug — so a title or class set by the office vanished
 * on the next reload, and parents saw an empty shelf. One module_local_state
 * row now holds them; an empty store starts from the verified catalogue
 * (lib/library EBOOK_SHELF_CATALOGUE).
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { mergeEbookShelfSeed, normalizeEbook, type LibraryEbook } from "@/lib/library";

export const LIBRARY_EBOOKS_KEY = "library_ebooks";

/** The shelves; null = the read failed (unknown, never "none"). */
export async function readLibraryEbooks(): Promise<LibraryEbook[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", LIBRARY_EBOOKS_KEY)
    .maybeSingle();
  if (error) return null;
  const stored = (data?.state as { ebooks?: unknown } | null)?.ebooks;
  const list = Array.isArray(stored) ? (stored as Partial<LibraryEbook>[]).map(normalizeEbook) : [];
  // Every known shelf is present, blanks filled; the office's own values stand.
  return mergeEbookShelfSeed(list).ebooks;
}

/**
 * Lay a browser's shelves onto the stored ones by id: a shelf it sends
 * replaces the stored copy of that shelf; shelves it does not send stay.
 * Nothing is ever removed — a shelf is retired by switching it off.
 */
export async function mergeLibraryEbooks(
  incoming: unknown,
): Promise<{ ok: true; ebooks: LibraryEbook[] } | { ok: false; error: string }> {
  if (!Array.isArray(incoming)) return { ok: false, error: "No shelves sent" };
  const current = await readLibraryEbooks();
  if (!current) return { ok: false, error: "Could not read the stored e-book shelves — nothing was saved." };
  const byId = new Map(current.map((e) => [e.id, e]));
  for (const raw of incoming.slice(0, 500)) {
    const e = normalizeEbook(raw as Partial<LibraryEbook>);
    if (!e.id || !e.url) continue;
    byId.set(e.id, e);
  }
  const ebooks = [...byId.values()];
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const now = new Date().toISOString();
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert(
      { tenant_id: ctx.tenantId, module_key: LIBRARY_EBOOKS_KEY, state: { ebooks }, updated_at: now },
      { onConflict: "tenant_id,module_key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true, ebooks };
}

/**
 * The timetable grids a teacher's scope is built from, read on the server
 * from the database (data-layer 1.7).
 *
 * Until 13 Oct 2026 staffSectionScope() awaited ensureTimetableHydratedServer()
 * and then loadTimetable(). On the server loadTimetable() always returns an
 * empty state and the hydrate writes through writeTimetableLocalRaw(), a
 * browser-only no-op — so the grids were always [] and a teacher whose only
 * tie to a section is the published timetable was given no students at all.
 *
 * What this reads: the `publishedGrids` row of `timetable_desk_slices` for the
 * tenant. ONLY the published timetable grants a teacher sections — never the
 * draft (`grids`), even when nothing is published (director's decision, 13 Oct
 * 2026: production had 13 unpublished draft grids that would have given 8
 * teachers 3–6 extra sections each — student records, parents' contacts,
 * marks, WhatsApp — from an unfinished draft). Publishing is the deliberate act
 * that grants timetable access.
 *
 * Cache (per process): keyed on `timetable_desk_sync_meta.updated_at`. Every
 * call does one select of that one row; the slices are read again only when it
 * moved. Every writer of the slices (pushTimetableDeskToDb) moves it. A failed
 * read keeps the previous copy and says so in a warning; with no copy a failed
 * read is a 503 — the scope is unknown, never "no timetable" (rule R6).
 * This small cache moves to lib/data/server/referenceCache (step 1.3) when that
 * is on main.
 */
import { ApiError } from "@/lib/api/v1/errors";
import { getServerTenantContext } from "@/lib/serverTenant";
import { normalizeTimetableState, type TimetableGrid } from "@/lib/timetable";

export type ScopeTimetable = {
  grids: TimetableGrid[];
  /** Which list `grids` is. "none" = the database holds no timetable at all. */
  source: "published" | "none";
  /** The sync-meta value the copy was read under ("" = no meta row). */
  version: string;
  /** true = this read failed and the previous copy was served. */
  stale: boolean;
};

type Copy = Omit<ScopeTimetable, "stale">;

let copy: Copy | null = null;
let rebuild: { version: string; promise: Promise<Copy> } | null = null;

/** Tests only: forget the process copy. */
export function resetScopeTimetableCacheForTests(): void {
  copy = null;
  rebuild = null;
}

function databaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const stampMs = (v: unknown): number => {
  const ms = Date.parse(String(v ?? ""));
  return Number.isFinite(ms) ? ms : NaN;
};

function failed(why: string): ScopeTimetable {
  if (copy) {
    console.warn(
      `[timetable-scope] timetable read failed (${why}) — keeping the copy read under ${copy.version || "(no meta)"}`,
    );
    return { ...copy, stale: true };
  }
  console.error(`[timetable-scope] timetable read failed (${why}) and this process has no copy — 503`);
  throw new ApiError("server_error", "Could not read the timetable — please try again.", 503);
}

async function readSlices(version: string): Promise<Copy> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("tenant not resolved");
  const { data, error } = await ctx.sb
    .from("timetable_desk_slices")
    .select("slice_key, payload, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("slice_key", "publishedGrids");
  if (error) throw new Error(error.message || "timetable_desk_slices");
  const rows = (data ?? []) as { slice_key: string; payload: unknown; updated_at?: string }[];
  const payload = (key: string) => rows.find((r) => r.slice_key === key)?.payload;
  const state = normalizeTimetableState({
    grids: [],
    publishedGrids: Array.isArray(payload("publishedGrids")) ? payload("publishedGrids") : [],
  });
  // Published only: an unpublished draft never grants access (see above).
  const source: Copy["source"] = state.publishedGrids.length ? "published" : "none";
  const out: Copy = {
    grids: state.publishedGrids,
    source,
    version,
  };
  // A versioned save claims the meta row BEFORE it writes the slices
  // (pushTimetableDeskToDb), and the slices then carry that same stamp. Slices
  // older than the meta value are a save caught half-way: serve them to this
  // call, but do not keep them under the new value — or the copy would be
  // stale until the next save.
  const newest = Math.max(...rows.map((r) => stampMs(r.updated_at)).filter((n) => !Number.isNaN(n)), -Infinity);
  const metaMs = stampMs(version);
  const settled = !version || rows.length === 0 || Number.isNaN(metaMs) || newest >= metaMs;
  if (settled) copy = out;
  else console.warn(`[timetable-scope] slices (${new Date(newest).toISOString()}) older than meta ${version} — not cached`);
  return out;
}

/**
 * The grids staffSectionScope() builds timetable sections from.
 * Throws ApiError 503 when the timetable is unknown (failed read, no copy).
 */
export async function loadScopeTimetable(): Promise<ScopeTimetable> {
  // A local demo with no database: there is nothing to read, nothing failed.
  if (!databaseConfigured()) return { grids: [], source: "none", version: "", stale: false };

  let version = "";
  let why = "";
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) {
      why = "tenant not resolved";
    } else {
      const { data, error } = await ctx.sb
        .from("timetable_desk_sync_meta")
        .select("updated_at")
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle();
      if (error) why = `timetable_desk_sync_meta: ${error.message}`;
      version = data?.updated_at ? String(data.updated_at) : "";
    }
  } catch (e) {
    why = e instanceof Error ? e.message : String(e);
  }
  if (why) return failed(why);

  if (copy && copy.version === version) return { ...copy, stale: false };

  if (!rebuild || rebuild.version !== version) {
    const promise = readSlices(version).finally(() => {
      if (rebuild?.promise === promise) rebuild = null;
    });
    rebuild = { version, promise };
  }
  try {
    return { ...(await rebuild.promise), stale: false };
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }
}

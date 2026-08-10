/**
 * The only place tenant data is read from or written to.
 *
 * Server-only. Every existing `*Normalized.server.ts` hand-rolls its own
 * version of this, which is how 26 modules ended up with 26 slightly
 * different bugs. Three rules are enforced here rather than remembered at
 * each call site:
 *
 *   1. No query is built without its mandatory scope. `tenant_id` always,
 *      `academic_year_code` wherever records belong to a session. A missing
 *      scope throws — it never degrades into "select the whole table".
 *
 *   2. No list is unbounded. Every read is keyset-paginated with a hard
 *      ceiling. The admissions desk returns 2.37 MB in 2-16 seconds today,
 *      with 503s at 19-47 seconds, at only 919 leads; that is what an
 *      unbounded read looks like before it becomes 258 MB at 100k.
 *
 *   3. A failure is never shaped like data. Every function returns a
 *      discriminated result — see types.ts.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { collectionDef, type CollectionDef } from "../registry";
import {
  asRevision,
  type Cursor,
  type ReadResult,
  type RecordOutcome,
  type Revision,
  type WriteOp,
  type WriteResult,
} from "../types";

export type Row = Record<string, unknown>;

export type ListParams = {
  /** Required for collections scoped to a session. */
  academicYearCode?: string;
  limit?: number;
  cursor?: Cursor | null;
};

/** Keyset cursor: the sort value and id of the last row on the page. */
type CursorParts = { sort: string; id: string };

function encodeCursor(parts: CursorParts): Cursor {
  return Buffer.from(JSON.stringify(parts), "utf8").toString(
    "base64url",
  ) as Cursor;
}

function decodeCursor(raw: string): CursorParts | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as CursorParts;
    if (typeof parsed?.sort !== "string" || typeof parsed?.id !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve and validate the scope for a collection.
 *
 * Returns an error rather than a partial filter set: a query missing
 * `academic_year_code` on a session-scoped collection would quietly return
 * every year at once, which reads as data rather than as a bug.
 */
function resolveScope(
  def: CollectionDef,
  tenantId: string,
  params: { academicYearCode?: string },
): { ok: true; filters: Row } | { ok: false; error: string } {
  const filters: Row = {};
  for (const key of def.scope) {
    if (key === "tenant_id") {
      filters.tenant_id = tenantId;
      continue;
    }
    if (key === "academic_year_code") {
      const ay = params.academicYearCode?.trim();
      if (!ay) {
        return {
          ok: false,
          error: `${def.id} is scoped to an academic year; none was supplied`,
        };
      }
      filters.academic_year_code = ay;
    }
  }
  return { ok: true, filters };
}

function clampLimit(def: CollectionDef, requested?: number): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return def.list.defaultLimit;
  }
  return Math.min(Math.floor(requested), def.list.maxLimit);
}

/**
 * Read one page of a collection.
 *
 * Ordered by (sortColumn, id) so the keyset is total — ordering by a
 * non-unique column alone drops or repeats rows across pages.
 */
export async function list(
  collectionId: string,
  params: ListParams = {},
): Promise<ReadResult<Row>> {
  const def = collectionDef(collectionId);
  if (!def) {
    return { ok: false, code: "not_found", error: "Unknown collection" };
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return {
      ok: false,
      code: "unavailable",
      error: "Supabase tenant not configured",
    };
  }

  const scope = resolveScope(def, ctx.tenantId, params);
  if (!scope.ok) {
    return { ok: false, code: "invalid", error: scope.error };
  }

  const limit = clampLimit(def, params.limit);
  const sortCol = def.list.sortColumn;

  // Projection: a list returns what a row needs to render and be opened, not
  // the whole record. `id` and the sort column are forced in — without them
  // the cursor cannot be built and paging stops after one page, which is the
  // kind of bug that only shows up on the second screenful.
  const projection = def.list.columns?.length
    ? Array.from(new Set(["id", sortCol, ...def.list.columns])).join(",")
    : "*";

  let q = ctx.sb.from(def.table).select(projection);
  for (const [k, v] of Object.entries(scope.filters)) {
    q = q.eq(k, v as string);
  }
  if (def.softDelete) {
    q = q.is("deleted_at", null);
  }

  if (params.cursor) {
    const after = decodeCursor(params.cursor);
    if (!after) {
      return { ok: false, code: "invalid", error: "Malformed cursor" };
    }
    // (sort, id) > (after.sort, after.id), expressed for PostgREST.
    q = q.or(
      `${sortCol}.gt.${after.sort},and(${sortCol}.eq.${after.sort},id.gt.${after.id})`,
    );
  }

  // One extra row tells us whether another page exists without a count(*).
  const { data, error } = await q
    .order(sortCol, { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (error) {
    return { ok: false, code: "unavailable", error: error.message };
  }

  // The projection is built at runtime, so PostgREST's typed select inference
  // cannot narrow the result. Cast through unknown rather than widen Row.
  const rows = (data ?? []) as unknown as Row[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    ok: true,
    rows: page,
    nextCursor:
      hasMore && last
        ? encodeCursor({ sort: String(last[sortCol] ?? ""), id: String(last.id) })
        : null,
    serverTime: new Date().toISOString(),
  };
}

/**
 * Apply stated per-record changes through desk_write_guarded.
 *
 * The function is the only writer: it holds the allowlist, the base-revision
 * check and the patch semantics, all in one transaction. Nothing here builds
 * an UPDATE, so there is no second implementation to drift.
 */
export async function write(
  collectionId: string,
  ops: readonly WriteOp<Row>[],
): Promise<WriteResult<Row>> {
  const def = collectionDef(collectionId);
  if (!def) {
    return {
      ok: false,
      kind: "not_found",
      message: "Unknown collection",
      conflicts: [],
    };
  }
  if (ops.length === 0) {
    return { ok: true, results: [], versions: {} };
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return {
      ok: false,
      kind: "unavailable",
      message: "Supabase tenant not configured",
      conflicts: [],
    };
  }

  const { data, error } = await ctx.sb.rpc("desk_write_guarded", {
    p_tenant_id: ctx.tenantId,
    p_table: def.table,
    p_ops: ops,
  });

  if (error) {
    // 42501 is the allowlist refusing the table — a bug or an attack, never
    // something to retry. Anything else is treated as unavailable.
    const denied = error.code === "42501" || /not writable/i.test(error.message);
    return {
      ok: false,
      kind: denied ? "auth" : "unavailable",
      message: error.message,
      conflicts: [],
    };
  }

  const payload = (data ?? {}) as {
    ok?: boolean;
    results?: {
      id: string;
      status: RecordOutcome<Row>["status"];
      revision?: string;
      stored?: Row;
    }[];
    versions?: Record<string, string>;
  };

  const results: RecordOutcome<Row>[] = (payload.results ?? []).map((r) =>
    r.status === "conflict"
      ? {
          id: r.id,
          status: "conflict",
          revision: asRevision(String(r.revision ?? "")),
          stored: (r.stored ?? {}) as Row,
        }
      : {
          id: r.id,
          status: r.status,
          revision: asRevision(String(r.revision ?? "")),
        },
  );

  const versions: Record<string, Revision> = {};
  for (const [id, rev] of Object.entries(payload.versions ?? {})) {
    versions[id] = asRevision(rev);
  }

  const conflicts = results.filter((r) => r.status === "conflict");
  if (conflicts.length > 0) {
    return {
      ok: false,
      kind: "conflict",
      message: `${conflicts.length} record(s) changed since you loaded them`,
      conflicts,
    };
  }

  return { ok: true, results, versions };
}

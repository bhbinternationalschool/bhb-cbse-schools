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
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { collectionDef, collectionKind, type CollectionDef, type SliceSource } from "../registry";
import {
  asRevision,
  type ConflictReason,
  type Cursor,
  type ReadResult,
  type RecordOutcome,
  type Revision,
  type WriteOp,
  type WriteResult,
} from "../types";

export type Row = Record<string, unknown>;

/**
 * A teacher's reach, applied in the query (data-layer 1.5, registry
 * `teacherScope`). Built by the route from staffSectionScope; the repo never
 * computes scope itself and never widens it.
 *  - `sections`: rows whose (class_id, section_id) pair is one of these;
 *  - `households`: rows whose id is one of these.
 * An empty list is a real "nothing in reach" and returns no rows.
 */
export type RowScope =
  | { readonly kind: "sections"; readonly sections: readonly { classId: string; sectionId: string }[] }
  | { readonly kind: "households"; readonly ids: readonly string[] };

export type ListParams = {
  /** Required for collections scoped to a session. */
  academicYearCode?: string;
  limit?: number;
  cursor?: Cursor | null;
  /** Restrict to a teacher's reach. See RowScope. */
  scope?: RowScope;
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

  if (collectionKind(def) !== "rows") {
    if (params.scope) {
      return { ok: false, code: "invalid", error: `${def.id} cannot be scoped to a teacher` };
    }
    return listSlice(def, ctx, params);
  }

  // A teacher's reach that holds nothing: no query, no rows.
  const pairKeys =
    params.scope?.kind === "sections"
      ? new Set(params.scope.sections.map((x) => `${x.classId}|${x.sectionId}`))
      : null;
  if (params.scope?.kind === "sections" && params.scope.sections.length === 0) {
    return { ok: true, rows: [], nextCursor: null, serverTime: new Date().toISOString() };
  }
  if (params.scope?.kind === "households" && params.scope.ids.length === 0) {
    return { ok: true, rows: [], nextCursor: null, serverTime: new Date().toISOString() };
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
    ? Array.from(
        new Set([
          "id",
          sortCol,
          ...(pairKeys ? ["class_id", "section_id"] : []),
          ...def.list.columns,
        ]),
      ).join(",")
    : "*";

  let q = ctx.sb.from(def.table).select(projection);
  for (const [k, v] of Object.entries(scope.filters)) {
    q = q.eq(k, v as string);
  }
  if (def.softDelete) {
    q = q.is("deleted_at", null);
  }
  // Scope in the WHERE clause (R5). Sections: section_id in (…) here, and the
  // (class, section) pair checked below — a child whose class moved but whose
  // section id did not is not in reach, exactly as sis-roster decides it.
  if (params.scope?.kind === "sections") {
    q = q.in("section_id", Array.from(new Set(params.scope.sections.map((x) => x.sectionId))));
  } else if (params.scope?.kind === "households") {
    q = q.in("id", Array.from(new Set(params.scope.ids)));
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
  // The cursor follows the page as read; the pair check only drops rows.
  const last = page[page.length - 1];
  const shown = pairKeys
    ? page.filter((r) => pairKeys.has(`${String(r.class_id ?? "")}|${String(r.section_id ?? "")}`))
    : page;

  return {
    ok: true,
    rows: shown,
    nextCursor:
      hasMore && last
        ? encodeCursor({ sort: String(last[sortCol] ?? ""), id: String(last.id) })
        : null,
    serverTime: new Date().toISOString(),
  };
}

type TenantCtx = NonNullable<Awaited<ReturnType<typeof getServerTenantContext>>>;

/**
 * Read a slice collection: the elements of one jsonb list (or one object
 * slice), from `*_desk_slices` — the truth — not from any derived table.
 * Keyset-paged by the element key. `revision` is the slice's stamp when the
 * collection's writes are based on it (and for object slices).
 */
async function listSlice(
  def: CollectionDef,
  ctx: TenantCtx,
  params: ListParams,
): Promise<ReadResult<Row>> {
  const src = def.slice;
  if (!src) return { ok: false, code: "unavailable", error: `${def.id} has no slice` };
  const { data, error } = await ctx.sb
    .from(src.table)
    .select("payload, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("slice_key", src.key)
    .maybeSingle();
  if (error) return { ok: false, code: "unavailable", error: error.message };
  const row = data as { payload?: unknown; updated_at?: string } | null;
  const stamp = row?.updated_at ? asRevision(String(row.updated_at)) : null;
  const serverTime = new Date().toISOString();

  if (collectionKind(def) === "object") {
    const value = row?.payload;
    return {
      ok: true,
      rows: value == null ? [] : [{ value } as Row],
      nextCursor: null,
      serverTime,
      revision: stamp,
    };
  }

  if (row && row.payload != null && !Array.isArray(row.payload)) {
    return { ok: false, code: "unavailable", error: `${def.id}: the stored slice is not a list` };
  }
  const keyField = src.keyField ?? "id";
  const keyOf = (r: Row) => String(r[keyField] ?? "");
  const all = (Array.isArray(row?.payload) ? (row!.payload as unknown[]) : [])
    .filter((e): e is Row => !!e && typeof e === "object" && !Array.isArray(e) && keyOf(e as Row) !== "")
    .sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));

  let from = 0;
  if (params.cursor) {
    const after = decodeCursor(params.cursor);
    if (!after) return { ok: false, code: "invalid", error: "Malformed cursor" };
    from = all.findIndex((r) => keyOf(r) > after.id);
    if (from < 0) from = all.length;
  }
  const limit = clampLimit(def, params.limit);
  const page = all.slice(from, from + limit);
  const hasMore = from + limit < all.length;
  const last = page[page.length - 1];
  return {
    ok: true,
    rows: page,
    nextCursor: hasMore && last ? encodeCursor({ sort: keyOf(last), id: keyOf(last) }) : null,
    serverTime,
    revision: src.base === "slice" ? stamp : undefined,
  };
}

/**
 * The household ids of the children in these (class, section) pairs — a
 * teacher's household reach (registry teacherScope "household"). Paged: a
 * section list can exceed one PostgREST page. Throws on a failed read: an
 * unknown reach is never an empty one.
 */
export async function householdIdsForSections(
  sections: readonly { classId: string; sectionId: string }[],
): Promise<string[]> {
  if (sections.length === 0) return [];
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("Supabase tenant not configured");
  const pairs = new Set(sections.map((x) => `${x.classId}|${x.sectionId}`));
  const sectionIds = Array.from(new Set(sections.map((x) => x.sectionId)));
  const res = await fetchAllPages<{ id: string; class_id: string | null; section_id: string | null; household_id: string | null }>(
    (from, to) =>
      ctx.sb
        .from("sis_students")
        .select("id, class_id, section_id, household_id")
        .eq("tenant_id", ctx.tenantId)
        .in("section_id", sectionIds)
        .order("id", { ascending: true })
        .range(from, to),
  );
  if (res.error || res.truncated) throw new Error(res.error ?? "household scope truncated");
  const ids = new Set<string>();
  for (const r of res.rows) {
    if (r.household_id && pairs.has(`${r.class_id ?? ""}|${r.section_id ?? ""}`)) ids.add(r.household_id);
  }
  return Array.from(ids);
}

/**
 * The current revision of named records, soft-deleted ones included — what a
 * client needs to revive a soft-deleted row or to put away a sheet it is
 * holding from another source (data-layer 1.5: a null base on an existing
 * row is refused). At most 200 ids.
 */
export async function revisionsOf(
  collectionId: string,
  ids: readonly string[],
): Promise<ReadResult<Row>> {
  const def = collectionDef(collectionId);
  if (!def) return { ok: false, code: "not_found", error: "Unknown collection" };
  if (collectionKind(def) !== "rows") {
    return { ok: false, code: "invalid", error: `${def.id} is a slice; its revision comes with the list` };
  }
  const wanted = Array.from(new Set(ids.map((x) => String(x)).filter(Boolean)));
  if (wanted.length === 0 || wanted.length > 200) {
    return { ok: false, code: "invalid", error: "Ask for 1–200 ids" };
  }
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, code: "unavailable", error: "Supabase tenant not configured" };
  const cols = def.softDelete ? "id, updated_at, deleted_at" : "id, updated_at";
  const { data, error } = await ctx.sb
    .from(def.table)
    .select(cols)
    .eq("tenant_id", ctx.tenantId)
    .in("id", wanted);
  if (error) return { ok: false, code: "unavailable", error: error.message };
  return {
    ok: true,
    rows: (data ?? []) as unknown as Row[],
    nextCursor: null,
    serverTime: new Date().toISOString(),
  };
}

/** A missing kernel function is unavailable — the code fails closed (§0). */
function rpcFailure(
  error: { code?: string; message: string },
): { kind: "auth" | "invalid" | "unavailable"; message: string } {
  if (error.code === "42501" || /not writable|is not a slice table|is not written here|is not an object slice/i.test(error.message)) {
    return { kind: "auth", message: error.message };
  }
  if (error.code === "22023" || error.code === "22004" || error.code === "22P02" || error.code === "22007") {
    return { kind: "invalid", message: error.message };
  }
  if (error.code === "PGRST202" || error.code === "42883") {
    return {
      kind: "unavailable",
      message:
        "Not saved — the server's write kernel is not installed yet (migration 20261014220000). Nothing was written.",
    };
  }
  return { kind: "unavailable", message: error.message };
}

function asReason(v: unknown): ConflictReason | undefined {
  return v === "stale" || v === "unversioned" || v === "deleted" ? v : undefined;
}

/**
 * One element of a slice collection, through desk_slice_row_write (or the
 * whole value of an object collection, through desk_slice_object_write).
 * Exactly one op: the RPC locks and writes one element per call, and a batch
 * of calls would not be one transaction.
 */
export async function writeSlice(
  collectionId: string,
  ops: readonly WriteOp<Row>[],
): Promise<WriteResult<Row>> {
  const def = collectionDef(collectionId);
  if (!def || !def.slice || collectionKind(def) === "rows") {
    return { ok: false, kind: "not_found", message: "Unknown slice collection", conflicts: [] };
  }
  if (ops.length !== 1) {
    return {
      ok: false,
      kind: "invalid",
      message: `${def.id} takes one change per request (got ${ops.length})`,
      conflicts: [],
    };
  }
  const op = ops[0]!;
  const id = typeof op?.id === "string" ? op.id : "";
  const src = def.slice;
  const isObject = collectionKind(def) === "object";
  if (isObject && (op.op !== "upsert" || id !== src.key)) {
    return {
      ok: false,
      kind: "invalid",
      message: `${def.id} is one object: send a single upsert with id "${src.key}" and the whole value as row`,
      conflicts: [],
    };
  }
  return writeSliceOp(src, isObject, op);
}

/**
 * One element of a list slice that is not a registry collection (its own
 * route decides who may write it — e.g. Staff → Requests, where any member
 * of staff files their own): the same RPC, base and outcome as writeSlice.
 */
export async function writeSliceElement(src: SliceSource, op: WriteOp<Row>): Promise<WriteResult<Row>> {
  return writeSliceOp(src, false, op);
}

async function writeSliceOp(src: SliceSource, isObject: boolean, op: WriteOp<Row>): Promise<WriteResult<Row>> {
  const id = typeof op?.id === "string" ? op.id : "";
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { ok: false, kind: "unavailable", message: "Supabase tenant not configured", conflicts: [] };
  }
  const base = op.base == null ? null : String(op.base);

  const { data, error } = isObject
    ? await ctx.sb.rpc("desk_slice_object_write", {
        p_tenant: ctx.tenantId,
        p_table: src.table,
        p_slice_key: src.key,
        p_value: (op as { row?: unknown }).row ?? null,
        p_base: base,
      })
    : await ctx.sb.rpc("desk_slice_row_write", {
        p_tenant: ctx.tenantId,
        p_table: src.table,
        p_slice_key: src.key,
        p_op: op.op,
        p_id: id,
        p_row: op.op === "upsert" ? ((op as { row?: unknown }).row ?? null) : null,
        p_base: base,
        p_key: src.keyField ?? "id",
      });
  if (error) {
    const f = rpcFailure(error);
    return { ok: false, kind: f.kind, message: f.message, conflicts: [] };
  }

  const res = (data ?? {}) as {
    ok?: boolean;
    status?: string;
    reason?: string;
    revision?: string | null;
    rev?: number | null;
    stored?: Row | null;
    changed?: boolean;
  };
  const sliceStamp = res.revision ? asRevision(String(res.revision)) : null;
  // The base the client sends next for THIS element.
  const elementBase = asRevision(
    src.base === "rev" && !isObject ? String(res.rev ?? (res.status === "deleted" ? "" : "0")) : String(res.revision ?? ""),
  );

  if (res.ok !== true) {
    if (res.status === "conflict") {
      const reason = asReason(res.reason);
      return {
        ok: false,
        kind: "conflict",
        message:
          reason === "unversioned"
            ? "This record exists on the server and the save did not say which version it changed"
            : reason === "deleted"
              ? "This record was removed on another device"
              : "Changed on another device since you loaded it",
        conflicts: [
          { id, status: "conflict", revision: elementBase, stored: (res.stored ?? {}) as Row, reason },
        ],
      };
    }
    return { ok: false, kind: "unavailable", message: "The slice write returned no outcome", conflicts: [] };
  }

  const status: "applied" | "unchanged" | "deleted" =
    res.status === "unchanged" ? "unchanged" : res.status === "deleted" ? "deleted" : "applied";
  return {
    ok: true,
    results: [{ id, status, revision: elementBase }],
    versions: { [id]: elementBase },
    revision: sliceStamp,
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
  return writeRows(def.table, ops);
}

/**
 * The same, for a table no collection exposes through the generic API —
 * a server module that decides every op itself (lib/notify/inbox.ts: a
 * reader marks THEIR OWN notifications read). The table must still be in
 * desk_writable_tables, or the function refuses it (42501).
 */
export async function writeRows(table: string, ops: readonly WriteOp<Row>[]): Promise<WriteResult<Row>> {
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
    p_table: table,
    p_ops: ops,
  });

  if (error) {
    // 42501 is the allowlist refusing the table — a bug or an attack, never
    // something to retry. 22023 is a malformed batch (an op without an id, an
    // id twice). A missing function fails closed.
    const f = rpcFailure(error);
    return { ok: false, kind: f.kind, message: f.message, conflicts: [] };
  }

  const payload = (data ?? {}) as {
    ok?: boolean;
    results?: {
      id: string;
      status: RecordOutcome<Row>["status"];
      revision?: string;
      stored?: Row;
      reason?: string;
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
          reason: asReason(r.reason),
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

  // v3 is all-or-none: one refusal means nothing in the batch was written.
  const conflicts = results.filter((r) => r.status === "conflict");
  if (conflicts.length > 0 || payload.ok === false) {
    const unversioned = conflicts.filter((c) => c.status === "conflict" && c.reason === "unversioned").length;
    return {
      ok: false,
      kind: "conflict",
      message:
        unversioned > 0
          ? `${unversioned} record(s) exist on the server but the save did not say which version it changed — nothing was written`
          : `${conflicts.length} record(s) changed since you loaded them — nothing was written`,
      conflicts,
    };
  }

  return { ok: true, results, versions };
}

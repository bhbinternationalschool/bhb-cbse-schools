/**
 * The client write path. There is exactly one, and it cannot be ignored.
 *
 * Today there are 71 `void pushX()` sites whose failures reach a
 * `console.warn` and stop there. That is why a refused save looked identical
 * to a successful one: the UI had no way to find out, and mostly did not
 * ask. `writeRecords` is async and returns a discriminated union, so a
 * caller that discards it trips no-floating-promises, and a caller that
 * keeps it cannot read the outcome without narrowing first.
 */

import {
  asRevision,
  type RecordOutcome,
  type Revision,
  type WriteOp,
  type WriteResult,
} from "../types";

type ServerOutcome = {
  id: string;
  status: RecordOutcome<unknown>["status"];
  revision?: string;
  stored?: unknown;
};

/**
 * Send stated per-record changes for one collection.
 *
 * Never throws: a thrown write is a write whose result someone forgot to
 * handle. Everything arrives as a value that has to be inspected.
 */
export async function writeRecords<T>(
  collection: string,
  ops: readonly WriteOp<T>[],
): Promise<WriteResult<T>> {
  if (ops.length === 0) return { ok: true, results: [], versions: {} };

  let res: Response;
  try {
    res = await fetch(`/api/data/${encodeURIComponent(collection)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Always a list of ops. Whole-module state is what this replaces.
      body: JSON.stringify({ ops }),
      cache: "no-store",
    });
  } catch (e) {
    // The only case that may honestly blame the user's connection.
    return {
      ok: false,
      kind: "network",
      message: e instanceof Error ? e.message : "Network error",
      conflicts: [],
    };
  }

  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    kind?: string;
    message?: string;
    error?: string;
    results?: ServerOutcome[];
    versions?: Record<string, string>;
    conflicts?: ServerOutcome[];
  } | null;

  if (res.ok && body?.ok) {
    const versions: Record<string, Revision> = {};
    for (const [id, rev] of Object.entries(body.versions ?? {})) {
      versions[id] = asRevision(rev);
    }
    return {
      ok: true,
      results: (body.results ?? []).map((r) => toOutcome<T>(r)),
      versions,
    };
  }

  if (res.status === 409) {
    return {
      ok: false,
      kind: "conflict",
      message: body?.message || "Changed on another device",
      conflicts: (body?.conflicts ?? []).map((r) => toOutcome<T>(r)),
    };
  }

  // 401/403 are their own kind: "sign in again" is different advice from
  // "try again", and both are different from "check your connection".
  const kind =
    res.status === 401 || res.status === 403
      ? ("auth" as const)
      : res.status === 400
        ? ("invalid" as const)
        : res.status === 404
          ? ("not_found" as const)
          : ("unavailable" as const);

  return {
    ok: false,
    kind,
    message: body?.message || body?.error || `Server returned ${res.status}`,
    conflicts: [],
  };
}

function toOutcome<T>(r: ServerOutcome): RecordOutcome<T> {
  const revision = asRevision(String(r.revision ?? ""));
  return r.status === "conflict"
    ? { id: r.id, status: "conflict", revision, stored: r.stored as T }
    : { id: r.id, status: r.status, revision };
}

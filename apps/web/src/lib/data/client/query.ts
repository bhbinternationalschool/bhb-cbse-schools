/**
 * The read half of the data layer. Pages, from the database, every time.
 *
 * Nothing here touches localStorage. That is the point: the browser cache is
 * what made the admissions payload 2.37 MB, pushed the origin past the ~5 MB
 * mobile storage cap, and on 2026-08-10 threw QuotaExceededError in the middle
 * of a save so the edit never reached the database at all.
 *
 * Two rules, both learned the hard way today:
 *
 *   1. A failed read is never shaped like data. `readPage` returns a
 *      discriminated result; there is no `rows` property on the failure. An
 *      empty read and a failed read were the same value in
 *      fetchMastersDeskFromDb, and that is what let a timed-out query read as
 *      "this tenant has no classes" and orphan 711 students.
 *
 *   2. No caller can ask for everything. The page size is clamped server-side
 *      by the collection's maxLimit; `readAll` exists but takes an explicit
 *      page budget and REFUSES to silently truncate — it tells you it stopped.
 */

import type { Cursor } from "../types";

export type PageResult<T> =
  | {
      ok: true;
      rows: T[];
      /** Null when this is the last page. */
      nextCursor: Cursor | null;
      serverTime: string;
    }
  | {
      ok: false;
      code: "not_found" | "auth" | "invalid" | "unavailable";
      error: string;
    };

export type ReadPageParams = {
  academicYearCode?: string;
  limit?: number;
  cursor?: Cursor | null;
  signal?: AbortSignal;
};

/**
 * Read one page of a collection.
 *
 * `academicYearCode` is required for session-scoped collections; the server
 * refuses rather than quietly returning every year at once, so a missing
 * scope surfaces as an error here instead of as a report that spans four
 * years and looks plausible.
 */
export async function readPage<T = Record<string, unknown>>(
  collection: string,
  params: ReadPageParams = {},
): Promise<PageResult<T>> {
  const qs = new URLSearchParams();
  if (params.academicYearCode) qs.set("academicYearCode", params.academicYearCode);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);

  let res: Response;
  try {
    res = await fetch(
      `/api/data/${encodeURIComponent(collection)}${qs.size ? `?${qs}` : ""}`,
      { cache: "no-store", signal: params.signal },
    );
  } catch (e) {
    // Offline, aborted, DNS. Explicitly NOT an empty page.
    return {
      ok: false,
      code: "unavailable",
      error: e instanceof Error ? e.message : "Network request failed",
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      ok: false,
      code: "unavailable",
      error: `Server returned ${res.status} with an unreadable body`,
    };
  }

  const parsed = body as {
    ok?: boolean;
    rows?: T[];
    nextCursor?: string | null;
    serverTime?: string;
    code?: PageResult<T> extends { ok: false; code: infer C } ? C : never;
    error?: string;
  };

  if (!res.ok || !parsed.ok) {
    return {
      ok: false,
      code:
        parsed.code ??
        (res.status === 401 || res.status === 403
          ? "auth"
          : res.status === 404
            ? "not_found"
            : res.status === 400
              ? "invalid"
              : "unavailable"),
      error: parsed.error ?? `Request failed (${res.status})`,
    };
  }

  // A success with no rows array is a malformed response, not an empty page.
  if (!Array.isArray(parsed.rows)) {
    return {
      ok: false,
      code: "unavailable",
      error: "Server reported success but returned no rows array",
    };
  }

  return {
    ok: true,
    rows: parsed.rows,
    nextCursor: (parsed.nextCursor ?? null) as Cursor | null,
    serverTime: parsed.serverTime ?? new Date().toISOString(),
  };
}

export type ReadAllResult<T> =
  | { ok: true; rows: T[]; complete: true }
  | {
      /**
       * The budget ran out. `rows` holds what was read, and `complete: false`
       * says so — a partial result must never be mistaken for the whole set.
       * A caller that renders these as "all leads" is showing a subset while
       * claiming otherwise, which is worse than showing an error.
       */
      ok: true;
      rows: T[];
      complete: false;
      nextCursor: Cursor;
    }
  | { ok: false; code: string; error: string; rowsReadBeforeFailure: number };

/**
 * Follow the cursor up to `maxPages`.
 *
 * For the places that genuinely need a whole small collection — a class list,
 * a fee-head list. NOT for admissions leads, which is why the budget is
 * mandatory and a truncated read is reported rather than returned as if it
 * were complete.
 */
export async function readAll<T = Record<string, unknown>>(
  collection: string,
  params: ReadPageParams & { maxPages: number },
): Promise<ReadAllResult<T>> {
  const rows: T[] = [];
  let cursor: Cursor | null = params.cursor ?? null;

  for (let page = 0; page < params.maxPages; page++) {
    const res: PageResult<T> = await readPage<T>(collection, { ...params, cursor });
    if (!res.ok) {
      return {
        ok: false,
        code: res.code,
        error: res.error,
        rowsReadBeforeFailure: rows.length,
      };
    }
    rows.push(...res.rows);
    cursor = res.nextCursor;
    if (!cursor) return { ok: true, rows, complete: true };
  }

  // Budget exhausted with more to read. Say so.
  return { ok: true, rows, complete: false, nextCursor: cursor as Cursor };
}

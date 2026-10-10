/**
 * Read a whole result set from PostgREST, a page at a time.
 *
 * PostgREST caps every request at 1,000 rows and reports the cut as SUCCESS.
 * That single fact has cost this system a receipt-lines wipe, a controls page
 * that ran on 40% of the ledger, and a UDISE+ sheet that "lost" 110 pupils.
 * The attendance desk holds 10,315 marks; any reader that asks for them in
 * one request gets the first thousand and no error.
 *
 * Every caller must ORDER by a stable column (id) so pages do not overlap.
 * The builder is called per page with an inclusive range.
 */
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; error: string | null; truncated: boolean }> {
  const page = Math.max(1, Math.min(1000, opts.pageSize ?? 1000));
  const max = opts.maxRows ?? 200_000;
  const rows: T[] = [];
  for (let from = 0; from < max; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) return { rows, error: error.message, truncated: false };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < page) return { rows, error: null, truncated: false };
  }
  return { rows, error: null, truncated: true };
}

/**
 * Read every row whose `column` is in `ids`, chunking the id list (a URL
 * can only carry so many) and paging each chunk. Every "select … .in(ids)"
 * over a parent's children must go through here: 483 attendance registers
 * hold 10,315 marks, and one request for them all returned 1,000.
 */
export async function fetchByIds<T>(
  ids: string[],
  build: (chunk: string[], from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  opts: { chunkSize?: number; pageSize?: number } = {},
): Promise<{ rows: T[]; error: string | null }> {
  const chunk = Math.max(1, opts.chunkSize ?? 150);
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    const res = await fetchAllPages<T>((from, to) => build(part, from, to), {
      pageSize: opts.pageSize,
    });
    if (res.error) return { rows: out, error: res.error };
    out.push(...res.rows);
  }
  return { rows: out, error: null };
}

/**
 * The Masters kernel from a test's signed-in context (data-layer 2.2c): the
 * masters view (elements with `_rev`) and element writes through
 * POST /api/data/masters.<list> — what the editor sends since 2.2c, and what
 * the specs use to put things back.
 */
import type { APIRequestContext } from "@playwright/test";
import { expect } from "./support";

type Row = Record<string, unknown>;
export type Book = Record<string, unknown> & { stamps?: Record<string, string> };

export async function mastersView(req: APIRequestContext): Promise<Book> {
  const res = await req.get("/api/data/views/masters");
  expect(res.status(), "GET views/masters").toBe(200);
  const body = (await res.json()) as { data: { masters: Book; stamps?: Record<string, string> } };
  return { ...body.data.masters, stamps: body.data.stamps ?? {} };
}

export function listOf(book: Book, key: string): Row[] {
  return Array.isArray(book[key]) ? (book[key] as Row[]) : [];
}

export function elementOf(book: Book, key: string, id: string): Row | undefined {
  return listOf(book, key).find((e) => e.id === id);
}

export async function writeElements(
  req: APIRequestContext,
  collection: string,
  ops: { op: "upsert" | "delete"; id: string; base: string | null; row?: Row }[],
): Promise<{ status: number; body: Row }> {
  const res = await req.post(`/api/data/${collection}`, { data: { ops } });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Row };
}

/** Upsert one element back to `row` on its current `_rev` (or create it). */
export async function putElement(req: APIRequestContext, collection: string, key: string, row: Row): Promise<void> {
  const cur = elementOf(await mastersView(req), key, String(row.id));
  const { _rev: _x, ...clean } = row;
  void _x;
  const w = await writeElements(req, collection, [{ op: "upsert", id: String(row.id), base: cur ? String(cur._rev ?? 0) : null, row: clean }]);
  expect(w.status, `put back ${collection} ${String(row.id)}: ${JSON.stringify(w.body).slice(0, 200)}`).toBe(200);
}

/** Remove one element if it is there. */
export async function dropElement(req: APIRequestContext, collection: string, key: string, id: string): Promise<void> {
  const cur = elementOf(await mastersView(req), key, id);
  if (!cur) return;
  const w = await writeElements(req, collection, [{ op: "delete", id, base: String(cur._rev ?? 0) }]);
  expect(w.status, `remove ${collection} ${id}: ${JSON.stringify(w.body).slice(0, 200)}`).toBe(200);
}

/** Put an object slice (school profile …) back to `value` on its current stamp. */
export async function putObject(req: APIRequestContext, collection: string, key: string, value: Row): Promise<void> {
  const book = await mastersView(req);
  const w = await writeElements(req, collection, [{ op: "upsert", id: key, base: book.stamps?.[key] ?? null, row: value }]);
  expect(w.status, `put back ${collection}: ${JSON.stringify(w.body).slice(0, 200)}`).toBe(200);
}

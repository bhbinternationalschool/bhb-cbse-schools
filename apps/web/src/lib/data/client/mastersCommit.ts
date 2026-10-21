/**
 * A Masters screen's "commit" — the list as the editor left it — turned into
 * stated element writes (data-layer 2.2b; used by useMastersMutation). Pure.
 *
 * The screens built in 2.2c edit a whole list in their form state (add a
 * subject, rename one, remove one) and then save. Sending that list whole is
 * exactly what wiped subjects on 10 Oct and the staff roster three times
 * (S1, the desk-prune wipes). So the commit is compared, element by element,
 * with the list the masters view served (which carries each element's
 * `_rev`), and only the differences go:
 *
 *  - a new id          → upsert, base null (the server refuses it if the id exists);
 *  - a changed element → upsert of it (minus `_rev`; a key the editor
 *                        dropped is sent as null), base = its `_rev` as read;
 *  - a missing id      → delete, base = its `_rev` as read;
 *  - unchanged         → nothing (an older `_rev` alone is not a change).
 *
 * Refused outright (nothing is sent):
 *  - MORE THAN ONE delete in one commit — removing is one element at a time;
 *    a commit that drops several is a stale or truncated copy, not a person
 *    removing things (every whole-list wipe looked like this);
 *  - a list that would become EMPTY while the server's has elements;
 *  - an element without a string id, or an id twice;
 *  - for an object slice (school profile …): no value, or an empty object.
 */
// `_rev` and the stamp came from the server's answer (the masters view): the
// one place a client may mint a Revision from a value (see types.ts).
import { asRevision, type Revision, type WriteOp } from "../types";

type Row = Record<string, unknown>;

export type MastersCommit = { ok: true; ops: WriteOp<Row>[] } | { ok: false; reason: string };

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (isObj(v)) {
    const out: Row = {};
    for (const k of Object.keys(v).sort()) {
      if (k === "_rev" || v[k] === undefined) continue;
      out[k] = stable(v[k]);
    }
    return out;
  }
  return v;
}

/** Same element, `_rev` aside (and key order, and undefined keys). */
export function sameElement(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
}

function revOf(el: Row): Revision {
  const r = el._rev;
  const n = typeof r === "number" && Number.isFinite(r) && r > 0 ? Math.floor(r) : 0;
  return asRevision(String(n));
}

function indexById(list: readonly unknown[], what: string, keyField: string): Map<string, Row> | string {
  const m = new Map<string, Row>();
  for (const el of list) {
    if (!isObj(el)) return `${what}: an element is not an object`;
    const id = el[keyField];
    if (typeof id !== "string" || !id) return `${what}: an element has no ${keyField}`;
    if (m.has(id)) return `${what}: ${id} appears twice`;
    m.set(id, el);
  }
  return m;
}

export function mastersListCommitOps(
  sliceKey: string,
  served: readonly unknown[] | null | undefined,
  next: readonly unknown[] | null | undefined,
  opts: { keyField?: string } = {},
): MastersCommit {
  const keyField = opts.keyField ?? "id";
  if (!Array.isArray(served)) return { ok: false, reason: `${sliceKey} has not been read from the server — nothing was saved.` };
  if (!Array.isArray(next)) return { ok: false, reason: `${sliceKey}: the edited list is missing — nothing was saved.` };
  const before = indexById(served, sliceKey, keyField);
  if (typeof before === "string") return { ok: false, reason: before };
  const after = indexById(next, sliceKey, keyField);
  if (typeof after === "string") return { ok: false, reason: after };

  if (before.size > 0 && after.size === 0) {
    return { ok: false, reason: `This save would leave ${sliceKey} empty — nothing was saved. Remove items one at a time.` };
  }
  const removed = [...before.keys()].filter((id) => !after.has(id));
  if (removed.length > 1) {
    return {
      ok: false,
      reason: `This save would remove ${removed.length} ${sliceKey} at once — nothing was saved. Remove one at a time.`,
    };
  }

  const ops: WriteOp<Row>[] = [];
  for (const id of removed) ops.push({ op: "delete", id, base: revOf(before.get(id)!) });
  for (const [id, el] of after) {
    const prev = before.get(id);
    if (prev && sameElement(prev, el)) continue;
    const row: Row = { ...el };
    delete row._rev;
    if (prev) {
      // The kernel patches an element: a key the editor dropped must be said.
      for (const k of Object.keys(prev)) if (k !== "_rev" && !(k in row)) row[k] = null;
    }
    ops.push({ op: "upsert", id, base: prev ? revOf(prev) : null, row });
  }
  return { ok: true, ops };
}

/** One object slice (schoolProfile, …): the whole value, based on the slice stamp the view served. */
export function mastersObjectCommitOp(
  sliceKey: string,
  served: unknown,
  next: unknown,
  stamp: string | null | undefined,
): MastersCommit {
  if (!isObj(next) || Object.keys(next).length === 0) {
    return { ok: false, reason: `${sliceKey}: an empty value is not saved.` };
  }
  if (served !== undefined && served !== null && !stamp) {
    return { ok: false, reason: `${sliceKey}: the server did not say which version was read — reload and try again.` };
  }
  if (isObj(served) && sameElement(served, next)) return { ok: true, ops: [] };
  return {
    ok: true,
    ops: [{ op: "upsert", id: sliceKey, base: stamp ? asRevision(stamp) : null, row: next }],
  };
}

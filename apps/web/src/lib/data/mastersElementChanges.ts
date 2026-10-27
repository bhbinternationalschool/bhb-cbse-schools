/**
 * Masters element changes made by lib/ code (data-layer 2.2e) — the fee
 * counter's concession grants, the RTE head waivers, the referral reward, the
 * revoke on a voided receipt, the fee-setup clone. Pure; used by the browser
 * (lib/data/client/mastersLibWrites.ts) and by the server
 * (lib/data/server/mastersLibWrites.server.ts).
 *
 * Until 2.2e each of these built a new whole book from the tab's copy and
 * pushed it (saveMasters): every concession grant, rule and fee line the tab
 * held went back to the server, and one stale or truncated tab was a wipe.
 * Now a caller states WHAT it changes, element by element:
 *
 *  - create  a new element (new id). Refused if the id is already stored —
 *            unless `ifAbsent` (a deterministic id such as the RTE waiver
 *            rule: already there = nothing to do);
 *  - patch   only the keys it sets, on the element AS STORED NOW, at the
 *            `_rev` just read — and only if those keys still hold what the
 *            caller saw (`expect`). Someone else's change to another key of
 *            the same element is kept; a change to a key this caller sets is
 *            a conflict, nothing written;
 *  - delete  the element at the `_rev` just read (already gone = nothing).
 *
 * All the ops of one user action go in ONE all-or-none batch
 * (POST /api/data/masters/batch → desk_slice_rows_write).
 */
import { COLLECTIONS, collectionKind } from "./registry";
import { asRevision, type Revision, type WriteOp } from "./types";

type Row = Record<string, unknown>;

export type MastersElementChange =
  | { readonly kind: "create"; readonly sliceKey: string; readonly id: string; readonly row: Row; readonly ifAbsent?: boolean }
  | { readonly kind: "patch"; readonly sliceKey: string; readonly id: string; readonly expect: Row; readonly set: Row }
  | { readonly kind: "delete"; readonly sliceKey: string; readonly id: string };

export type PlannedElementOp = { collection: string; sliceKey: string; op: WriteOp<Row> };

export type ElementChangePlan =
  | { ok: true; ops: PlannedElementOp[] }
  | { ok: false; kind: "conflict" | "invalid"; message: string };

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** The `_rev` list collection of masters_desk_slices for this key, or null. */
export function mastersListCollection(sliceKey: string): string | null {
  const def = COLLECTIONS.find(
    (c) => c.module === "masters" && c.slice?.table === "masters_desk_slices" && c.slice.key === sliceKey,
  );
  if (!def || collectionKind(def) !== "slice" || def.slice?.base !== "rev") return null;
  return def.id;
}

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

/**
 * Two values of one key, the way a normalised tab copy and the stored element
 * can differ without anyone having changed anything: absent, null and ""
 * are the same "nothing" (normalizeConcessionGrant fills `ground: ""`,
 * `effectiveTo: null`).
 */
export function sameValue(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);
  return JSON.stringify(stable(n(a))) === JSON.stringify(stable(n(b)));
}

function revOf(el: Row): Revision {
  const r = el._rev;
  const n = typeof r === "number" && Number.isFinite(r) && r > 0 ? Math.floor(r) : 0;
  return asRevision(String(n));
}

function byId(list: unknown): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const el of Array.isArray(list) ? list : []) {
    if (isObj(el) && typeof el.id === "string" && el.id && !m.has(el.id)) m.set(el.id, el);
  }
  return m;
}

/**
 * The element changes between two books, for the named lists: a new id is a
 * create, a changed element a patch of the keys that changed (expecting what
 * `before` held), a missing id a delete. Keys a lib function did not touch
 * are never sent, whatever the tab's copy says about them.
 */
export function diffMastersLists(
  before: unknown,
  after: unknown,
  keys: readonly string[],
  opts: { ifAbsent?: boolean } = {},
): MastersElementChange[] {
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const out: MastersElementChange[] = [];
  for (const sliceKey of keys) {
    const was = byId(b[sliceKey]);
    const now = byId(a[sliceKey]);
    for (const [id, el] of now) {
      const prev = was.get(id);
      if (!prev) {
        const row = { ...el };
        delete row._rev;
        out.push({ kind: "create", sliceKey, id, row, ...(opts.ifAbsent ? { ifAbsent: true } : {}) });
        continue;
      }
      const set: Row = {};
      const expect: Row = {};
      for (const k of new Set([...Object.keys(prev), ...Object.keys(el)])) {
        if (k === "_rev" || k === "id") continue;
        if (sameValue(prev[k], el[k])) continue;
        set[k] = el[k] === undefined ? null : el[k];
        expect[k] = prev[k] ?? null;
      }
      if (Object.keys(set).length) out.push({ kind: "patch", sliceKey, id, expect, set });
    }
    for (const id of was.keys()) if (!now.has(id)) out.push({ kind: "delete", sliceKey, id });
  }
  return out;
}

/**
 * Turn changes into ops against the elements as STORED NOW (`served`, read
 * just before). Anything that no longer matches what the caller saw is a
 * conflict and nothing is planned.
 */
export function planMastersElementChanges(
  changes: readonly MastersElementChange[],
  served: (sliceKey: string) => ReadonlyMap<string, Row>,
): ElementChangePlan {
  const ops: PlannedElementOp[] = [];
  const seen = new Set<string>();
  for (const c of changes) {
    const collection = mastersListCollection(c.sliceKey);
    if (!collection) return { ok: false, kind: "invalid", message: `${c.sliceKey} is not a Masters list written element by element.` };
    if (typeof c.id !== "string" || !c.id) return { ok: false, kind: "invalid", message: `${c.sliceKey}: a change has no id.` };
    const key = `${c.sliceKey}|${c.id}`;
    if (seen.has(key)) return { ok: false, kind: "invalid", message: `${c.sliceKey}: ${c.id} is changed twice in one save.` };
    seen.add(key);
    const stored = served(c.sliceKey).get(c.id);
    if (c.kind === "create") {
      if (stored) {
        if (c.ifAbsent) continue;
        return { ok: false, kind: "conflict", message: `${c.sliceKey}: ${c.id} already exists — nothing was saved.` };
      }
      const row: Row = { ...c.row, id: c.id };
      delete row._rev;
      ops.push({ collection, sliceKey: c.sliceKey, op: { op: "upsert", id: c.id, base: null, row } });
      continue;
    }
    if (c.kind === "delete") {
      if (!stored) continue;
      ops.push({ collection, sliceKey: c.sliceKey, op: { op: "delete", id: c.id, base: revOf(stored) } });
      continue;
    }
    if (!stored) {
      return { ok: false, kind: "conflict", message: `${c.sliceKey}: ${c.id} was removed elsewhere — nothing was saved.` };
    }
    const set: Row = {};
    for (const [k, v] of Object.entries(c.set)) {
      if (k === "_rev" || k === "id") continue;
      if (sameValue(stored[k], v)) continue; // already so
      if (!sameValue(stored[k], c.expect[k])) {
        return {
          ok: false,
          kind: "conflict",
          message: `${c.sliceKey}: ${c.id} was changed on another device a moment ago — nothing was saved. Reload and try again.`,
        };
      }
      set[k] = v;
    }
    if (Object.keys(set).length === 0) continue;
    ops.push({ collection, sliceKey: c.sliceKey, op: { op: "upsert", id: c.id, base: revOf(stored), row: set } });
  }
  return { ok: true, ops };
}

/** The marker the counter writes into a grant born from a receipt (counterConcession). */
export function voucherGrantMarker(voucherId: string): string {
  return `[v:${voucherId}]`;
}

/**
 * The grants a voided receipt must revoke: every stored grant carrying the
 * receipt's marker that is not already rejected — read from the server, not
 * from a tab (a grant made from another tab is revoked too). Rejection, not
 * deletion: the grant stays on file with the void note.
 */
export function revokeChangesForVoucher(
  storedGrants: Iterable<Row>,
  voucher: { id: string; receiptNo: string },
  todayIso: string,
): MastersElementChange[] {
  if (!voucher.id) return [];
  const marker = voucherGrantMarker(voucher.id);
  const out: MastersElementChange[] = [];
  for (const g of storedGrants) {
    const id = typeof g.id === "string" ? g.id : "";
    const reason = typeof g.reason === "string" ? g.reason : "";
    if (!id || g.status === "rejected" || !reason.includes(marker)) continue;
    out.push({
      kind: "patch",
      sliceKey: "concessionGrants",
      id,
      expect: { status: g.status ?? null, reason },
      set: { status: "rejected", reason: `${reason} · auto-revoked — receipt ${voucher.receiptNo} voided ${todayIso}` },
    });
  }
  return out;
}

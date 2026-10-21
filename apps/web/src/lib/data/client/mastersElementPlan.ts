/**
 * The Masters editor's commit, as element writes (data-layer 2.2c). Pure.
 *
 * The editor's panels still hand MastersWorkspace a whole book (`next`) built
 * from the book on screen (`shown`): "add a section" is `{...shown, sections:
 * [...shown.sections, sec]}`. Since 2.2c nothing of the Foundation lists is
 * ever sent whole. This turns the difference between `shown` and `next` into
 * stated element writes, each based on the revision of the element as the
 * screen showed it (the revision a save of this tab answered for it, else the
 * `_rev` it carries, else the one the masters view served):
 *
 *  - an element that differs between shown and next → one upsert of it (the
 *    whole element as the editor holds it, minus `_rev`; a key the served one
 *    has and the edited one lacks is sent as null), on the base above (null
 *    when the server has no such element and this tab saved none: a new one);
 *  - an element in shown and not in next → a delete on the same base,
 *    ONE PER REQUEST (the server refuses more than one removal per save — a
 *    user action that removes several, e.g. a subject with its components from
 *    a class, is several saves in a row, the parent first);
 *  - an object slice (school profile, timing, statutory setup) that differs →
 *    one upsert of the object on the stamp the view served;
 *  - a change to a staff record's class / subject teacher links → a link
 *    change (added links, removed link ids) for that member, applied by the
 *    caller to the record AS STORED (sis.staff, data-layer 2.2b);
 *  - any other key that changed (fee setup — 2.2e; staff setup — 2.2d) is
 *    returned in `rest` for the old save, unchanged here.
 *
 * Elements nobody touched are never sent, whatever the view or the overlay
 * says about them: a stale answer on screen cannot be written back over a
 * newer save (the 2.1h overlay fault), and two people editing different
 * elements of one list both land (director, 20 Oct 2026).
 *
 * Refused outright, nothing sent: a list that would become empty while the
 * server's has elements; an element without an id or an id twice; more than
 * MAX_REMOVALS removals in one action.
 */
import { COLLECTIONS, collectionKind } from "../registry";
import { asRevision, type Revision, type WriteOp } from "../types";
import { sameElement } from "./mastersCommit";

type Row = Record<string, unknown>;

/** The Foundation lists, parents before children (the order requests go in). */
export const FOUNDATION_LIST_KEYS = [
  "campuses",
  "academicYears",
  "academicTerms",
  "classes",
  "sections",
  "subjects",
  "seniorStreams",
  "classSubjects",
  "numberSeries",
  "holidays",
] as const;

/** The Foundation objects (one value each, written on the slice stamp). */
export const FOUNDATION_OBJECT_KEYS = ["schoolProfile", "schoolTiming", "statutoryConfig"] as const;

/** The staff-record fields the Masters editor changes: class and subject teacher links. */
export const STAFF_LINK_FIELDS = ["classTeacherLinks", "subjectTeachingLinks"] as const;

export type FoundationKey = (typeof FOUNDATION_LIST_KEYS)[number] | (typeof FOUNDATION_OBJECT_KEYS)[number];

/** One action may remove at most this many elements (each its own save). A stale or truncated copy removes far more. */
export const MAX_REMOVALS = 12;

export type ElementRequest = {
  sliceKey: FoundationKey;
  /** The registry collection (masters.classes …). */
  collection: string;
  kind: "slice" | "object";
  ops: WriteOp<Row>[];
};

export type StaffLinkChange = {
  staffId: string;
  field: (typeof STAFF_LINK_FIELDS)[number];
  /** Links to add (or replace, same id). */
  put: Row[];
  /** Link ids to take off. */
  remove: string[];
};

export type ElementPlan =
  | {
      ok: true;
      /** In order: upserts per list (parents first), objects, then one request per removal (parents first). */
      requests: ElementRequest[];
      staff: StaffLinkChange[];
      /** Other changed keys, for the old save (fees 2.2e, staff setup 2.2d). */
      rest: string[];
    }
  | { ok: false; reason: string };

/** The revision this tab already holds for an element (a save it made that the view has not served yet). */
export type RevisionOverride = (sliceKey: string, id: string) => Revision | undefined;

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** The registry collection writing this Foundation key. */
export function foundationCollection(sliceKey: string): { id: string; kind: "slice" | "object" } | null {
  const def = COLLECTIONS.find((c) => c.module === "masters" && c.slice?.table === "masters_desk_slices" && c.slice.key === sliceKey);
  if (!def) return null;
  const kind = collectionKind(def);
  return kind === "rows" ? null : { id: def.id, kind };
}

function indexById(list: unknown, what: string): Map<string, Row> | string {
  const m = new Map<string, Row>();
  if (list == null) return m;
  if (!Array.isArray(list)) return `${what} is not a list`;
  for (const el of list) {
    if (!isObj(el)) return `${what}: an element is not an object`;
    const id = el.id;
    if (typeof id !== "string" || !id) return `${what}: an element has no id`;
    if (m.has(id)) return `${what}: ${id} appears twice`;
    m.set(id, el);
  }
  return m;
}

function servedRev(el: Row | undefined): Revision | null {
  if (!el) return null;
  const r = el._rev;
  const n = typeof r === "number" && Number.isFinite(r) && r > 0 ? Math.floor(r) : 0;
  return asRevision(String(n));
}

function changedKeys(a: Row, b: Row): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("version");
  return [...keys].filter((k) => !sameElement(a[k], b[k])).sort();
}

/** The staff link changes between two rosters, or null when anything else on a staff record changed. */
function staffLinkChanges(shown: unknown, next: unknown): StaffLinkChange[] | null {
  const a = indexById(shown, "staff");
  const b = indexById(next, "staff");
  if (typeof a === "string" || typeof b === "string") return null;
  if (a.size !== b.size) return null;
  const out: StaffLinkChange[] = [];
  for (const [id, after] of b) {
    const before = a.get(id);
    if (!before) return null;
    for (const k of changedKeys(before, after)) {
      if (!(STAFF_LINK_FIELDS as readonly string[]).includes(k)) return null;
      const field = k as StaffLinkChange["field"];
      const was = indexById(before[field] ?? [], `${field} of ${id}`);
      const now = indexById(after[field] ?? [], `${field} of ${id}`);
      if (typeof was === "string" || typeof now === "string") return null;
      const put = [...now.values()].filter((l) => !was.has(String(l.id)) || !sameElement(was.get(String(l.id)), l));
      const remove = [...was.keys()].filter((lid) => !now.has(lid));
      if (put.length || remove.length) out.push({ staffId: id, field, put, remove });
    }
  }
  return out;
}

export function planMastersElementCommit(input: {
  /** The book on screen (what the panel built `next` from). */
  shown: unknown;
  /** The book the panel committed. */
  next: unknown;
  /** The masters view's book as served (elements carry `_rev`). */
  served: unknown;
  /** The masters view's object-slice stamps. */
  stamps?: Readonly<Record<string, string>> | null;
  revisionOf?: RevisionOverride;
}): ElementPlan {
  const shown = isObj(input.shown) ? input.shown : {};
  const next = isObj(input.next) ? input.next : {};
  const served = isObj(input.served) ? input.served : {};
  const changed = changedKeys(shown, next);
  const rest: string[] = [];
  const upserts: ElementRequest[] = [];
  const objects: ElementRequest[] = [];
  const removals: ElementRequest[] = [];
  let staff: StaffLinkChange[] = [];

  for (const key of changed) {
    if (key === "staff") {
      const links = staffLinkChanges(shown.staff, next.staff);
      if (links === null) rest.push(key);
      else staff = links;
      continue;
    }
    const target = foundationCollection(key);
    const isList = (FOUNDATION_LIST_KEYS as readonly string[]).includes(key);
    const isObject = (FOUNDATION_OBJECT_KEYS as readonly string[]).includes(key);
    if (!target || (!isList && !isObject)) {
      rest.push(key);
      continue;
    }
    const sliceKey = key as FoundationKey;
    if (isObject) {
      const value = next[key];
      if (!isObj(value) || Object.keys(value).length === 0) return { ok: false, reason: `${key}: an empty value is not saved.` };
      const stamp = input.revisionOf?.(key, key) ?? (input.stamps?.[key] ? asRevision(input.stamps[key]) : null);
      if (served[key] != null && !stamp) {
        return { ok: false, reason: `${key}: the server did not say which version was read — reload and try again.` };
      }
      if (isObj(served[key]) && sameElement(served[key], value)) continue;
      objects.push({ sliceKey, collection: target.id, kind: "object", ops: [{ op: "upsert", id: key, base: stamp, row: value }] });
      continue;
    }
    const before = indexById(shown[key], key);
    if (typeof before === "string") return { ok: false, reason: before };
    const after = indexById(next[key], key);
    if (typeof after === "string") return { ok: false, reason: after };
    const onServer = indexById(served[key], key);
    if (typeof onServer === "string") return { ok: false, reason: onServer };
    // The base is the revision of the element AS THE SCREEN SHOWED IT: the
    // one a save of this tab answered, else the `_rev` the shown element
    // carries (a screen held on an older answer is then refused as stale, not
    // written over a newer save), else the served one (a read-time
    // normalisation that dropped `_rev`).
    const shownRev = (id: string): Revision | null => {
      const r = before.get(id)?._rev;
      return typeof r === "number" && Number.isFinite(r) && r > 0 ? asRevision(String(Math.floor(r))) : null;
    };
    const base = (id: string): Revision | null => input.revisionOf?.(key, id) ?? shownRev(id) ?? servedRev(onServer.get(id));

    const removed = [...before.keys()].filter((id) => !after.has(id) && onServer.has(id));
    if (onServer.size > 0 && removed.length >= onServer.size) {
      return { ok: false, reason: `This would leave ${key} empty — nothing was saved. Remove items one at a time.` };
    }
    const ops: WriteOp<Row>[] = [];
    for (const [id, el] of after) {
      const prevShown = before.get(id);
      if (prevShown && sameElement(prevShown, el)) continue;
      const prev = onServer.get(id);
      if (prev && sameElement(prev, el)) continue;
      const row: Row = { ...el };
      delete row._rev;
      // The kernel patches an element: a key the editor dropped must be said.
      if (prev) for (const k of Object.keys(prev)) if (k !== "_rev" && !(k in row)) row[k] = null;
      ops.push({ op: "upsert", id, base: prev || input.revisionOf?.(key, id) !== undefined ? base(id) : null, row });
    }
    if (ops.length) upserts.push({ sliceKey, collection: target.id, kind: "slice", ops });
    for (const id of removed) {
      removals.push({ sliceKey, collection: target.id, kind: "slice", ops: [{ op: "delete", id, base: base(id) }] });
    }
  }

  if (removals.length > MAX_REMOVALS) {
    return {
      ok: false,
      reason: `This would remove ${removals.length} items at once — nothing was saved. Remove them in smaller steps.`,
    };
  }
  const order = (k: string) => {
    const i = (FOUNDATION_LIST_KEYS as readonly string[]).indexOf(k);
    return i < 0 ? FOUNDATION_LIST_KEYS.length : i;
  };
  upserts.sort((a, b) => order(a.sliceKey) - order(b.sliceKey));
  removals.sort((a, b) => order(a.sliceKey) - order(b.sliceKey));
  return { ok: true, requests: [...upserts, ...objects, ...removals], staff, rest };
}

/** Apply link changes to a member's stored link list (the record as read just now). */
export function applyStaffLinkChange(stored: unknown, change: Pick<StaffLinkChange, "put" | "remove">): Row[] {
  const list = Array.isArray(stored) ? stored.filter(isObj) : [];
  const drop = new Set([...change.remove, ...change.put.map((l) => String(l.id))]);
  return [...list.filter((l) => !drop.has(String(l.id))), ...change.put];
}

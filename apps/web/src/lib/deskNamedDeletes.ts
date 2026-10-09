/**
 * Deletions a desk has to say out loud.
 *
 * A desk save no longer deletes rows by leaving them out (see
 * deskNamedDeletes.server.ts), so when a user really deletes something the
 * client records it here and the next push carries it as
 * `deletes: { table: ids[] }`. The record survives reloads and failed pushes,
 * and is forgotten only for the ids the server confirmed — a deletion
 * recorded while a push is in flight rides the next one.
 */

const KEY_PREFIX = "bhb_desk_named_deletes_v1:";

export type DeskDeletes = Record<string, string[]>;

const memory = new Map<string, DeskDeletes>();

function read(desk: string): DeskDeletes {
  const cached = memory.get(desk);
  if (cached) return cached;
  let out: DeskDeletes = {};
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(KEY_PREFIX + desk);
      const v = raw ? (JSON.parse(raw) as unknown) : null;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [table, ids] of Object.entries(v as Record<string, unknown>)) {
          if (Array.isArray(ids)) {
            const list = ids.filter((x): x is string => typeof x === "string" && x !== "");
            if (list.length) out[table] = list;
          }
        }
      }
    }
  } catch {
    out = {};
  }
  memory.set(desk, out);
  return out;
}

function write(desk: string, value: DeskDeletes) {
  memory.set(desk, value);
  try {
    if (typeof localStorage === "undefined") return;
    if (Object.keys(value).length) localStorage.setItem(KEY_PREFIX + desk, JSON.stringify(value));
    else localStorage.removeItem(KEY_PREFIX + desk);
  } catch {
    /* storage full — the in-memory copy still carries them for this tab */
  }
}

/** The user deleted these rows; the next push of this desk names them. */
export function recordDeskDeletion(desk: string, table: string, ids: readonly string[]) {
  const add = ids.filter(Boolean);
  if (!desk || !table || add.length === 0) return;
  const cur = read(desk);
  write(desk, { ...cur, [table]: [...new Set([...(cur[table] ?? []), ...add])] });
}

/** What the next push should carry. A copy: the caller may hold it across awaits. */
export function pendingDeskDeletes(desk: string): DeskDeletes {
  const cur = read(desk);
  const out: DeskDeletes = {};
  for (const [t, ids] of Object.entries(cur)) if (ids.length) out[t] = [...ids];
  return out;
}

/** The server accepted a push that carried `sent`; forget exactly those ids. */
export function confirmDeskDeletes(desk: string, sent: DeskDeletes) {
  const cur = read(desk);
  const next: DeskDeletes = {};
  for (const [t, ids] of Object.entries(cur)) {
    const done = new Set(sent[t] ?? []);
    const left = ids.filter((id) => !done.has(id));
    if (left.length) next[t] = left;
  }
  write(desk, next);
}

/** Test seam. */
export function resetDeskDeletesForTest() {
  memory.clear();
}

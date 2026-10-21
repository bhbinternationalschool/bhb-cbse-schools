/**
 * What the Masters editor shows between an ELEMENT save and the masters
 * view's answer that holds it (data-layer 2.2c; pure —
 * mastersElementPending.selftest.ts). Replaces, for the Foundation lists, the
 * 2.1h whole-book overlay (mastersPending.ts, which stays for the slices
 * still saved whole until 2.2d/2.2e).
 *
 * Why anything is held at all: after a save the view is refetched, but the
 * first answer can be older than the save (another Cloud Run instance's
 * masters cache re-checks erp_versions at most every 2 s; a failed refetch
 * keeps the old answer). Shown as it is, the edit would flick back.
 *
 * What changed from 2.1h: the overlay is per ELEMENT, not the whole book, and
 * the proof is the element's own `_rev`:
 *   - an upsert is held until an answer serves that element at the `_rev` the
 *     save answered (or later — someone else changed it since);
 *   - a delete until an answer no longer has the element;
 *   - an object slice until the view's stamp for it is the save's or later.
 * Everything else on screen is the server's latest answer — so another
 * person's change to a different element of the same list shows at the next
 * answer instead of waiting behind this tab's overlay. And holding an element
 * can never send it again: commits send only what an action changed
 * (mastersElementPlan.ts), on the `_rev` this overlay knows for it.
 *
 * A save that failed or conflicted drops its elements at once (the screen
 * shows the server's value; the editor says why). An entry that no answer
 * proves within HOLD_MS of its save is dropped too (the element was removed
 * elsewhere, say) — the screen then shows whatever the server says.
 */
import { asRevision, type Revision } from "@/lib/data/types";

type Row = Record<string, unknown>;

export const HOLD_MS = 60_000;

export type PendingElement = {
  sliceKey: string;
  id: string;
  kind: "slice" | "object" | "staff";
  /** The element as sent (upsert), or null (delete). For "staff": the member's changed fields. */
  value: Row | null;
  /** The revision the save answered for it ("" while saving). */
  revision: string;
  /** Which save (several elements share one). */
  saveId: number;
  /** When the save answered (0 while saving). */
  savedAt: number;
};

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** The book on screen: the server's answer with this tab's unproven saves laid on, element by element. */
export function withPending<T>(book: T, pending: readonly PendingElement[]): T {
  if (!pending.length || !isObj(book)) return book;
  const out: Row = { ...(book as Row) };
  for (const p of pending) {
    if (p.kind === "object") {
      if (p.value) out[p.sliceKey] = p.value;
      continue;
    }
    if (p.kind === "staff") {
      const list = Array.isArray(out.staff) ? (out.staff as Row[]) : [];
      out.staff = list.map((s) => (s.id === p.id && p.value ? { ...s, ...p.value } : s));
      continue;
    }
    const list = Array.isArray(out[p.sliceKey]) ? (out[p.sliceKey] as Row[]) : [];
    const at = list.findIndex((el) => isObj(el) && el.id === p.id);
    if (p.value === null) {
      if (at >= 0) out[p.sliceKey] = [...list.slice(0, at), ...list.slice(at + 1)];
    } else if (at >= 0) {
      out[p.sliceKey] = [...list.slice(0, at), { ...p.value, _rev: list[at]._rev }, ...list.slice(at + 1)];
    } else {
      out[p.sliceKey] = [...list, p.value];
    }
  }
  return out as T;
}

function revNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function laterOrSame(stamp: string | undefined, saved: string): boolean {
  if (!stamp) return false;
  const a = Date.parse(stamp);
  const b = Date.parse(saved);
  if (Number.isFinite(a) && Number.isFinite(b)) return a >= b;
  return stamp === saved;
}

/** Does this answer of the masters view prove the entry (so the server's value can be shown)? */
export function answerHolds(p: PendingElement, served: unknown, stamps: Readonly<Record<string, string>> | null | undefined): boolean {
  if (!p.revision || p.kind === "staff") return false;
  const book = isObj(served) ? served : {};
  if (p.kind === "object") return laterOrSame(stamps?.[p.sliceKey], p.revision);
  const list = Array.isArray(book[p.sliceKey]) ? (book[p.sliceKey] as unknown[]) : [];
  const el = list.find((e) => isObj(e) && e.id === p.id) as Row | undefined;
  if (p.value === null) return !el;
  return !!el && revNumber(el._rev) >= revNumber(p.revision);
}

/** Entries an answer leaves standing (proven ones and old ones go). */
export function pendingAfterAnswer(
  pending: readonly PendingElement[],
  served: unknown,
  stamps: Readonly<Record<string, string>> | null | undefined,
  now: number,
): PendingElement[] {
  const out = pending.filter((p) => !(answerHolds(p, served, stamps) || (p.savedAt > 0 && now - p.savedAt > HOLD_MS)));
  return out.length === pending.length ? (pending as PendingElement[]) : out;
}

/** A save answered: set the revisions it returned (versions[id]); a failed save drops its entries. */
export function pendingAfterSave(
  pending: readonly PendingElement[],
  saveId: number,
  answer: { ok: true; versions: Readonly<Record<string, Revision | string>> } | { ok: false },
  now: number,
): PendingElement[] {
  if (!answer.ok) return pending.filter((p) => p.saveId !== saveId);
  return pending.map((p) =>
    p.saveId !== saveId
      ? p
      : { ...p, revision: p.value === null ? "deleted" : String(answer.versions[p.id] ?? ""), savedAt: now },
  );
}

/** The revision this tab knows for an element it saved and the view has not served yet. */
export function pendingRevision(pending: readonly PendingElement[], sliceKey: string, id: string): Revision | undefined {
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i];
    if (p.sliceKey === sliceKey && p.id === id && p.value !== null && p.revision && p.kind !== "staff") {
      // The revision a save of this tab was ANSWERED (writeRecords' versions).
      return asRevision(p.revision);
    }
  }
  return undefined;
}

/**
 * Drop values the client will rebuild identically, before they hit the wire.
 *
 * A lead is serialised with all 79 fields whether or not they hold anything,
 * because emptyAdmissionLead() constructs a complete object literal. Measured
 * on all 919 production leads: 1.826 MB of JSON, of which 0.686 MB (37.5%) is
 * empty strings and nulls. Students are the same shape.
 *
 * Removing them is LOSSLESS, and that is a property of the client's own
 * normalizers rather than an assumption:
 *
 *     address: partial?.address || ""
 *     locality: partial?.locality || ""
 *
 * An absent key and an empty string produce the same result. So the client
 * reconstructs a stripped record byte-for-byte.
 *
 * Why this matters beyond bytes: on 2026-08-11 three deploys inside 70 seconds
 * restarted every container, every connected client re-hydrated at once
 * pulling ~4.8 MB each, and the pile-up queued past the 8s statement timeout —
 * 503s on sis-roster, admissions-desk, fees-vouchers and payment-links. The
 * screens read as "couldn't load data" and "classes unassigned" while the
 * database sat idle with every row intact. Smaller payloads make that herd
 * survivable.
 *
 * ── What is NOT stripped, and why ────────────────────────────────────────
 *
 * `false` and `0` are kept. They look like emptiness and are not:
 *
 *     whatsappSame: partial?.whatsappSame !== false
 *
 * Omit that key and `false` comes back as `true` — a parent's WhatsApp number
 * silently re-pointed. A first version of this stripped `false` and `0` and
 * would have saved 51% instead of 37.5%. The extra 13.5% was a data
 * corruption bug, caught by reading the normalizer rather than trusting the
 * shape.
 *
 * Nested objects and arrays are left alone. `docs`, `sisStudentInfo` and
 * friends are rebuilt by their own code paths, and this function does not know
 * their defaulting rules. Shallow, per-record, provably reversible.
 */

/** True for a value the client's `x || ""` defaulting will restore exactly. */
function isRebuildableEmpty(v: unknown): boolean {
  return v === "" || v === null || v === undefined;
}

/**
 * Strip rebuildable-empty top-level fields from one record.
 *
 * `keep` names fields that must survive even when empty — an id, or anything
 * a consumer distinguishes absent-from-empty on.
 */
export function stripEmptyForWire<T extends Record<string, unknown>>(
  record: T,
  keep: readonly string[] = ["id"],
): Partial<T> {
  const out: Record<string, unknown> = {};
  const keepSet = new Set(keep);
  for (const [k, v] of Object.entries(record)) {
    if (!keepSet.has(k) && isRebuildableEmpty(v)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Apply to every record in a list. */
export function stripEmptyList<T extends Record<string, unknown>>(
  records: readonly T[] | null | undefined,
  keep: readonly string[] = ["id"],
): Partial<T>[] {
  return (records ?? []).map((r) => stripEmptyForWire(r, keep));
}

/* ─── One level deeper: the document skeleton ─────────────────────────────
 *
 * `stripEmptyForWire` is shallow by design, and that left the largest single
 * thing on the wire untouched. Every student carries a `docs` object with a
 * fixed slot per document — birth certificate, photo, Aadhaar, TC and the
 * rest — and each slot is twelve fields whether or not a file was ever
 * uploaded.
 *
 * Measured on production: 4,991 slots across 713 students, 1014 kB, and
 * every single one empty. Not one student has a document on file. That is
 * 40% of the roster payload spent saying "nothing here", seven times per
 * child, and it is re-downloaded by every browser that opens a desk needing
 * the roster — the fee counter chief among them.
 *
 * Lossless for the same reason the shallow strip is, one level down:
 *
 *     normalizeStudentDocs(undefined) -> emptyStudentDocs()
 *     absent slot                     -> emptyDocFile()
 *
 * and `loadSis()` normalises every student on every read, so an omitted slot
 * is rebuilt before anything can observe its absence. `sisWirePayload.selftest`
 * asserts the round trip against the real normaliser rather than trusting
 * this comment.
 *
 * A slot is only dropped when it is empty in EVERY field. A status of
 * "pending" or "rejected", a review note, a file name with no URL — any of
 * these and the whole slot is sent untouched. The rule is deliberately
 * conservative: the saving is already the entire population, so there is
 * nothing to gain by trimming a slot that holds anything at all.
 */

/** True when a document slot holds nothing a normaliser would not rebuild. */
export function isEmptyDocSlot(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const slot = v as Record<string, unknown>;
  for (const [k, val] of Object.entries(slot)) {
    if (k === "status") {
      if (val !== "missing") return false;
      continue;
    }
    if (val === "" || val === 0 || val === null || val === undefined) continue;
    return false;
  }
  return true;
}

/**
 * Drop empty document slots from one student, and `docs` itself when every
 * slot is empty. Returns the record unchanged when there is nothing to drop.
 */
export function stripEmptyDocsForWire<T extends Record<string, unknown>>(
  record: T,
): T {
  const docs = record.docs;
  if (!docs || typeof docs !== "object" || Array.isArray(docs)) return record;

  const kept: Record<string, unknown> = {};
  for (const [key, slot] of Object.entries(docs as Record<string, unknown>)) {
    if (!isEmptyDocSlot(slot)) kept[key] = slot;
  }

  const entries = Object.keys(kept).length;
  if (entries === Object.keys(docs as Record<string, unknown>).length) {
    return record; // nothing was empty
  }

  const out = { ...record } as Record<string, unknown>;
  if (entries === 0) delete out.docs;
  else out.docs = kept;
  return out as T;
}

export function stripEmptyDocsList<T extends Record<string, unknown>>(
  records: readonly T[] | null | undefined,
): T[] {
  return (records ?? []).map((r) => stripEmptyDocsForWire(r));
}

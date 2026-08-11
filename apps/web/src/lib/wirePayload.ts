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

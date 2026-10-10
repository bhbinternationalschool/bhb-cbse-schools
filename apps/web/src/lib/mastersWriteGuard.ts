/**
 * Refuse a masters push that replaces the class-id generation wholesale.
 *
 * Every data loss incident on 2026-08-09 had the same shape: a client POSTed
 * masters carrying a freshly generated set of class ids, `pushMastersDeskToDb`
 * accepted it, and every `sis_students.class_id`, `admission_desk_leads
 * .class_sought_id` and `rte_desk_seats.class_id` in the database was orphaned
 * in one write — 711 students and 889 leads, three times over.
 *
 * The distinguishing signal is simple and does not depend on knowing which
 * client path is at fault: a legitimate edit (rename a class, add a section,
 * change a fee head) keeps the existing ids and touches a few rows, whereas a
 * re-seed shares *no* ids with what is stored. Requiring a single id in common
 * separates the two cleanly, and fails safe — when in doubt it rejects, and a
 * rejected push loses at most one client's unsaved masters edit, while an
 * accepted re-seed orphans the whole database.
 *
 * Kept free of server-only imports so it can be exercised directly; see
 * mastersWriteGuard.selftest.ts.
 */

export type MastersOverwriteVerdict =
  | { allow: true; reason: "bootstrap" | "overlaps" }
  | {
      allow: false;
      reason: "wipe" | "regenerated";
      storedCount: number;
      incomingCount: number;
      overlap: number;
      message: string;
    };

export function guardMastersOverwrite(
  storedClassIds: readonly string[],
  incomingClassIds: readonly string[],
): MastersOverwriteVerdict {
  const stored = new Set(storedClassIds.filter(Boolean));
  const incoming = new Set(incomingClassIds.filter(Boolean));

  // Nothing to protect yet — first write, or a tenant that has been wiped
  // deliberately. ensureDeskCutover seeds an empty shell through this path.
  if (stored.size === 0) return { allow: true, reason: "bootstrap" };

  if (incoming.size === 0) {
    return {
      allow: false,
      reason: "wipe",
      storedCount: stored.size,
      incomingCount: 0,
      overlap: 0,
      message:
        `Refusing masters push: it carries no classes while ${stored.size} are stored. ` +
        `An empty push deletes the slice and orphans every student, lead and RTE seat.`,
    };
  }

  let overlap = 0;
  for (const id of incoming) if (stored.has(id)) overlap += 1;
  if (overlap > 0) return { allow: true, reason: "overlaps" };

  return {
    allow: false,
    reason: "regenerated",
    storedCount: stored.size,
    incomingCount: incoming.size,
    overlap: 0,
    message:
      `Refusing masters push: none of its ${incoming.size} class ids match the ` +
      `${stored.size} stored ones, so this replaces the id generation wholesale ` +
      `and would orphan every reference to a class. If the masters really were ` +
      `rebuilt, clear the desk slices first.`,
  };
}

/**
 * Subjects and class–subject links, guarded like the classes (10 Oct 2026).
 *
 * A teacher's phone, saving Masters in the background, replaced the whole
 * subject list with a generic one under new ids: every teacher's subject
 * assignment, the timetable and the exam papers named ids that no longer
 * existed, and homework offered teachers no subjects. Removing a subject is
 * a deliberate one-at-a-time act on the Subjects screen; a save that drops
 * several at once is a stale or seeded copy, never an edit.
 */
export type ListGuardVerdict = { allow: true } | { allow: false; removed: number; stored: number; message: string };

export function guardListShrink(
  label: string,
  storedIds: string[],
  incomingIds: string[],
  opts: { maxRemoved: number; maxShare: number },
): ListGuardVerdict {
  const incoming = new Set(incomingIds);
  const removed = storedIds.filter((id) => !incoming.has(id)).length;
  if (removed > opts.maxRemoved && removed > storedIds.length * opts.maxShare) {
    return {
      allow: false,
      removed,
      stored: storedIds.length,
      message: `This save would remove ${removed} of ${storedIds.length} ${label} at once — that is a stale copy, not an edit. Nothing was saved; the screen will refresh.`,
    };
  }
  return { allow: true };
}

export function guardSubjectsOverwrite(
  stored: { subjects?: { id: string }[]; classSubjects?: { id: string }[] },
  incoming: { subjects?: { id: string }[]; classSubjects?: { id: string }[] },
): ListGuardVerdict {
  if (Array.isArray(incoming.subjects) && Array.isArray(stored.subjects)) {
    const v = guardListShrink("subjects", stored.subjects.map((s) => s.id), incoming.subjects.map((s) => s.id), { maxRemoved: 2, maxShare: 0.1 });
    if (!v.allow) return v;
  }
  if (Array.isArray(incoming.classSubjects) && Array.isArray(stored.classSubjects)) {
    const v = guardListShrink("class–subject links", stored.classSubjects.map((s) => s.id), incoming.classSubjects.map((s) => s.id), { maxRemoved: 10, maxShare: 0.25 });
    if (!v.allow) return v;
  }
  return { allow: true };
}

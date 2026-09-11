/**
 * One child's library record: what they are holding, what is late, and what
 * came back damaged.
 *
 * The library desk is organised by TITLE and by COPY — "where is accession
 * MATH-0043" — so the child-shaped question ("has he returned the book?
 * does he owe a fine? can he borrow another one?") had no screen. It is
 * asked at the counter, at the gate, and on the day a leaving certificate is
 * signed, which is the last chance the school has to get a book back.
 *
 * One rule drives the shape of this: A BOOK STILL OUT FROM LAST SESSION IS
 * STILL OUT. Everything else on the profile is scoped to the running year;
 * scoping the "currently issued" list the same way would quietly forgive
 * every book borrowed in March and never returned — which is exactly the
 * set the school loses.
 */

import type {
  LibraryIssue,
  LibraryItemCondition,
  LibraryState,
} from "@/lib/library";

export type StudentBookRow = {
  issueId: string;
  titleId: string;
  title: string;
  author: string;
  accessionNo: string;
  academicYearCode: string;
  issuedOn: string;
  dueOn: string;
  returnedOn: string;
  /** Whole days past the due date, as of the given day. 0 when not late. */
  daysLate: number;
  finePaise: number;
  issueCondition: LibraryItemCondition | undefined;
  returnCondition: LibraryItemCondition | undefined;
  /** Came back damaged or torn — the school usually charges for this. */
  damagedOnReturn: boolean;
  damageNote: string;
};

export type StudentLibraryRecord = {
  /** Not returned yet — every session, not just this one. */
  out: StudentBookRow[];
  /** Returned, newest return first. */
  returned: StudentBookRow[];
  /** Of `out`, the ones past their due date. */
  overdue: StudentBookRow[];
  /** Longest overdue run in days, 0 when nothing is late. */
  worstDaysLate: number;
  borrowedEver: number;
  /** Fines recorded on this child's returns — collected or not, the desk decides. */
  finePaise: number;
  damagedReturns: number;
  lastBorrowedOn: string;
};

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00.000Z`);
  const b = Date.parse(`${toIso}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function studentLibraryRecord(
  state: LibraryState,
  studentId: string,
  opts?: { today?: string },
): StudentLibraryRecord {
  const today = opts?.today || new Date().toISOString().slice(0, 10);

  const rows: StudentBookRow[] = (state.issues || [])
    .filter((i: LibraryIssue) => i.borrowerType === "student")
    .filter((i) => i.studentId === studentId)
    .map((i) => {
      const copy = (state.copies || []).find((c) => c.id === i.copyId);
      const title = copy
        ? (state.titles || []).find((t) => t.id === copy.titleId)
        : undefined;
      const returnedOn = i.returnedOn || "";
      const dueOn = i.dueOn || "";
      const late =
        !returnedOn && dueOn && dueOn < today ? daysBetween(dueOn, today) : 0;
      const returnCondition = i.returnCondition;
      return {
        issueId: i.id,
        titleId: copy?.titleId || "",
        // A copy or title that no longer resolves is said to be missing
        // rather than left blank: "(title not found)" sends the clerk to the
        // catalogue, an empty cell sends nobody anywhere.
        title: title?.title || "(title not in the catalogue)",
        author: title?.author || "",
        accessionNo: copy?.accessionNo || "(copy not found)",
        academicYearCode: i.academicYearCode || "",
        issuedOn: i.issuedOn || "",
        dueOn,
        returnedOn,
        daysLate: late,
        finePaise: i.finePaise || 0,
        issueCondition: i.issueCondition,
        returnCondition,
        damagedOnReturn:
          returnCondition === "damaged" || returnCondition === "torn",
        damageNote: i.damageNoteOnReturn || "",
      };
    });

  const out = rows
    .filter((r) => !r.returnedOn)
    .sort(
      (a, b) =>
        (a.dueOn || "9999-12-31").localeCompare(b.dueOn || "9999-12-31") ||
        a.issueId.localeCompare(b.issueId),
    );
  const returned = rows
    .filter((r) => r.returnedOn)
    .sort(
      (a, b) =>
        b.returnedOn.localeCompare(a.returnedOn) ||
        b.issueId.localeCompare(a.issueId),
    );
  const overdue = out.filter((r) => r.daysLate > 0);

  return {
    out,
    returned,
    overdue,
    worstDaysLate: overdue.reduce((m, r) => Math.max(m, r.daysLate), 0),
    borrowedEver: rows.length,
    finePaise: rows.reduce((s, r) => s + r.finePaise, 0),
    damagedReturns: returned.filter((r) => r.damagedOnReturn).length,
    lastBorrowedOn: rows
      .map((r) => r.issuedOn)
      .filter(Boolean)
      .sort()
      .at(-1) || "",
  };
}

/** Nothing borrowed, ever — the profile shows no card. */
export function libraryRecordIsEmpty(r: StudentLibraryRecord): boolean {
  return r.borrowedEver === 0;
}

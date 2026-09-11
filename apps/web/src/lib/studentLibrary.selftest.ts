/**
 * Run: npx tsx src/lib/studentLibrary.selftest.ts
 *
 * The rule worth a test of its own: a book still out from LAST session is
 * still out. Every other panel on the profile is scoped to the running year;
 * scoping this one the same way would quietly forgive every book borrowed in
 * March and never returned — which is exactly the set the school loses.
 */
import assert from "node:assert/strict";
import { emptyLibraryState, type LibraryIssue, type LibraryState } from "./library";
import { libraryRecordIsEmpty, studentLibraryRecord } from "./studentLibrary";

console.log("studentLibrary.selftest.ts");

const TODAY = "2026-09-11";
const KID = "st1";

function base(): LibraryState {
  return {
    ...emptyLibraryState(),
    titles: [
      {
        id: "t1",
        isbn: "978",
        title: "Panchatantra",
        author: "Vishnu Sharma",
        publisher: "",
        edition: "",
        category: "story",
        shelf: "A1",
        purchaseDate: "2025-06-01",
        pricePaise: 25000,
        copiesTotal: 2,
        isActive: true,
      },
    ],
    copies: [
      { id: "c1", titleId: "t1", accessionNo: "PANCH-0001", barcode: "", status: "issued" },
      { id: "c2", titleId: "t1", accessionNo: "PANCH-0002", barcode: "", status: "available" },
    ],
    issues: [],
  } as unknown as LibraryState;
}

let n = 0;
function issue(p: Partial<LibraryIssue>): LibraryIssue {
  n += 1;
  return {
    id: `i${n}`,
    copyId: "c1",
    borrowerType: "student",
    studentId: KID,
    staffId: "",
    academicYearCode: "2026-27",
    issuedOn: "2026-09-01",
    dueOn: "2026-09-08",
    finePaise: 0,
    issuedBy: "librarian",
    note: "",
    issueCondition: "good",
    damageNoteOnIssue: "",
    damageNoteOnReturn: "",
    ...p,
  };
}

// --- never borrowed: no card ------------------------------------------
{
  const r = studentLibraryRecord(base(), KID, { today: TODAY });
  assert.equal(r.borrowedEver, 0);
  assert.ok(libraryRecordIsEmpty(r));
  assert.equal(r.worstDaysLate, 0);
}

// --- out and late, with the days counted ------------------------------
{
  const s = { ...base(), issues: [issue({ dueOn: "2026-09-04" })] };
  const r = studentLibraryRecord(s, KID, { today: TODAY });
  assert.equal(r.out.length, 1);
  assert.equal(r.overdue.length, 1);
  assert.equal(r.out[0]?.daysLate, 7, "4th to 11th");
  assert.equal(r.worstDaysLate, 7);
  assert.equal(r.out[0]?.title, "Panchatantra");
  assert.equal(r.out[0]?.accessionNo, "PANCH-0001");
}

// --- out but not yet due is not late ----------------------------------
{
  const s = { ...base(), issues: [issue({ dueOn: "2026-09-20" })] };
  const r = studentLibraryRecord(s, KID, { today: TODAY });
  assert.equal(r.out.length, 1);
  assert.equal(r.overdue.length, 0);
  assert.equal(r.out[0]?.daysLate, 0);
}

// --- LAST SESSION'S UNRETURNED BOOK IS STILL OUT ----------------------
{
  const s = {
    ...base(),
    issues: [
      issue({
        academicYearCode: "2025-26",
        issuedOn: "2026-03-02",
        dueOn: "2026-03-09",
      }),
    ],
  };
  const r = studentLibraryRecord(s, KID, { today: TODAY });
  assert.equal(
    r.out.length,
    1,
    "borrowed in March, never returned — the school's loss, not forgiven",
  );
  assert.equal(r.overdue.length, 1);
  assert.ok(r.out[0]!.daysLate > 180);
}

// --- returned, with a fine and damage ---------------------------------
{
  const s = {
    ...base(),
    issues: [
      issue({
        id: "done",
        returnedOn: "2026-09-09",
        finePaise: 2000,
        returnCondition: "torn",
        damageNoteOnReturn: "Back cover missing",
      }),
    ],
  };
  const r = studentLibraryRecord(s, KID, { today: TODAY });
  assert.equal(r.out.length, 0, "it came back");
  assert.equal(r.overdue.length, 0);
  assert.equal(r.returned.length, 1);
  assert.equal(r.finePaise, 2000);
  assert.equal(r.damagedReturns, 1);
  assert.equal(r.returned[0]?.damagedOnReturn, true);
  assert.equal(r.returned[0]?.damageNote, "Back cover missing");
  assert.equal(
    r.returned[0]?.daysLate,
    0,
    "a returned book is not accruing lateness",
  );
}

// --- another child's issue, and a staff issue, stay out ---------------
{
  const s = {
    ...base(),
    issues: [
      issue({ studentId: "someone_else" }),
      issue({ borrowerType: "staff", studentId: "", staffId: KID }),
      issue({ id: "mine" }),
    ],
  };
  const r = studentLibraryRecord(s, KID, { today: TODAY });
  assert.equal(r.borrowedEver, 1, "only this child's own student issues");
  assert.equal(r.out[0]?.issueId, "mine");
}

// --- a copy that no longer resolves is named, not blanked -------------
{
  const s = { ...base(), issues: [issue({ copyId: "gone" })] };
  const r = studentLibraryRecord(s, KID, { today: TODAY });
  assert.match(r.out[0]?.title || "", /not in the catalogue/);
  assert.match(r.out[0]?.accessionNo || "", /not found/);
}

// --- ordering: soonest due first out, newest return first in history --
{
  const s = {
    ...base(),
    issues: [
      issue({ id: "later", dueOn: "2026-09-30" }),
      issue({ id: "sooner", dueOn: "2026-09-12" }),
      issue({ id: "ret_old", returnedOn: "2026-08-01" }),
      issue({ id: "ret_new", returnedOn: "2026-09-05" }),
    ],
  };
  const r = studentLibraryRecord(s, KID, { today: TODAY });
  assert.deepEqual(r.out.map((x) => x.issueId), ["sooner", "later"]);
  assert.deepEqual(r.returned.map((x) => x.issueId), ["ret_new", "ret_old"]);
  assert.equal(r.borrowedEver, 4);
}

console.log("  all student-library assertions passed");

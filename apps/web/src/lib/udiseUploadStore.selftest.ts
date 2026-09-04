/**
 * Merging a second UDISE+ export into the sheet already being worked.
 *
 * The failure that matters is silent: a class-wise export replacing the whole
 * working set, so rows the office reconciled last week simply disappear and
 * have to be uploaded again. That is the loop this exists to end.
 */
import assert from "node:assert/strict";
import { mergeUdiseMatrices, udiseRowKey } from "@/lib/udiseUploadStore";

const COLS = { pen: 0, apaar: 1, name: 2, dob: 3 };
const HEAD = ["PEN", "APAAR ID", "Name", "Date of Birth"];
const row = (pen: string, apaar: string, name: string, dob: string) => [pen, apaar, name, dob];

function run() {
  /* ── the key: PEN first, then APAAR, then name+DOB ─────────────────── */
  assert.equal(udiseRowKey(row("P1", "A1", "Asha", "01/01/2018"), COLS), "pen:p1");
  assert.equal(udiseRowKey(row("", "A1", "Asha", "01/01/2018"), COLS), "apaar:a1");
  assert.equal(udiseRowKey(row("", "", "Asha", "01/01/2018"), COLS), "nd:asha|01/01/2018");
  // A dash is how the portal writes "none" — it must not become an identity.
  assert.equal(udiseRowKey(row("-", "-", "Asha", "01/01/2018"), COLS), "nd:asha|01/01/2018");
  // Case and spacing must not split one child into two rows.
  assert.equal(
    udiseRowKey(row(" p1 ", "", "", ""), COLS),
    udiseRowKey(row("P1", "", "", ""), COLS),
  );
  // A name with no DOB identifies nobody: two such rows must NOT merge.
  const a = udiseRowKey(row("", "", "Asha", ""), COLS);
  const b = udiseRowKey(row("", "", "Bina", ""), COLS);
  assert.notEqual(a, b);

  /* ── first upload: nothing to merge into ───────────────────────────── */
  const first = mergeUdiseMatrices({
    existing: null,
    incoming: [HEAD, row("P1", "", "Asha", "01/01/2018"), row("P2", "", "Bina", "02/02/2018")],
    headerRowIndex: 0,
    cols: COLS,
  });
  assert.equal(first.matrix.length, 3);
  assert.equal(first.added, 2);

  /* ── THE ONE THAT MATTERS: a class-wise second file must not wipe the
        rows the office already reconciled from the first ──────────────── */
  const second = mergeUdiseMatrices({
    existing: first.matrix,
    incoming: [HEAD, row("P3", "", "Chetan", "03/03/2018")],
    headerRowIndex: 0,
    cols: COLS,
  });
  assert.equal(second.added, 1);
  assert.equal(second.matrix.length, 4, "P1 and P2 must survive a file that never mentions them");
  const pens = second.matrix.slice(1).map((r) => r[0]);
  assert.deepEqual(pens, ["P1", "P2", "P3"], "earlier rows keep their order, new ones append");

  /* ── the portal is the authority on its own data ───────────────────── */
  const updated = mergeUdiseMatrices({
    existing: second.matrix,
    incoming: [HEAD, row("P1", "AP-NEW", "Asha Devi", "01/01/2018")],
    headerRowIndex: 0,
    cols: COLS,
  });
  assert.equal(updated.updated, 1);
  assert.equal(updated.added, 0);
  assert.equal(updated.matrix.length, 4, "an update replaces, it does not duplicate");
  const asha = updated.matrix.slice(1).find((r) => r[0] === "P1")!;
  assert.equal(asha[1], "AP-NEW", "a later export is later news");
  assert.equal(asha[2], "Asha Devi");

  /* ── re-uploading the same file changes nothing ────────────────────── */
  const again = mergeUdiseMatrices({
    existing: updated.matrix,
    incoming: [HEAD, row("P1", "AP-NEW", "Asha Devi", "01/01/2018")],
    headerRowIndex: 0,
    cols: COLS,
  });
  assert.equal(again.unchanged, 1);
  assert.equal(again.added, 0);
  assert.equal(again.updated, 0);
  assert.equal(again.matrix.length, 4, "re-uploading must not grow the sheet");

  /* ── a child who gains a PEN arrives as a NEW row, because the portal
        now identifies them differently. Losing the old one would be worse:
        it still holds what the office reconciled. ──────────────────────── */
  const gained = mergeUdiseMatrices({
    existing: [HEAD, row("", "", "Deep", "04/04/2018")],
    incoming: [HEAD, row("P9", "", "Deep", "04/04/2018")],
    headerRowIndex: 0,
    cols: COLS,
  });
  assert.equal(gained.added, 1);
  assert.equal(gained.matrix.length, 3);

  /* ── a header further down the sheet is respected ──────────────────── */
  const withPreamble = mergeUdiseMatrices({
    existing: null,
    incoming: [["UDISE+ Report"], [], HEAD, row("P1", "", "Asha", "01/01/2018")],
    headerRowIndex: 2,
    cols: COLS,
  });
  assert.equal(withPreamble.added, 1);

  console.log("udiseUploadStore selftest: ok");
}

run();

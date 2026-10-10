/**
 * Merging UDISE+ exports into the working sheet.
 *
 * Two failures here were real, not hypothetical (2026-09-05):
 *
 *  - The office uploaded both layouts the portal offers. Raw rows of the
 *    23-column export stored under the 66-column header became pupils called
 *    "Female" with a birth date of "AARVI SINGH".
 *  - "NA" was taken as an identity, so every child without an APAAR collapsed
 *    into one row and about 110 pupils vanished from a 213-row upload.
 *
 * And the one the feature exists for: a class-wise second file must never
 * wipe the rows the office reconciled from the first.
 */
import assert from "node:assert/strict";
import {
  mergeUdiseRecords,
  udiseIdentityKeys,
  udiseRecordsCompatible,
  udiseRowKey,
  type UdiseSheetRecord,
} from "@/lib/udiseUploadStore";
import {
  parseUdiseStudentDetailsMatrix,
  udiseEmptyRow,
  udiseRowsToMatrix,
  type UdiseStudentRow,
} from "@/lib/udiseStudentDetails";

const row = (o: Partial<UdiseStudentRow>): UdiseStudentRow => ({ ...udiseEmptyRow(), ...o });

function run() {
  /* ── the key: PEN, then full APAAR, then name+DOB, then name+parents ─── */
  assert.equal(udiseRowKey(row({ pen: "P1", apaarId: "123456789012", fullName: "Asha" })), "pen:p1");
  assert.equal(udiseRowKey(row({ apaarId: "123456789012", fullName: "Asha" })), "apaar:123456789012");
  assert.equal(udiseRowKey(row({ fullName: "Asha Devi", dob: "01/01/2018" })), "nd:asha|20180101");
  assert.equal(
    udiseRowKey(row({ fullName: "Asha", fatherName: "Ram Singh", motherName: "Sita" })),
    "nfm:asha|ram|sita",
  );
  // A dash, NA, NOT AVAILABLE are how the portal writes "none" — never an identity.
  for (const none of ["-", "NA", "N/A", "NOT AVAILABLE", "Not Applicable", "—"]) {
    const k = udiseRowKey(row({ pen: none, apaarId: none, fullName: "Asha", dob: "01/01/2018" }));
    assert.equal(k, "nd:asha|20180101", `"${none}" must not become a key`);
  }
  // Case and spacing must not split one child into two rows.
  assert.equal(udiseRowKey(row({ pen: " p1 " })), udiseRowKey(row({ pen: "P1" })));
  // A masked APAAR is not a full one: it is tied to the name, never used alone.
  const masked = udiseIdentityKeys(row({ apaarId: "********5445", fullName: "Aadvik Singh" }));
  assert.ok(!masked.some((k) => k.startsWith("apaar:")));
  assert.ok(masked.includes("ma:5445|aadvik"));
  // A name with nothing else identifies nobody twice: two such rows must NOT merge.
  assert.notEqual(udiseRowKey(row({ fullName: "Asha" })), udiseRowKey(row({ fullName: "Bina" })));

  /* ── compatibility: what may be the same child ─────────────────────── */
  assert.equal(
    udiseRecordsCompatible(row({ pen: "P1", fullName: "Asha" }), row({ pen: "P2", fullName: "Asha" })),
    false,
    "two PENs are two children",
  );
  assert.equal(
    udiseRecordsCompatible(
      row({ fullName: "Veer Pratap", fatherName: "Ram Singh" }),
      row({ fullName: "Veer Pratap Mishra", fatherName: "Ram Kumar Singh" }),
    ),
    true,
    "a surname on one side only is the same person",
  );
  assert.equal(
    udiseRecordsCompatible(
      row({ fullName: "Veer Pratap", dob: "01/01/2018" }),
      row({ fullName: "Veer Pratap Mishra", dob: "02/01/2018" }),
    ),
    false,
    "birth dates that disagree are two children",
  );

  /* ── THE ONE THAT MATTERS: the two portal layouts land on one child ──── */
  const shortFile = parseUdiseStudentDetailsMatrix([
    ["List of All Students"],
    ["Class", "Section", "Name", "Gender", "Initialised at SDMS", "Student PEN", "Student State Code",
     "Father Name", "Mother Name", "Social Category", "AADHAAR No.", "Name As per AADHAAR",
     "AADHAAR Validation Status", "MBU Status", "APAAR ID", "APAAR Status"],
    ["Nursery/KG/PP3", "A", "AARVI SINGH", "Female", "2026-27", "23220880281", "NA",
     "DHARM PRAKASH SINGH", "PRIYA SINGH", "1-GENERAL", "********6649", "AARVI SINGH",
     "Verified", "MBU Not Required", "********6927", "Generated"],
    ["Nursery/KG/PP3", "A", "AYANSH KUMAR", "Male", "2026-27", "NA", "NA",
     "SANTOSH KUMAR", "REKHA DEVI", "1-GENERAL", "NOT AVAILABLE", "NOT AVAILABLE",
     "AADHAAR not available", "NOT APPLICABLE", "NA", "NA"],
    ["Nursery/KG/PP3", "A", "MANAS SINGH", "Male", "2026-27", "NA", "NA",
     "PUNEET SINGH", "ANAMIKA SINGH", "1-GENERAL", "NOT AVAILABLE", "NOT AVAILABLE",
     "AADHAAR not available", "NOT APPLICABLE", "NA", "NA"],
  ]);
  assert.equal(shortFile.length, 3);

  const first = mergeUdiseRecords({ existing: [], incoming: shortFile });
  assert.equal(first.added, 3, "three children, not one row called apaar:na");
  assert.equal(first.records.length, 3);
  assert.equal(first.changed.length, 3);
  assert.deepEqual(first.removed, []);

  const longHeader = ["Class", "Section", "DOB", "Name", "Gender", "Mother Name", "Father Name",
    "Guardian Name", "AADHAAR No.", "Name As per AADHAAR", "Address", "Pincode", "Mobile No.",
    "Blood Group", "Admission Date", "AADHAAR Validation Status", "APAAR ID", "APAAR Status"];
  const longFile = parseUdiseStudentDetailsMatrix([
    ["List_of_Active_Students"], ["BHB"], ["Generated"],
    longHeader,
    longHeader.map((_, i) => `(${i + 1})`),
    ["Nursery/KG", "A", "21/01/2023", "AARVI SINGH", "Female", "PRIYA SINGH", "DHARM PRAKASH SINGH",
     "DHARM PRAKASH SINGH", "********6649", "AARVI SINGH", "VILLAGE X", "221202", "94******11",
     "B+", "24/03/2026", "Verified From UIDAI", "********6927", "Generated"],
    ["Nursery/KG", "A", "12/05/2019", "YATHARTH SINGH", "Male", "PRIYANKA SINGH", "AJAY SINGH",
     "NA", "NOT AVAILABLE", "NA", "NA", "NA", "NA", "NA", "NA", "Not Defined", "NA", "NA"],
    ["Nursery/KG", "A", "03/03/2021", "MANAS SINGH", "Male", "ANAMIKA SINGH", "PUNEET KUMAR SINGH",
     "NA", "NOT AVAILABLE", "NA", "NA", "NA", "NA", "NA", "NA", "Not Defined", "NA", "NA"],
  ]);
  assert.equal(longFile.length, 3, "the (n) row is not a pupil");

  const second = mergeUdiseRecords({ existing: first.records, incoming: longFile });
  assert.equal(second.records.length, 4, "Aarvi and Manas join their rows; Yatharth is new; Ayansh survives");
  assert.equal(second.added, 1);
  assert.equal(second.updated, 2);
  const aarvi = second.records.find((r) => r.key === "pen:23220880281")!;
  assert.ok(aarvi, "Aarvi keeps the PEN key she was filed under");
  assert.equal(aarvi.fields.pen, "23220880281", "PEN from the short file");
  assert.equal(aarvi.fields.dob, "21/01/2023", "birth date from the long file");
  assert.equal(aarvi.fields.bloodGroup, "B+");
  assert.equal(aarvi.fields.aadhaarValidation, "Verified From UIDAI", "a later export is later news");
  const manas = second.records.find((r) => r.fields.fullName === "MANAS SINGH")!;
  assert.equal(manas.fields.dob, "03/03/2021", "matched on name + both parents despite the father's middle name");
  assert.equal(manas.fields.fatherName, "PUNEET KUMAR SINGH");
  // Only what changed is written.
  assert.equal(second.changed.length, 3);

  /* ── a class-wise third file must not wipe the others ──────────────── */
  const third = mergeUdiseRecords({
    existing: second.records,
    incoming: [row({ fullName: "CHETAN", pen: "P3", fatherName: "X", motherName: "Y" })],
  });
  assert.equal(third.records.length, 5, "rows a file never mentions survive");
  assert.equal(third.added, 1);
  assert.equal(third.changed.length, 1, "unchanged children are not rewritten");

  /* ── re-uploading the short file changes nothing and loses nothing ─── */
  const again = mergeUdiseRecords({ existing: third.records, incoming: shortFile });
  assert.equal(again.added, 0);
  // The two layouts spell the class differently ("Nursery/KG" against
  // "Nursery/KG/PP3") and the validation phrase too ("Verified" against
  // "Verified From UIDAI"); later wins on those, and nothing else moves.
  // Class is only ever a hint — the SIS class is never written from here.
  assert.equal(again.updated, 2);
  assert.equal(again.unchanged, 1);
  assert.equal(again.changed.length, 2);
  const aarvi2 = again.records.find((r) => r.key === "pen:23220880281")!;
  assert.equal(aarvi2.fields.dob, "21/01/2023", "a file with no DOB column must not blank the date");
  const manas2 = again.records.find((r) => r.fields.fullName === "MANAS SINGH")!;
  assert.equal(manas2.fields.fatherName, "PUNEET KUMAR SINGH", "the fuller spelling of a name is kept");

  /* ── a child who gains a PEN: the two rows are joined, not doubled ─── */
  const gained = mergeUdiseRecords({
    existing: [
      { key: "nd:deep|20180404", ord: 0, fields: row({ fullName: "Deep", dob: "04/04/2018", fatherName: "Mohan" }) },
    ] as UdiseSheetRecord[],
    incoming: [row({ fullName: "Deep Kumar", pen: "P9", fatherName: "Mohan Lal" })],
  });
  assert.equal(gained.records.length, 1);
  assert.equal(gained.records[0]!.fields.pen, "P9");
  assert.equal(gained.records[0]!.fields.dob, "04/04/2018");

  /* ── one row that ties two earlier records together retires one ────── */
  const tie = mergeUdiseRecords({
    existing: [
      { key: "pen:p5", ord: 0, fields: row({ fullName: "Riya", pen: "P5", fatherName: "Anil" }) },
      { key: "nd:riya|20190505", ord: 1, fields: row({ fullName: "Riya Verma", dob: "05/05/2019", motherName: "Kavita" }) },
    ] as UdiseSheetRecord[],
    incoming: [row({ fullName: "Riya Verma", pen: "P5", dob: "05/05/2019", motherName: "Kavita" })],
  });
  assert.equal(tie.records.length, 1);
  assert.deepEqual(tie.removed, ["nd:riya|20190505"]);
  assert.equal(tie.records[0]!.fields.fatherName, "Anil", "what the retired row knew is kept");

  /* ── a masked id never replaces the unmasked form ───────────────────── */
  const mask = mergeUdiseRecords({
    existing: [{ key: "pen:p7", ord: 0, fields: row({ fullName: "Om", pen: "P7", apaarId: "123456785445" }) }],
    incoming: [row({ fullName: "Om", pen: "P7", apaarId: "********5445" })],
  });
  assert.equal(mask.records[0]!.fields.apaarId, "123456785445");

  /* ── the canonical matrix reads back exactly ────────────────────────── */
  const back = parseUdiseStudentDetailsMatrix(udiseRowsToMatrix(second.records.map((r) => r.fields)));
  assert.equal(back.length, 4);
  assert.deepEqual(back[0], aarvi.fields);

  console.log("udiseUploadStore selftest: ok");
}

run();

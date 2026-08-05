#!/usr/bin/env npx tsx
/**
 * Seed library_desk_* — catalog titles, copies, and one open issue from SIS.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-library-from-sis.ts
 */

import {
  emptyLibraryState,
  type LibraryCopy,
  type LibraryIssue,
  type LibraryState,
  type LibraryTitle,
} from "../src/lib/library";
import { DEFAULT_AY } from "../src/lib/masters";
import { fetchSisFromDb } from "../src/lib/sisNormalized.server";
import {
  fetchLibraryDeskFromDb,
  pushLibraryDeskToDb,
} from "../src/lib/libraryNormalized.server";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function dueYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const today = todayYmd();
  const { bundle } = await fetchSisFromDb();
  const student = bundle.students.find((s) => s.status === "active");
  if (!student) throw new Error("No active SIS student — seed SIS first.");

  const titles: LibraryTitle[] = [
    {
      id: "libt_seed_harry",
      isbn: "9780439708180",
      title: "Harry Potter and the Sorcerer's Stone",
      author: "J.K. Rowling",
      publisher: "Scholastic",
      edition: "",
      category: "book",
      shelf: "A-12",
      purchaseDate: "",
      pricePaise: 0,
      copiesTotal: 2,
      isActive: true,
    },
    {
      id: "libt_seed_science",
      isbn: "9789352534029",
      title: "NCERT Science Class VIII",
      author: "NCERT",
      publisher: "NCERT",
      edition: "",
      category: "book",
      shelf: "B-04",
      purchaseDate: "",
      pricePaise: 0,
      copiesTotal: 3,
      isActive: true,
    },
    {
      id: "libt_seed_hindi",
      isbn: "",
      title: "Bharat Ki Khoj",
      author: "Pandit Nehru",
      publisher: "NCERT",
      edition: "",
      category: "book",
      shelf: "C-01",
      purchaseDate: "",
      pricePaise: 0,
      copiesTotal: 2,
      isActive: true,
    },
  ];

  const copies: LibraryCopy[] = [
    {
      id: "libc_seed_harry_1",
      titleId: "libt_seed_harry",
      accessionNo: "LIB-0001",
      barcode: "LIB-0001",
      status: "issued",
    },
    {
      id: "libc_seed_harry_2",
      titleId: "libt_seed_harry",
      accessionNo: "LIB-0002",
      barcode: "LIB-0002",
      status: "available",
    },
    {
      id: "libc_seed_sci_1",
      titleId: "libt_seed_science",
      accessionNo: "LIB-0003",
      barcode: "LIB-0003",
      status: "available",
    },
    {
      id: "libc_seed_sci_2",
      titleId: "libt_seed_science",
      accessionNo: "LIB-0004",
      barcode: "LIB-0004",
      status: "available",
    },
    {
      id: "libc_seed_hindi_1",
      titleId: "libt_seed_hindi",
      accessionNo: "LIB-0005",
      barcode: "LIB-0005",
      status: "available",
    },
  ];

  const issues: LibraryIssue[] = [
    {
      id: "libi_seed_open",
      copyId: "libc_seed_harry_1",
      borrowerType: "student",
      studentId: student.id,
      staffId: "",
      academicYearCode: student.academicYearCode || DEFAULT_AY,
      issuedOn: today,
      dueOn: dueYmd(14),
      finePaise: 0,
      issuedBy: "seed-library-from-sis",
      note: "Seeded open issue for desk cutover",
      issueCondition: "good",
      damageNoteOnIssue: "",
      damageNoteOnReturn: "",
    },
  ];

  const state: LibraryState = {
    ...emptyLibraryState(),
    titles,
    copies,
    issues,
  };

  console.log(
    `Seeding ${titles.length} titles, ${copies.length} copies, ${issues.length} issues`,
  );

  const before = await fetchLibraryDeskFromDb();
  console.log(`DB before: ${before.bundle.titles.length} titles`);

  const result = await pushLibraryDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchLibraryDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.titles.length} titles, ${after.bundle.copies.length} copies, ${after.meta?.openIssueCount ?? 0} open issues`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

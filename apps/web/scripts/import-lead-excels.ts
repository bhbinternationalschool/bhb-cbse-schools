/**
 * One-shot: import Field_Leads.xlsx + BHB_School_Enquiry_Survey.xlsx into
 * school_mirror admissions (CRM).
 *
 * Run from apps/web:
 *   npx tsx scripts/import-lead-excels.ts
 */

import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import {
  defaultAdmissionsState,
  importLeads,
  normalizeAdmissionsState,
  type AdmissionsState,
  type ImportLeadRow,
} from "../src/lib/admissions";
import {
  mapEnquirySurveyRows,
  mapFieldLeadsRows,
} from "../src/lib/admissionsExcelImport";
import { reconcileLeadsWithSis } from "../src/lib/admissionsSisReconcile";
import { DEFAULT_AY } from "../src/lib/masters";
import type { SisState } from "../src/lib/sis";

const ROOT = path.join(process.cwd());
const DATA_LEADS = path.join(ROOT, "data", "leads");
const MIRROR_PATH = path.join(ROOT, ".data", "school_mirror.json");

type MirrorBundle = {
  version: 1;
  updatedAt: string;
  sis: unknown | null;
  fees: unknown | null;
  payments: unknown | null;
  masters: unknown | null;
  admissions: unknown | null;
};

function sheetRows(filePath: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  return XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: true,
  }) as Record<string, unknown>[];
}

function resolveClassIdFactory(masters: {
  classes?: { id: string; name: string }[];
}) {
  const classes = masters.classes ?? [];
  return (name: string) => {
    const n = name.trim().toLowerCase();
    return classes.find((c) => c.name.toLowerCase() === n)?.id;
  };
}

async function main() {
  const fieldPath = path.join(DATA_LEADS, "Field_Leads.xlsx");
  const surveyPath = path.join(DATA_LEADS, "BHB_School_Enquiry_Survey.xlsx");

  const fieldRaw = sheetRows(fieldPath);
  const surveyRaw = sheetRows(surveyPath);
  const fieldRows = mapFieldLeadsRows(fieldRaw);
  const surveyRows = mapEnquirySurveyRows(surveyRaw);

  console.log(
    `Mapped Field_Leads: ${fieldRaw.length} sheet rows → ${fieldRows.length} lead rows`,
  );
  console.log(
    `Mapped Enquiry Survey: ${surveyRaw.length} sheet rows → ${surveyRows.length} lead rows`,
  );

  let mirror: MirrorBundle = {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    sis: null,
    fees: null,
    payments: null,
    masters: null,
    admissions: null,
  };
  try {
    mirror = JSON.parse(await fs.readFile(MIRROR_PATH, "utf8")) as MirrorBundle;
  } catch {
    /* first run */
  }

  const masters = (mirror.masters || {}) as {
    classes?: { id: string; name: string }[];
  };
  const resolveClassId = resolveClassIdFactory(masters);

  const existing = mirror.admissions
    ? normalizeAdmissionsState(mirror.admissions as Partial<AdmissionsState>)
    : defaultAdmissionsState();

  // Deduplicate against already-imported campaign notes from these files
  const alreadyFromFiles = new Set(
    existing.leads
      .filter(
        (l) =>
          l.campaignNote === "Field_Leads.xlsx" ||
          l.campaignNote === "BHB_School_Enquiry_Survey.xlsx",
      )
      .map(
        (l) =>
          `${l.mobile}|${l.childName.trim().toLowerCase()}|${l.campaignNote}`,
      ),
  );

  function filterNew(rows: ImportLeadRow[], campaign: string) {
    return rows.filter((r) => {
      const key = `${String(r.mobile || "").replace(/\D/g, "").slice(-10)}|${r.childName.trim().toLowerCase()}|${campaign}`;
      return !alreadyFromFiles.has(key);
    });
  }

  const fieldNew = filterNew(fieldRows, "Field_Leads.xlsx");
  const surveyNew = filterNew(surveyRows, "BHB_School_Enquiry_Survey.xlsx");

  let state = existing;
  const fieldResult = importLeads(
    state,
    fieldNew,
    {
      source: "field_survey",
      stage: "enquiry",
      academicYearCode: DEFAULT_AY,
    },
    "Excel import · Field_Leads",
    resolveClassId,
  );
  state = fieldResult.state;

  const surveyResult = importLeads(
    state,
    surveyNew,
    {
      source: "field_survey",
      stage: "enquiry",
      academicYearCode: DEFAULT_AY,
    },
    "Excel import · Enquiry Survey",
    resolveClassId,
  );
  state = surveyResult.state;

  // Check imported leads against the student register (all sessions, incl.
  // inactive). Runs even without SIS data so admission years get normalized
  // from the enquiry dates.
  const sis = mirror.sis as SisState | null;
  const sisSafe: SisState =
    sis && Array.isArray(sis.students) && Array.isArray(sis.households)
      ? sis
      : ({ students: [], households: [] } as unknown as SisState);
  if (!sisSafe.students.length) {
    console.log("No SIS students in mirror — only fixing admission years.");
  }
  const rec = reconcileLeadsWithSis(state, sisSafe);
  state = rec.state;
  const sisAdmitted = rec.admitted.length;
  const sisSuspected = rec.suspected.length;
  for (const m of rec.admitted.slice(0, 10)) {
    console.log(
      `  admitted: ${m.childName} (${m.mobile}) → ${m.student.fullName} · Adm ${m.student.admissionNo || "—"} · ${m.student.academicYearCode} · ${m.student.status}`,
    );
  }
  if (rec.yearFixed) {
    console.log(`  admission year corrected on ${rec.yearFixed} lead(s)`);
  }

  mirror.admissions = state;
  mirror.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(MIRROR_PATH), { recursive: true });
  await fs.writeFile(MIRROR_PATH, JSON.stringify(mirror), "utf8");

  // Also write a client seed for localStorage hydrate
  const seedPath = path.join(DATA_LEADS, "admissions_leads_seed.json");
  await fs.writeFile(
    seedPath,
    JSON.stringify(
      {
        version: 1,
        importedAt: mirror.updatedAt,
        sources: ["Field_Leads.xlsx", "BHB_School_Enquiry_Survey.xlsx"],
        state,
        stats: {
          fieldImported: fieldResult.imported,
          fieldSkipped: fieldResult.skipped,
          surveyImported: surveyResult.imported,
          surveySkipped: surveyResult.skipped,
          totalLeads: state.leads.length,
          totalHouseholds: state.households.length,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        fieldImported: fieldResult.imported,
        fieldSkipped: fieldResult.skipped,
        surveyImported: surveyResult.imported,
        surveySkipped: surveyResult.skipped,
        sisAdmittedMatches: sisAdmitted,
        sisSuspectedMatches: sisSuspected,
        totalLeads: state.leads.length,
        totalHouseholds: state.households.length,
        mirror: MIRROR_PATH,
        seed: seedPath,
        fieldErrors: fieldResult.errors.slice(0, 5),
        surveyErrors: surveyResult.errors.slice(0, 5),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * One-click finish for Masters go-live checklist gaps
 * (safe seeds / publish — never invents UDISE or salary a/c number).
 */

import {
  defaultFoundationSlice,
  ensureFoundationOnMasters,
  mergeNumberSeries,
  normalizeSchoolProfile,
} from "@/lib/foundationMasters";
import {
  DEFAULT_MID_YEAR_FEE_POLICY,
  publishFeeGroupStructure,
  type MastersState,
} from "@/lib/masters";
import {
  loadSalarySetup,
  normalizeSalarySettings,
  saveSalarySetup,
  SCHOOL_SALARY_BANK,
} from "@/lib/salarySetup";
import { TENANT } from "@/lib/types";

export type MastersCompleteResult = {
  state: MastersState;
  actions: string[];
};

/**
 * Fill remaining masters gaps so the Completeness dashboard can reach go-live.
 */
export function completeMastersSetup(
  state: MastersState,
  publishedBy = "Setup",
): MastersCompleteResult {
  const actions: string[] = [];
  let next = ensureFoundationOnMasters({ ...state });

  // School profile — affiliation / board from tenant when blank
  const profile = normalizeSchoolProfile(next.schoolProfile);
  let profileChanged = false;
  if (!profile.affiliationNo.trim()) {
    profile.affiliationNo = TENANT.affiliationNo;
    profileChanged = true;
  }
  if (!profile.boardMode) {
    profile.boardMode = (TENANT.boardMode as typeof profile.boardMode) || "DUAL";
    profileChanged = true;
  }
  if (!profile.displayName.trim()) {
    profile.displayName = TENANT.nameDisplay;
    profileChanged = true;
  }
  if (!profile.city.trim()) {
    profile.city = TENANT.city;
    profileChanged = true;
  }
  if (!profile.state.trim()) {
    profile.state = TENANT.state;
    profileChanged = true;
  }
  if (!profile.address.trim()) {
    profile.address = TENANT.schoolAddress;
    profileChanged = true;
  }
  if (profileChanged) {
    next = { ...next, schoolProfile: profile };
    actions.push("School profile filled from BHB defaults (UDISE still needed)");
  }

  // Academic year current
  if (!(next.academicYears ?? []).some((y) => y.status === "current")) {
    const seed = defaultFoundationSlice(next.classes ?? []);
    next = {
      ...next,
      academicYears: seed.academicYears,
      academicTerms: next.academicTerms?.length
        ? next.academicTerms
        : seed.academicTerms,
    };
    actions.push("Set current academic year 2025-26");
  }

  // Number series — backfill any missing seed codes
  {
    const seed = defaultFoundationSlice(next.classes ?? []);
    const merged = mergeNumberSeries(next.numberSeries, seed.numberSeries);
    const hadMissing = seed.numberSeries.some(
      (s) => !(next.numberSeries ?? []).some((n) => n.code === s.code),
    );
    if (hadMissing || (next.numberSeries ?? []).length === 0) {
      next = { ...next, numberSeries: merged };
      actions.push(
        hadMissing ? "Added missing numbering series" : "Restored numbering series",
      );
    }
  }

  // Departments / designations
  if (
    (next.departments ?? []).filter((d) => d.isActive).length < 1 ||
    (next.designations ?? []).filter((d) => d.isActive).length < 1
  ) {
    const seed = defaultFoundationSlice(next.classes ?? []);
    next = {
      ...next,
      departments: seed.departments,
      designations: seed.designations,
    };
    actions.push("Restored departments & designations");
  }

  // Senior streams
  if ((next.seniorStreams ?? []).filter((s) => s.isActive).length < 3) {
    const seed = defaultFoundationSlice(next.classes ?? []);
    next = { ...next, seniorStreams: seed.seniorStreams };
    actions.push("Restored XI–XII streams");
  }

  // Subjects + class map when thin
  if ((next.subjects ?? []).filter((s) => s.isActive).length < 3) {
    const seed = defaultFoundationSlice(next.classes ?? []);
    next = {
      ...next,
      subjects: seed.subjects,
      classSubjects: seed.classSubjects,
    };
    actions.push("Restored subjects & class–subject map");
  } else if (
    (next.classSubjects ?? []).filter((l) => l.isActive).length < 3
  ) {
    const seed = defaultFoundationSlice(next.classes ?? []);
    next = { ...next, classSubjects: seed.classSubjects };
    actions.push("Restored class–subject map");
  }

  // Mid-year policy
  if (!next.midYearFeePolicy) {
    next = {
      ...next,
      midYearFeePolicy: { ...DEFAULT_MID_YEAR_FEE_POLICY },
    };
    actions.push("Enabled mid-year fee policy");
  }

  // Publish holidays
  const unpublished = (next.holidays ?? []).filter((h) => !h.isPublished);
  if (unpublished.length > 0) {
    next = {
      ...next,
      holidays: (next.holidays ?? []).map((h) =>
        h.isPublished ? h : { ...h, isPublished: true },
      ),
    };
    actions.push(`Published ${unpublished.length} holiday(s)`);
  } else if ((next.holidays ?? []).length === 0) {
    const seed = defaultFoundationSlice(next.classes ?? []);
    next = {
      ...next,
      holidays: seed.holidays.map((h) => ({ ...h, isPublished: true })),
    };
    actions.push("Added & published default holidays");
  }

  // Publish fee structures
  let feePublished = 0;
  for (const g of [...(next.feeGroups ?? [])]) {
    if (!g.isActive || g.structurePublishedAt) continue;
    const r = publishFeeGroupStructure(next, g.id, publishedBy);
    if (r.ok) {
      next = r.state;
      feePublished += 1;
    }
  }
  if (feePublished > 0) {
    actions.push(`Published ${feePublished} fee group structure(s)`);
  }

  // Salary bank — Union Bank Murdaha Bazar (keep existing a/c if set)
  const salary = loadSalarySetup();
  const settings = normalizeSalarySettings(salary.settings);
  const needBank =
    !settings.salaryBankName.trim() ||
    !settings.salaryBankIfsc.trim() ||
    !settings.salaryBankBranch.trim() ||
    settings.salaryBankIfsc.toUpperCase() !== SCHOOL_SALARY_BANK.ifsc;
  if (needBank || !settings.salaryBankBranch.includes("Murdaha")) {
    saveSalarySetup({
      ...salary,
      settings: normalizeSalarySettings({
        ...settings,
        salaryBankName: SCHOOL_SALARY_BANK.name,
        salaryBankBranch: SCHOOL_SALARY_BANK.branch,
        salaryBankIfsc: SCHOOL_SALARY_BANK.ifsc,
        salaryAccountLabel:
          settings.salaryAccountLabel.includes("Union Bank")
            ? settings.salaryAccountLabel
            : "Salary account — Union Bank Murdaha Bazar",
      }),
    });
    actions.push(
      `Salary bank → ${SCHOOL_SALARY_BANK.name}, ${SCHOOL_SALARY_BANK.branch} (${SCHOOL_SALARY_BANK.ifsc})`,
    );
  }

  // Do not re-seed demo staff when the roster is empty — schools clear
  // demo rows and import their Teacher.xlsx / CSV instead.

  if (actions.length === 0) {
    actions.push("Nothing to auto-fill — enter UDISE and salary a/c if still open");
  }

  return { state: next, actions };
}

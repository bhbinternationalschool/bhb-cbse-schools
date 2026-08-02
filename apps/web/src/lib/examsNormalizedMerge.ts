import type { ExamsState } from "@/lib/exams";
import { examsReadFromDbEnabled } from "@/lib/examsDbConfig";
import type { ExamDeskBundle } from "@/lib/examsNormalized.server";

export function examsReadFromDbFlag(): boolean {
  return examsReadFromDbEnabled();
}

function preferRemoteDb(
  localLen: number,
  remoteLen: number,
  preferDb?: boolean,
): boolean {
  return (
    !!preferDb ||
    examsReadFromDbFlag() ||
    localLen === 0 ||
    remoteLen > localLen
  );
}

export function mergeDbDeskIntoExamsState(
  state: ExamsState,
  bundle: ExamDeskBundle,
  opts?: { preferDb?: boolean },
): ExamsState {
  const localSheets = state.sheets ?? [];
  const remoteSheets = bundle.sheets ?? [];
  const hasRemoteData =
    bundle.terms.length > 0 ||
    bundle.subjects.length > 0 ||
    remoteSheets.length > 0 ||
    bundle.promotions.length > 0;

  if (!hasRemoteData) return state;

  const takeSheets = preferRemoteDb(
    localSheets.length,
    remoteSheets.length,
    opts?.preferDb,
  );

  const sheetById = new Map<string, (typeof localSheets)[0]>();
  if (!takeSheets) {
    for (const s of localSheets) sheetById.set(s.id, s);
  }
  for (const s of remoteSheets) sheetById.set(s.id, s);
  if (!takeSheets) {
    for (const s of localSheets) {
      if (!sheetById.has(s.id)) sheetById.set(s.id, s);
    }
  }

  const takeTerms =
    opts?.preferDb ||
    examsReadFromDbFlag() ||
    (state.terms?.length ?? 0) === 0 ||
    bundle.terms.length > 0;

  const takeSubjects =
    opts?.preferDb ||
    examsReadFromDbFlag() ||
    (state.subjects?.length ?? 0) === 0 ||
    bundle.subjects.length > 0;

  return {
    ...state,
    version: 1,
    terms: takeTerms ? bundle.terms : state.terms,
    subjects: takeSubjects ? bundle.subjects : state.subjects,
    dateSheet:
      bundle.dateSheet.length > 0 ? bundle.dateSheet : state.dateSheet,
    sheets: [...sheetById.values()],
    policy: bundle.policy ?? state.policy,
    promotions:
      bundle.promotions.length > 0 ? bundle.promotions : state.promotions,
  };
}

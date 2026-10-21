import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import { normalizeStudentDocTypesState, type StudentDocTypesState } from "@/lib/studentDocTypes";

const KEY = "student_doc_types" as const;

/** null = could not read (never treated as "no custom types"). */
export async function readStudentDocTypes(): Promise<StudentDocTypesState | null> {
  const row = await readModuleLocalState<unknown>(KEY);
  if (!row) return null;
  return normalizeStudentDocTypesState(row.state);
}

export async function writeStudentDocTypes(state: StudentDocTypesState): Promise<boolean> {
  const w = await writeModuleLocalState(KEY, state);
  return w.ok;
}

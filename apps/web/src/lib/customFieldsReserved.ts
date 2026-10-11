import type { CustomFieldEntity } from "@/lib/customFields";
import { isBuiltInStudentImportHeader } from "@/lib/studentImport";

/**
 * Names a custom field may not take, per entity: a student field named like
 * a column the built-in import already reads ("Admission no", "Father
 * name"…) could never be filled from a file, and would read as the built-in
 * column to anyone looking at the sheet. Used by the server (the rule) and
 * Masters → Custom fields (the early warning). Staff have no import, so no
 * reserved names.
 */
export function reservedCustomLabel(entity: CustomFieldEntity): ((label: string) => boolean) | undefined {
  return entity === "student" ? isBuiltInStudentImportHeader : undefined;
}

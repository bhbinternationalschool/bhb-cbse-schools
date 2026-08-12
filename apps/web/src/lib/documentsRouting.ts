/**
 * Shared subject/docKey validation for the Drive document routes
 * (upload + serve) — docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md §Phase 3.
 */

import { DOC_LABELS, type StudentDocKey } from "@/lib/sis";
import { STAFF_DOC_LABELS, type StaffDocKey } from "@/lib/foundationMasters";
import type { RbacModule } from "@/lib/rbac";

export type DocumentSubject = "student" | "staff";

export function isDocumentSubject(v: unknown): v is DocumentSubject {
  return v === "student" || v === "staff";
}

export function subjectRbacModule(subject: DocumentSubject): RbacModule {
  return subject === "student" ? "students" : "staff";
}

export function isValidDocKey(subject: DocumentSubject, docKey: string): boolean {
  if (subject === "student") {
    return DOC_LABELS.some((d) => d.key === (docKey as StudentDocKey));
  }
  return STAFF_DOC_LABELS.some((d) => d.key === (docKey as StaffDocKey));
}

export function documentProxyUrl(
  subject: DocumentSubject,
  subjectId: string,
  docKey: string,
): string {
  return `/api/documents/${subject}/${encodeURIComponent(subjectId)}/${encodeURIComponent(docKey)}`;
}

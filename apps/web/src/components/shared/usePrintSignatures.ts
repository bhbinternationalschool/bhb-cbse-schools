"use client";

/**
 * Staff pages: the signatures a printed document carries, from
 * GET /api/v1/print/signatures (embedded data URLs). Until it answers — or
 * if it fails — every line is blank, which is how the sheets printed
 * before. Refetched when the roster changes (a new signature, a new
 * principal).
 */

import { useErpQuery } from "@/lib/data/client/hooks";
import { printSignatureQuery, type PrintSignatureRequest, type PrintSignatureSet } from "@/lib/printSignatures";

export function printSignaturesPath(req: PrintSignatureRequest): string {
  return `/api/v1/print/signatures?${printSignatureQuery(req)}`;
}

export function usePrintSignatures(req: PrintSignatureRequest | null): PrintSignatureSet | null {
  const wantsAny = !!req && (!!req.want.principal || !!req.want.classTeacher || !!req.want.checkedBy);
  const q = useErpQuery<PrintSignatureSet>("print-signatures", req ? printSignaturesPath(req) : "/api/v1/print/signatures", {
    desk: ["sis_staff", "sis_designations"],
    enabled: wantsAny,
  });
  return wantsAny ? q.data ?? null : null;
}

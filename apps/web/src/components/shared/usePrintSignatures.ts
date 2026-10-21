"use client";

/**
 * Staff pages: the signatures a printed document carries, from
 * GET /api/v1/print/signatures (embedded data URLs), and whether it has
 * answered yet. A sheet never prints while the answer is outstanding
 * (PrintWithSignaturesButton): a copy with blank lines only because the
 * request was slow would look like nobody signed. Refetched when the
 * roster changes (a new signature, a new principal).
 */

import { useErpQuery } from "@/lib/data/client/hooks";
import { printSignatureQuery, type PrintSignatureRequest, type PrintSignatureSet } from "@/lib/printSignatures";

/**
 *   none     the document has no line anyone signs — print at once
 *   loading  asked, not answered: Print waits
 *   ready    answered (with images, or with nobody's on file)
 *   failed   could not be read: ask before printing without them
 */
export type PrintSignatureStatus = "none" | "loading" | "ready" | "failed";

export type PrintSignaturesState = {
  signatures: PrintSignatureSet | null;
  status: PrintSignatureStatus;
  retry: () => void;
};

export function printSignaturesPath(req: PrintSignatureRequest): string {
  return `/api/v1/print/signatures?${printSignatureQuery(req)}`;
}

export function usePrintSignatures(req: PrintSignatureRequest | null): PrintSignaturesState {
  const wantsAny = !!req && (!!req.want.principal || !!req.want.classTeacher || !!req.want.checkedBy);
  const q = useErpQuery<PrintSignatureSet>("print-signatures", req ? printSignaturesPath(req) : "/api/v1/print/signatures", {
    desk: ["sis_staff", "sis_designations"],
    enabled: wantsAny,
  });
  if (!wantsAny) return { signatures: null, status: "none", retry: () => undefined };
  const status: PrintSignatureStatus = q.data ? "ready" : q.isError && !q.isFetching ? "failed" : "loading";
  return { signatures: q.data ?? null, status, retry: () => void q.refetch() };
}

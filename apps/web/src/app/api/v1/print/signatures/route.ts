/**
 * GET /api/v1/print/signatures?doc=…&want=principal,classTeacher,checkedBy&…
 *
 * The staff signatures one printed document carries (lib/printSignatures),
 * each as an embedded data URL, or null for a line that stays blank.
 *
 *   doc=certificate                         Certificates · view
 *   doc=report_card | result_sheet | admit_card   Exams · view
 *
 * Staff only. A parent never calls this: a parent's report card arrives
 * with its signatures already embedded (/api/v1/parent/results). The
 * mirror sync secret is refused — this is for a person printing a sheet.
 * Who signs is decided here on the server from the roster, never by an id
 * the caller sends.
 */

import { NextResponse } from "next/server";
import { apiOk } from "@/lib/api/v1/errors";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { parsePrintSignatureQuery, PRINT_SIGNATURE_DOCS } from "@/lib/printSignatures";
import { loadPrintSignatures } from "@/lib/printSignatures.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const req = parsePrintSignatureQuery(new URL(request.url).searchParams);
  if (!req) {
    return NextResponse.json({ ok: false, error: { code: "bad_request", message: "Unknown document" } }, { status: 400 });
  }
  const auth = await requireStaffPermission(request, PRINT_SIGNATURE_DOCS[req.doc], "view");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) {
    return NextResponse.json({ ok: false, error: { code: "forbidden", message: "Signatures are for a signed-in member of staff" } }, { status: 403 });
  }
  const set = await loadPrintSignatures(auth.ctx.masters, req);
  const res = apiOk(set);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

/**
 * GET /api/data/views/certificate-dues?studentId=…[&fresh=1] — one child's open fee
 * dues (total and line count, nothing else) as the server computes them from
 * the whole fee book, for the Certificates gate: a TC or a fee clearance /
 * no-dues certificate is issued only on this answer (lib/certificates.ts
 * certificateEligibility). See lib/certificateDues.server.ts for why the
 * browser's own copy is not enough.
 *
 * Who: whoever may issue a certificate — Certificates (create) or its "Issue
 * & register" function (create) — or Fees (view). A Certificates viewer
 * (the built-in teacher role) is not shown fee figures here. Anyone else
 * gets 403, and the screen then says "Fee dues could not be checked for your
 * role — ask the office" and refuses, never ₹0. A failed read is 503, never
 * zero dues.
 */
import { NextResponse } from "next/server";
import {
  requireStaffPermission,
  requireStaffPermissionOrFeature,
} from "@/lib/apiRouteAuth.server";
import { readCertificateDues } from "@/lib/certificateDues.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });

export async function GET(req: Request) {
  let auth = await requireStaffPermissionOrFeature(req, "certificates", "create", "certificates.register", "create");
  if (!auth.ok && auth.response.status === 403) auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  // A person's question only: the mirror sync secret has no business here.
  if (auth.viaMirrorSecret) return fail(403, "Staff session required");

  const studentId = new URL(req.url).searchParams.get("studentId")?.trim() || "";
  if (!studentId) return fail(400, "studentId is required");

  // fresh=1: the issue-time check re-reads the fee book now (not this
  // instance's copy, which may be up to 45 s old).
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const read = await readCertificateDues(studentId, { fresh });
  if (!read.ok) return fail(read.status, read.error);
  return NextResponse.json({ ok: true, data: read.view }, { headers: NO_STORE });
}

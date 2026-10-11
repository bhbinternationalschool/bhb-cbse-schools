/**
 * /api/admissions/entrance-test — Admissions → Entrance test.
 *
 * GET  ?view=sessions&academicYearCode=…   the sittings of a year
 * GET  ?view=session&id=…                   one sitting + its roll
 * GET  ?view=eligible&id=…                  leads that may sit it
 * GET  ?view=summary&academicYearCode=…     every sitting + roll, for the class summary
 * GET  ?view=lead&leadId=…                  the CRM record's badge
 *
 * POST { action, … }
 *   create_session { session }                         admissions:create
 *   update_session { id, session, updatedAt }          admissions:edit
 *   delete_session { id }                              admissions:delete
 *   add_candidates { sessionId, leadIds }              admissions:create
 *   remove_candidate { id, updatedAt }                 admissions:delete
 *   save_marks { sessionId, rows:[{id,marks,absent,updatedAt}] }   admissions:edit
 *   apply_pass_mark { sessionId, candidateIds?, includeManual? }   admissions:edit
 *   set_status { sessionId, candidateIds, status }     admissions:edit
 *
 * The function "Entrance test" (lib/rbacFeatureCatalog/people.ts) lists this
 * path, so a role holding only that function reaches it with the same
 * actions; everyone else needs the Admissions module grant.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import type { RbacAction } from "@/lib/rbac";
import { validateSessionInput, type EntranceSessionInput } from "@/lib/admissionEntranceTest";
import {
  EntranceTestError,
  addCandidates,
  applyPassMark,
  createSession,
  deleteSession,
  getSessionBundle,
  leadEntranceRecords,
  listEligibleApplicants,
  listSessions,
  listYearCandidates,
  removeCandidate,
  saveMarks,
  setManualStatus,
  updateSession,
  type MarksRowInput,
} from "@/lib/admissionEntranceTest.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE });
}

function handle(e: unknown, verb: string) {
  if (e instanceof EntranceTestError) {
    console.warn(`[entrance-test] ${verb} ${e.status}: ${e.message}`);
    return fail(e.message, e.status);
  }
  const message = e instanceof Error ? e.message : "Unexpected error";
  console.error(`[entrance-test] ${verb} unhandled: ${message}`);
  return fail("Something went wrong. Try again.", 500);
}

export async function GET(request: Request) {
  const auth = await requireStaffPermission(request, "admissions", "view");
  if (!auth.ok) return auth.response;
  const p = new URL(request.url).searchParams;
  const view = p.get("view") || "sessions";
  try {
    switch (view) {
      case "sessions": {
        const year = (p.get("academicYearCode") || "").trim();
        if (!year) return fail("academicYearCode is required", 400);
        return NextResponse.json({ ok: true, sessions: await listSessions(year) }, { headers: NO_STORE });
      }
      case "session":
        return NextResponse.json(
          { ok: true, ...(await getSessionBundle(p.get("id") || "")) },
          { headers: NO_STORE },
        );
      case "eligible":
        return NextResponse.json(
          { ok: true, applicants: await listEligibleApplicants(p.get("id") || "") },
          { headers: NO_STORE },
        );
      case "summary": {
        const year = (p.get("academicYearCode") || "").trim();
        if (!year) return fail("academicYearCode is required", 400);
        return NextResponse.json({ ok: true, ...(await listYearCandidates(year)) }, { headers: NO_STORE });
      }
      case "lead":
        return NextResponse.json(
          { ok: true, records: await leadEntranceRecords((p.get("leadId") || "").trim()) },
          { headers: NO_STORE },
        );
      default:
        return fail(`Unknown view "${view}"`, 400);
    }
  } catch (e) {
    return handle(e, `GET ${view}`);
  }
}

const ACTION_GRANT: Record<string, RbacAction> = {
  create_session: "create",
  update_session: "edit",
  delete_session: "delete",
  add_candidates: "create",
  remove_candidate: "delete",
  save_marks: "edit",
  apply_pass_mark: "edit",
  set_status: "edit",
};

type Body = {
  action?: string;
  id?: string;
  sessionId?: string;
  session?: EntranceSessionInput;
  updatedAt?: string;
  leadIds?: string[];
  rows?: MarksRowInput[];
  candidateIds?: string[];
  includeManual?: boolean;
  status?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return fail("Invalid JSON body", 400);
  }
  const action = String(body.action || "");
  const grant = ACTION_GRANT[action];
  if (!grant) return fail(`Unknown action "${action}"`, 400);

  const auth = await requireStaffPermission(request, "admissions", grant);
  if (!auth.ok) return auth.response;
  const actor = String(auth.ctx.session.fullName || auth.ctx.session.roleCode || "staff");

  try {
    switch (action) {
      case "create_session": {
        const v = validateSessionInput(body.session ?? {});
        if (!v.ok) return fail(v.error, 400);
        return NextResponse.json({ ok: true, session: await createSession(v.draft, actor) });
      }
      case "update_session": {
        const v = validateSessionInput(body.session ?? {});
        if (!v.ok) return fail(v.error, 400);
        return NextResponse.json({
          ok: true,
          session: await updateSession(String(body.id || ""), v.draft, String(body.updatedAt || ""), actor),
        });
      }
      case "delete_session":
        await deleteSession(String(body.id || ""));
        return NextResponse.json({ ok: true });
      case "add_candidates":
        return NextResponse.json({
          ok: true,
          ...(await addCandidates(
            String(body.sessionId || ""),
            Array.isArray(body.leadIds) ? body.leadIds.map(String) : [],
            actor,
          )),
        });
      case "remove_candidate":
        await removeCandidate(String(body.id || ""), String(body.updatedAt || ""));
        return NextResponse.json({ ok: true });
      case "save_marks": {
        if (!Array.isArray(body.rows) || body.rows.length === 0) return fail("Nothing to save", 400);
        const res = await saveMarks(String(body.sessionId || ""), body.rows);
        return NextResponse.json({
          ok: res.conflicts.length === 0 && res.errors.length === 0,
          ...res,
        });
      }
      case "apply_pass_mark":
        return NextResponse.json({
          ok: true,
          ...(await applyPassMark(
            String(body.sessionId || ""),
            Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : null,
            body.includeManual === true,
            actor,
          )),
        });
      case "set_status":
        return NextResponse.json({
          ok: true,
          saved: await setManualStatus(
            String(body.sessionId || ""),
            Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : [],
            String(body.status ?? "") as never,
            actor,
          ),
        });
    }
    return fail(`Unknown action "${action}"`, 400);
  } catch (e) {
    return handle(e, `POST ${action}`);
  }
}

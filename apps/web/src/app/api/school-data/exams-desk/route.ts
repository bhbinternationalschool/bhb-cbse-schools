import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import {
  deskFeatureGateFor,
  deskReadGate,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
  type FeatureGate,
} from "@/lib/deskFeatureGate.server";
import type { ExamsState } from "@/lib/exams";
import { examsDualWriteDbEnabled } from "@/lib/examsDbConfig";
import {
  fetchExamDeskFromDb,
  fetchExamSetupFromDb,
  pushExamDeskToDb,
  type ExamDeskBundle,
  EXAMS_DELETABLE_TABLES,
  EXAMS_TABLE_SLICES,
} from "@/lib/examsNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { featureAuthorizedDeletes } from "@/lib/deskNamedDeletesFeature.server";
import type { RbacAction } from "@/lib/rbac";

export const runtime = "nodejs";

/**
 * A function holder's copy of the desk (Exams → Date sheet, Mark entry, …).
 *
 * Terms, subjects, the policy and the date sheet are the frame every exam
 * function works inside — a marks screen cannot name its exam without the
 * term list — so they are always served; only their owner may change them.
 * Mark sheets go to Mark entry (own classes, when the function is limited
 * to them) and to Report cards & promotion (every class: a report card is
 * read across the school).
 */
function featureExamBundle(bundle: ExamDeskBundle, gate: FeatureGate): ExamDeskBundle {
  const holds = (id: string) =>
    (["view", "create", "edit", "delete"] as RbacAction[]).some((a) => gate.access(id, a).allowed);
  const stripped = stripDeskForFeatures("exams", bundle, gate);
  let sheets: ExamDeskBundle["sheets"] = [];
  if (holds("exams.results")) {
    sheets = bundle.sheets;
  } else if (holds("exams.marks")) {
    const own = gate.ownClassIds;
    sheets = own ? bundle.sheets.filter((s) => own.has(s.classId)) : bundle.sheets;
  }
  return {
    ...stripped,
    terms: bundle.terms,
    subjects: bundle.subjects,
    policy: bundle.policy,
    dateSheet: bundle.dateSheet,
    sheets,
  };
}

/** GET — pull exam desk from normalized tables */
export async function GET(req: Request) {
  // The whole desk, or — holding Exams functions only — their part of it.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["exams-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle: full, meta } = await fetchExamDeskFromDb();
  const bundle = gate.mode === "feature" ? featureExamBundle(full, gate) : full;
  return NextResponse.json({
    ok: true,
    terms: bundle.terms,
    subjects: bundle.subjects,
    dateSheet: bundle.dateSheet,
    sheets: bundle.sheets,
    policy: bundle.policy,
    promotions: bundle.promotions,
    sheetCount: bundle.sheets.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type ExamsDeskPostBody = Partial<
  Pick<ExamsState, "terms" | "subjects" | "dateSheet" | "sheets" | "policy" | "promotions" | "rooms" | "seating">
> & { deletes?: unknown };

/**
 * POST — push the exam SETUP: terms, subjects, date sheet, policy and
 * promotion decisions.
 *
 * Mark sheets are not accepted here any more. A payload's `sheets` used to
 * replace every sheet on the server — including deleting the ones this
 * browser had never seen — which is how one teacher's save erased another's
 * marks. Sheets go one at a time through ./sheet, where the version and the
 * lock are checked. A `sheets` array in the body is ignored; older tabs
 * still send one.
 *
 * Setup is school-wide, so only a school-wide login may write it. A class
 * teacher's copy of the term list is whatever their tab last hydrated, and
 * pushing it would prune terms the office added since.
 */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["exams-desk"], "POST");
  // Without the module: a function holder's save, or refused.
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "exams", "write");
    if (!gate) return auth.response;
  }
  if (!examsDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "EXAMS_DUAL_WRITE_DB disabled",
    });
  }
  // The school-wide rule holds for function holders too: a function moves
  // what may be changed, not who may push the setup desk.
  const scopeCtx = gate ? gate.ctx : auth.ok && !auth.viaMirrorSecret ? auth.ctx : null;
  if (scopeCtx) {
    const scope = await staffSectionScope(scopeCtx);
    if (!scope.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Exam setup (terms, subjects, policy, date sheet, promotions) is saved by the office, principal or owner. Your marks are saved separately and are not affected.",
        },
        { status: 403 },
      );
    }
  }

  let body: ExamsDeskPostBody;
  try {
    body = (await req.json()) as ExamsDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (Array.isArray(body.sheets) && body.sheets.length > 0) {
    console.warn(
      `[exams-desk] ignoring ${body.sheets.length} sheet(s) in a setup push — sheets are saved through /sheet`,
    );
  }

  // Deletions are named by the desk, never inferred from what it lacks.
  let deletes = readNamedDeletes(body.deletes, EXAMS_DELETABLE_TABLES);

  // Function holders (e.g. Exams → Date sheet): merged onto the stored
  // setup, only their functions' slices — never the body as sent. Sheets
  // are never written here, so a stray copy is dropped before the check.
  if (gate) {
    const stored = await fetchExamSetupFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved exam setup — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const { sheets: _ignored, deletes: _named, ...setup } = body;
    void _ignored;
    void _named;
    const merged = featurePushOutcome(gate, "exams", stored.bundle, setup);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    deletes = featureAuthorizedDeletes(deletes, EXAMS_TABLE_SLICES, stored.bundle, merged.state);
    body = merged.state as ExamsDeskPostBody;
  }

  const result = await pushExamDeskToDb({
    version: 1,
    terms: Array.isArray(body.terms) ? body.terms : [],
    subjects: Array.isArray(body.subjects) ? body.subjects : [],
    dateSheet: Array.isArray(body.dateSheet) ? body.dateSheet : [],
    // Carried through, or a setup push would wipe the rooms and the seating
    // plan built on them.
    rooms: Array.isArray(body.rooms) ? body.rooms : [],
    seating: Array.isArray(body.seating) ? body.seating : [],
    sheets: [],
    policy: body.policy!,
    promotions: Array.isArray(body.promotions) ? body.promotions : [],
  }, deletes);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  if (gate) return featureSavedResponse(true);
  const { bundle } = await fetchExamDeskFromDb();
  return NextResponse.json({
    ok: true,
    sheetCount: bundle.sheets.length,
    updatedAt: new Date().toISOString(),
  });
}

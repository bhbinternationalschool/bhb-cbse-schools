import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import { stripEmptyList } from "@/lib/wirePayload";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import {
  normalizeAdmissionsState,
  type AdmissionsState,
} from "@/lib/admissions";
import { admissionsDualWriteDbEnabled } from "@/lib/admissionsDbConfig";
import {
  fetchAdmissionDeskFromDb,
  pushAdmissionDeskToDb,
} from "@/lib/admissionsNormalized.server";

export const runtime = "nodejs";

/** GET — pull admissions desk from normalized tables */
/**
 * Ship records without their empty fields.
 *
 * OPT-IN via LEAN_WIRE_PAYLOAD; rollback is removing the variable. Three
 * deploys in 70 seconds on 2026-08-11 restarted every container, every client
 * re-hydrated ~4.8 MB at once, and the pile-up queued past the 8s statement
 * timeout — 503s across four modules while the database sat idle.
 */
function leanWireEnabled(): boolean {
  const flag = process.env.LEAN_WIRE_PAYLOAD?.trim().toLowerCase();
  return flag === "true" || flag === "1";
}

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["admissions-desk"], "GET");
  if (!auth.ok) return auth.response

  // ?leadId=... returns ONE complete lead, lead_json included.
  //
  // The list is projected (20 of 79 fields) to keep the payload off the
  // browser's storage cap, so anything opening a lead needs the rest. A read
  // failure is a 503, never an empty result — "could not read" must not
  // arrive looking like "no such lead".
  const leadId = new URL(req.url).searchParams.get("leadId")?.trim();
  if (leadId) {
    try {
      const { fetchAdmissionLeadDetail } = await import(
        "@/lib/admissionsNormalized.server"
      );
      const lead = await fetchAdmissionLeadDetail(leadId);
      if (!lead) {
        return NextResponse.json(
          { ok: false, error: "Lead not found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, lead });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: e instanceof Error ? e.message : "Lead read failed",
        },
        { status: 503 },
      );
    }
  }

  try {
    const result = await cachedDeskJson({
      cacheKey: "admissions-desk",
      tables: ["admission_desk_leads", "admission_desk_households", "admission_desk_registration_payments", "admission_desk_field_ops"],
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const { state, meta, ok } = await fetchAdmissionDeskFromDb();
        if (!ok) throw new Error("Admissions desk fetch failed — tenant/db unavailable");

        // Drop empty strings and nulls the client rebuilds anyway — 37.5% of this
        // payload, measured on all 919 leads. Lossless: emptyAdmissionLead does
        // `partial?.x || ""`, so absent and empty produce the same record. `false`
        // and `0` are kept; see lib/wirePayload.ts.
        const wireState = leanWireEnabled()
        ? {
        ...state,
        leads: stripEmptyList(state.leads as unknown as Record<string, unknown>[]),
        households: stripEmptyList(
        state.households as unknown as Record<string, unknown>[],
        ),
        }
        : state;

        return ({
        ok: true,
        state: wireState,
        leadCount: state.leads.length,
        householdCount: state.households.length,
        updatedAt: meta?.updatedAt || new Date().toISOString(),
        meta,
        });
      },
    });
    return deskJsonResponse(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Admissions desk fetch failed" },
      { status: 503 },
    );
  }
}

/** POST — push full admissions desk snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["admissions-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!admissionsDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "ADMISSIONS_DUAL_WRITE_DB disabled",
    });
  }

  let body: { state?: Partial<AdmissionsState> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.state) {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }

  const normalized = normalizeAdmissionsState(body.state);
  const result = await pushAdmissionDeskToDb(normalized);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    leadCount: normalized.leads.length,
    householdCount: normalized.households.length,
    updatedAt: new Date().toISOString(),
  });
}

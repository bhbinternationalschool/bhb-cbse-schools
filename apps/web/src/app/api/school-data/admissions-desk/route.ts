import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import { stripEmptyList } from "@/lib/wirePayload";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import {
  deskReadGate,
  deskWriteGate,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
  visibleSlices,
  type FeatureGate,
} from "@/lib/deskFeatureGate.server";
import {
  normalizeAdmissionsState,
  type AdmissionsState,
} from "@/lib/admissions";
import { admissionsDualWriteDbEnabled } from "@/lib/admissionsDbConfig";
import {
  ADMISSION_SLICES,
  fetchAdmissionDeskFromDb,
  pushAdmissionDeskToDb,
} from "@/lib/admissionsNormalized.server";
import { readStampsParam, type RowStamps } from "@/lib/rowStampClient";

/** The stamps of the rows a response carries (a cut desk gets only its rows'). */
function stampsFor(state: Partial<AdmissionsState>, all: RowStamps): RowStamps {
  const out: RowStamps = {};
  for (const slice of ADMISSION_SLICES) {
    const from = all[slice] ?? {};
    const m: Record<string, string> = {};
    for (const r of (state[slice] ?? []) as { id: string }[]) if (from[r.id]) m[r.id] = from[r.id];
    out[slice] = m;
  }
  return out;
}

export const runtime = "nodejs";

/**
 * The number counters. No function owns them (lib/rbacFeatureCatalog/
 * people.ts): whoever adds a lead, household, payment or beat must move its
 * counter, or the next one reuses a number — and someone allowed only to
 * ADD enquiries holds no "change" to edit a counter with. So a
 * function-only save moves each counter forward to the pushed value and
 * never back (a stale browser cannot rewind it).
 */
const SEQ_KEYS = [
  "nextEnquirySeq",
  "nextApplicationSeq",
  "nextHouseholdSeq",
  "nextRegPaySeq",
  "nextBeatSeq",
] as const;

/**
 * A function holder's read: their slices, the rest empty. Not served from
 * the shared desk cache — that copy (and its ETag) is the whole desk.
 */
async function featureDeskResponse(gate: FeatureGate): Promise<NextResponse> {
  const { state, ok, stamps } = await fetchAdmissionDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Admissions desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  const stripped = stripDeskForFeatures("admissions", state, gate);
  return NextResponse.json(
    {
      ok: true,
      state: stripped,
      stamps: stampsFor(stripped, stamps),
      leadCount: stripped.leads?.length ?? 0,
      householdCount: stripped.households?.length ?? 0,
      functionOnly: true,
      // No revision (and no sync meta carrying one): this copy is partial
      // and must never be a base.
      updatedAt: "",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

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
  // The whole desk, or — holding Admissions functions only (e.g. Field
  // survey) — their slices.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["admissions-desk"]);
  if (gate.mode === "deny") return gate.response;

  // ?leadId=... returns ONE complete lead, lead_json included.
  //
  // The list is projected (20 of 79 fields) to keep the payload off the
  // browser's storage cap, so anything opening a lead needs the rest. A read
  // failure is a 503, never an empty result — "could not read" must not
  // arrive looking like "no such lead".
  const leadId = new URL(req.url).searchParams.get("leadId")?.trim();
  if (leadId) {
    // One whole lead is the leads list's business: a function holder sees
    // it only through a function that shows the leads.
    if (gate.mode === "feature" && !visibleSlices("admissions", gate).has("leads")) {
      return NextResponse.json(
        { ok: false, error: "Your role does not include admission leads." },
        { status: 403 },
      );
    }
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

  if (gate.mode === "feature") return featureDeskResponse(gate);

  try {
    const result = await cachedDeskJson({
      cacheKey: "admissions-desk",
      tables: ["admission_desk_leads", "admission_desk_households", "admission_desk_registration_payments", "admission_desk_field_ops"],
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const { state, meta, ok, stamps } = await fetchAdmissionDeskFromDb();
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
        // Each row's updated_at: the browser's saves are stamped with them.
        stamps,
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
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["admissions-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (!admissionsDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "ADMISSIONS_DUAL_WRITE_DB disabled",
    });
  }

  let body: { state?: Partial<AdmissionsState>; stamps?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.state) {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }

  let normalized = normalizeAdmissionsState(body.state);
  // The rows this browser changed and the stamp each was changed from.
  const stamps = readStampsParam(body.stamps, ADMISSION_SLICES);

  // Function-only writers (director, 6 Oct 2026 — e.g. Admissions → Field
  // survey): merged onto the stored desk, their functions' slices only, row
  // by row — never the body as sent. Both sides go through the same
  // normaliser so an unchanged lead compares equal; keys the browser did not
  // send stay out (normalising would invent them — empty lists, seeded
  // beats — and an invented empty list reads as "removed everything").
  // pushAdmissionDeskToDb keeps every guard it has for everyone: stub leads
  // are restored from lead_json, paid / enrolled leads are never pruned.
  if (gate.mode === "feature") {
    const stored = await fetchAdmissionDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved admissions desk — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const sent = body.state as Record<string, unknown>;
    const incoming: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(normalized)) if (k in sent) incoming[k] = v;
    const merged = featurePushOutcome(gate, "admissions", stored.state, incoming);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    const next = merged.state as unknown as AdmissionsState;
    for (const k of SEQ_KEYS) {
      const pushed = Number(sent[k]);
      if (Number.isFinite(pushed) && pushed > next[k]) next[k] = Math.round(pushed);
    }
    normalized = normalizeAdmissionsState(next);
  }

  const result = await pushAdmissionDeskToDb(normalized, { stamps });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  const answer = { stamps: result.stamps ?? {}, conflicts: result.conflicts ?? {} };
  if (gate.mode === "feature") {
    const saved = featureSavedResponse(true);
    return NextResponse.json({ ...(await saved.json()), ...answer }, { status: saved.status });
  }
  return NextResponse.json({
    ok: true,
    ...answer,
    leadCount: normalized.leads.length,
    householdCount: normalized.households.length,
    updatedAt: new Date().toISOString(),
  });
}

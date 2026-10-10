import { NextResponse } from "next/server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import {
  deskFeatureGateFor,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
  type FeatureGate,
} from "@/lib/deskFeatureGate.server";
import type { PtmState } from "@/lib/ptm";
import { scopedPtmState } from "@/lib/ptmTeacherScope.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { ptmDualWriteDbEnabled } from "@/lib/ptmDbConfig";
import {
  fetchPtmDeskFromDb,
  pushPtmDeskToDb,
  PTM_DELETABLE_TABLES,
  PTM_SLICES,
  PTM_TABLE_SLICES,
} from "@/lib/ptmNormalized.server";
import { readStampsParam, type RowStamps } from "@/lib/rowStampClient";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { featureAuthorizedDeletes } from "@/lib/deskNamedDeletesFeature.server";

export const runtime = "nodejs";

type PtmDeskBody = Pick<PtmState, "events" | "slots" | "bookings" | "feedback">;

/** The stamps of the rows a response carries (a cut desk gets only its rows'). */
function stampsFor(desk: PtmDeskBody, all: RowStamps): RowStamps {
  const out: RowStamps = {};
  for (const slice of PTM_SLICES) {
    const from = all[slice] ?? {};
    const m: Record<string, string> = {};
    for (const r of desk[slice] ?? []) if (from[r.id]) m[r.id] = from[r.id];
    out[slice] = m;
  }
  return out;
}

/**
 * A PTM function holder's copy: their slices, plus the events and slots
 * every PTM job is arranged around; bookings also go to whoever records
 * the meeting's feedback (feedback is written against a booking).
 */
function featurePtmBody(desk: PtmDeskBody, gate: FeatureGate): PtmDeskBody {
  const holds = (id: string) =>
    (["view", "create", "edit", "delete"] as const).some((a) => gate.access(id, a).allowed);
  const cut = stripDeskForFeatures("ptm", desk, gate);
  return {
    events: desk.events,
    slots: desk.slots,
    bookings: holds("ptm.bookings") || holds("ptm.feedback") ? desk.bookings : [],
    feedback: cut.feedback,
  };
}

/** GET — pull PTM desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["ptm-desk"], "GET");
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "ptm", "read");
    if (!gate) return auth.response;
  }
  const { bundle, meta, ok, stamps } = await fetchPtmDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "PTM desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  // A teacher's browser gets only its own slice (lib/ptmTeacherScope.server,
  // the same cut as /api/v1/staff/ptm/desk) — ptm.view is held by every
  // teacher, and this was the whole school's bookings and feedback
  // (2026-09-29). Unknown scope is refused, never widened. A function
  // holder outside the office gets the same cut, then their functions' part.
  const scopeCtx = gate ? gate.ctx : auth.ok && !auth.viaMirrorSecret ? auth.ctx : null;
  if (scopeCtx) {
    const scope = await staffSectionScope(scopeCtx).catch(() => null);
    if (!scope) {
      return NextResponse.json({ ok: false, error: "Could not work out your classes" }, { status: 503 });
    }
    if (!scope.unrestricted) {
      await ensureSchoolMirrorHydrated();
      await ensureSisHydratedServer();
      const scoped = scopedPtmState({
        state: { version: 1, ...bundle },
        scope,
        staffId: scopeCtx.session.staffId || "",
        sis: loadSis(),
      });
      const cut = gate ? featurePtmBody(scoped, gate) : scoped;
      return NextResponse.json(
        {
          ok: true,
          events: cut.events,
          slots: cut.slots,
          bookings: cut.bookings,
          feedback: cut.feedback,
          stamps: stampsFor(cut, stamps),
          eventCount: cut.events.length,
          ...(gate ? { functionOnly: true } : {}),
          updatedAt: meta?.updatedAt || new Date().toISOString(),
          meta,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }
  const desk = gate ? featurePtmBody(bundle, gate) : bundle;
  return NextResponse.json({
    ok: true,
    events: desk.events,
    slots: desk.slots,
    bookings: desk.bookings,
    feedback: desk.feedback,
    stamps: stampsFor(desk, stamps),
    eventCount: desk.events.length,
    ...(gate ? { functionOnly: true } : {}),
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type PtmDeskPostBody = Pick<
  PtmState,
  "events" | "slots" | "bookings" | "feedback"
> & { deletes?: unknown; stamps?: unknown };

/** POST — push full PTM desk snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["ptm-desk"], "POST");
  // Without the module: a function holder's save, or refused.
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "ptm", "write");
    if (!gate) return auth.response;
  }
  // This push replaces the whole school's PTM desk (every event, slot,
  // booking and feedback note). "ptm.edit" alone let a teacher's browser
  // send it — a stale copy could drop other classes' bookings. Teachers add
  // their own slots and record feedback through /api/v1/staff/ptm/slots and
  // /api/v1/staff/ptm/booking; this route is the office's (2026-09-29).
  // A function holder is held to it too: the function says what may
  // change, not that a teacher's browser may push the school's desk.
  const scopeCtx = gate ? gate.ctx : auth.ok && !auth.viaMirrorSecret ? auth.ctx : null;
  if (scopeCtx) {
    const scope = await staffSectionScope(scopeCtx).catch(() => null);
    if (!scope?.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the office or principal can save the whole PTM desk. " +
            "Your own slots and meeting feedback are saved on their own.",
        },
        { status: 403 },
      );
    }
  }
  if (!ptmDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "PTM_DUAL_WRITE_DB disabled",
    });
  }

  let body: PtmDeskPostBody;
  try {
    body = (await req.json()) as PtmDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Deletions are named by the desk, never inferred from what it lacks.
  let deletes = readNamedDeletes(body.deletes, PTM_DELETABLE_TABLES);
  // The rows this browser changed and the stamp each was changed from.
  const stamps = readStampsParam(body.stamps, PTM_SLICES);

  // Function holders (e.g. PTM → Meeting slots): merged onto the stored
  // desk, only their functions' slices — never the body as sent.
  if (gate) {
    const stored = await fetchPtmDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved PTM desk — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(gate, "ptm", stored.bundle, body);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    deletes = featureAuthorizedDeletes(deletes, PTM_TABLE_SLICES, stored.bundle, merged.state);
    body = merged.state as unknown as PtmDeskPostBody;
  }

  const result = await pushPtmDeskToDb({
    version: 1,
    events: Array.isArray(body.events) ? body.events : [],
    slots: Array.isArray(body.slots) ? body.slots : [],
    bookings: Array.isArray(body.bookings) ? body.bookings : [],
    feedback: Array.isArray(body.feedback) ? body.feedback : [],
  }, deletes, { stamps });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  const answer = { stamps: result.stamps ?? {}, conflicts: result.conflicts ?? {} };
  if (gate) {
    const saved = featureSavedResponse(true);
    return NextResponse.json({ ...(await saved.json()), ...answer }, { status: saved.status });
  }
  return NextResponse.json({
    ok: true,
    ...answer,
    eventCount: body.events?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}

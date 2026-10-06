import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import {
  authorizeSchoolDataDesk,
  requireStaffApi,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import { mastersDualWriteDbEnabled } from "@/lib/mastersDbConfig";
import {
  fetchMastersDeskFromDb,
  fetchMastersSyncMeta,
  pushMastersDeskToDb,
} from "@/lib/mastersNormalized.server";
import { fetchMastersFromRowTables } from "@/lib/mastersRowTables.server";
import { guardMastersOverwrite } from "@/lib/mastersWriteGuard";
import { guardMastersRevision } from "@/lib/mastersRevisionGuard";
import {
  deskWriteGate,
  featurePushOutcome,
  featureSavedResponse,
} from "@/lib/deskFeatureGate.server";

export const runtime = "nodejs";

/**
 * Serve masters from the masters_desk_* row tables instead of the JSONB
 * slices.
 *
 * OPT-IN via MASTERS_READ_FROM_ROWS. Rollback is removing the variable —
 * no code change, no redeploy of a different build.
 *
 * This lives in the route, not in mastersNormalized.server.ts, because that
 * module is reachable from client pages (via mastersPersistence -> masters.ts
 * -> app/pay/share/page.tsx) and importing a `server-only` file there breaks
 * the production build. Nothing imports a route, so here it is safe.
 */
function readFromRowTables(): boolean {
  const flag = process.env.MASTERS_READ_FROM_ROWS?.trim().toLowerCase();
  return flag === "true" || flag === "1";
}

/**
 * The parts of Masters every member of staff needs to do their job: the
 * school's years, terms, classes, sections, subjects, holidays and timings.
 * Nothing about money (fee heads, structures, concessions and the families
 * they were granted to), numbering, statutory setup or students.
 */
const TEACHING_MASTERS_KEYS = [
  "academicYears",
  "academicTerms",
  "campuses",
  "classes",
  "sections",
  "subjects",
  "classSubjects",
  "seniorStreams",
  "holidays",
  "schoolTiming",
  "schoolProfile",
] as const;

/**
 * Staff without the Masters grant used to get 403 here — and with it an
 * EMPTY class list on every screen, because this is the only place a
 * browser learns the school's classes. Every teacher who signed in on
 * 2026-09-29 saw "Select class…" with nothing under it. They now get the
 * teaching subset, marked `teachingOnly` so nothing mistakes it for the
 * whole desk (and a push of it is refused anyway: POST needs masters.edit).
 */
async function teachingMastersResponse() {
  const { bundle, meta, readFailed } = await fetchMastersDeskFromDb();
  if (readFailed) {
    return NextResponse.json(
      { ok: false, error: "Could not read the school setup — please try again." },
      { status: 503 },
    );
  }
  // Start from the empty shell so every other key is present but empty —
  // the client reads e.g. `bundle.feeHeads.length` and must not crash.
  const { version: _v, ...subset } = emptyMastersShell() as unknown as Record<string, unknown>;
  for (const k of TEACHING_MASTERS_KEYS) subset[k] = (bundle as Record<string, unknown>)[k];
  // The Staff module owns these three; an empty list here would be merged
  // over the roster the browser already holds.
  delete subset.staff;
  delete subset.departments;
  delete subset.designations;
  return NextResponse.json({
    ok: true,
    ...subset,
    teachingOnly: true,
    classCount: bundle.classes.length,
    feeHeadCount: 0,
    subjectCount: bundle.subjects.length,
    sliceCount: meta?.sliceCount ?? 0,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    source: "slices",
  });
}

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["masters-desk"], "GET");
  if (!auth.ok) {
    if (auth.response.status === 403) {
      const staff = await requireStaffApi(req);
      if (staff.ok && !staff.viaMirrorSecret && staff.ctx.session.persona === "staff") {
        return teachingMastersResponse();
      }
    }
    return auth.response;
  }

  if (readFromRowTables()) {
    const cachedRows = await cachedDeskJson({
      cacheKey: "masters-desk-rows",
      tables: ["masters_desk_slices", "masters_desk_settings"],
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const rows = await fetchMastersFromRowTables();
        if (!rows.ok) throw new Error("row path failed");
        const meta = await fetchMastersSyncMeta(rows.bundle);
        return {
          ok: true,
          ...rows.bundle,
          classCount: rows.bundle.classes.length,
          feeHeadCount: rows.bundle.feeHeads.length,
          subjectCount: rows.bundle.subjects.length,
          sliceCount: meta?.sliceCount ?? 0,
          updatedAt: meta?.updatedAt || new Date().toISOString(),
          meta,
          source: "rows",
        };
      },
    }).catch(() => null);
    if (cachedRows) return deskJsonResponse(cachedRows);
    const rows = await fetchMastersFromRowTables();
    if (rows.ok) {
      // The revision still comes from masters_desk_sync_meta, so the
      // optimistic-locking base is identical whichever source served the
      // bundle. Anything else would make every save falsely stale.
      const meta = await fetchMastersSyncMeta(rows.bundle);
      return NextResponse.json({
        ok: true,
        ...rows.bundle,
        classCount: rows.bundle.classes.length,
        feeHeadCount: rows.bundle.feeHeads.length,
        subjectCount: rows.bundle.subjects.length,
        sliceCount: meta?.sliceCount ?? 0,
        updatedAt: meta?.updatedAt || new Date().toISOString(),
        meta,
        source: "rows",
      });
    }
    // Falling back to the slices, which are still written on every push and
    // are therefore correct — this is not an error dressed as data. It is
    // logged at error level so a broken row path is visible rather than
    // silent. Once the slices go in Stage 10 there is nothing to fall back
    // to and this becomes a hard failure.
    console.error(
      "[masters-desk] row-table read failed — serving slices instead. " +
        "The row path is broken and needs attention.",
    );
  }

  const { bundle, meta } = await fetchMastersDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    classCount: bundle.classes.length,
    feeHeadCount: bundle.feeHeads.length,
    subjectCount: bundle.subjects.length,
    sliceCount: meta?.sliceCount ?? 0,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
    source: "slices",
  });
}

export async function POST(req: Request) {
  // The whole of Masters, or some of its functions (a teacher's Class
  // subjects) — lib/deskFeatureGate.server.ts.
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["masters-desk"]);
  if (gate.mode === "deny") return gate.response;
  const featureGate = gate.mode === "feature" ? gate : null;
  if (!mastersDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "MASTERS_DUAL_WRITE_DB disabled",
    });
  }

  let body: MastersState & { baseUpdatedAt?: string | null };
  try {
    body = (await req.json()) as MastersState & { baseUpdatedAt?: string | null };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { version: _v, baseUpdatedAt, ...rest } = body;
  let state = { version: 2 as const, ...rest } as MastersState;

  const { bundle: stored, meta, readFailed } = await fetchMastersDeskFromDb();

  // No stored state, no guard. guardMastersOverwrite reads zero stored classes
  // as `bootstrap` and allows the write — correct for a genuinely new tenant,
  // catastrophic when the read merely failed. On 2026-08-10 a read timed out
  // under load, the guard saw an empty bundle, and a wholesale id replacement
  // was accepted: all 15 class ids rewritten, 711 students orphaned on class
  // and section in one request, 268 fee lines with them.
  //
  // Refusing costs a retry. Guarding against data we never read costs the
  // school its id generation, and the repair took a hand-built remap.
  if (readFailed) {
    console.error("[masters-desk] refusing push: stored state unreadable");
    return NextResponse.json(
      {
        error:
          "Could not read the saved masters to check this change against. " +
          "Nothing was written — please try again.",
        reason: "stored_unreadable",
      },
      { status: 503 },
    );
  }

  // Optimistic locking: the push must carry the desk revision the client
  // hydrated at. A mismatch means another device saved after this one
  // loaded — refuse instead of last-write-wins, and let the client
  // rehydrate. Missing base = legacy client, allowed but logged so we can
  // see when they drain and tighten enforcement.
  // Compare against meta.updatedAt first: it is the field GET serves as
  // `updatedAt`, which is what the client stored as its base. (Push writes
  // both columns from the same instant, so they normally agree.)
  const revision = guardMastersRevision(
    baseUpdatedAt ?? null,
    meta?.updatedAt ?? meta?.lastUpdatedAt ?? null,
  );
  // Function-only writers are exempt: their browser is served the teaching
  // subset with no revision, and their push is merged row by row onto the
  // stored desk below — nothing of theirs can overwrite a newer save
  // outside their own classes.
  if (!revision.allow && !featureGate) {
    console.warn(
      `[masters-desk] rejected stale push`,
      `base=${baseUpdatedAt} stored=${revision.storedUpdatedAt}`,
    );
    return NextResponse.json(
      {
        error: revision.message,
        reason: revision.reason,
        storedUpdatedAt: revision.storedUpdatedAt,
      },
      { status: 409 },
    );
  }
  if (revision.reason === "unversioned" && meta) {
    console.warn("[masters-desk] unversioned push accepted (legacy client)");
  }

  // Function-only writers: the stored desk is the base, and only the slices
  // their functions own are lifted in — row by row, inside their classes.
  // Their browser holds the teaching subset only, so anything else in the
  // push is not theirs to save and is ignored, never written.
  if (featureGate) {
    const className = new Map((stored.classes ?? []).map((c) => [c.id, c.name]));
    const merged = featurePushOutcome(
      featureGate,
      "masters",
      stored,
      state,
      (id) => className.get(id) || "That class",
    );
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    state = { ...(merged.state as unknown as MastersState), version: 2 };
  }

  // A client must not be able to replace the class-id generation wholesale.
  // This is checked before the write, not after, because pushMastersDeskToDb
  // upserts every slice in one go — by the time it returns, every student,
  // lead and RTE seat referencing a class is already orphaned.
  const verdict = guardMastersOverwrite(
    (stored.classes ?? []).map((c) => c.id),
    (state.classes ?? []).map((c) => c.id),
  );
  if (!verdict.allow) {
    console.warn(
      `[masters-desk] rejected ${verdict.reason} push`,
      `stored=${verdict.storedCount} incoming=${verdict.incomingCount}`,
    );
    return NextResponse.json(
      {
        error: verdict.message,
        reason: verdict.reason,
        storedClassCount: verdict.storedCount,
        incomingClassCount: verdict.incomingCount,
      },
      { status: 409 },
    );
  }

  // Awaited: the previous fire-and-forget meant a failed write still returned
  // ok:true, so a client could believe its masters were saved when they were
  // not.
  const pushed = await pushMastersDeskToDb(state);
  if (!pushed.ok) {
    return NextResponse.json(
      { error: pushed.error || "Masters push failed" },
      { status: 500 },
    );
  }
  if (featureGate) {
    // No revision back: this browser holds the teaching subset and must
    // never take it as a base for a whole-desk push.
    return featureSavedResponse(true);
  }
  return NextResponse.json({
    ok: true,
    classCount: body.classes?.length ?? 0,
    feeHeadCount: body.feeHeads?.length ?? 0,
    // The exact revision written to sync meta, not a fresh timestamp: the
    // client stores this as the base for its next push, and it must equal
    // what the revision guard will read back.
    updatedAt: pushed.updatedAt || new Date().toISOString(),
  });
}

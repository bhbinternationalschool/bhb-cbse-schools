import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import { deskWriteGate } from "@/lib/deskFeatureGate.server";
import { teachingMastersSubset } from "@/lib/mastersTeachingSubset";
import { resolveMastersReadScope } from "@/lib/mastersReadScope.server";
import {
  fetchMastersDeskFromDb,
  fetchMastersSliceStamps,
  fetchMastersSyncMeta,
} from "@/lib/mastersNormalized.server";
import { fetchMastersFromRowTables } from "@/lib/mastersRowTables.server";
import { BUILD_HEADER, STALE_HEADER } from "@/lib/staleBuild.server";

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
 * Staff without the Masters grant used to get 403 here — and with it an
 * EMPTY class list on every screen, because this is the only place a
 * browser learns the school's classes. Every teacher who signed in on
 * 2026-09-29 saw "Select class…" with nothing under it. They now get the
 * teaching subset, marked `teachingOnly` so nothing mistakes it for the
 * whole desk (and the POST is gone since data-layer 2.2f).
 */
async function teachingMastersResponse() {
  const { bundle, meta, readFailed } = await fetchMastersDeskFromDb();
  if (readFailed) {
    return NextResponse.json(
      { ok: false, error: "Could not read the school setup — please try again." },
      { status: 503 },
    );
  }
  // Every other key is present but empty — the client reads e.g.
  // `bundle.feeHeads.length` and must not crash. The Staff module owns
  // staff/departments/designations; an empty list here would be merged over
  // the roster the browser already holds, so they are left out
  // (lib/mastersTeachingSubset, shared with GET /api/data/views/masters).
  const subset = teachingMastersSubset(bundle as Record<string, unknown>);
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
  // Full Masters, the teaching subset, or the guard's refusal — one rule,
  // shared with GET /api/data/views/masters (lib/mastersReadScope.server).
  const access = await resolveMastersReadScope(req);
  if (!access.ok) return access.response;
  if (access.scope === "teaching") return teachingMastersResponse();

  if (readFromRowTables()) {
    const cachedRows = await cachedDeskJson({
      cacheKey: "masters-desk-rows",
      tables: ["masters_desk_slices", "masters_desk_settings"],
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const rows = await fetchMastersFromRowTables();
        if (!rows.ok) throw new Error("row path failed");
        const { meta, readFailed } = await fetchMastersSyncMeta(rows.bundle);
        if (readFailed) throw new Error("masters sync meta read failed");
        const sliceStamps = await fetchMastersSliceStamps();
        return {
          ok: true,
          ...rows.bundle,
          sliceStamps,
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
    // The revision still comes from masters_desk_sync_meta, so the
    // optimistic-locking base is identical whichever source served the
    // bundle. Anything else would make every save falsely stale — and a
    // failed meta read is not a revision (it falls to the slices below).
    const rowsMeta = rows.ok ? await fetchMastersSyncMeta(rows.bundle) : null;
    if (rows.ok && rowsMeta && !rowsMeta.readFailed) {
      const meta = rowsMeta.meta;
      const sliceStamps = await fetchMastersSliceStamps();
      return NextResponse.json({
        ok: true,
        ...rows.bundle,
        sliceStamps,
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

  const { bundle, meta, sliceStamps, readFailed } = await fetchMastersDeskFromDb();
  // Unknown is not empty (data-layer 0.5b): a failed read answered 200 with
  // zero classes, and the browser took that as the school's masters.
  if (readFailed) {
    return NextResponse.json(
      { ok: false, error: "Could not read the school setup — please try again." },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    sliceStamps,
    classCount: bundle.classes.length,
    feeHeadCount: bundle.feeHeads.length,
    subjectCount: bundle.subjects.length,
    sliceCount: meta?.sliceCount ?? 0,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
    source: "slices",
  });
}

/**
 * POST — gone (data-layer 2.2f). Masters is written one element at a time
 * through the kernel: POST /api/data/masters.<list> (one element at its
 * `_rev`), POST /api/data/masters/batch (one all-or-none batch across lists),
 * and the number-series / counter-grant routes. The whole-book save, the
 * section save (`sliceBases`) and the function-only teacher save that used to
 * land here are refused for EVERY body — nothing is read, nothing written —
 * and an old tab that still sends one is told to reload (the 1.2 stub:
 * 410 `{ok:false, reason:"build_stale", reload:true}` + `X-Bhb-Build-Stale: 1`,
 * one log line) — for everyone who holds Masters or one of its functions. Kept for one release, then deleted with the route's GET
 * (2.3b).
 */
export async function POST(req: Request) {
  // Anyone who could save Masters here before — the module, or one of its
  // functions (a teacher's Class subjects) — is told to reload; anyone else
  // gets the refusal they always got.
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["masters-desk"]);
  if (gate.mode === "deny") return gate.response;
  const who = gate.mode === "feature" ? gate.ctx.session.staffId || gate.ctx.session.email || "?" : "masters-holder";
  console.warn(
    JSON.stringify({
      event: "masters-desk-post-gone",
      who,
      clientBuild: (req.headers.get(BUILD_HEADER) || "").trim().slice(0, 80) || null,
    }),
  );
  return NextResponse.json(
    {
      ok: false,
      reason: "build_stale",
      reload: true,
      error:
        "This page is out of date: Masters is now saved one item at a time. Reload the page and make the change again — nothing was saved.",
    },
    { status: 410, headers: { [STALE_HEADER]: "1" } },
  );
}

/**
 * Masters desk — Supabase slice rows (masters_desk_slices).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MastersState } from "@/lib/masters";
import { emptyMastersShell } from "@/lib/masters";
import { mastersDualWriteDbEnabled } from "@/lib/mastersDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { stripStaffFromMastersForBlob } from "@/lib/staffPersistence";

export type MastersSliceKey = keyof Omit<MastersState, "version">;

export const MASTERS_OBJECT_SLICES: MastersSliceKey[] = [
  "midYearFeePolicy",
  "schoolProfile",
  "schoolTiming",
  // EPF/ESIC establishment config (wage ceilings, rates). Until 2026-08-19 it
  // was not in this list, so the ceilings set in Masters → Statutory lived in
  // one browser only and never reached payroll on another device.
  "statutoryConfig",
];

export const MASTERS_ARRAY_SLICES: MastersSliceKey[] = [
  "campuses",
  "classes",
  "sections",
  "feeHeads",
  "feeHeadCategories",
  "feeGroups",
  "feeStructureLines",
  "installments",
  "lateFeeRules",
  "students",
  "specialFees",
  "specialFeeAssignments",
  "concessionKinds",
  "concessions",
  "concessionGrants",
  "academicYears",
  "academicTerms",
  "subjects",
  "classSubjects",
  "seniorStreams",
  "numberSeries",
  "holidays",
  "departments",
  "designations",
  "staff",
];

export const MASTERS_SLICE_KEYS: MastersSliceKey[] = [
  ...MASTERS_OBJECT_SLICES,
  ...MASTERS_ARRAY_SLICES,
];

export type MastersDeskSyncMeta = {
  sliceCount: number;
  classCount: number;
  feeHeadCount: number;
  subjectCount: number;
  lastUpdatedAt: string | null;
  updatedAt: string;
};

export type MastersDeskBundle = Omit<MastersState, "version">;

const META_SELECT =
  "slice_count, class_count, fee_head_count, subject_count, last_updated_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

function nowIso() {
  return new Date().toISOString();
}

function emptyBundle(): MastersDeskBundle {
  const { version: _v, ...rest } = emptyMastersShell();
  return rest;
}

function stateToSlices(state: MastersState): {
  key: MastersSliceKey;
  payload: unknown;
}[] {
  return MASTERS_SLICE_KEYS.map((key) => ({
    key,
    payload: state[key],
  }));
}

function slicesToBundle(
  sliceMap: Partial<Record<MastersSliceKey, unknown>>,
): MastersDeskBundle {
  const empty = emptyBundle();
  const bundle = { ...empty };
  for (const key of MASTERS_SLICE_KEYS) {
    const payload = sliceMap[key];
    if (payload === undefined || payload === null) continue;
    if (MASTERS_OBJECT_SLICES.includes(key)) {
      (bundle as Record<string, unknown>)[key] = payload;
      continue;
    }
    if (Array.isArray(payload)) {
      (bundle as Record<string, unknown>)[key] = payload;
    }
  }
  return bundle;
}

export type MastersPushOutcome = {
  ok: boolean;
  error?: string;
  updatedAt?: string;
  /** Set when the write was refused for its revision: the caller answers 409. */
  conflict?: "stale" | "unversioned" | "slice_stale";
  /** Section saves: the sections that changed elsewhere first. */
  conflicts?: string[];
  /** Section saves: each written section's new stamp. */
  sliceStamps?: Record<string, string>;
};

/**
 * Save only the sections a browser changed (10 Oct 2026). `bases` holds,
 * for each section in `keys`, the `updated_at` it was loaded at ("" = it
 * saw no such section). masters_write_slices writes them all or none: one
 * stale section refuses the whole save, because sections depend on each
 * other. Sections not named are left exactly as stored. `state` is the
 * stored desk with this save's sections laid on — the route's guards ran on
 * it — and supplies the meta counts.
 */
export async function pushMastersSlicesToDb(
  state: MastersState,
  keys: MastersSliceKey[],
  bases: Record<string, string>,
): Promise<MastersPushOutcome> {
  if (!mastersDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const stripped = stripStaffFromMastersForBlob(state) as unknown as Record<string, unknown>;
  const slices = keys
    .filter((key) => MASTERS_SLICE_KEYS.includes(key))
    .filter((key) =>
      MASTERS_OBJECT_SLICES.includes(key) ? stripped[key] != null : Array.isArray(stripped[key]),
    )
    .map((key) => ({ key, payload: stripped[key], base: bases[key] ?? "" }));
  if (!slices.length) return { ok: true, updatedAt: "", sliceStamps: {} };

  const { data, error } = await sb.rpc("masters_write_slices", {
    p_tenant_id: tenantId,
    p_slices: slices,
    p_now: now,
  });
  if (error) return { ok: false, error: `Masters were not saved: ${error.message}` };
  const res = (data ?? {}) as { ok?: boolean; conflicts?: string[]; error?: string };
  if (!res.ok) {
    if (res.conflicts?.length) {
      return {
        ok: false,
        conflict: "slice_stale",
        conflicts: res.conflicts,
        error:
          "Someone changed the same part of Masters on another device after this one loaded it " +
          `(${res.conflicts.join(", ")}). Nothing was saved — the screen will refresh; re-apply your change.`,
      };
    }
    return { ok: false, error: res.error || "Masters were not saved." };
  }

  await sb
    .from("masters_desk_sync_meta")
    .update({
      class_count: (state.classes ?? []).length,
      fee_head_count: (state.feeHeads ?? []).length,
      subject_count: (state.subjects ?? []).length,
    })
    .eq("tenant_id", tenantId);

  // The derived masters_desk_* row tables follow the slices, as for a whole save.
  const { error: syncErr } = await sb.rpc("masters_sync_rows_from_slices", { p_tenant_id: tenantId });
  if (syncErr) {
    console.error("[masters] row-table sync failed", syncErr.message);
    return { ok: false, error: `Masters saved, but the row tables did not update: ${syncErr.message}`, updatedAt: now };
  }
  return {
    ok: true,
    updatedAt: now,
    sliceStamps: Object.fromEntries(slices.map((x) => [x.key, now])),
  };
}

/** Each section's `updated_at` — the base a browser saves that section from. */
export async function fetchMastersSliceStamps(): Promise<Record<string, string> | null> {
  const ctx = await resolveCtx();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("masters_desk_slices")
    .select("slice_key, updated_at")
    .eq("tenant_id", ctx.tenantId);
  if (error) return null;
  return Object.fromEntries(
    (data ?? []).map((r) => [String((r as { slice_key: string }).slice_key), String((r as { updated_at: string }).updated_at)]),
  );
}

/**
 * Write masters — only on top of the revision the writer read.
 *
 * `baseUpdatedAt` is the desk revision (sync meta `updated_at`) the caller's
 * copy came from. The route checked it for browsers, but every other writer
 * (the mirror push, the ops loader, the cutover) wrote unconditionally, and
 * the route itself let a browser with NO revision through as "legacy" —
 * which is exactly a browser that never loaded masters. Now the writer
 * itself refuses:
 *  - no revision while the desk has one ("unversioned"),
 *  - a revision the desk has moved past ("stale"),
 * and claims the new revision with a conditional update, so of two saves
 * from the same base only one lands. Only a desk that has never been written
 * (no sync meta) accepts a write without a revision.
 */
export async function pushMastersDeskToDb(
  state: MastersState,
  opts: { baseUpdatedAt: string | null },
): Promise<MastersPushOutcome> {
  if (!mastersDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const stripped = stripStaffFromMastersForBlob(state);
  const slices = stateToSlices(stripped);

  // A slice the push does not carry is left as stored — absence is not a
  // deletion. This deleted every slice a push lacked or sent empty, so a
  // client (or a server copy) missing a key erased that master, and a push
  // carrying nothing wiped the desk. A slice the push DOES carry is written
  // as sent, an empty array included: removing the last holiday is a real
  // edit, and the route's revision lock is what keeps a stale copy from
  // making it.
  const rows = slices
    .filter(({ key, payload }) => {
      if (MASTERS_OBJECT_SLICES.includes(key)) return payload != null;
      return Array.isArray(payload);
    })
    .map(({ key, payload }) => ({
      tenant_id: tenantId,
      slice_key: key,
      payload,
      updated_at: now,
    }));

  if (rows.length === 0) {
    return { ok: false, error: "Masters push carried no slices — nothing was written." };
  }

  const { data: metaNow, error: metaErr } = await sb
    .from("masters_desk_sync_meta")
    .select("updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (metaErr) {
    return { ok: false, error: `Could not read the masters revision — nothing was written: ${metaErr.message}` };
  }
  const storedRev = (metaNow as { updated_at?: string } | null)?.updated_at ?? null;
  if (storedRev) {
    const base = (opts.baseUpdatedAt ?? "").trim();
    if (!base) {
      return {
        ok: false,
        conflict: "unversioned",
        error:
          "This copy of masters was never loaded from the server, so it cannot be saved over it. " +
          "The screen will refresh with the current data; re-apply your change.",
      };
    }
    if (Date.parse(base) !== Date.parse(storedRev)) {
      return {
        ok: false,
        conflict: "stale",
        error:
          "Masters changed on another device after this one loaded them. Refusing the save so the " +
          "newer version is not overwritten — the screen will refresh; re-apply your change.",
      };
    }
    // Claim the new revision only if nobody moved it since the read above.
    const { data: claimed, error: claimErr } = await sb
      .from("masters_desk_sync_meta")
      .update({ updated_at: now, last_updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("updated_at", storedRev)
      .select("tenant_id");
    if (claimErr) return { ok: false, error: claimErr.message };
    if (!claimed?.length) {
      return {
        ok: false,
        conflict: "stale",
        error: "Another save to masters landed at the same moment — this one was not written. Re-apply your change.",
      };
    }
  }

  {
    const { error } = await sb.from("masters_desk_slices").upsert(rows);
    if (error) return { ok: false, error: error.message };
  }

  await sb.from("masters_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      slice_count: rows.filter((r) => !Array.isArray(r.payload) || r.payload.length > 0).length,
      // Counts only for slices this push carried; the rest stay as recorded.
      ...(Array.isArray(state.classes) ? { class_count: state.classes.length } : {}),
      ...(Array.isArray(state.feeHeads) ? { fee_head_count: state.feeHeads.length } : {}),
      ...(Array.isArray(state.subjects) ? { subject_count: state.subjects.length } : {}),
      last_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  // Derive the masters_desk_* row tables from the slices just written.
  //
  // The rows are a DERIVED copy, never a second writer: the slices stay
  // authoritative and the rows follow. Two independent writers would be a
  // merge problem, which is the disease this migration cures rather than a
  // treatment for it.
  //
  // This must happen before the read path can be switched. Until it does,
  // reads from the rows would come from somewhere the writes never reach,
  // and every masters edit would save fine and never appear.
  //
  // A failure here is reported, not swallowed. The slices are already
  // written and correct, so masters is not lost — but the rows are now stale
  // and the caller needs to know, because after the flip stale rows are what
  // the user would be looking at.
  const { error: syncErr } = await sb.rpc("masters_sync_rows_from_slices", {
    p_tenant_id: tenantId,
  });
  if (syncErr) {
    console.error("[masters] row-table sync failed", syncErr.message);
    return {
      ok: false,
      error: `Masters saved, but the row tables did not update: ${syncErr.message}`,
      updatedAt: now,
    };
  }

  // The exact revision written to sync meta. The route returns this to the
  // client, which stores it as the base for its next push — a freshly
  // minted timestamp here would differ from the stored one and make every
  // second push falsely stale under the revision guard.
  return { ok: true, updatedAt: now };
}

export async function fetchMastersDeskFromDb(): Promise<{
  bundle: MastersDeskBundle;
  meta: MastersDeskSyncMeta | null;
  /**
   * True when the read did not complete. The bundle is then meaningless —
   * NOT "this tenant has no masters".
   *
   * On 2026-08-10 this function swallowed the error and returned an empty
   * bundle. The masters push route guards with
   * `guardMastersOverwrite(stored.classes, incoming.classes)`, and that guard
   * treats zero stored classes as `bootstrap` — a first write, allow. So a
   * read that timed out under load read as "fresh tenant", the guard waved
   * through a wholesale id replacement, and all 15 class ids were rewritten:
   * 711 students orphaned on class and section in one request.
   *
   * A failed read must never be indistinguishable from empty data. That is
   * the same rule ReadFail encodes in lib/data/types.ts (which deliberately
   * has no `rows` property); this path predates it.
   */
  readFailed: boolean;
  /** Each section's `updated_at`, read with the slices. */
  sliceStamps?: Record<string, string>;
}> {
  const ctx = await resolveCtx();
  const empty = emptyBundle();
  if (!ctx) return { bundle: empty, meta: null, readFailed: true };
  const { sb, tenantId } = ctx;

  // This module deliberately does NOT read the row tables, and must not.
  //
  // Importing mastersRowTables.server.ts here pulls a `server-only` file
  // into the CLIENT bundle graph, because masters.ts is reachable from
  // client pages:
  //
  //   mastersRowTables.server.ts -> mastersNormalized.server.ts
  //     -> mastersPersistence.ts -> masters.ts -> app/pay/share/page.tsx
  //
  // That fails the production build outright. The row-table read lives in
  // the API route instead, which nothing imports and is server-only by
  // nature. See app/api/school-data/masters-desk/route.ts.

  // `error` is captured, not discarded. Dropping it is what turned a timed-out
  // read into "this tenant has no classes" — see readFailed above.
  const [{ data: sliceRows, error: sliceErr }, { data: metaRow, error: metaErr }] =
    await Promise.all([
      sb.from("masters_desk_slices").select("*").eq("tenant_id", tenantId),
      sb
        .from("masters_desk_sync_meta")
        .select(META_SELECT)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

  if (sliceErr || metaErr) {
    console.error(
      "[masters-desk] stored-state read FAILED — reporting unknown, not empty:",
      sliceErr?.message ?? metaErr?.message,
    );
    return { bundle: empty, meta: null, readFailed: true };
  }

  const sliceMap: Partial<Record<MastersSliceKey, unknown>> = {};
  const sliceStamps: Record<string, string> = {};
  for (const row of sliceRows ?? []) {
    const r = row as { slice_key: string; payload: unknown; updated_at?: string };
    const key = r.slice_key as MastersSliceKey;
    if (MASTERS_SLICE_KEYS.includes(key)) sliceMap[key] = r.payload;
    if (r.updated_at) sliceStamps[r.slice_key] = String(r.updated_at);
  }

  const bundle = slicesToBundle(sliceMap);
  return { bundle, meta: metaFromRow(metaRow, bundle), readFailed: false, sliceStamps };
}

/**
 * The desk revision, independent of which source served the bundle.
 *
 * The row-table read path needs this without also reading the slices —
 * otherwise "switching the read path" would still read both. `updatedAt` is
 * what the client sends back as `baseUpdatedAt` for optimistic locking, so
 * it must come from masters_desk_sync_meta either way; anything else would
 * make every save falsely stale under the revision guard.
 */
export async function fetchMastersSyncMeta(
  bundle: MastersDeskBundle,
): Promise<MastersDeskSyncMeta | null> {
  const ctx = await resolveCtx();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("masters_desk_sync_meta")
    .select(META_SELECT)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  return metaFromRow(data, bundle);
}

/**
 * Shared meta mapping, so the two read paths cannot disagree about the
 * revision. `updatedAt` is what the client sends back as `baseUpdatedAt`
 * for optimistic locking — it must be identical whichever source served the
 * bundle, or switching the read path would make every save falsely stale.
 */
function metaFromRow(
  metaRow: {
    slice_count?: number | null;
    class_count?: number | null;
    fee_head_count?: number | null;
    subject_count?: number | null;
    last_updated_at?: string | null;
    updated_at?: string | null;
  } | null,
  bundle: MastersDeskBundle,
): MastersDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    sliceCount: Number(metaRow.slice_count ?? 0),
    classCount: Number(metaRow.class_count ?? bundle.classes.length),
    feeHeadCount: Number(metaRow.fee_head_count ?? bundle.feeHeads.length),
    subjectCount: Number(metaRow.subject_count ?? bundle.subjects.length),
    lastUpdatedAt: metaRow.last_updated_at
      ? String(metaRow.last_updated_at)
      : null,
    updatedAt: String(metaRow.updated_at || ""),
  };
}

export function deskBundleToMastersState(bundle: MastersDeskBundle): MastersState {
  return { version: 2, ...bundle };
}

/**
 * Every academic year code Masters defines, current or not.
 *
 * Used to validate what may be written into the signed session cookie. An
 * empty array means Masters could not be read — the caller must treat that as
 * "cannot validate" and not as "no year is valid", or an unreadable desk would
 * lock everyone out of switching sessions.
 */
export async function listAcademicYearCodesFromDesk(): Promise<string[]> {
  const { bundle } = await fetchMastersDeskFromDb();
  return (bundle.academicYears ?? [])
    .filter((y) => y.isActive !== false)
    .map((y) => y.code)
    .filter((c): c is string => !!c);
}

export async function fetchCurrentAcademicYearFromDesk(): Promise<string | null> {
  const { bundle } = await fetchMastersDeskFromDb();
  const years = bundle.academicYears ?? [];
  const cur = years.find(
    (y) => y.status === "current" && y.isActive !== false,
  );
  return cur?.code ?? null;
}

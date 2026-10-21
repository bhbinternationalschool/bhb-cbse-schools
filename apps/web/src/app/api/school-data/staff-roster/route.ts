import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import { requireStaffApi, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  fetchStaffRemoteServer,
  pushStaffRemoteServer,
  softRemoveStaffRosterServer,
} from "@/lib/staffPersistence";
import { invalidateServerMastersCache } from "@/lib/api/v1/auth";
import { signInMobilesInUse } from "@/lib/data/server/repo";
import { logMobileFills } from "@/lib/staffMobileFillLog.server";
import { clearDeskProbeCache } from "@/lib/deskProbeCache.server";
import {
  prepareRosterRows,
  rosterSaveRefusal,
  staffActorOf,
  staffHoldsPowerfulAccess,
  staffSensitiveAuthority,
  type StaffAuthority,
} from "@/lib/staffProtectedFields";
import type { MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import { hasPermission } from "@/lib/rbac";
import { redactStaffRoster } from "@/lib/staffRosterRedact";
import { readStampsParam } from "@/lib/rowStampClient";
import { STAFF_STAMPED_SLICES } from "@/lib/staffPersistence";

export const runtime = "nodejs";

/** GET — pull staff/departments/designations from normalized tables */
export async function GET(req: Request) {
  // Any member of staff: the directory + their own record (redacted below).
  // Everyone needs their own record — punch card, leave, payslips, the
  // teacher home — and staff.view is no longer given to teachers.
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;

  // staff.view is held by teachers, accounts, transport and the auditor.
  // They get a directory and their own record — never colleagues' Aadhaar,
  // PAN, bank, salary or anyone's password (lib/staffRosterRedact.ts).
  const canEditStaff =
    auth.viaMirrorSecret ||
    hasPermission(auth.ctx.session, auth.ctx.masters, "staff", "edit", auth.ctx.rbac) ||
    // The owner and the bank & pay details function read whole records (2.2b).
    staffSensitiveAuthority(auth.ctx.session, auth.ctx.masters, auth.ctx.rbac, { rbacKnown: auth.ctx.rbacKnown !== false }) !== null;
  const selfStaffId = auth.viaMirrorSecret ? "" : auth.ctx.session.staffId || "";
  if (!auth.viaMirrorSecret) {
    try {
      const bundle = await fetchStaffRemoteServer();
      if (!bundle) throw new Error("Staff roster fetch failed — tenant/db unavailable");
      return NextResponse.json(
        {
          ok: true,
          ...bundle,
          staff: redactStaffRoster(bundle.staff as StaffRecord[], { canEditStaff, selfStaffId }),
          redacted: !canEditStaff,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Staff roster fetch failed" },
        { status: 503 },
      );
    }
  }

  try {
    const result = await cachedDeskJson({
      cacheKey: "staff-roster",
      tables: ["sis_staff", "sis_departments", "sis_designations"],
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const bundle = await fetchStaffRemoteServer();
        if (!bundle) throw new Error("Staff roster fetch failed — tenant/db unavailable");
        return { ok: true, ...bundle };
      },
    });
    return deskJsonResponse(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Staff roster fetch failed" },
      { status: 503 },
    );
  }
}

/** POST — push a Masters state's staff/department/designation slices */
export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) return auth.response;

  let body: { state?: Partial<MastersState>; stamps?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.state) {
    return NextResponse.json({ error: "Missing state" }, { status: 400 });
  }

  const incoming = (body.state.staff ?? []) as StaffRecord[];
  let stamps = readStampsParam(body.stamps, STAFF_STAMPED_SLICES);
  let refused: { refusedIds: string[]; message: string } | null = null;
  let mobileFillIds: string[] = [];
  if (incoming.length > 0) {
    // Read the stored roster to judge this save against (always, since 2.2b:
    // the protected-field rule below needs it, not only the password fill).
    const stored = await fetchStaffRemoteServer();
    if (!stored) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved roster to check this change — nothing was written, try again" },
        { status: 503 },
      );
    }
    // Each row is judged — and written — against the stored row the save
    // lands on: by employee code first, else id, exactly as upsertStaffBundle
    // remaps (rosterTargetOf). A protected or sign-in key the row does not
    // carry is the STORED value (absent = keep): the push normalises an absent
    // key to "", which would otherwise blank a bank account. Browsers never
    // receive loginPassword (staffRosterRedact), so a blank one means "not
    // sent", not "clear it": keep the stored.
    const storedStaff = stored.staff as StaffRecord[];
    type Rec = Parameters<typeof rosterSaveRefusal>[0][number];
    const filled = prepareRosterRows(storedStaff as unknown as Rec[], incoming as unknown as Rec[]) as unknown as StaffRecord[];

    // Bank, UPI, Aadhaar, PAN and pay: only the owner or the bank & pay
    // details function; a set sign-in link (login, e-mail, mobile): only the
    // owner; a password: never set (data-layer 2.2b; director 20–21 Oct
    // 2026). This route writes sis_staff directly, past the database's own
    // guard, so it is checked here — from the session, never from the body.
    const authority: StaffAuthority | null = auth.viaMirrorSecret
      ? null
      : staffSensitiveAuthority(auth.ctx.session, auth.ctx.masters, auth.ctx.rbac, { rbacKnown: auth.ctx.rbacKnown !== false });
    const named = stamps ? new Set(Object.keys(stamps.staff ?? {})) : null;
    // The director's mobile rule (21 Oct): a MISSING mobile may be recorded
    // here, if no other member, family or login has the number and the member
    // holds no powerful access; each such fill is logged.
    let inUse: Set<string>;
    try {
      inUse = await signInMobilesInUse();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Could not check the mobile numbers in use — nothing was written, try again" },
        { status: 503 },
      );
    }
    const fills: string[] = [];
    const refusal = rosterSaveRefusal(storedStaff as unknown as Rec[], filled as unknown as Rec[], named, authority, {
      inUse,
      isPowerful: (t) =>
        auth.viaMirrorSecret ? true : staffHoldsPowerfulAccess(t as unknown as StaffRecord, auth.ctx.masters, auth.ctx.rbac),
      fills,
    });
    mobileFillIds = fills;
    if (refusal) {
      console.warn(
        `[staff-roster] refused ${refusal.refusedIds.length} row(s) of a save by ${auth.viaMirrorSecret ? "mirror" : auth.ctx.session.staffId || "?"}: ${refusal.message}`,
      );
    }
    const refusedSet = new Set(refusal?.refusedIds ?? []);
    const kept = filled.filter((s) => !refusedSet.has(s.id));
    if (refusal && kept.length === 0 && !(body.state.departments?.length || body.state.designations?.length)) {
      // Nothing else in the save: nothing written.
      return NextResponse.json(
        { ok: false, error: refusal.message, reason: "protected_fields", refused: { staff: refusal.refusedIds } },
        { status: 403 },
      );
    }
    // The refused rows leave the save (and its stamps); every other row saves.
    body.state = { ...body.state, staff: kept };
    if (stamps?.staff && refusal) {
      const staffStamps = { ...stamps.staff };
      for (const id of refusal.refusedIds) delete staffStamps[id];
      stamps = { ...stamps, staff: staffStamps };
    }
    refused = refusal;
  }

  // Stamped (current browsers): only the rows named, each at its stamp.
  // Unstamped (older tabs): new rows added, stored rows never replaced.
  const result = await pushStaffRemoteServer(body.state as MastersState, stamps);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Push failed" },
      { status: 502 },
    );
  }
  if (result.kept) {
    console.warn(`[staff-roster] unstamped save left ${result.kept} stored row(s) as they were`);
  }
  const written = new Set(Object.keys(result.stamps?.staff ?? {}));
  const filledNow = mobileFillIds.filter((id) => written.has(id) || !stamps);
  if (filledNow.length && !auth.viaMirrorSecret) await logMobileFills(auth.ctx.session, filledNow, "staff roster save");
  // Refused rows are said: the browser forgets their stamps, re-reads the
  // roster (its copy of those rows goes back to the server's) and toasts the
  // reason once — never re-sending them with every later save.
  return NextResponse.json({
    ok: true,
    stamps: result.stamps,
    conflicts: result.conflicts,
    ...(refused ? { refused: { staff: refused.refusedIds }, refusal: refused.message } : {}),
  });
}

/**
 * DELETE — remove the whole staff roster. Since data-layer 2.2b a SOFT
 * remove (deleted_at + deleted_by = this session): hidden everywhere,
 * restorable; departments and designations stay. It hard-deleted every
 * sis_staff, sis_designations and sis_departments row before.
 */
export async function DELETE(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "delete");
  if (!auth.ok) return auth.response;

  const by = auth.viaMirrorSecret ? "mirror-sync" : staffActorOf(auth.ctx.session) || auth.ctx.session.fullName;
  const result = await softRemoveStaffRosterServer(by);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Remove failed" },
      { status: 502 },
    );
  }
  clearDeskProbeCache("staff-roster");
  invalidateServerMastersCache();
  return NextResponse.json({ ok: true, removed: result.removed ?? 0, soft: true });
}

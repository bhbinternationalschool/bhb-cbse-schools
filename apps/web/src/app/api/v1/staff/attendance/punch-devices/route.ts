import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertSchoolWide, staffWorkingYear } from "@/lib/api/v1/staffScope";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { applyWhatsAppStaffPunch } from "@/lib/staffAttendance.server";
import { attemptsToRecord } from "@/lib/punchAttempts";
import { campusGeofenceFromSettings, validateScreenLocation } from "@/lib/staffGeofence.server";
import { fetchStaffAttendanceSettingsFromDb } from "@/lib/staffAttendanceDeskAncillary.server";
import { loadPunchOptions, savePunchOptions } from "@/lib/punchOptions.server";
import { printedQrTokenFor } from "@/lib/punchCode.server";
import { normalizePunchOptions, printedQrLink, punchWindowState, type PunchOptions } from "@/lib/punchSchedule";
import { publicAppOrigin } from "@/lib/waSisBotServer";
import {
  createPunchDisplay,
  decidePunchDevice,
  listPunchDevices,
  listPunchDisplays,
  revokePunchDisplay,
  startScreenPairing,
} from "@/lib/punchDevices.server";

export const runtime = "nodejs";

/**
 * GET  /api/v1/staff/attendance/punch-devices — the office's view: every
 *      staff member's registered punch phone, phones waiting for approval,
 *      and the QR screens that are switched on.
 * POST {action: approve|reject|reset, id} — decide a phone.
 * POST {action: screen_create, label} → {token} — switch THIS device on as
 *      a QR screen; POST {action: screen_revoke, id} switches one off.
 * POST {action: punch_options, windowStart, windowEnd, days, printedQrEnabled}
 *      — the gate window and the printed backup QR on/off.
 * POST {action: printed_qr_new} — a new printed QR; every earlier print
 *      stops working at once.
 * POST {action: screen_pair_start, label} → {code, expiresAt} — a one-time
 *      code the gate phone types at /punch-screen; nobody signs in on it.
 * Office / principal / admin only. Deciding a phone also needs RBAC
 * attendance.edit (admin / owner): approving writes the punches the phone
 * tried while waiting into the register (director, 5 Oct 2026).
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    await assertSchoolWide(ctx);
    const [devices, screens] = await Promise.all([listPunchDevices(), listPunchDisplays()]);
    if (!devices || !screens) {
      throw new ApiError("server_error", "Could not read punch phones right now", 503);
    }
    const nameOf = new Map(ctx.masters.staff.map((s) => [s.id, s.fullName]));
    const punchOptions = await loadPunchOptions();
    return apiOk({
      punchOptions,
      punchWindow: punchWindowState(punchOptions, Date.now()),
      printedQr: printedQrView(punchOptions),
      // Outside field surveyors' phones (ext:…) live in the same table but
      // are managed under Admissions → Field survey, not here.
      devices: devices
        .filter((d) => !d.staff_id.startsWith("ext:"))
        .map((d) => ({ ...d, staffName: nameOf.get(d.staff_id) || d.staff_id })),
      screens,
      staffWithoutPhone: ctx.masters.staff
        .filter((s) => s.status !== "inactive" && !devices.some((d) => d.staff_id === s.id && d.status === "active"))
        .map((s) => ({ id: s.id, name: s.fullName })),
    });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = {
  action?: string;
  id?: string;
  label?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  windowStart?: string;
  windowEnd?: string;
  days?: number[];
  printedQrEnabled?: boolean;
};

/** The printed QR's link, for the office's print page — only while it is on. */
function printedQrView(o: PunchOptions) {
  if (!o.printedQrEnabled) return null;
  const token = printedQrTokenFor(o.printedQrVersion);
  if (!token) return null;
  return {
    version: o.printedQrVersion,
    issuedAt: o.printedQrIssuedAt,
    link: printedQrLink(publicAppOrigin(), token),
  };
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    await assertSchoolWide(ctx);
    const body = (await request.json().catch(() => ({}))) as Body;
    const by = ctx.session.fullName || "Office";
    const meta = requestMeta(request);

    if (body.action === "screen_create") {
      // Only a device inside the school may become a QR screen.
      const fence = campusGeofenceFromSettings(await fetchStaffAttendanceSettingsFromDb());
      const where = validateScreenLocation({ lat: body.lat, lng: body.lng, accuracyM: body.accuracyM }, fence);
      if (!where.ok) throw new ApiError("forbidden", where.reason || "Outside the school", 403);
      const r = await createPunchDisplay(String(body.label || "Office screen"), by);
      if (!r.ok) throw new ApiError("server_error", r.error, 503);
      await writeAudit({
        session: ctx.session,
        module: "staff_attendance",
        action: "create",
        entityType: "punch_screen",
        entityId: "",
        summary: `Switched on a punch QR screen: ${body.label || "Office screen"}`,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ token: r.token });
    }
    if (body.action === "punch_options" || body.action === "printed_qr_new") {
      const current = await loadPunchOptions();
      const next: PunchOptions =
        body.action === "printed_qr_new"
          ? {
              ...current,
              printedQrEnabled: true,
              printedQrVersion: current.printedQrVersion + 1,
              printedQrIssuedAt: new Date().toISOString(),
            }
          : normalizePunchOptions({
              ...current,
              windowStart: body.windowStart ?? current.windowStart,
              windowEnd: body.windowEnd ?? current.windowEnd,
              days: body.days ?? current.days,
              printedQrEnabled:
                typeof body.printedQrEnabled === "boolean" ? body.printedQrEnabled : current.printedQrEnabled,
              // The first switch-on stamps the issue date; the version is never
              // touched here, so saving times cannot revive or kill a print.
              printedQrIssuedAt:
                body.printedQrEnabled === true && !current.printedQrIssuedAt
                  ? new Date().toISOString()
                  : current.printedQrIssuedAt,
            });
      const r = await savePunchOptions(next);
      if (!r.ok) throw new ApiError("server_error", r.error, 503);
      await writeAudit({
        session: ctx.session,
        module: "staff_attendance",
        action: "edit",
        entityType: "punch_options",
        entityId: "",
        summary:
          body.action === "printed_qr_new"
            ? `New printed gate QR (version ${r.options.printedQrVersion}) — earlier prints stop working`
            : `Gate punch window ${r.options.windowStart}–${r.options.windowEnd}, days ${r.options.days.join(",")}; printed QR ${r.options.printedQrEnabled ? "on" : "off"}`,
        before: current,
        after: r.options,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({
        punchOptions: r.options,
        punchWindow: punchWindowState(r.options, Date.now()),
        printedQr: printedQrView(r.options),
      });
    }
    if (body.action === "screen_pair_start") {
      // The office's own device may be anywhere; the GATE phone's location
      // is checked when it types the code (/api/public/punch-screen/pair).
      const r = await startScreenPairing(String(body.label || "Gate phone"), by);
      if (!r.ok) throw new ApiError("server_error", r.error, 503);
      await writeAudit({
        session: ctx.session,
        module: "staff_attendance",
        action: "create",
        entityType: "punch_screen",
        entityId: "",
        summary: `Pairing code made for a punch QR screen: ${body.label || "Gate phone"} (valid 10 min)`,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ code: r.code, expiresAt: r.expiresAt });
    }
    if (body.action === "screen_revoke") {
      if (!body.id || !(await revokePunchDisplay(body.id))) {
        throw new ApiError("server_error", "Could not switch that screen off", 503);
      }
      return apiOk({ revoked: body.id });
    }
    if (body.action === "approve" || body.action === "reject" || body.action === "reset") {
      assertPermission(ctx, "attendance", "edit");
      if (!body.id) throw new ApiError("bad_request", "Which phone?", 400);
      const r = await decidePunchDevice(body.id, body.action, by);
      if (!r.ok) throw new ApiError("conflict", r.error, 409);

      // Approving a new phone records the punches it made while waiting,
      // at the time they were made (director, 30 Sep 2026). Each passed
      // the office-screen code and the phone's signature when it was tried.
      const recorded: { kind: string; time: string; ok: boolean; note?: string }[] = [];
      if (body.action === "approve" && r.staffId && r.attempts?.length) {
        await ensureSchoolMirrorHydrated();
        const staff = ctx.masters.staff.find((s) => s.id === r.staffId);
        for (const a of attemptsToRecord(r.attempts, Date.now())) {
          if (!staff) {
            recorded.push({ kind: a.kind, time: a.time, ok: false, note: "staff record not found" });
            continue;
          }
          const res = await applyWhatsAppStaffPunch({
            staff,
            mobile10: "",
            kind: a.kind,
            presence: "qr",
            via: "app",
            at: { date: a.date, time: a.time },
            academicYearCode: staffWorkingYear(ctx),
          }).catch((e: unknown) => ({ ok: false as const, error: (e as Error)?.message || "failed" }));
          recorded.push(
            res.ok
              ? { kind: a.kind, time: a.time, ok: true }
              : { kind: a.kind, time: a.time, ok: false, note: res.error },
          );
        }
      }
      await writeAudit({
        session: ctx.session,
        module: "staff_attendance",
        action: "edit",
        entityType: "punch_phone",
        entityId: body.id,
        summary:
          `Punch phone ${body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "reset"}` +
          (recorded.length
            ? ` · recorded ${recorded.map((x) => `${x.kind.toUpperCase()} ${x.time}${x.ok ? "" : " (not saved)"}`).join(", ")}`
            : ""),
        after: recorded.length ? { recorded } : undefined,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ id: body.id, action: body.action, recorded });
    }
    throw new ApiError("bad_request", "Unknown action", 400);
  } catch (e) {
    return apiErr(e);
  }
}

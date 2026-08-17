import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { ensureStaffAttendanceHydratedServer } from "@/lib/staffAttendancePersistence";
import { ensureAdmissionsHydratedServer } from "@/lib/admissionsPersistence";
import { ensurePaymentsHydratedServer } from "@/lib/paymentsPersistence";
import { loadAdmissions } from "@/lib/admissions";
import { loadAttendance, summarizeMarks, todayIso } from "@/lib/attendance";
import { computeStudentDues, loadFees, openFeeDues } from "@/lib/fees";
import { classifyClassHolidayDay } from "@/lib/holidayPolicy";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { householdWhatsApp, loadSis } from "@/lib/sis";
import { loadStaffAttendance } from "@/lib/staffAttendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Kind = "defaulters" | "registers" | "staff_attendance" | "followups";

/**
 * GET /api/v1/principal/lists?kind=defaulters|registers|staff_attendance|followups
 *
 * The drill-down behind each principal-snapshot number. Same source libs and
 * the same filters as buildPrincipalSnapshot() so the list always adds up to
 * the headline figure the user tapped.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "home", "view");
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") as Kind | null;
    if (!kind) throw new ApiError("bad_request", "kind required", 400);

    await ensureSchoolMirrorHydrated();
    const masters = loadMasters();
    const ay =
      url.searchParams.get("academicYearCode") ||
      ctx.session.academicYearCode ||
      currentAcademicYearCode(masters);
    const today = todayIso();

    const className = (id: string) => masters.classes.find((c) => c.id === id)?.name || id;
    const sectionName = (id: string) =>
      masters.sections.find((s) => s.id === id)?.name || id;

    let data: unknown;
    switch (kind) {
      case "defaulters": {
        await Promise.all([ensureSisHydratedServer(), ensurePaymentsHydratedServer()]);
        const sis = loadSis();
        const fees = loadFees();
        type Row = {
          householdId: string;
          guardianName: string;
          mobile: string;
          openPaise: number;
          children: {
            studentId: string;
            fullName: string;
            classLabel: string;
            openPaise: number;
          }[];
        };
        const byHh = new Map<string, Row>();
        for (const stu of sis.students) {
          if (stu.status !== "active" || stu.academicYearCode !== ay) continue;
          const open = openFeeDues(
            computeStudentDues(stu, masters, fees, {
              asOf: today,
              includeFuture: false,
              includePaid: true,
            }),
          );
          if (!open.length) continue;
          const openPaise = open.reduce((s, d) => s + d.balancePaise, 0);
          if (openPaise <= 0) continue;
          const hh = sis.households.find((h) => h.id === stu.householdId);
          const key = hh?.id || `stu:${stu.id}`;
          const row =
            byHh.get(key) ??
            ({
              householdId: hh?.id || "",
              guardianName: hh?.guardianName || "Guardian",
              mobile: householdWhatsApp(hh) || hh?.mobile || "",
              openPaise: 0,
              children: [],
            } satisfies Row);
          row.openPaise += openPaise;
          row.children.push({
            studentId: stu.id,
            fullName: stu.fullName,
            classLabel: `${className(stu.classId)} ${sectionName(stu.sectionId)}`.trim(),
            openPaise,
          });
          byHh.set(key, row);
        }
        const rows = [...byHh.values()].sort((a, b) => b.openPaise - a.openPaise);
        data = {
          asOf: today,
          totalOpenPaise: rows.reduce((s, r) => s + r.openPaise, 0),
          households: rows,
        };
        break;
      }

      case "registers": {
        await ensureAttendanceHydratedServer();
        const att = loadAttendance();
        const todayRegs = (att.registers ?? []).filter(
          (r) => r.academicYearCode === ay && r.date === today,
        );
        const byId = new Map(todayRegs.map((r) => [r.sectionId, r]));
        const classOrder = new Map(masters.classes.map((c, i) => [c.id, i]));
        const sections = masters.sections
          .filter((s) => s.isActive)
          .map((s) => {
            const reg = byId.get(s.id);
            const sum = reg ? summarizeMarks(reg.marks || []) : null;
            const holiday =
              classifyClassHolidayDay(masters, today, ay, s.classId).status === "holiday";
            return {
              sectionId: s.id,
              classId: s.classId,
              label: `${className(s.classId)} ${s.name}`.trim(),
              marked: !!reg,
              holiday,
              present: sum?.present ?? 0,
              absent: sum?.absent ?? 0,
              leave: sum?.leave ?? 0,
              markedBy: reg?.markedBy || "",
            };
          })
          // Masters' class order (Nursery → LKG → … → XII), not alphabetical
          // Roman numerals; sections within a class by name.
          .sort(
            (a, b) =>
              (classOrder.get(a.classId) ?? 999) - (classOrder.get(b.classId) ?? 999) ||
              a.label.localeCompare(b.label, undefined, { numeric: true }),
          );
        data = { date: today, sections };
        break;
      }

      case "staff_attendance": {
        await ensureStaffAttendanceHydratedServer();
        const staffAtt = loadStaffAttendance();
        const reg = (staffAtt.registers ?? []).find(
          (r) => r.date === today && r.academicYearCode === ay,
        );
        const marks = new Map((reg?.marks ?? []).map((m) => [m.staffId, m]));
        const desigName = (id: string | null) =>
          (masters.designations ?? []).find((d) => d.id === id)?.name || "";
        const staff = (masters.staff ?? [])
          .filter((s) => s.status === "active")
          .map((s) => {
            const m = marks.get(s.id);
            return {
              staffId: s.id,
              fullName: s.fullName,
              designation: desigName(s.designationId),
              mobile: s.mobile || "",
              status: m?.status || "",
              inTime: m?.inTime || "",
              outTime: m?.outTime || "",
              punchWay: m?.punchWay || "",
            };
          })
          .sort((a, b) => {
            // Unmarked and absent first — that's what the principal is looking for.
            const rank = (s: string) => (s === "" ? 0 : s === "A" ? 1 : s === "L" ? 2 : 3);
            return rank(a.status) - rank(b.status) || a.fullName.localeCompare(b.fullName);
          });
        data = { date: today, marked: !!reg, staff };
        break;
      }

      case "followups": {
        await ensureAdmissionsHydratedServer();
        const adm = loadAdmissions();
        const leads = adm.leads
          .filter((l) => l.nextFollowUpAt && l.nextFollowUpAt.slice(0, 10) <= today)
          .filter((l) => l.stage !== "enrolled" && l.stage !== "lost")
          .map((l) => ({
            id: l.id,
            enquiryNo: l.enquiryNo,
            childName: l.childName,
            guardianName: l.guardianName,
            mobile: l.mobile,
            stage: l.stage,
            classSought: l.classSoughtId ? className(l.classSoughtId) : "",
            nextFollowUpAt: l.nextFollowUpAt.slice(0, 10),
            overdueDays: Math.max(
              0,
              Math.round(
                (Date.parse(today) - Date.parse(l.nextFollowUpAt.slice(0, 10))) / 86_400_000,
              ),
            ),
          }))
          .sort((a, b) => b.overdueDays - a.overdueDays);
        data = { date: today, leads };
        break;
      }

      default:
        throw new ApiError("bad_request", `Unknown kind ${String(kind)}`, 400);
    }

    const res = apiOk(data);
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  } catch (e) {
    return apiErr(e);
  }
}

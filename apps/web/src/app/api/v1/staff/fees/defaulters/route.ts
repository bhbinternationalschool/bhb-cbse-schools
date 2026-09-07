import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { classLabelOf, istToday, loadFeeContext, openDuesFor } from "@/lib/api/v1/staffFees";
import { loadFeeFollowups } from "@/lib/api/v1/feeFollowups.server";
import { formatInr } from "@/lib/fees";
import { householdWhatsApp } from "@/lib/sis";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

function daysSince(iso: string | null, today: string): number {
  if (!iso) return 0;
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * GET /api/v1/staff/fees/defaulters — families with money outstanding,
 * biggest first, each with the guardian's number for a call or WhatsApp and
 * whatever was last promised.
 *
 * A class teacher sees only their own sections; the office and leadership
 * see the school. `classId`/`sectionId` narrow it further, `q` searches.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "fee_defaulters");
    const url = new URL(request.url);
    const classId = url.searchParams.get("classId")?.trim() || "";
    const sectionId = url.searchParams.get("sectionId")?.trim() || "";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const minRupees = Number(url.searchParams.get("min") || 0);

    const scope = await staffSectionScope(ctx);
    const { sis, fees, masters } = await loadFeeContext();
    const ay = ctx.session.academicYearCode;
    const today = istToday();

    let followups: Awaited<ReturnType<typeof loadFeeFollowups>>["meetings"] = [];
    try {
      followups = (await loadFeeFollowups()).meetings;
    } catch {
      /* the list is still useful without the promise history */
    }
    const lastPromise = new Map<string, (typeof followups)[number]>();
    for (const m of followups) {
      const prev = lastPromise.get(m.studentId);
      if (!prev || (m.createdAt || "") > (prev.createdAt || "")) {
        lastPromise.set(m.studentId, m);
      }
    }

    type Child = {
      studentId: string;
      fullName: string;
      classLabel: string;
      admissionNo: string;
      openPaise: number;
      openLabel: string;
      oldestDueOn: string | null;
      overdueDays: number;
      promisedOn: string;
      promiseNote: string;
    };
    type Row = {
      householdId: string;
      guardianName: string;
      mobile: string;
      openPaise: number;
      openLabel: string;
      overdueDays: number;
      children: Child[];
    };

    const byHousehold = new Map<string, Row>();
    for (const s of sis.students) {
      if (s.status !== "active" || s.academicYearCode !== ay) continue;
      if (!scopeAllows(scope, s.classId, s.sectionId)) continue;
      if (classId && s.classId !== classId) continue;
      if (sectionId && s.sectionId !== sectionId) continue;

      const dues = openDuesFor(s, masters, fees, today);
      const openPaise = dues.reduce((n, d) => n + d.balancePaise, 0);
      if (openPaise <= 0) continue;

      const dated = dues.map((d) => d.dueOn).filter((d): d is string => !!d).sort();
      const oldest = dated[0] ?? null;
      const hh = sis.households.find((h) => h.id === s.householdId);
      const key = hh?.id || `stu:${s.id}`;
      const guardianName = hh?.guardianName || "Guardian";
      const mobile = householdWhatsApp(hh) || hh?.mobile || "";

      if (q) {
        const blob = `${s.fullName} ${guardianName} ${mobile} ${s.admissionNo || ""}`.toLowerCase();
        if (!blob.includes(q)) continue;
      }

      const promise = lastPromise.get(s.id);
      const row =
        byHousehold.get(key) ??
        ({
          householdId: hh?.id || "",
          guardianName,
          mobile,
          openPaise: 0,
          openLabel: "",
          overdueDays: 0,
          children: [],
        } satisfies Row);
      const overdueDays = daysSince(oldest, today);
      row.openPaise += openPaise;
      row.overdueDays = Math.max(row.overdueDays, overdueDays);
      row.children.push({
        studentId: s.id,
        fullName: s.fullName,
        classLabel: classLabelOf(ctx, s),
        admissionNo: s.admissionNo || "",
        openPaise,
        openLabel: formatInr(openPaise),
        oldestDueOn: oldest,
        overdueDays,
        promisedOn: promise?.status === "scheduled" ? promise.scheduledOn : "",
        promiseNote: promise?.note || "",
      });
      byHousehold.set(key, row);
    }

    const rows = [...byHousehold.values()]
      .filter((r) => r.openPaise >= Math.max(0, minRupees) * 100)
      .sort((a, b) => b.openPaise - a.openPaise)
      .slice(0, 300)
      .map((r) => ({ ...r, openLabel: formatInr(r.openPaise) }));

    return apiOk({
      asOf: today,
      unrestricted: scope.unrestricted,
      householdCount: rows.length,
      totalOpenPaise: rows.reduce((n, r) => n + r.openPaise, 0),
      totalOpenLabel: formatInr(rows.reduce((n, r) => n + r.openPaise, 0)),
      households: rows,
    });
  } catch (e) {
    return apiErr(e);
  }
}

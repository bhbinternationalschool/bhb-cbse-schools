/**
 * POST /api/ai/concession-case-file — one child's concession case file.
 *
 * Code assembles what the school knows (discounts, how each was granted, the
 * household's other children and their discounts, a staff-roster match on
 * guardian mobiles, this session's money) and raises flags by rule. The
 * model writes the reviewer's QUESTION, by flag code, and never a digit.
 * Where no ground was recorded the case file says so and stops — it never
 * supplies one.
 */
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { generateConcessionCaseJson } from "@/lib/aiLlm.server";
import { loadServerMasters } from "@/lib/api/v1/auth";
import {
  buildConcessionCaseFlags,
  concessionGrantRoute,
  mobileKey,
  type ConcessionCaseFacts,
  type ConcessionCaseGrant,
} from "@/lib/concessionReviewAi";
import { classLabel } from "@/lib/homework";
import { TENANT } from "@/lib/types";
import { istDateOf } from "@/lib/teaching";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    service: "concession-case-file",
    note: "POST { studentId, language?: en|hi } — the child's concession case file with rule-raised flags and the reviewer's question. Nothing is saved.",
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "view");
  if (!auth.ok) return auth.response;
  let body: { studentId?: string; language?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const studentId = (body.studentId || "").trim();
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 });
  const language = body.language === "hi" ? "hi" : "en";

  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  await ensureSchoolMirrorHydrated();
  const { loadMasters, formatConcessionValue, concessionGroundLabel, formatInr } = await import("@/lib/masters");
  const { loadSis } = await import("@/lib/sis");
  const { computeStudentDues, loadFees } = await import("@/lib/fees");
  const masters = loadMasters();
  const sis = loadSis();
  const fees = loadFees();
  const student = sis.students.find((s) => s.id === studentId);
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  const household = sis.households.find((h) => h.id === student.householdId);
  const todayIso = istDateOf();

  const rulesById = new Map((masters.concessions ?? []).map((r) => [r.id, r]));
  const headName = (id: string) => (masters.feeHeads ?? []).find((h) => h.id === id)?.nameEn || id;
  const renderGrant = (g: (typeof masters.concessionGrants)[number]): ConcessionCaseGrant => {
    const rule = rulesById.get(g.concessionId);
    return {
      policyName: rule?.name || rule?.code || "Unknown policy",
      valueLabel: rule ? formatConcessionValue(rule) : "—",
      headsLabel: rule?.feeHeadIds?.length ? rule.feeHeadIds.map(headName).join(", ") : "all heads",
      groundLabel: g.ground ? concessionGroundLabel(g.ground) : "Not recorded",
      route: concessionGrantRoute(g.reason),
      effectiveFrom: g.effectiveFrom,
      effectiveTo: g.effectiveTo,
      status: g.status,
    };
  };
  const allGrants = masters.concessionGrants ?? [];
  const grants = allGrants.filter((g) => g.studentId === studentId && g.status !== "rejected").map(renderGrant);

  const siblings = sis.students
    .filter((s) => s.householdId === student.householdId && s.id !== student.id && s.status === "active")
    .map((s) => {
      const theirs = allGrants
        .filter((g) => g.studentId === s.id && g.status === "approved")
        .map((g) => {
          const rule = rulesById.get(g.concessionId);
          return `${rule ? formatConcessionValue(rule) : "—"} (${rule?.name || rule?.code || "policy"})`;
        })
        .sort();
      return { name: s.fullName, classLabel: classLabel(masters, s.classId, s.sectionId), discounts: theirs.join("; ") || "none" };
    });

  // Staff-ward: a guardian mobile that is also a staff mobile. The roster is
  // stripped from the mirror blob, so it comes from the server masters.
  const familyMobiles = new Map<string, string>();
  const put = (label: string, m: string | undefined) => {
    const k = mobileKey(m);
    if (k && !familyMobiles.has(k)) familyMobiles.set(k, label);
  };
  put("guardian mobile", household?.mobile);
  put("guardian WhatsApp", household?.whatsappMobile);
  put("alternate mobile", household?.altMobile);
  put("father's mobile", student.fatherMobile);
  put("mother's mobile", student.motherMobile);
  const staffMatches: ConcessionCaseFacts["staffMatches"] = [];
  try {
    const server = await loadServerMasters();
    for (const st of server.staff ?? []) {
      if (st.status !== "active") continue;
      for (const [label, m] of [["staff mobile", st.mobile], ["staff alternate mobile", st.altMobile]] as const) {
        const k = mobileKey(m);
        if (k && familyMobiles.has(k)) {
          staffMatches.push({ staffName: st.fullName, via: `${familyMobiles.get(k)} = ${label}` });
        }
      }
    }
  } catch {
    /* roster unavailable → no match claimed */
  }

  let money: ConcessionCaseFacts["money"] = null;
  let balancePaise: number | null = null;
  try {
    const dues = computeStudentDues(student, masters, fees, { includeFuture: false, includePaid: true });
    const sum = (k: "billedPaise" | "concessionPaise" | "paidPaise" | "balancePaise") => dues.reduce((s, d) => s + (d[k] || 0), 0);
    balancePaise = sum("balancePaise");
    money = { billed: formatInr(sum("billedPaise")), concession: formatInr(sum("concessionPaise")), paid: formatInr(sum("paidPaise")), balance: formatInr(balancePaise) };
  } catch {
    money = null;
  }

  const facts: ConcessionCaseFacts = {
    schoolName: TENANT.nameDisplay,
    asOf: todayIso,
    student: { name: student.fullName, admissionNo: student.admissionNo, classLabel: classLabel(masters, student.classId, student.sectionId) },
    grants,
    siblings,
    staffMatches,
    money,
    flags: buildConcessionCaseFlags({ grants, siblings, staffMatches, balancePaise, todayIso }),
  };
  const gen = await generateConcessionCaseJson({ facts, language });
  if (!gen.ok) {
    return NextResponse.json({ ok: false, facts, error: gen.error, engine: gen.engine }, { status: 503 });
  }
  return NextResponse.json({ ok: true, facts, draft: gen.draft, engine: gen.engine, generationId: gen.generationId });
}

/**
 * The director's Monday note on fee collections.
 *
 * POST as staff (fees:view) returns the figures and the note for the fees
 * desk. POST with x-cron-secret and ?send=1 also WhatsApps it to every owner
 * on the roster (the same recipients as the ERP command digest), figures
 * first, then the note. Scheduled Monday 08:15 IST
 * (setup-cloud-scheduler.sh: bhb-collections-weekly-note).
 *
 * Every figure is computed here from the receipts, the open-dues cache and
 * the fee-desk meetings; the model writes prose with no digits in it. Nothing
 * is saved except the ai_generations audit row the router writes.
 */
import { NextResponse } from "next/server";
import { requireJobSecret, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { generateCollectionsWeeklyNoteJson } from "@/lib/aiLlm.server";
import { loadServerMasters } from "@/lib/api/v1/auth";
import {
  buildAgeing,
  buildReceiptWeeks,
  lastCompleteWeek,
  renderCollectionsWeeklyFigures,
  type CollectionsWeeklyFacts,
} from "@/lib/collectionsWeeklyAi";
import type { FeeRecoveryTasksState } from "@/lib/feeRecoveryTasks";
import { fetchServerBlob } from "@/lib/serverBlob";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { istDateOf } from "@/lib/teaching";
import { TENANT } from "@/lib/types";
import { inferStaffIsOwner } from "@/lib/waRoleResolver";
import { buildWaTemplateBodyComponent, sendWaWithFailover } from "@/lib/waSend";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json({
    service: "collections-weekly-note",
    note: "POST as staff for the note; POST with x-cron-secret and ?send=1 to WhatsApp it to the owners. ?dryRun=1 with send computes and lists recipients without sending.",
  });
}

async function buildFacts(todayIso: string): Promise<CollectionsWeeklyFacts> {
  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  await ensureSchoolMirrorHydrated();
  const { loadMasters, currentAcademicYearCode } = await import("@/lib/masters");
  const { loadFees } = await import("@/lib/fees");
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const { weekFrom, weekTo } = lastCompleteWeek(todayIso);
  const vouchers = loadFees().vouchers.filter((v) => !v.academicYearCode || v.academicYearCode === ay);
  const receipts = buildReceiptWeeks(vouchers, weekFrom, weekTo);

  // The open-dues cache is what every dues screen reads; the same truth here.
  let dues: { studentId: string; dueOn: string; balancePaise: number }[] = [];
  let billed: number | null = null;
  const ctx = await getServerTenantContext();
  if (ctx) {
    const { rows } = await fetchAllPages<{ student_id: string; due_on: string | null; balance_paise: number; billed_paise: number }>(
      (from, to) =>
        ctx.sb
          .from("fee_desk_open_dues")
          .select("student_id, due_on, balance_paise, billed_paise")
          .eq("tenant_id", ctx.tenantId)
          .eq("academic_year_code", ay)
          .order("student_id", { ascending: true })
          .range(from, to),
    );
    dues = rows.map((r) => ({ studentId: r.student_id, dueOn: r.due_on || todayIso, balancePaise: Number(r.balance_paise) || 0 }));
    // Billed for the session = what the cache still shows as billed (open
    // rows) + what the receipts settled. An approximation, labelled as such
    // by omission when the cache is empty.
    billed = rows.length ? rows.reduce((s, r) => s + (Number(r.billed_paise) || 0), 0) + receipts.sessionAmountPaise : null;
  }
  const ageing = buildAgeing(dues, todayIso);

  let meetings: CollectionsWeeklyFacts["meetings"] = null;
  try {
    const { state } = await fetchServerBlob<FeeRecoveryTasksState>("fee_recovery_tasks_state");
    const list = Array.isArray(state?.meetings) ? state.meetings : null;
    if (list) {
      const inWeek = list.filter((m) => m.scheduledOn >= weekFrom && m.scheduledOn <= weekTo);
      meetings = {
        scheduled: inWeek.length,
        done: inWeek.filter((m) => m.status === "done").length,
        noShow: inWeek.filter((m) => m.status === "no_show").length,
        cancelled: inWeek.filter((m) => m.status === "cancelled").length,
      };
    }
  } catch {
    meetings = null;
  }

  return {
    schoolName: TENANT.nameDisplay,
    academicYearCode: ay,
    weekFrom,
    weekTo,
    receipts: { ...receipts, sessionBilledPaise: billed },
    ageing: ageing.ageing,
    totalOpenPaise: ageing.totalOpenPaise,
    childrenOwing: ageing.childrenOwing,
    meetings,
  };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const send = url.searchParams.get("send") === "1";
  const dryRun = url.searchParams.get("dryRun") === "1";
  const byJob = requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"]);
  if (!byJob) {
    if (send) return NextResponse.json({ error: "Sending needs the cron secret" }, { status: 401 });
    const auth = await requireStaffPermission(req, "fees", "view");
    if (!auth.ok) return auth.response;
  }
  let body: { language?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const language = body.language === "hi" ? "hi" : "en";
  const todayIso = istDateOf();
  const facts = await buildFacts(todayIso);
  const figures = renderCollectionsWeeklyFigures(facts);
  const gen = await generateCollectionsWeeklyNoteJson({ facts, language });
  const draft = gen.ok ? gen.draft : null;
  const text = draft ? `${figures}\n\n*${draft.headline}*\n${draft.note}` : figures;

  if (!send) {
    return NextResponse.json(
      { ok: gen.ok, facts, figures, draft, error: gen.ok ? undefined : gen.error, engine: gen.engine, generationId: gen.ok ? gen.generationId : undefined },
      { status: gen.ok ? 200 : 503 },
    );
  }

  // The figures go even when the model does not: the note is the reading
  // aid, the numbers are the report.
  const masters = await loadServerMasters();
  const owners = (masters.staff ?? []).filter((s) => s.status === "active" && inferStaffIsOwner(s, masters.designations ?? []));
  const templateName = (process.env.ERP_COMMANDS_DIGEST_TEMPLATE || "").trim();
  const templateLang = (process.env.ERP_COMMANDS_DIGEST_TEMPLATE_LANG || "en").trim();
  const recipients: { name: string; mobile: string; wa: string }[] = [];
  for (const s of owners) {
    const mobile = (s.mobile || "").trim();
    let wa = mobile ? (dryRun ? "dry run" : "") : "no mobile";
    if (mobile && !dryRun) {
      const r = await sendWaWithFailover({ primaryMobile: mobile, body: text, clientMessageId: `collections_weekly_${facts.weekTo}_${s.id}` });
      if (r.ok) wa = "text";
      else if (templateName && /24h|window/i.test(r.error || "")) {
        const t = await sendWaWithFailover({
          primaryMobile: mobile,
          template: {
            name: templateName,
            language: templateLang,
            components: [buildWaTemplateBodyComponent(["summary"], { summary: draft?.headline || figures.split("\n")[1] || "Weekly fee collections note" })],
          },
          clientMessageId: `collections_weekly_${facts.weekTo}_${s.id}_t`,
        });
        wa = t.ok ? "template" : `failed: ${t.error || "template send failed"}`;
      } else wa = `failed: ${r.error || "send failed"}`;
    }
    recipients.push({ name: s.fullName, mobile: mobile ? `${mobile.slice(0, 2)}xxxxxx${mobile.slice(-2)}` : "", wa });
  }
  const failed = recipients.filter((r) => r.wa.startsWith("failed")).length;
  return NextResponse.json(
    { ok: failed === 0, week: { from: facts.weekFrom, to: facts.weekTo }, noteGenerated: gen.ok, error: gen.ok ? undefined : gen.error, recipients, text },
    { status: failed === 0 ? 200 : 207 },
  );
}

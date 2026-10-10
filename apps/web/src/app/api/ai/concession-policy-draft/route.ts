/**
 * POST /api/ai/concession-policy-draft — group the school's concession
 * definitions into the policies they appear to be, and let the model name
 * them. A DRAFT: the route saves nothing, merges nothing.
 *
 * Deterministic code decides the groups (same amount, same heads); the model
 * writes names and says which ground each group looks like, allow-listed to
 * the catalogue. The client reports accepted / edited / rejected against the
 * generationId at its natural accept action.
 */
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { generateConcessionPolicyDraftJson } from "@/lib/aiLlm.server";
import { buildConcessionClusters, type ConcessionPolicyFacts } from "@/lib/concessionReviewAi";
import { TENANT } from "@/lib/types";
import { istDateOf } from "@/lib/teaching";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    service: "concession-policy-draft",
    note: "POST { language?: en|hi } — groups concession definitions by value+heads and drafts a policy name per group. Draft only; nothing is merged.",
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "view");
  if (!auth.ok) return auth.response;
  let body: { language?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const language = body.language === "hi" ? "hi" : "en";

  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  await ensureSchoolMirrorHydrated();
  const { loadMasters } = await import("@/lib/masters");
  const masters = loadMasters();
  const rules = masters.concessions ?? [];
  const grants = masters.concessionGrants ?? [];
  const headName = (id: string) => (masters.feeHeads ?? []).find((h) => h.id === id)?.nameEn || id;
  const { clusters, unusedDefinitions } = buildConcessionClusters({ rules, grants, feeHeadName: headName });
  const approved = grants.filter((g) => g.status === "approved");
  const facts: ConcessionPolicyFacts = {
    schoolName: TENANT.nameDisplay,
    asOf: istDateOf(),
    totalDefinitions: rules.length,
    totalGrants: approved.length,
    totalStudents: new Set(approved.map((g) => g.studentId)).size,
    clusters,
    unusedDefinitions,
  };
  if (!clusters.length) {
    return NextResponse.json({ ok: true, facts, draft: null, note: "No approved concession grants to group." });
  }
  const gen = await generateConcessionPolicyDraftJson({ facts, language });
  if (!gen.ok) {
    // The grouping is still useful without the prose — it is the finding.
    return NextResponse.json({ ok: false, facts, error: gen.error, engine: gen.engine }, { status: 503 });
  }
  return NextResponse.json({ ok: true, facts, draft: gen.draft, engine: gen.engine, generationId: gen.generationId });
}

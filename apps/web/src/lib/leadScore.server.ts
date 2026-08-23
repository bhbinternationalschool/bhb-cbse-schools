/**
 * Admissions → lead scoring, server side.
 *
 * Reads every lead's inputs in one round trip, scores them in TypeScript (see
 * leadScore.ts for the rubric and why it is arithmetic rather than a model),
 * and writes the result to admission_lead_market_state.
 *
 * The scores are stored rather than computed on read because the desk sorts
 * and filters by them, and because storing the breakdown lets somebody ask
 * "why is this lead hot" in three months and get a straight answer.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  childAgeYears,
  isPositiveOutcome,
  scoreLead,
  type LeadStatus,
} from "@/lib/leadScore";

const LOG = "[leadScore]";

/** Rows per upsert batch — 919 leads is three round trips, not 919. */
const UPSERT_BATCH = 400;

export class LeadScoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "LeadScoreError";
    this.status = status;
  }
}

export type RescoreResult = {
  ok: true;
  scored: number;
  byStatus: Record<LeadStatus, number>;
  /** Leads whose village we could not resolve — scored, but with no distance. */
  withoutVillage: number;
  /** Leads whose village has no travel time cached yet. */
  withoutDistance: number;
};

type FeedRow = {
  lead_id: string;
  stage: string;
  dob: string;
  age_years_approx: number | string | null;
  locality: string;
  village_id: string | null;
  touchpoints: number;
  last_outcome: string;
  distance_km: number | string | null;
  travel_minutes: number | null;
};

/**
 * Re-score every lead in scope.
 *
 * Idempotent: running it twice on unchanged data produces identical rows, so
 * it is safe to trigger from a button, a cron, or both.
 */
export async function rescoreLeads(academicYearCode = ""): Promise<RescoreResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new LeadScoreError("Database is not reachable.", 503);
  const sb = ctx.sb as NonNullable<ReturnType<typeof createServiceSupabase>>;
  const tenantId = ctx.tenantId;

  const { data, error } = await sb.rpc("admission_leads_for_scoring", {
    p_tenant_id: tenantId,
    p_academic_year_code: academicYearCode || null,
  });
  if (error) {
    throw new LeadScoreError(`Could not read leads for scoring: ${error.message}`, 502);
  }

  const feed = (data as FeedRow[] | null) ?? [];
  const now = new Date();
  const byStatus: Record<LeadStatus, number> = { cold: 0, warm: 0, hot: 0, enrolled: 0 };
  let withoutVillage = 0;
  let withoutDistance = 0;

  const rows = feed.map((r) => {
    // numeric(7,2) arrives as a string over PostgREST; Number("") is 0, which
    // would read as "the campus is at this village's front door".
    const distanceRaw = r.distance_km;
    const distanceKm =
      distanceRaw === null || distanceRaw === ""
        ? null
        : Number.isFinite(Number(distanceRaw))
          ? Number(distanceRaw)
          : null;

    if (!r.village_id) withoutVillage += 1;
    if (distanceKm === null) withoutDistance += 1;

    // An exact birth date wins; a parent-stated age is the fallback. They are
    // never merged into one stored value — see the scoring feed migration.
    const approxRaw = Number(r.age_years_approx ?? 0);
    const approx = Number.isFinite(approxRaw) && approxRaw > 0 ? approxRaw : null;
    const age = childAgeYears(r.dob, now) ?? approx;
    const result = scoreLead({
      distanceKm,
      touchpoints: Number(r.touchpoints) || 0,
      childAgeYears: age,
      stage: r.stage,
      lastOutcomePositive: isPositiveOutcome(r.last_outcome),
    });
    byStatus[result.status] += 1;

    return {
      lead_id: r.lead_id,
      tenant_id: tenantId,
      village_id: r.village_id,
      distance_from_campus_km: distanceKm,
      travel_minutes: r.travel_minutes ?? null,
      lead_score: result.score,
      lead_status: result.status,
      touchpoints: Number(r.touchpoints) || 0,
      child_age_years: age,
      score_breakdown: result.breakdown,
      scored_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
  });

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error: upsertError } = await sb
      .from("admission_lead_market_state")
      .upsert(batch, { onConflict: "lead_id" });
    if (upsertError) {
      throw new LeadScoreError(
        `Could not save scores (batch ${i / UPSERT_BATCH + 1}): ${upsertError.message}`,
        502,
      );
    }
  }

  console.info(
    `${LOG} scored=${rows.length} hot=${byStatus.hot} warm=${byStatus.warm} ` +
      `cold=${byStatus.cold} enrolled=${byStatus.enrolled} ` +
      `noVillage=${withoutVillage} noDistance=${withoutDistance}`,
  );

  return { ok: true, scored: rows.length, byStatus, withoutVillage, withoutDistance };
}

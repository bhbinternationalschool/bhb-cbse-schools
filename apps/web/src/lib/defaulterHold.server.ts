/**
 * Reading and writing the defaulter policy, its rounds, and what a round
 * decided.
 *
 * WHY THIS IS SERVER-SIDE AND THE OLD ENGINE IS NOT
 * `holds.ts` keeps overrides in localStorage under `bhb_holds_v1`, synced as
 * an opaque blob. That is survivable for a report card: the worst case is the
 * office reprints it from the other machine. It is not survivable for a bus
 * seat, where the gate keeper, the transport desk and the driver's list are
 * three different browsers and a decision that exists in one of them is a
 * decision that does not exist. A child is either allowed on the bus or not,
 * and that fact cannot live in one person's browser profile.
 *
 * So rounds and decisions are rows, read through the service role like every
 * other server-truth module.
 *
 * EVERY READ IS CHECKED
 * A failed read returns an error, never a shorter list. "Nobody is blocked"
 * and "we could not find out who is blocked" are opposite answers, and a
 * defaulter screen that quietly shows the first when it means the second is
 * the exact defect class this project keeps writing down.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import type { HoldCode, OverdueStage } from "@/lib/types";
import { calendarDaysPastDue, resolveStage } from "@/lib/playbook";
import {
  defaultDefaulterPolicy,
  isBlockableHold,
  normalizeDefaulterPolicy,
  type DefaulterFacts,
  type DefaulterPolicy,
  type HoldGateMode,
} from "@/lib/defaulterHoldPolicy";
import type {
  HoldDecision,
  HoldDecisionRecord,
  HoldRound,
  HoldRoundItem,
} from "@/lib/defaulterHoldRound";

/* ── policy ─────────────────────────────────────────────────── */

type PolicyRow = {
  hold_code: string;
  from_stage: string;
  mode: string;
  enabled: boolean;
  min_amount_paise: number | string | null;
  min_overdue_days: number | null;
};

/**
 * The column has said 'auto' | 'suggest' since July; the TypeScript calls the
 * middle one 'propose' because that is what it does. Translating here beats
 * rewriting live rows to a new spelling.
 */
function modeFromRow(row: PolicyRow): HoldGateMode {
  if (!row.enabled) return "off";
  if (row.mode === "auto") return "auto";
  if (row.mode === "suggest") return "propose";
  return "off";
}

function modeToRow(mode: HoldGateMode): { mode: string; enabled: boolean } {
  if (mode === "auto") return { mode: "auto", enabled: true };
  if (mode === "propose") return { mode: "suggest", enabled: true };
  return { mode: "off", enabled: false };
}

export async function fetchDefaulterPolicy(
  sb: SupabaseClient,
  tenantId: string,
): Promise<{ ok: true; policy: DefaulterPolicy } | { ok: false; error: string }> {
  const { data, error } = await sb
    .from("fee_hold_policies")
    .select("hold_code, from_stage, mode, enabled, min_amount_paise, min_overdue_days")
    .eq("tenant_id", tenantId);

  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as PolicyRow[];
  // No rows at all is a tenant that has never been seeded, which is a real
  // state on a fresh database — the defaults reproduce today's behaviour.
  if (rows.length === 0) return { ok: true, policy: defaultDefaulterPolicy() };

  const gates = rows
    .filter((r) => isBlockableHold(r.hold_code))
    .map((r) => ({
      holdCode: r.hold_code as HoldCode,
      mode: modeFromRow(r),
      fromStage: r.from_stage as OverdueStage,
      minAmountPaise: Number(r.min_amount_paise ?? 0),
      minOverdueDays: Number(r.min_overdue_days ?? 0),
    }));

  return { ok: true, policy: normalizeDefaulterPolicy({ version: 1, note: "", gates }) };
}

export async function saveDefaulterPolicy(
  sb: SupabaseClient,
  tenantId: string,
  policy: DefaulterPolicy,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = normalizeDefaulterPolicy(policy);
  const rows = clean.gates.map((g) => {
    const { mode, enabled } = modeToRow(g.mode);
    return {
      tenant_id: tenantId,
      hold_code: g.holdCode,
      from_stage: g.fromStage,
      mode,
      enabled,
      min_amount_paise: g.minAmountPaise,
      min_overdue_days: g.minOverdueDays,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await sb
    .from("fee_hold_policies")
    .upsert(rows, { onConflict: "tenant_id,hold_code" });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ── who is a defaulter today ───────────────────────────────── */

/**
 * Build the population a gate is measured against, from the open-dues cache.
 *
 * The cache is used rather than recomputing every child's bill because it is
 * what the rest of the server already trusts, and because a round must be
 * reproducible: two people opening the screen a minute apart should see the
 * same list. `fee_desk_open_dues` is rebuilt by its own route and carries an
 * `updated_at`, which the caller reports so a stale cache is visible rather
 * than silently old.
 *
 * ONLY THE CURRENT YEAR
 * A closed year's "open dues" were fee structure with no receipts behind them
 * — the ₹35.8 lakh artefact of 2025-26. Measuring a bus ban against that
 * would ban most of the school for a bookkeeping shadow.
 */
export async function fetchDefaulterPopulation(
  sb: SupabaseClient,
  tenantId: string,
  academicYearCode: string,
  asOf: string,
): Promise<
  | {
      ok: true;
      population: DefaulterFacts[];
      cacheUpdatedAt: string | null;
    }
  | { ok: false; error: string }
> {
  const rows = await fetchAllPages<{
    student_id: string;
    due_on: string;
    balance_paise: number | string | null;
    updated_at: string | null;
  }>((from, to) =>
    sb
      .from("fee_desk_open_dues")
      .select("student_id, due_on, balance_paise, updated_at")
      .eq("tenant_id", tenantId)
      .eq("academic_year_code", academicYearCode)
      .gt("balance_paise", 0)
      .order("student_id", { ascending: true })
      .range(from, to),
  );
  if (rows.error) return { ok: false, error: rows.error };

  let cacheUpdatedAt: string | null = null;
  const byStudent = new Map<
    string,
    { earliest: string; overdueAmount: number }
  >();

  for (const r of rows.rows) {
    if (r.updated_at && (!cacheUpdatedAt || r.updated_at > cacheUpdatedAt)) {
      cacheUpdatedAt = r.updated_at;
    }
    // A bill not yet due is not overdue. Counting it would put a family who
    // owes nothing today at the same stage as one three months behind.
    if (!r.due_on || r.due_on > asOf) continue;

    const balance = Number(r.balance_paise ?? 0);
    if (!Number.isFinite(balance) || balance <= 0) continue;

    const prev = byStudent.get(r.student_id);
    if (!prev) {
      byStudent.set(r.student_id, {
        earliest: r.due_on,
        overdueAmount: balance,
      });
    } else {
      byStudent.set(r.student_id, {
        earliest: r.due_on < prev.earliest ? r.due_on : prev.earliest,
        overdueAmount: prev.overdueAmount + balance,
      });
    }
  }

  const population: DefaulterFacts[] = [];
  for (const [studentId, agg] of byStudent) {
    const overdueDays = calendarDaysPastDue(agg.earliest, asOf);
    population.push({
      studentId,
      stage: resolveStage(overdueDays),
      overdueDays,
      overdueAmountPaise: agg.overdueAmount,
    });
  }

  return { ok: true, population, cacheUpdatedAt };
}

/* ── rounds ─────────────────────────────────────────────────── */

type RoundRow = {
  id: string;
  hold_code: string;
  status: string;
  as_of: string;
  academic_year_code: string | null;
  created_at: string;
  created_by: string | null;
  applied_at: string | null;
  applied_by: string | null;
  note: string | null;
};

type ItemRow = {
  round_id: string;
  student_id: string;
  decision: string;
  stage: string;
  overdue_days: number | null;
  overdue_amount_paise: number | string | null;
  reason: string | null;
};

function roundFromRows(row: RoundRow, items: ItemRow[]): HoldRound {
  return {
    id: row.id,
    holdCode: row.hold_code as HoldCode,
    status:
      row.status === "applied"
        ? "applied"
        : row.status === "cancelled"
          ? "cancelled"
          : "draft",
    asOf: row.as_of,
    createdAt: row.created_at,
    createdBy: row.created_by ?? "",
    appliedAt: row.applied_at,
    appliedBy: row.applied_by || null,
    note: row.note ?? "",
    items: items.map(
      (i): HoldRoundItem => ({
        studentId: i.student_id,
        decision:
          i.decision === "disallow"
            ? "disallow"
            : i.decision === "allow"
              ? "allow"
              : "undecided",
        stage: i.stage as OverdueStage,
        overdueDays: Number(i.overdue_days ?? 0),
        overdueAmountPaise: Number(i.overdue_amount_paise ?? 0),
        reason: i.reason ?? "",
      }),
    ),
  };
}

export async function fetchRound(
  sb: SupabaseClient,
  tenantId: string,
  roundId: string,
): Promise<{ ok: true; round: HoldRound | null } | { ok: false; error: string }> {
  const { data, error } = await sb
    .from("fee_hold_rounds")
    .select(
      "id, hold_code, status, as_of, academic_year_code, created_at, created_by, applied_at, applied_by, note",
    )
    .eq("tenant_id", tenantId)
    .eq("id", roundId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, round: null };

  const items = await fetchAllPages<ItemRow>((from, to) =>
    sb
      .from("fee_hold_round_items")
      .select(
        "round_id, student_id, decision, stage, overdue_days, overdue_amount_paise, reason",
      )
      .eq("tenant_id", tenantId)
      .eq("round_id", roundId)
      .order("student_id", { ascending: true })
      .range(from, to),
  );
  if (items.error) return { ok: false, error: items.error };

  return { ok: true, round: roundFromRows(data as RoundRow, items.rows) };
}

export async function listRounds(
  sb: SupabaseClient,
  tenantId: string,
  opts: { holdCode?: HoldCode; limit?: number } = {},
): Promise<
  | { ok: true; rounds: Omit<HoldRound, "items">[] }
  | { ok: false; error: string }
> {
  let q = sb
    .from("fee_hold_rounds")
    .select(
      "id, hold_code, status, as_of, academic_year_code, created_at, created_by, applied_at, applied_by, note",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));

  if (opts.holdCode) q = q.eq("hold_code", opts.holdCode);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    // The head rows only. A list screen showing fifty rounds does not need
    // every child in each of them, and fetching them would be fifty joins.
    rounds: (data ?? []).map((r) => {
      const full = roundFromRows(r as RoundRow, []);
      return {
        id: full.id,
        holdCode: full.holdCode,
        status: full.status,
        asOf: full.asOf,
        createdAt: full.createdAt,
        createdBy: full.createdBy,
        appliedAt: full.appliedAt,
        appliedBy: full.appliedBy,
        note: full.note,
      };
    }),
  };
}

export async function insertRound(
  sb: SupabaseClient,
  tenantId: string,
  round: HoldRound,
  academicYearCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: headError } = await sb.from("fee_hold_rounds").insert({
    id: round.id,
    tenant_id: tenantId,
    hold_code: round.holdCode,
    status: round.status,
    as_of: round.asOf,
    academic_year_code: academicYearCode,
    created_at: round.createdAt,
    created_by: round.createdBy,
    note: round.note,
  });
  if (headError) return { ok: false, error: headError.message };

  if (round.items.length === 0) return { ok: true };

  const { error: itemError } = await sb.from("fee_hold_round_items").insert(
    round.items.map((i) => ({
      round_id: round.id,
      student_id: i.studentId,
      tenant_id: tenantId,
      decision: i.decision,
      stage: i.stage,
      overdue_days: i.overdueDays,
      overdue_amount_paise: i.overdueAmountPaise,
      reason: i.reason,
    })),
  );
  if (itemError) {
    // The head row without its children is a round that says it caught
    // nobody, which is a lie the office would act on. Take it back out.
    await sb.from("fee_hold_rounds").delete().eq("tenant_id", tenantId).eq("id", round.id);
    return { ok: false, error: itemError.message };
  }
  return { ok: true };
}

/**
 * The bulk write: one decision across many children in one round.
 *
 * This is what the office's "Disallow 40 selected" button becomes. Chunked
 * because PostgREST takes a URL, and forty ids is comfortable while four
 * hundred is not.
 */
export async function setRoundDecisions(
  sb: SupabaseClient,
  tenantId: string,
  roundId: string,
  studentIds: string[],
  decision: HoldDecision,
  reason: string,
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return { ok: true, changed: 0 };

  const patch: Record<string, unknown> = { decision };
  // A disallow keeps whatever note was typed while the row was an allow, so
  // flipping a row back and forth does not lose the office's words.
  if (decision === "allow") patch.reason = reason.trim().slice(0, 300);

  let changed = 0;
  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from("fee_hold_round_items")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("round_id", roundId)
      .in("student_id", slice)
      .select("student_id");
    if (error) return { ok: false, error: error.message };
    changed += (data ?? []).length;
  }
  return { ok: true, changed };
}

/* ── applying ───────────────────────────────────────────────── */

/**
 * Write an applied round's decisions and close the round.
 *
 * Order matters. The decisions land first: a round marked applied whose
 * decisions never wrote would tell the office a child is blocked while
 * enforcement lets them through, and that gap is worse than the reverse.
 */
export async function commitRoundDecisions(
  sb: SupabaseClient,
  tenantId: string,
  round: HoldRound,
  records: HoldDecisionRecord[],
  appliedBy: string,
): Promise<{ ok: true; written: number } | { ok: false; error: string }> {
  const now = new Date().toISOString();

  // Supersede any standing decision for these children on this service. The
  // unique index allows one live row per child per hold, so the old one has
  // to be released before the new one lands.
  const ids = records.map((r) => r.studentId);
  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await sb
      .from("fee_hold_decisions")
      .update({
        released_at: now,
        released_by: appliedBy,
        released_reason: `Superseded by round ${round.id}`,
      })
      .eq("tenant_id", tenantId)
      .eq("hold_code", round.holdCode)
      .is("released_at", null)
      .in("student_id", ids.slice(i, i + CHUNK));
    if (error) return { ok: false, error: error.message };
  }

  if (records.length > 0) {
    const { error } = await sb.from("fee_hold_decisions").insert(
      records.map((r) => ({
        tenant_id: tenantId,
        student_id: r.studentId,
        hold_code: r.holdCode,
        decision: r.decision,
        reason: r.reason,
        round_id: r.roundId,
        stage: r.stage,
        overdue_amount_paise: r.overdueAmountPaise,
        decided_at: r.decidedAt,
        decided_by: r.decidedBy,
      })),
    );
    if (error) return { ok: false, error: error.message };
  }

  const { error: closeError } = await sb
    .from("fee_hold_rounds")
    .update({
      status: "applied",
      applied_at: now,
      applied_by: appliedBy,
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("id", round.id);
  if (closeError) return { ok: false, error: closeError.message };

  return { ok: true, written: records.length };
}

/* ── enforcement reads ──────────────────────────────────────── */

export type LiveHoldDecision = {
  studentId: string;
  holdCode: HoldCode;
  decision: "disallow" | "allow";
  reason: string;
  stage: OverdueStage;
  decidedAt: string;
  decidedBy: string;
};

/**
 * Every standing decision. This is what a gate consults.
 *
 * Returns both disallows and allows: a caller that only asked for blocks
 * would have to guess what an absent row means, and "we spared this family
 * last week" is exactly the thing that must not be guessed.
 */
export async function fetchLiveHoldDecisions(
  sb: SupabaseClient,
  tenantId: string,
  holdCode?: HoldCode,
): Promise<
  { ok: true; decisions: LiveHoldDecision[] } | { ok: false; error: string }
> {
  const rows = await fetchAllPages<{
    student_id: string;
    hold_code: string;
    decision: string;
    reason: string | null;
    stage: string | null;
    decided_at: string;
    decided_by: string | null;
  }>((from, to) => {
    let q = sb
      .from("fee_hold_decisions")
      .select("student_id, hold_code, decision, reason, stage, decided_at, decided_by")
      .eq("tenant_id", tenantId)
      .is("released_at", null)
      .order("student_id", { ascending: true })
      .range(from, to);
    if (holdCode) q = q.eq("hold_code", holdCode);
    return q;
  });
  if (rows.error) return { ok: false, error: rows.error };

  return {
    ok: true,
    decisions: rows.rows
      .filter((r) => isBlockableHold(r.hold_code))
      .map((r) => ({
        studentId: r.student_id,
        holdCode: r.hold_code as HoldCode,
        decision: r.decision === "disallow" ? "disallow" : "allow",
        reason: r.reason ?? "",
        stage: (r.stage ?? "S0") as OverdueStage,
        decidedAt: r.decided_at,
        decidedBy: r.decided_by ?? "",
      })),
  };
}

/**
 * Lift a standing decision — the office letting a family back on the bus
 * because they paid, or because somebody argued successfully.
 */
export async function releaseHoldDecisions(
  sb: SupabaseClient,
  tenantId: string,
  holdCode: HoldCode,
  studentIds: string[],
  releasedBy: string,
  reason: string,
): Promise<{ ok: true; released: number } | { ok: false; error: string }> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return { ok: true, released: 0 };

  const now = new Date().toISOString();
  let released = 0;
  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await sb
      .from("fee_hold_decisions")
      .update({
        released_at: now,
        released_by: releasedBy,
        released_reason: reason.trim().slice(0, 300),
      })
      .eq("tenant_id", tenantId)
      .eq("hold_code", holdCode)
      .is("released_at", null)
      .in("student_id", ids.slice(i, i + CHUNK))
      .select("student_id");
    if (error) return { ok: false, error: error.message };
    released += (data ?? []).length;
  }
  return { ok: true, released };
}

/**
 * Inter-school events — server truth (Supabase evt_* tables).
 *
 * The registration and transparency pages are public, so nothing here may
 * depend on any browser's local store. Outside students exist ONLY in
 * evt_participants — never in sis_students.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createCashfreeLink,
  fetchCashfreeLinkStatus,
  shouldUseCashfreeCheckout,
} from "@/lib/cashfree.server";
import { publicAppOrigin } from "@/lib/waSisBotServer";

export class EvtError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Ctx = { sb: SupabaseClient; tenantId: string };

async function evtCtx(): Promise<Ctx> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new EvtError("Database unavailable", 503);
  return ctx;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));
const int = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : 0;
};
const dateOnly = (v: unknown): string => str(v).slice(0, 10);

export type EvtStatus = "draft" | "open" | "closed" | "completed";

export type EvtCategory = {
  id: string;
  name: string;
  classBand: string;
  prize1Paise: number;
  prize2Paise: number;
  prize3Paise: number;
  prizeNotes: string;
  resultsLockedAt: string;
  lockedBy: string;
  sortOrder: number;
};

export type EvtEvent = {
  id: string;
  name: string;
  slug: string;
  eventDate: string;
  venue: string;
  description: string;
  registrationClosesOn: string;
  entryFeePaise: number;
  otherCostsPaise: number;
  status: EvtStatus;
  categories: EvtCategory[];
};

export type EvtParticipant = {
  id: string;
  eventId: string;
  categoryId: string;
  studentName: string;
  schoolName: string;
  classLabel: string;
  guardianMobile: string;
  isOwnStudent: boolean;
  sisStudentId: string;
  status: "pending" | "approved" | "rejected";
  feeStatus: "na" | "due" | "paid";
  feePaise: number;
  paymentRef: string;
  source: string;
  score: number | null;
  rank: number | null;
  createdAt: string;
};

function rowToCategory(r: Row): EvtCategory {
  return {
    id: str(r.id),
    name: str(r.name),
    classBand: str(r.class_band),
    prize1Paise: int(r.prize1_paise),
    prize2Paise: int(r.prize2_paise),
    prize3Paise: int(r.prize3_paise),
    prizeNotes: str(r.prize_notes),
    resultsLockedAt: str(r.results_locked_at),
    lockedBy: str(r.locked_by),
    sortOrder: int(r.sort_order),
  };
}

function rowToEvent(r: Row, categories: EvtCategory[]): EvtEvent {
  return {
    id: str(r.id),
    name: str(r.name),
    slug: str(r.slug),
    eventDate: dateOnly(r.event_date),
    venue: str(r.venue),
    description: str(r.description),
    registrationClosesOn: dateOnly(r.registration_closes_on),
    entryFeePaise: int(r.entry_fee_paise),
    otherCostsPaise: int(r.other_costs_paise),
    status: (str(r.status) || "draft") as EvtStatus,
    categories,
  };
}

function rowToParticipant(r: Row): EvtParticipant {
  return {
    id: str(r.id),
    eventId: str(r.event_id),
    categoryId: str(r.category_id),
    studentName: str(r.student_name),
    schoolName: str(r.school_name),
    classLabel: str(r.class_label),
    guardianMobile: str(r.guardian_mobile),
    isOwnStudent: !!r.is_own_student,
    sisStudentId: str(r.sis_student_id),
    status: (str(r.status) || "pending") as EvtParticipant["status"],
    feeStatus: (str(r.fee_status) || "na") as EvtParticipant["feeStatus"],
    feePaise: int(r.fee_paise),
    paymentRef: str(r.payment_ref),
    source: str(r.source),
    score: r.score == null ? null : Number(r.score),
    rank: r.rank == null ? null : int(r.rank),
    createdAt: str(r.created_at),
  };
}

async function categoriesOf(
  ctx: Ctx,
  eventIds: string[],
): Promise<Map<string, EvtCategory[]>> {
  if (eventIds.length === 0) return new Map();
  const { data, error } = await ctx.sb
    .from("evt_categories")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .in("event_id", eventIds)
    .order("sort_order");
  if (error) throw new EvtError(error.message, 500);
  const map = new Map<string, EvtCategory[]>();
  for (const r of (data ?? []) as Row[]) {
    const k = str(r.event_id);
    (map.get(k) ?? map.set(k, []).get(k)!).push(rowToCategory(r));
  }
  return map;
}

/* ─── Staff: events ────────────────────────────────────────── */

export async function listEvents(): Promise<EvtEvent[]> {
  const ctx = await evtCtx();
  const { data, error } = await ctx.sb
    .from("evt_events")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new EvtError(error.message, 500);
  const rows = (data ?? []) as Row[];
  const cats = await categoriesOf(ctx, rows.map((r) => str(r.id)));
  return rows.map((r) => rowToEvent(r, cats.get(str(r.id)) ?? []));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function saveEvent(input: {
  id?: string;
  name: string;
  eventDate?: string;
  venue?: string;
  description?: string;
  registrationClosesOn?: string;
  entryFeePaise?: number;
  otherCostsPaise?: number;
  status?: EvtStatus;
  categories: {
    id?: string;
    name: string;
    classBand?: string;
    prize1Paise?: number;
    prize2Paise?: number;
    prize3Paise?: number;
    prizeNotes?: string;
  }[];
  by: string;
}): Promise<EvtEvent> {
  const ctx = await evtCtx();
  const name = input.name.trim();
  if (!name) throw new EvtError("Event needs a name");
  if (!input.categories.some((c) => c.name.trim())) {
    throw new EvtError("Add at least one competition category");
  }

  let eventId = input.id ?? "";
  if (!eventId) {
    const { data, error } = await ctx.sb
      .from("evt_events")
      .insert({
        tenant_id: ctx.tenantId,
        name,
        slug: slugify(name) || `event-${Date.now().toString(36)}`,
        event_date: input.eventDate || null,
        venue: str(input.venue),
        description: str(input.description),
        registration_closes_on: input.registrationClosesOn || null,
        entry_fee_paise: Math.max(0, int(input.entryFeePaise)),
        other_costs_paise: Math.max(0, int(input.otherCostsPaise)),
        status: input.status ?? "draft",
        created_by: input.by,
      })
      .select("id")
      .single();
    if (error) throw new EvtError(error.message, 500);
    eventId = str((data as Row).id);
  } else {
    const { error } = await ctx.sb
      .from("evt_events")
      .update({
        name,
        event_date: input.eventDate || null,
        venue: str(input.venue),
        description: str(input.description),
        registration_closes_on: input.registrationClosesOn || null,
        entry_fee_paise: Math.max(0, int(input.entryFeePaise)),
        other_costs_paise: Math.max(0, int(input.otherCostsPaise)),
        ...(input.status ? { status: input.status } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", eventId);
    if (error) throw new EvtError(error.message, 500);
  }

  // Upsert categories; never delete one that has participants.
  const wanted = input.categories.filter((c) => c.name.trim());
  const keepIds: string[] = [];
  for (let i = 0; i < wanted.length; i++) {
    const c = wanted[i]!;
    const body = {
      tenant_id: ctx.tenantId,
      event_id: eventId,
      name: c.name.trim(),
      class_band: str(c.classBand),
      prize1_paise: Math.max(0, int(c.prize1Paise)),
      prize2_paise: Math.max(0, int(c.prize2Paise)),
      prize3_paise: Math.max(0, int(c.prize3Paise)),
      prize_notes: str(c.prizeNotes),
      sort_order: i,
      updated_at: new Date().toISOString(),
    };
    if (c.id) {
      const { error } = await ctx.sb
        .from("evt_categories")
        .update(body)
        .eq("tenant_id", ctx.tenantId)
        .eq("id", c.id);
      if (error) throw new EvtError(error.message, 500);
      keepIds.push(c.id);
    } else {
      const { data, error } = await ctx.sb
        .from("evt_categories")
        .insert(body)
        .select("id")
        .single();
      if (error) throw new EvtError(error.message, 500);
      keepIds.push(str((data as Row).id));
    }
  }
  // Remove dropped categories only when empty of participants.
  const { data: existing } = await ctx.sb
    .from("evt_categories")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", eventId);
  for (const r of (existing ?? []) as Row[]) {
    const id = str(r.id);
    if (keepIds.includes(id)) continue;
    const { count } = await ctx.sb
      .from("evt_participants")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("category_id", id);
    if ((count ?? 0) === 0) {
      await ctx.sb
        .from("evt_categories")
        .delete()
        .eq("tenant_id", ctx.tenantId)
        .eq("id", id);
    }
  }

  const events = await listEvents();
  return events.find((e) => e.id === eventId)!;
}

/* ─── Participants ─────────────────────────────────────────── */

export async function listParticipants(
  eventId: string,
): Promise<EvtParticipant[]> {
  const ctx = await evtCtx();
  const { data, error } = await ctx.sb
    .from("evt_participants")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", eventId)
    .order("created_at");
  if (error) throw new EvtError(error.message, 500);
  return ((data ?? []) as Row[]).map(rowToParticipant);
}

/** Office adds the school's own students, straight from SIS rows. */
export async function addOwnStudents(input: {
  eventId: string;
  categoryId: string;
  sisStudentIds: string[];
  schoolName: string;
}): Promise<number> {
  const ctx = await evtCtx();
  if (input.sisStudentIds.length === 0) return 0;
  const { data, error } = await ctx.sb
    .from("sis_students")
    .select("id, full_name, class_id, section_id, father_mobile, mother_mobile, academic_year_code")
    .eq("tenant_id", ctx.tenantId)
    .in("id", input.sisStudentIds);
  if (error) throw new EvtError(error.message, 500);

  const { data: existing } = await ctx.sb
    .from("evt_participants")
    .select("sis_student_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", input.eventId)
    .eq("category_id", input.categoryId);
  const already = new Set(
    ((existing ?? []) as Row[]).map((r) => str(r.sis_student_id)),
  );

  const { data: ev } = await ctx.sb
    .from("evt_events")
    .select("entry_fee_paise")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.eventId)
    .single();
  const fee = int((ev as Row | null)?.entry_fee_paise);

  const rows = ((data ?? []) as Row[])
    .filter((r) => !already.has(str(r.id)))
    .map((r) => ({
      tenant_id: ctx.tenantId,
      event_id: input.eventId,
      category_id: input.categoryId,
      student_name: str(r.full_name),
      school_name: input.schoolName,
      class_label: "",
      guardian_mobile: str(r.father_mobile) || str(r.mother_mobile),
      is_own_student: true,
      sis_student_id: str(r.id),
      status: "approved",
      source: "office",
      fee_status: fee > 0 ? "due" : "na",
      fee_paise: fee,
    }));
  if (rows.length === 0) return 0;
  const { error: insErr } = await ctx.sb.from("evt_participants").insert(rows);
  if (insErr) throw new EvtError(insErr.message, 500);
  return rows.length;
}

export async function setParticipantStatus(input: {
  participantId: string;
  status: "approved" | "rejected" | "pending";
}): Promise<void> {
  const ctx = await evtCtx();
  const { error } = await ctx.sb
    .from("evt_participants")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.participantId);
  if (error) throw new EvtError(error.message, 500);
}

export async function markFeePaid(input: {
  participantId: string;
  paymentRef: string;
}): Promise<void> {
  const ctx = await evtCtx();
  const { error } = await ctx.sb
    .from("evt_participants")
    .update({
      fee_status: "paid",
      payment_ref: input.paymentRef,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.participantId);
  if (error) throw new EvtError(error.message, 500);
}

/* ─── Results ──────────────────────────────────────────────── */

export async function enterResult(input: {
  participantId: string;
  score: number | null;
  rank: number | null;
  by: string;
}): Promise<void> {
  const ctx = await evtCtx();
  const { data: p, error: pe } = await ctx.sb
    .from("evt_participants")
    .select("category_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.participantId)
    .single();
  if (pe || !p) throw new EvtError("Participant not found", 404);
  const { data: cat } = await ctx.sb
    .from("evt_categories")
    .select("results_locked_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", str((p as Row).category_id))
    .single();
  if ((cat as Row | null)?.results_locked_at) {
    throw new EvtError(
      "Results are locked for this category — unlock with a public reason first",
      409,
    );
  }
  const { error } = await ctx.sb
    .from("evt_participants")
    .update({
      score: input.score,
      rank: input.rank,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.participantId);
  if (error) throw new EvtError(error.message, 500);
}

export async function lockCategory(input: {
  categoryId: string;
  by: string;
}): Promise<void> {
  const ctx = await evtCtx();
  const { error } = await ctx.sb
    .from("evt_categories")
    .update({
      results_locked_at: new Date().toISOString(),
      locked_by: input.by,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.categoryId);
  if (error) throw new EvtError(error.message, 500);
}

/** Unlocking after publish is a PUBLIC act: the reason goes on the record. */
export async function unlockCategory(input: {
  categoryId: string;
  reason: string;
  by: string;
}): Promise<void> {
  const ctx = await evtCtx();
  const reason = input.reason.trim();
  if (!reason) throw new EvtError("A public reason is required to reopen locked results");
  const { data: cat, error: ce } = await ctx.sb
    .from("evt_categories")
    .select("event_id, results_locked_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.categoryId)
    .single();
  if (ce || !cat) throw new EvtError("Category not found", 404);
  if (!(cat as Row).results_locked_at) throw new EvtError("Results are not locked");
  const { error: re } = await ctx.sb.from("evt_result_revisions").insert({
    tenant_id: ctx.tenantId,
    event_id: str((cat as Row).event_id),
    category_id: input.categoryId,
    reason,
    revised_by: input.by,
  });
  if (re) throw new EvtError(re.message, 500);
  const { error } = await ctx.sb
    .from("evt_categories")
    .update({
      results_locked_at: null,
      locked_by: "",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.categoryId);
  if (error) throw new EvtError(error.message, 500);
}

/* ─── Prizes & certificates ────────────────────────────────── */

export async function recordPayout(input: {
  participantId: string;
  amountPaise: number;
  by: string;
  note?: string;
}): Promise<void> {
  const ctx = await evtCtx();
  const { data: p } = await ctx.sb
    .from("evt_participants")
    .select("event_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.participantId)
    .single();
  if (!p) throw new EvtError("Participant not found", 404);
  const { error } = await ctx.sb.from("evt_prize_payouts").insert({
    tenant_id: ctx.tenantId,
    event_id: str((p as Row).event_id),
    participant_id: input.participantId,
    amount_paise: Math.max(1, int(input.amountPaise)),
    handed_by: input.by,
    note: str(input.note),
  });
  if (error) throw new EvtError(error.message, 500);
}

/**
 * Issue certificates for every APPROVED participant of the event: winner
 * certificates where a locked category gave them rank 1–3, participation
 * for everyone else. Idempotent — re-running issues only what is missing.
 */
export async function issueCertificates(eventId: string): Promise<{
  winners: number;
  participation: number;
}> {
  const ctx = await evtCtx();
  const parts = await listParticipants(eventId);
  const { data: cats } = await ctx.sb
    .from("evt_categories")
    .select("id, results_locked_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", eventId);
  const locked = new Set(
    ((cats ?? []) as Row[])
      .filter((r) => !!r.results_locked_at)
      .map((r) => str(r.id)),
  );

  const rows: Row[] = [];
  for (const p of parts) {
    if (p.status !== "approved") continue;
    const isWinner =
      locked.has(p.categoryId) && p.rank != null && p.rank >= 1 && p.rank <= 3;
    rows.push({
      tenant_id: ctx.tenantId,
      event_id: eventId,
      participant_id: p.id,
      kind: isWinner ? "winner" : "participation",
      rank: isWinner ? p.rank : null,
    });
  }
  if (rows.length === 0) return { winners: 0, participation: 0 };
  const { error } = await ctx.sb
    .from("evt_certificates")
    .upsert(rows, { onConflict: "tenant_id,participant_id,kind" });
  if (error) throw new EvtError(error.message, 500);

  const { data: all } = await ctx.sb
    .from("evt_certificates")
    .select("kind")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", eventId);
  const kinds = ((all ?? []) as Row[]).map((r) => str(r.kind));
  return {
    winners: kinds.filter((k) => k === "winner").length,
    participation: kinds.filter((k) => k === "participation").length,
  };
}

export async function listCertificates(eventId: string): Promise<
  { id: string; participantId: string; kind: string; rank: number | null }[]
> {
  const ctx = await evtCtx();
  const { data, error } = await ctx.sb
    .from("evt_certificates")
    .select("id, participant_id, kind, rank")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", eventId);
  if (error) throw new EvtError(error.message, 500);
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    participantId: str(r.participant_id),
    kind: str(r.kind),
    rank: r.rank == null ? null : int(r.rank),
  }));
}

/* ─── Public reads ─────────────────────────────────────────── */

export type EvtPublicView = {
  event: Omit<EvtEvent, "id"> & { id: string };
  participants: {
    studentName: string;
    schoolName: string;
    classLabel: string;
    categoryId: string;
  }[];
  results: Record<
    string,
    {
      lockedAt: string;
      rows: {
        studentName: string;
        schoolName: string;
        classLabel: string;
        score: number | null;
        rank: number | null;
        prizePaise: number;
      }[];
    }
  >;
  revisions: { categoryId: string; reason: string; revisedAt: string }[];
  accounts: {
    paidCount: number;
    feesCollectedPaise: number;
    prizesPaidPaise: number;
    otherCostsPaise: number;
    schoolContributionPaise: number;
  };
};

export async function publicEventView(slug: string): Promise<EvtPublicView> {
  const ctx = await evtCtx();
  const { data: ev, error } = await ctx.sb
    .from("evt_events")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("slug", slug)
    .neq("status", "draft")
    .single();
  if (error || !ev) throw new EvtError("Event not found", 404);
  const eventId = str((ev as Row).id);
  const cats = (await categoriesOf(ctx, [eventId])).get(eventId) ?? [];
  const event = rowToEvent(ev as Row, cats);
  const parts = (await listParticipants(eventId)).filter(
    (p) => p.status === "approved",
  );

  const prizeOf = (categoryId: string, rank: number | null): number => {
    if (rank == null) return 0;
    const c = cats.find((x) => x.id === categoryId);
    if (!c) return 0;
    return rank === 1
      ? c.prize1Paise
      : rank === 2
        ? c.prize2Paise
        : rank === 3
          ? c.prize3Paise
          : 0;
  };

  const results: EvtPublicView["results"] = {};
  for (const c of cats) {
    if (!c.resultsLockedAt) continue;
    const rows = parts
      .filter((p) => p.categoryId === c.id)
      .sort((a, b) => {
        if (a.rank != null && b.rank != null) return a.rank - b.rank;
        if (a.rank != null) return -1;
        if (b.rank != null) return 1;
        return (b.score ?? -1) - (a.score ?? -1);
      })
      .map((p) => ({
        studentName: p.studentName,
        schoolName: p.schoolName,
        classLabel: p.classLabel,
        score: p.score,
        rank: p.rank,
        prizePaise: prizeOf(p.categoryId, p.rank),
      }));
    results[c.id] = { lockedAt: c.resultsLockedAt, rows };
  }

  const { data: revs } = await ctx.sb
    .from("evt_result_revisions")
    .select("category_id, reason, revised_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", eventId)
    .order("revised_at");

  const { data: pays } = await ctx.sb
    .from("evt_prize_payouts")
    .select("amount_paise")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", eventId);
  const prizesPaid = ((pays ?? []) as Row[]).reduce(
    (s, r) => s + int(r.amount_paise),
    0,
  );
  const paid = parts.filter((p) => p.feeStatus === "paid");
  const feesCollected = paid.reduce((s, p) => s + p.feePaise, 0);

  return {
    event,
    participants: parts.map((p) => ({
      studentName: p.studentName,
      schoolName: p.schoolName,
      classLabel: p.classLabel,
      categoryId: p.categoryId,
    })),
    results,
    revisions: ((revs ?? []) as Row[]).map((r) => ({
      categoryId: str(r.category_id),
      reason: str(r.reason),
      revisedAt: str(r.revised_at),
    })),
    accounts: {
      paidCount: paid.length,
      feesCollectedPaise: feesCollected,
      prizesPaidPaise: prizesPaid,
      otherCostsPaise: event.otherCostsPaise,
      schoolContributionPaise: Math.max(
        0,
        prizesPaid + event.otherCostsPaise - feesCollected,
      ),
    },
  };
}

/* ─── Public registration ──────────────────────────────────── */

export async function registerPublic(input: {
  slug: string;
  studentName: string;
  schoolName: string;
  classLabel: string;
  guardianMobile: string;
  categoryId: string;
  consent: boolean;
}): Promise<{
  participantId: string;
  feePaise: number;
  checkoutUrl: string | null;
}> {
  const ctx = await evtCtx();
  const name = input.studentName.trim();
  const school = input.schoolName.trim();
  const mobile = input.guardianMobile.replace(/\D/g, "").slice(-10);
  if (name.length < 2) throw new EvtError("Student name required");
  if (school.length < 2) throw new EvtError("School name required");
  if (mobile.length !== 10) throw new EvtError("Valid 10-digit guardian mobile required");
  if (!input.consent) {
    throw new EvtError("Consent to appear on the public participant list is required");
  }

  const { data: ev, error } = await ctx.sb
    .from("evt_events")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("slug", input.slug)
    .single();
  if (error || !ev) throw new EvtError("Event not found", 404);
  const e = ev as Row;
  if (str(e.status) !== "open") throw new EvtError("Registration is closed for this event");
  const closes = dateOnly(e.registration_closes_on);
  if (closes && closes < new Date().toISOString().slice(0, 10)) {
    throw new EvtError("Registration deadline has passed");
  }
  const { data: cat } = await ctx.sb
    .from("evt_categories")
    .select("id, name")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", str(e.id))
    .eq("id", input.categoryId)
    .single();
  if (!cat) throw new EvtError("Choose a competition category");

  // The same child registering the same category twice is a resubmit, not a
  // second entry.
  const { data: dup } = await ctx.sb
    .from("evt_participants")
    .select("id, fee_status, fee_paise")
    .eq("tenant_id", ctx.tenantId)
    .eq("event_id", str(e.id))
    .eq("category_id", input.categoryId)
    .eq("guardian_mobile", mobile)
    .ilike("student_name", name)
    .limit(1);
  const fee = int(e.entry_fee_paise);
  let participantId = str(((dup ?? [])[0] as Row | undefined)?.id ?? "");
  if (!participantId) {
    const { data: ins, error: insErr } = await ctx.sb
      .from("evt_participants")
      .insert({
        tenant_id: ctx.tenantId,
        event_id: str(e.id),
        category_id: input.categoryId,
        student_name: name,
        school_name: school,
        class_label: input.classLabel.trim(),
        guardian_mobile: mobile,
        source: "public",
        status: "pending",
        fee_status: fee > 0 ? "due" : "na",
        fee_paise: fee,
        public_consent: true,
      })
      .select("id")
      .single();
    if (insErr) throw new EvtError(insErr.message, 500);
    participantId = str((ins as Row).id);
  }

  let checkoutUrl: string | null = null;
  if (fee > 0 && shouldUseCashfreeCheckout()) {
    const origin = publicAppOrigin();
    const cf = await createCashfreeLink({
      linkId: `evtp_${participantId}`,
      amountPaise: fee,
      purpose: `Entry fee — ${str(e.name)} · ${name} (${school})`,
      customerName: name,
      customerMobile: mobile,
      returnUrl: `${origin}/fest/${input.slug}?registered=${participantId}`,
      webhookUrl: `${origin}/api/payments/cashfree/webhook`,
      notes: {
        kind: "event_fee",
        participantId,
        eventSlug: input.slug,
      },
    });
    if (cf.ok) checkoutUrl = cf.linkUrl;
  }

  return { participantId, feePaise: fee, checkoutUrl };
}

/** Webhook: an entry-fee Cashfree link reached PAID. */
export async function settleEventFee(input: {
  participantId: string;
  paymentRef: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await evtCtx();
  const { data: p } = await ctx.sb
    .from("evt_participants")
    .select("id, fee_status")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.participantId)
    .single();
  if (!p) return { ok: false, error: "Participant not found" };
  if (str((p as Row).fee_status) === "paid") return { ok: true };
  const live = await fetchCashfreeLinkStatus(`evtp_${input.participantId}`);
  if (!live.ok || live.status !== "PAID") {
    return { ok: false, error: live.ok ? `Link is ${live.status}` : live.error };
  }
  const { error } = await ctx.sb
    .from("evt_participants")
    .update({
      fee_status: "paid",
      payment_ref: input.paymentRef,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.participantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ─── Public certificate verification ──────────────────────── */

export async function verifyCertificate(certId: string): Promise<{
  eventName: string;
  eventDate: string;
  studentName: string;
  schoolName: string;
  categoryName: string;
  kind: string;
  rank: number | null;
  issuedAt: string;
} | null> {
  const ctx = await evtCtx();
  const { data: c } = await ctx.sb
    .from("evt_certificates")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", certId)
    .single();
  if (!c) return null;
  const cert = c as Row;
  const { data: p } = await ctx.sb
    .from("evt_participants")
    .select("student_name, school_name, category_id, event_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", str(cert.participant_id))
    .single();
  if (!p) return null;
  const part = p as Row;
  const [{ data: ev }, { data: cat }] = await Promise.all([
    ctx.sb
      .from("evt_events")
      .select("name, event_date")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", str(part.event_id))
      .single(),
    ctx.sb
      .from("evt_categories")
      .select("name, class_band")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", str(part.category_id))
      .single(),
  ]);
  return {
    eventName: str((ev as Row | null)?.name),
    eventDate: dateOnly((ev as Row | null)?.event_date),
    studentName: str(part.student_name),
    schoolName: str(part.school_name),
    categoryName: [str((cat as Row | null)?.name), str((cat as Row | null)?.class_band)]
      .filter(Boolean)
      .join(" · "),
    kind: str(cert.kind),
    rank: cert.rank == null ? null : int(cert.rank),
    issuedAt: str(cert.issued_at),
  };
}

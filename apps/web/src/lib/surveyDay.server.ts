import "server-only";
import { createHash, randomInt } from "crypto";
import { getServerTenantContext } from "@/lib/serverTenant";
import { deviceIdOf, type PunchJwk } from "@/lib/punchDevices.server";
import { ensureAdmissionsHydratedServer } from "@/lib/admissionsPersistence";
import { loadAdmissions, type SurveyTeamMember } from "@/lib/admissions";
import { istParts } from "@/lib/punchSchedule";
import {
  externalMemberKey,
  type SurveyDay,
  type SurveyDayBreak,
  type SurveyFix,
  type SurveyStartMode,
} from "@/lib/surveyDay";

/**
 * Field survey days on the server (director, 5 Oct 2026). Schema and the
 * why: supabase/migrations/20261005150000_survey_days.sql; the rules:
 * lib/surveyDay.ts.
 *
 * A surveyor is whoever holds a phone key registered in staff_punch_devices
 * — a staff member under their staff id (the same phone they punch with), an
 * outside surveyor under 'ext:<externalId>' (registered by an office pairing
 * code). Unknown is never "allowed": a failed read refuses the step.
 */

export type SurveyMember = {
  memberKey: string;
  name: string;
  staffId: string;
  startMode: SurveyStartMode;
  kind: "staff" | "external";
  mobile: string;
};

export function memberKeyOf(m: SurveyTeamMember): string {
  return m.kind === "external" ? externalMemberKey(m.externalId) : m.staffId;
}

export function istDateAndTime(nowMs = Date.now()): { date: string; time: string } {
  const p = istParts(nowMs);
  const hh = String(Math.floor(p.minutes / 60)).padStart(2, "0");
  const mm = String(p.minutes % 60).padStart(2, "0");
  return { date: p.date, time: `${hh}:${mm}` };
}

/** The survey team as the office set it up (assigned members only). */
export async function loadSurveyTeam(): Promise<SurveyTeamMember[] | null> {
  try {
    await ensureAdmissionsHydratedServer();
    return (loadAdmissions().surveyTeam ?? []).filter((m) => m.assigned);
  } catch {
    return null;
  }
}

export async function loadSurveyBeats() {
  await ensureAdmissionsHydratedServer();
  return (loadAdmissions().surveyBeats ?? []).filter((b) => b.isActive);
}

export type WhoIs =
  | { ok: true; member: SurveyMember; deviceId: string }
  | { ok: false; reason: "not_registered" | "not_on_team" | "unavailable" };

/** Which surveyor holds this phone key? */
export async function surveyMemberForKey(jwk: PunchJwk): Promise<WhoIs> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, reason: "unavailable" };
  const deviceId = deviceIdOf(jwk);
  const { data, error } = await ctx.sb
    .from("staff_punch_devices")
    .select("id, staff_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("device_id", deviceId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return { ok: false, reason: "unavailable" };
  if (!data) return { ok: false, reason: "not_registered" };
  const key = String((data as { staff_id: string }).staff_id);
  const team = await loadSurveyTeam();
  if (!team) return { ok: false, reason: "unavailable" };
  const m = team.find((t) => memberKeyOf(t) === key);
  if (!m) return { ok: false, reason: "not_on_team" };
  try {
    await ctx.sb
      .from("staff_punch_devices")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", (data as { id: string }).id);
  } catch {
    /* best effort */
  }
  return {
    ok: true,
    deviceId,
    member: {
      memberKey: key,
      name: m.fullName,
      staffId: m.kind === "staff" ? m.staffId : "",
      startMode: m.startMode,
      kind: m.kind,
      mobile: m.mobile,
    },
  };
}

// ── pairing: the office gives a surveyor a one-time code for their phone ──

const PAIR_TTL_MS = 10 * 60_000;
const PAIR_MAX_TRIES = 5;
const pairHash = (code: string) => createHash("sha256").update(`survey-pair|${code}`).digest("hex");

/**
 * Open a pairing code for one surveyor. Only one code is open for the
 * school at a time — opening another cancels the last — so five wrong tries
 * on the open code are all a guesser gets.
 */
export async function startSurveyPairing(
  memberKey: string,
  by: string,
): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable" };
  const now = new Date();
  await ctx.sb
    .from("survey_phone_pairings")
    .update({ used_at: now.toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .is("used_at", null);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now.getTime() + PAIR_TTL_MS).toISOString();
  const { error } = await ctx.sb.from("survey_phone_pairings").insert({
    tenant_id: ctx.tenantId,
    member_key: memberKey,
    code_hash: pairHash(code),
    expires_at: expiresAt,
    created_by: by.slice(0, 80),
  });
  return error ? { ok: false, error: error.message } : { ok: true, code, expiresAt };
}

/**
 * The surveyor's phone types the code: its key becomes that surveyor's one
 * phone. Refused if the phone is already someone else's. The surveyor's old
 * phone, if any, stops working.
 */
export async function completeSurveyPairing(input: {
  code: unknown;
  jwk: PunchJwk;
  label: string;
}): Promise<{ ok: true; memberKey: string } | { ok: false; error: string; status: number }> {
  const code = String(input.code ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "Type the 6-digit code the office gave you.", status: 400 };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable", status: 503 };
  const { data, error } = await ctx.sb
    .from("survey_phone_pairings")
    .select("id, member_key, code_hash, expires_at, attempts")
    .eq("tenant_id", ctx.tenantId)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: "Could not check the code right now — try again.", status: 503 };
  const row = data as { id: string; member_key: string; code_hash: string; expires_at: string; attempts: number } | null;
  if (!row || Date.parse(row.expires_at) < Date.now()) {
    return { ok: false, error: "No code is open. Ask the office to press “Pair phone” again.", status: 404 };
  }
  if (row.code_hash !== pairHash(code)) {
    const tries = (row.attempts ?? 0) + 1;
    await ctx.sb
      .from("survey_phone_pairings")
      .update(tries >= PAIR_MAX_TRIES ? { attempts: tries, used_at: new Date().toISOString() } : { attempts: tries })
      .eq("id", row.id);
    return {
      ok: false,
      error:
        tries >= PAIR_MAX_TRIES
          ? "Too many wrong codes — this code is cancelled. Ask the office for a new one."
          : `That code is not right (${PAIR_MAX_TRIES - tries} tries left).`,
      status: 403,
    };
  }
  const deviceId = deviceIdOf(input.jwk);
  const { data: owner, error: ownerErr } = await ctx.sb
    .from("staff_punch_devices")
    .select("staff_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("device_id", deviceId)
    .eq("status", "active")
    .maybeSingle();
  if (ownerErr) return { ok: false, error: "Could not check this phone right now — try again.", status: 503 };
  const ownerKey = (owner as { staff_id: string } | null)?.staff_id;
  if (ownerKey && ownerKey !== row.member_key) {
    return {
      ok: false,
      error: "This phone is already registered to another person. Each surveyor uses their own phone.",
      status: 409,
    };
  }
  // Use the code (conditional, so two phones typing it at once can't both win).
  const nowIso = new Date().toISOString();
  const { data: used, error: useErr } = await ctx.sb
    .from("survey_phone_pairings")
    .update({ used_at: nowIso })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id");
  if (useErr || !used || used.length === 0) {
    return { ok: false, error: "This code was just used. Ask the office for a new one.", status: 409 };
  }
  if (ownerKey === row.member_key) return { ok: true, memberKey: row.member_key };
  await ctx.sb
    .from("staff_punch_devices")
    .update({ status: "revoked", decided_by: "replaced by pairing code", decided_at: nowIso, updated_at: nowIso })
    .eq("tenant_id", ctx.tenantId)
    .eq("staff_id", row.member_key)
    .eq("status", "active");
  const { error: insErr } = await ctx.sb.from("staff_punch_devices").insert({
    tenant_id: ctx.tenantId,
    staff_id: row.member_key,
    device_id: deviceId,
    public_key: input.jwk,
    status: "active",
    label: input.label.slice(0, 80),
    decided_by: "office pairing code",
    decided_at: nowIso,
    last_used_at: nowIso,
  });
  if (insErr) return { ok: false, error: "Could not register this phone — try again.", status: 503 };
  return { ok: true, memberKey: row.member_key };
}

/** Which surveyors have a registered phone (member_key → label). */
export async function surveyPhones(keys: string[]): Promise<Map<string, string> | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  if (keys.length === 0) return new Map();
  const { data, error } = await ctx.sb
    .from("staff_punch_devices")
    .select("staff_id, label")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "active")
    .in("staff_id", keys);
  if (error) return null;
  return new Map((data ?? []).map((r) => [String(r.staff_id), String(r.label || "phone")]));
}

// ── days and captures ──

type DayRow = {
  id: string;
  member_key: string;
  member_name: string;
  staff_id: string;
  day: string;
  start_mode: SurveyStartMode;
  beat_id: string;
  status: SurveyDay["status"];
  started_at: string;
  start_geo: SurveyFix;
  ended_at: string | null;
  end_geo: SurveyFix | null;
  breaks: SurveyDayBreak[];
};

function fromRow(r: DayRow): SurveyDay {
  return {
    id: r.id,
    memberKey: r.member_key,
    memberName: r.member_name,
    staffId: r.staff_id,
    day: String(r.day).slice(0, 10),
    startMode: r.start_mode,
    beatId: r.beat_id,
    status: r.status,
    startedAt: r.started_at,
    startGeo: r.start_geo,
    endedAt: r.ended_at,
    endGeo: r.end_geo,
    breaks: Array.isArray(r.breaks) ? r.breaks : [],
  };
}

const DAY_COLS =
  "id, member_key, member_name, staff_id, day, start_mode, beat_id, status, started_at, start_geo, ended_at, end_geo, breaks";

/** Today's day for one surveyor; undefined = could not read (refuse, don't guess). */
export async function loadSurveyDay(memberKey: string, date: string): Promise<SurveyDay | null | undefined> {
  const ctx = await getServerTenantContext();
  if (!ctx) return undefined;
  const { data, error } = await ctx.sb
    .from("survey_days")
    .select(DAY_COLS)
    .eq("tenant_id", ctx.tenantId)
    .eq("member_key", memberKey)
    .eq("day", date)
    .maybeSingle();
  if (error) return undefined;
  return data ? fromRow(data as DayRow) : null;
}

export async function insertSurveyDay(
  day: Omit<SurveyDay, "id">,
  deviceId: string,
): Promise<{ ok: true; day: SurveyDay } | { ok: false; error: string; status: number }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable", status: 503 };
  const { data, error } = await ctx.sb
    .from("survey_days")
    .insert({
      tenant_id: ctx.tenantId,
      member_key: day.memberKey,
      member_name: day.memberName,
      staff_id: day.staffId,
      day: day.day,
      start_mode: day.startMode,
      beat_id: day.beatId,
      status: day.status,
      started_at: day.startedAt,
      start_geo: day.startGeo,
      breaks: [],
      device_id: deviceId,
    })
    .select(DAY_COLS)
    .single();
  if (error) {
    return error.code === "23505"
      ? { ok: false, error: "Today's survey is already started.", status: 409 }
      : { ok: false, error: "Could not save — try again.", status: 503 };
  }
  return { ok: true, day: fromRow(data as DayRow) };
}

/** Save a moved day, only if nobody moved it since we read it. */
export async function updateSurveyDay(
  before: SurveyDay,
  next: SurveyDay,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "School database unavailable", status: 503 };
  const { data, error } = await ctx.sb
    .from("survey_days")
    .update({
      status: next.status,
      ended_at: next.endedAt,
      end_geo: next.endGeo,
      breaks: next.breaks,
      updated_at: new Date().toISOString(),
    })
    .eq("id", before.id)
    .eq("status", before.status)
    .select("id");
  if (error) return { ok: false, error: "Could not save — try again.", status: 503 };
  if (!data || data.length === 0) {
    return { ok: false, error: "Your day changed on another screen — reload and try again.", status: 409 };
  }
  return { ok: true };
}

export async function recordSurveyCapture(input: {
  dayId: string;
  memberKey: string;
  leadId: string;
  enquiryNo: string;
  childName: string;
  geo: SurveyFix;
}): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const { error } = await ctx.sb.from("survey_captures").insert({
    tenant_id: ctx.tenantId,
    survey_day_id: input.dayId,
    member_key: input.memberKey,
    lead_id: input.leadId,
    enquiry_no: input.enquiryNo,
    child_name: input.childName.slice(0, 120),
    geo: input.geo,
    captured_at: input.geo.at,
  });
  return !error || error.code === "23505";
}

export type SurveyCaptureRow = {
  surveyDayId: string;
  memberKey: string;
  leadId: string;
  enquiryNo: string;
  childName: string;
  geo: SurveyFix;
  capturedAt: string;
};

/** Every day on one date, with its captures — the office's view. */
export async function listSurveyDays(
  date: string,
): Promise<{ days: SurveyDay[]; captures: SurveyCaptureRow[] } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("survey_days")
    .select(DAY_COLS)
    .eq("tenant_id", ctx.tenantId)
    .eq("day", date)
    .order("started_at", { ascending: true });
  if (error) return null;
  const days = (data ?? []).map((r) => fromRow(r as DayRow));
  if (days.length === 0) return { days, captures: [] };
  const { data: caps, error: capErr } = await ctx.sb
    .from("survey_captures")
    .select("survey_day_id, member_key, lead_id, enquiry_no, child_name, geo, captured_at")
    .eq("tenant_id", ctx.tenantId)
    .in(
      "survey_day_id",
      days.map((d) => d.id),
    )
    .order("captured_at", { ascending: true });
  if (capErr) return null;
  return {
    days,
    captures: (caps ?? []).map((c) => ({
      surveyDayId: String(c.survey_day_id),
      memberKey: String(c.member_key),
      leadId: String(c.lead_id),
      enquiryNo: String(c.enquiry_no || ""),
      childName: String(c.child_name || ""),
      geo: c.geo as SurveyFix,
      capturedAt: String(c.captured_at),
    })),
  };
}

import "server-only";

/**
 * Server side of birthday greetings: who has a birthday (from the school
 * mirror / DB), the signed public card URL WhatsApp & Facebook fetch, the
 * per-family send (template with image header when configured, free text
 * inside the 24h window otherwise), the optional social post, and the
 * settings + send-log kept in module_local_state ("birthday_settings") so a
 * day is never sent twice and the office sees what went out.
 *
 * Staff birthdays run the same way with three differences, each of them a
 * decision rather than an omission: the message goes to the person and not to
 * a family, so there are no quiet hours and no household language; the card
 * is signed by the Director rather than the Principal; and nothing is ever
 * posted on social, because a colleague's birthday is not marketing.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerTenantContext } from "@/lib/serverTenant";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getSchoolMirrorSync } from "@/lib/schoolDataMirror";
import { loadSis, type SisState, type SisStudent, type Household } from "@/lib/sis";
import { loadMasters, type MastersState, currentAcademicYearCode} from "@/lib/masters";
import {
  ageOn,
  alreadySent,
  appendBirthdayLog,
  birthdayCardSignature,
  birthdayMessageFor,
  birthdayMessageLanguageFor,
  DEFAULT_SOCIAL_CAPTION,
  emptyBirthdayState,
  normalizeBirthdayState,
  renderBirthdayMessage,
  staffBirthdayMessageFor,
  staffWithBirthday,
  studentsWithBirthday,
  type BirthdayLogEntry,
  type BirthdayState,
  type BirthdaySubject,
} from "@/lib/birthdayCards";
import { isInQuietHours, quietHoursLabel } from "@/lib/householdPrefs";
import { buildWaTemplateBodyComponent, buildWaTemplateMediaHeader, sendWaWithFailover, type WaTemplateComponent } from "@/lib/waSend";
import { crossPostCommsContent } from "@/lib/socialCrossPost.server";
import { TENANT } from "@/lib/types";

const MODULE_KEY = "birthday_settings";

/* ─── Signed card URLs ─────────────────────────────────────────────── */

function secret(): string {
  return process.env.CRON_SECRET || process.env.WA_DISPATCH_SECRET || "";
}
export function signBirthdayCard(parts: { studentId: string; date: string; design: string; format: string }): string {
  const s = secret();
  if (!s) return "";
  return createHmac("sha256", s).update(`${parts.studentId}|${parts.date}|${parts.design}|${parts.format}`).digest("hex").slice(0, 32);
}
export function birthdayCardSigOk(given: string, parts: { studentId: string; date: string; design: string; format: string }): boolean {
  const want = signBirthdayCard(parts);
  if (!want || !given || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
export function publicOrigin(): string {
  const host = (TENANT.publicPortal || process.env.NEXT_PUBLIC_APP_URL || "bhbinternational.school").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}`;
}
export function birthdayCardUrl(opts: { studentId: string; staffId?: string; date: string; design: string; format: string; photo?: boolean; group?: boolean; wish?: string }): string {
  // The "staff:" prefix keeps the two id spaces apart inside the HMAC, so a
  // signature minted for a student can never open a staff member's card.
  const id = opts.group ? "group" : opts.staffId ? `staff:${opts.staffId}` : opts.studentId;
  const sig = signBirthdayCard({ studentId: id, date: opts.date, design: opts.design, format: opts.format });
  const p = new URLSearchParams({ date: opts.date, design: opts.design, format: opts.format, sig });
  if (opts.group) p.set("group", "1");
  else if (opts.staffId) p.set("staff", opts.staffId);
  else p.set("student", opts.studentId);
  if (opts.photo === false) p.set("photo", "0");
  if (opts.wish) p.set("wish", opts.wish);
  return `${publicOrigin()}/api/birthday/card?${p.toString()}`;
}

/* ─── Data ─────────────────────────────────────────────────────────── */

async function sisAndMasters(): Promise<{ sis: SisState; masters: MastersState }> {
  await ensureSchoolMirrorHydrated();
  const m = getSchoolMirrorSync();
  const sis = (m.sis as SisState | null) || loadSis();
  const masters = (m.masters as MastersState | null) || loadMasters();
  return { sis, masters };
}

function classLabel(masters: MastersState, s: SisStudent): string {
  const c = masters.classes?.find((x) => x.id === s.classId);
  const sec = masters.sections?.find((x) => x.id === s.sectionId);
  return [c?.name ? `Class ${c.name}` : "", sec?.name ? sec.name : ""].filter(Boolean).join(" · ");
}

function designationLabel(masters: MastersState, designationId: string | null): string {
  if (!designationId) return "";
  return masters.designations?.find((d) => d.id === designationId)?.name || "";
}

/** The line at the foot of the card: the Director for staff, the Principal for students. */
export async function cardSignatureFor(subject: BirthdaySubject): Promise<string> {
  const st = await readBirthdayState();
  return birthdayCardSignature(st.settings, subject);
}

export async function findBirthdayCardSubject(opts: { date: string; studentId?: string; staffId?: string; group?: boolean }): Promise<
  | { ok: true; studentName: string; className: string; photoUrl: string; names: string[] }
  | { ok: false; error: string }
> {
  const { sis, masters } = await sisAndMasters();
  if (opts.staffId) {
    const m = masters.staff?.find((x) => x.id === opts.staffId);
    if (!m) return { ok: false, error: "Staff member not found" };
    return { ok: true, studentName: m.fullName, className: designationLabel(masters, m.designationId), photoUrl: m.photoUrl || "", names: [] };
  }
  if (opts.group) {
    const names = studentsWithBirthday(sis.students, opts.date, currentAcademicYearCode(loadMasters())).map((s) => s.fullName);
    if (!names.length) return { ok: false, error: "No birthdays on this date" };
    return { ok: true, studentName: "", className: "", photoUrl: "", names };
  }
  const s = sis.students.find((x) => x.id === opts.studentId);
  if (!s) return { ok: false, error: "Student not found" };
  return { ok: true, studentName: s.fullName, className: classLabel(masters, s), photoUrl: s.photoUrl || "", names: [] };
}

export type BirthdayToday = {
  studentId: string;
  fullName: string;
  className: string;
  age: number | null;
  householdId: string;
  guardianName: string;
  mobile: string;
  language: "en" | "hi";
  hasPhoto: boolean;
};

export async function birthdaysOn(date: string): Promise<BirthdayToday[]> {
  const { sis, masters } = await sisAndMasters();
  const st = await readBirthdayState();
  const hh = new Map(sis.households.map((h) => [h.id, h]));
  // The session matters: without it a child who has left is greeted every
  // year forever, at a template charge each.
  return studentsWithBirthday(
    sis.students,
    date,
    currentAcademicYearCode(loadMasters()),
  ).map((s) => {
    const h = hh.get(s.householdId) as Household | undefined;
    return {
      studentId: s.id,
      fullName: s.fullName,
      className: classLabel(masters, s),
      age: ageOn(s.dob, date),
      householdId: s.householdId,
      guardianName: h?.guardianName || "",
      mobile: h?.whatsappMobile || h?.mobile || "",
      language: birthdayMessageLanguageFor(h, st.settings.defaultLanguage),
      hasPhoto: !!s.photoUrl,
    };
  });
}

export type StaffBirthdayToday = {
  staffId: string;
  fullName: string;
  designation: string;
  age: number | null;
  mobile: string;
  hasPhoto: boolean;
};

/**
 * Active staff with a birthday on `date`, with the number their greeting would
 * go to. The roster comes through the mirror: staff are stripped from the
 * masters BLOB and merged back from `sis_staff` during hydration, so this must
 * read the hydrated mirror rather than a bare loadMasters().
 */
export async function staffBirthdaysOn(date: string): Promise<StaffBirthdayToday[]> {
  const { masters } = await sisAndMasters();
  return staffWithBirthday(masters.staff ?? [], date).map((m) => ({
    staffId: m.id,
    fullName: m.fullName,
    designation: designationLabel(masters, m.designationId),
    age: ageOn(m.dateOfBirth, date),
    mobile: m.mobile || m.altMobile || "",
    hasPhoto: !!m.photoUrl,
  }));
}

/* ─── Settings + log in module_local_state ─────────────────────────── */

export async function readBirthdayState(): Promise<BirthdayState> {
  const ctx = await getServerTenantContext();
  if (!ctx) return emptyBirthdayState();
  const { data, error } = await ctx.sb.from("module_local_state").select("state").eq("tenant_id", ctx.tenantId).eq("module_key", MODULE_KEY).maybeSingle();
  if (error || !data?.state) return emptyBirthdayState();
  return normalizeBirthdayState(data.state);
}

async function appendLogServer(entries: BirthdayLogEntry[]): Promise<void> {
  if (!entries.length) return;
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const cur = await readBirthdayState();
  const next = appendBirthdayLog(cur, entries);
  const { error } = await ctx.sb.from("module_local_state").upsert(
    { tenant_id: ctx.tenantId, module_key: MODULE_KEY, state: next, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,module_key" },
  );
  if (error) console.warn("[birthday] log write failed", error.message);
}

/* ─── Sending ──────────────────────────────────────────────────────── */

export type BirthdayRunResult = {
  date: string;
  considered: number;
  sent: number;
  failed: number;
  deferred: number;
  skipped: number;
  social: { attempted: boolean; ok: boolean; detail: string };
  rows: { studentId: string; fullName: string; mobile: string; status: BirthdayLogEntry["status"]; detail: string; via: string }[];
};

/**
 * Send today's greetings. `dryRun` builds everything and sends nothing.
 * `studentIds` restricts to a manual "send now" for some students (ignores
 * autoSend, still respects quiet hours and the already-sent log).
 */
export async function runBirthdayGreetings(opts: { date: string; dryRun?: boolean; studentIds?: string[]; force?: boolean; includeSocial?: boolean }): Promise<BirthdayRunResult> {
  const st = await readBirthdayState();
  const s = st.settings;
  const list = (await birthdaysOn(opts.date)).filter((b) => !opts.studentIds || opts.studentIds.includes(b.studentId));
  const { sis } = await sisAndMasters();
  const hh = new Map(sis.households.map((h) => [h.id, h]));
  const result: BirthdayRunResult = { date: opts.date, considered: list.length, sent: 0, failed: 0, deferred: 0, skipped: 0, social: { attempted: false, ok: false, detail: "" }, rows: [] };
  const log: BirthdayLogEntry[] = [];

  for (const b of list) {
    const key = `${b.studentId}:${opts.date}`;
    const push = (status: BirthdayLogEntry["status"], detail: string, via: string) => {
      result.rows.push({ studentId: b.studentId, fullName: b.fullName, mobile: b.mobile, status, detail, via });
      if (!opts.dryRun) log.push({ key, subjectId: b.studentId, subject: "student", date: opts.date, channel: "whatsapp", status, detail, at: new Date().toISOString() });
      if (status === "sent") result.sent += 1;
      else if (status === "failed") result.failed += 1;
      else if (status === "deferred") result.deferred += 1;
      else result.skipped += 1;
    };
    if (!opts.force && alreadySent(st, b.studentId, opts.date, "whatsapp")) {
      push("skipped", "Already sent today", "log");
      continue;
    }
    if (b.mobile.replace(/\D/g, "").length < 10) {
      push("skipped", "No household WhatsApp / mobile", "none");
      continue;
    }
    const household = hh.get(b.householdId);
    if (household && isInQuietHours(household)) {
      push("deferred", `Family quiet hours ${quietHoursLabel(household)} — retried by the next tick`, "none");
      continue;
    }
    const cardLink = birthdayCardUrl({ studentId: b.studentId, date: opts.date, design: s.design, format: s.format, wish: s.cardWish || undefined });
    const text = birthdayMessageFor({
      settings: s,
      language: b.language,
      childName: b.fullName,
      guardianName: b.guardianName,
      className: b.className,
      age: b.age,
      schoolName: TENANT.nameDisplay,
      cardLink,
    });
    if (opts.dryRun) {
      push("skipped", `dry run · ${s.waTemplateName ? `template ${s.waTemplateName}` : "free text"} · ${text.slice(0, 80)}…`, s.waTemplateName ? "template" : "text");
      continue;
    }
    let r;
    let via = "text";
    if (s.waTemplateName) {
      via = "template";
      const vars: Record<string, string> = {
        childName: b.fullName,
        firstName: b.fullName.split(/\s+/)[0] || b.fullName,
        guardianName: b.guardianName || (b.language === "hi" ? "अभिभावक" : "Parent"),
        className: b.className,
        age: b.age != null ? String(b.age) : "",
        schoolName: TENANT.nameDisplay,
        cardLink,
      };
      const components: WaTemplateComponent[] = [buildWaTemplateMediaHeader("IMAGE", cardLink)];
      if (s.waTemplateVars.length) components.push(buildWaTemplateBodyComponent(s.waTemplateVars, vars));
      r = await sendWaWithFailover({
        primaryMobile: b.mobile,
        template: { name: s.waTemplateName, language: s.waTemplateLanguage || (b.language === "hi" ? "hi" : "en"), components },
        clientMessageId: `bday_${key}`,
      });
      // Template failed for a non-delivery reason (e.g. not approved) → try free text once.
      if (!r.ok && /template|not found|132001|132012/i.test(r.error || "")) {
        via = "text-after-template";
        r = await sendWaWithFailover({ primaryMobile: b.mobile, body: text, clientMessageId: `bday_${key}_t` });
      }
    } else {
      r = await sendWaWithFailover({ primaryMobile: b.mobile, body: text, clientMessageId: `bday_${key}` });
    }
    if (r.ok) push("sent", `${r.mode}${r.usedFallback ? " · fallback number" : ""}`, via);
    else push("failed", r.error || "send failed", via);
  }

  // One social post for the day (names-only group card unless photos are opted in).
  if (opts.includeSocial && s.socialEnabled && list.length && !opts.dryRun) {
    const already = list.every((b) => alreadySent(st, b.studentId, opts.date, "social"));
    if (already && !opts.force) {
      result.social = { attempted: false, ok: true, detail: "Already posted today" };
    } else {
      result.social.attempted = true;
      const names = list.map((b) => b.fullName);
      const caption = renderBirthdayMessage(s.socialCaption || DEFAULT_SOCIAL_CAPTION, {
        names: names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`,
        schoolName: TENANT.nameDisplay,
        schoolTag: (TENANT.shortName || TENANT.nameDisplay).replace(/[^A-Za-z0-9]/g, ""),
      });
      const imageUrl =
        s.socialIncludePhoto && list.length === 1
          ? birthdayCardUrl({ studentId: list[0].studentId, date: opts.date, design: s.socialDesign, format: "square" })
          : birthdayCardUrl({ studentId: "", date: opts.date, design: s.socialDesign, format: "square", group: true });
      const r = await crossPostCommsContent({ kind: "marketing", contentId: `bday_${opts.date}`, title: "Happy birthday", body: caption, imageUrl, linkUrl: `${publicOrigin()}/apply?src=social` });
      const detail = r.results.map((x) => `${x.platform}: ${x.ok ? "posted" : x.error || "failed"}`).join(" · ") || r.error || "";
      result.social = { attempted: true, ok: r.ok, detail };
      for (const b of list) log.push({ key: `${b.studentId}:${opts.date}`, subjectId: b.studentId, subject: "student", date: opts.date, channel: "social", status: r.ok ? "sent" : "failed", detail: detail.slice(0, 200), at: new Date().toISOString() });
    }
  }

  await appendLogServer(log);
  return result;
}

export type StaffBirthdayRunResult = {
  date: string;
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
  rows: { staffId: string; fullName: string; mobile: string; status: BirthdayLogEntry["status"]; detail: string; via: string }[];
};

/**
 * Wish today's staff. Deliberately simpler than the family run: a colleague
 * has no quiet hours to respect and no household language to look up, and
 * nothing here ever posts to social.
 */
export async function runStaffBirthdayGreetings(opts: { date: string; dryRun?: boolean; staffIds?: string[]; force?: boolean }): Promise<StaffBirthdayRunResult> {
  const st = await readBirthdayState();
  const s = st.settings;
  const list = (await staffBirthdaysOn(opts.date)).filter((b) => !opts.staffIds || opts.staffIds.includes(b.staffId));
  const result: StaffBirthdayRunResult = { date: opts.date, considered: list.length, sent: 0, failed: 0, skipped: 0, rows: [] };
  const log: BirthdayLogEntry[] = [];
  const language = s.defaultLanguage;

  for (const b of list) {
    const key = `staff:${b.staffId}:${opts.date}`;
    const push = (status: BirthdayLogEntry["status"], detail: string, via: string) => {
      result.rows.push({ staffId: b.staffId, fullName: b.fullName, mobile: b.mobile, status, detail, via });
      if (!opts.dryRun) log.push({ key, subjectId: b.staffId, subject: "staff", date: opts.date, channel: "whatsapp", status, detail, at: new Date().toISOString() });
      if (status === "sent") result.sent += 1;
      else if (status === "failed") result.failed += 1;
      else result.skipped += 1;
    };
    if (!opts.force && alreadySent(st, b.staffId, opts.date, "whatsapp", "staff")) {
      push("skipped", "Already sent today", "log");
      continue;
    }
    if (b.mobile.replace(/\D/g, "").length < 10) {
      push("skipped", "No mobile on the staff record", "none");
      continue;
    }
    const cardLink = birthdayCardUrl({ studentId: "", staffId: b.staffId, date: opts.date, design: s.design, format: s.format, wish: s.cardWish || undefined });
    const text = staffBirthdayMessageFor({
      settings: s,
      language,
      name: b.fullName,
      designation: b.designation,
      age: b.age,
      schoolName: TENANT.nameDisplay,
      cardLink,
    });
    if (opts.dryRun) {
      push("skipped", `dry run · ${s.staffWaTemplateName ? `template ${s.staffWaTemplateName}` : "free text"} · ${text.slice(0, 80)}…`, s.staffWaTemplateName ? "template" : "text");
      continue;
    }
    let r;
    let via = "text";
    if (s.staffWaTemplateName) {
      via = "template";
      const vars: Record<string, string> = {
        name: b.fullName,
        firstName: b.fullName.split(/\s+/)[0] || b.fullName,
        designation: b.designation,
        age: b.age != null ? String(b.age) : "",
        schoolName: TENANT.nameDisplay,
        cardLink,
      };
      const components: WaTemplateComponent[] = [buildWaTemplateMediaHeader("IMAGE", cardLink)];
      if (s.staffWaTemplateVars.length) components.push(buildWaTemplateBodyComponent(s.staffWaTemplateVars, vars));
      r = await sendWaWithFailover({
        primaryMobile: b.mobile,
        template: { name: s.staffWaTemplateName, language: s.staffWaTemplateLanguage || (language === "hi" ? "hi" : "en"), components },
        clientMessageId: `bdaystaff_${b.staffId}_${opts.date}`,
      });
      if (!r.ok && /template|not found|132001|132012/i.test(r.error || "")) {
        via = "text-after-template";
        r = await sendWaWithFailover({ primaryMobile: b.mobile, body: text, clientMessageId: `bdaystaff_${b.staffId}_${opts.date}_t` });
      }
    } else {
      r = await sendWaWithFailover({ primaryMobile: b.mobile, body: text, clientMessageId: `bdaystaff_${b.staffId}_${opts.date}` });
    }
    if (r.ok) push("sent", `${r.mode}${r.usedFallback ? " · fallback number" : ""}`, via);
    else push("failed", r.error || "send failed", via);
  }

  await appendLogServer(log);
  return result;
}

/** IST "YYYY-MM-DD" and hour for the tick. */
export function istNow(now = new Date()): { date: string; hour: number } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}

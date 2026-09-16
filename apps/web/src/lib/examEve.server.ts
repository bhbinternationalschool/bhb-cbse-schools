import "server-only";

/**
 * The 6 PM exam-eve sweep. See lib/examEve.ts for why it exists.
 *
 * Runs every evening and does nothing unless TOMORROW has a paper, so the
 * scheduler needs no knowledge of the exam calendar: the date sheet is the
 * calendar.
 *
 * Per family, per exam date, at most once — the household_message_log is
 * the ledger, the same way the parent chat-close sweep uses it. A family
 * already inside the 24-hour window gets free text (no template, no
 * conversation charge); everyone else gets the approved template.
 */

import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { fetchExamDeskFromDb } from "@/lib/examsNormalized.server";
import { loadSis, householdWhatsApp, studentsInSession, type Household } from "@/lib/sis";
import { loadMasters, currentAcademicYearCode } from "@/lib/masters";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/lib/waSend";
import {
  resolveTemplateForSend,
  templateVariablePositions,
} from "@/lib/waTemplates";
import { loadWaTemplatesServer } from "@/lib/waTemplatesRead.server";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import {
  isWithin24HourWindow,
  listOptedOutSet,
  toE164India,
} from "@/lib/waContactState.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { isReviewDemoHousehold } from "@/lib/reviewDemoRecords";
import {
  examEveFreeText,
  examEveVariables,
  nextExamDate,
  tomorrowIso,
  type EveChild,
  type EveFamily,
  type EveSlot,
} from "@/lib/examEve";

export const EXAM_EVE_PURPOSE = "exam_eve";
const FAMILY_KEY = "exams_tomorrow";

export function istTodayIso(nowMs = Date.now()): string {
  return new Date(nowMs + 330 * 60_000).toISOString().slice(0, 10);
}

export type ExamSetup = {
  slots: EveSlot[];
  subjectNames: Map<string, string>;
  academicYearCode: string;
};

/** The live date sheet, as the parent-facing code needs it. */
export async function loadExamSetup(): Promise<ExamSetup> {
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const { bundle } = await fetchExamDeskFromDb();
  const activeTerms = new Set(
    bundle.terms.filter((t) => t.isActive && t.academicYearCode === ay).map((t) => t.id),
  );
  return {
    academicYearCode: ay,
    subjectNames: new Map(bundle.subjects.map((s) => [s.id, s.name])),
    slots: bundle.dateSheet
      .filter((d) => d.academicYearCode === ay && activeTerms.has(d.examTermId))
      .map((d) => ({
        date: d.date,
        classId: d.classId,
        subjectId: d.subjectId,
        note: d.note,
        startTime: d.startTime,
      })),
  };
}

/** This household's children in the running session, as the exam code sees them. */
export function eveChildrenOf(householdId: string, academicYearCode: string): EveChild[] {
  const sis = loadSis();
  const masters = loadMasters();
  const className = new Map((masters.classes ?? []).map((c) => [c.id, c.name]));
  return studentsInSession(sis, academicYearCode)
    .filter((s) => s.householdId === householdId && s.status === "active")
    .map((s) => ({
      studentId: s.id,
      name: s.fullName,
      classId: s.classId,
      className: className.get(s.classId) ?? "",
    }));
}

export function eveFamilyFor(hh: Household, academicYearCode: string): EveFamily {
  return {
    householdId: hh.id,
    guardianName: hh.guardianName || "",
    mobile: householdWhatsApp(hh) || hh.mobile || "",
    hindi: waTemplateLanguageFor(hh) === "hi",
    children: eveChildrenOf(hh.id, academicYearCode),
  };
}

/** Households already sent this exam date's message. */
async function alreadySent(examDate: string): Promise<Set<string>> {
  const ctx = await getServerTenantContext();
  if (!ctx) return new Set();
  // Sent from the evening before, so a window of 30 hours covers a re-run
  // at any time that evening without touching the previous exam day's sends.
  const since = new Date(new Date(`${examDate}T00:00:00+05:30`).getTime() - 30 * 3_600_000);
  const { data, error } = await ctx.sb
    .from("household_message_log")
    .select("household_id, preview")
    .eq("tenant_id", ctx.tenantId)
    .eq("purpose", EXAM_EVE_PURPOSE)
    .eq("status", "sent")
    .gte("created_at", since.toISOString());
  if (error) {
    // Unknown is not "nobody has been sent it": refuse the whole run rather
    // than message every family a second time.
    throw new Error(`exam-eve ledger unreadable: ${error.message}`);
  }
  const out = new Set<string>();
  for (const r of (data ?? []) as { household_id: string | null; preview: string | null }[]) {
    if (r.household_id && (r.preview ?? "").includes(`[${examDate}]`)) out.add(r.household_id);
  }
  return out;
}

export type ExamEveResult = {
  examDate: string | null;
  families: number;
  sent: number;
  freeText: number;
  template: number;
  skipped: string[];
  failed: string[];
  preview: { household: string; mobile: string; language: string; body: string }[];
};

/**
 * Send tomorrow's papers to every family with a child sitting one.
 *
 * `dryRun` builds everything and sends nothing — it is how the office reads
 * tonight's messages before they go.
 */
export async function runExamEveSweep(opts: {
  dryRun?: boolean;
  now?: Date;
  /** Force a specific exam date (testing / a missed evening). */
  examDate?: string;
}): Promise<ExamEveResult> {
  const now = opts.now ?? new Date();
  const today = istTodayIso(now.getTime());
  const setup = await loadExamSetup();

  // Tomorrow, or nothing. A sweep that ran on the 17th must not send the
  // 21st's papers just because the 21st is the next exam day.
  const examDate = opts.examDate ?? tomorrowIso(today);
  const result: ExamEveResult = {
    examDate,
    families: 0,
    sent: 0,
    freeText: 0,
    template: 0,
    skipped: [],
    failed: [],
    preview: [],
  };
  if (!setup.slots.some((s) => s.date === examDate)) {
    const next = nextExamDate(setup.slots, today);
    result.examDate = null;
    result.skipped.push(`no paper on ${examDate}${next ? ` — next exam day is ${next}` : ""}`);
    return result;
  }

  const sis = loadSis();
  const households = sis.households ?? [];
  const sentAlready = opts.dryRun ? new Set<string>() : await alreadySent(examDate);
  const mobiles = households.map((h) => householdWhatsApp(h) || h.mobile || "").filter(Boolean);
  const optedOut = await listOptedOutSet(mobiles);

  const templates = opts.dryRun ? null : await loadWaTemplatesServer();

  for (const hh of households) {
    // The fictional Play-review family (Rakesh Sharma, 9000000001) is live
    // in SIS so a Google reviewer can sign in. It must never be messaged —
    // the number is not a person.
    if (isReviewDemoHousehold(hh)) continue;
    const family = eveFamilyFor(hh, setup.academicYearCode);
    const vars = examEveVariables(family, setup.slots, setup.subjectNames, examDate);
    if (vars.empty) continue;
    result.families += 1;

    const who = `${family.guardianName || hh.id}`;
    if (!family.mobile) {
      result.skipped.push(`${who}: no WhatsApp number`);
      continue;
    }
    // The opt-out set is keyed "91XXXXXXXXXX", not by the stored 10 digits.
    const e164 = toE164India(family.mobile);
    if (e164 && optedOut.has(e164)) {
      result.skipped.push(`${who}: opted out`);
      continue;
    }
    if (sentAlready.has(hh.id)) {
      result.skipped.push(`${who}: already sent for ${examDate}`);
      continue;
    }

    const inWindow = await isWithin24HourWindow(family.mobile);
    const freeText = examEveFreeText(family, setup.slots, setup.subjectNames, examDate);
    const language = family.hindi ? "hi" : "en";

    if (opts.dryRun) {
      result.preview.push({
        household: who,
        mobile: family.mobile.slice(-4).padStart(10, "•"),
        language,
        body: inWindow
          ? freeText
          : `[template] ${vars.guardianName} · ${vars.examDay} · ${vars.childPapers}`,
      });
      continue;
    }

    // The ledger marker: the exam date in the preview, so the dedupe read
    // above can tell this evening's send from last evening's.
    const marker = `[${examDate}] `;

    if (inWindow) {
      const send = await sendWhatsAppText({
        toMobile: family.mobile,
        body: freeText,
        clientMessageId: `exameve:${examDate}:${hh.id}`,
      });
      await logHouseholdWaSend({
        mobile: family.mobile,
        purpose: EXAM_EVE_PURPOSE,
        via: "text",
        preview: (marker + freeText).slice(0, 200),
        status: send.ok ? "sent" : "failed",
        error: send.ok ? undefined : send.error,
        waMessageId: send.ok ? send.providerId : undefined,
      }).catch(() => undefined);
      if (send.ok) {
        result.sent += 1;
        result.freeText += 1;
        continue;
      }
      // Our window record can be a few minutes stale; fall through to the
      // template rather than leave the family without tomorrow's paper.
    }

    const resolved = resolveTemplateForSend({
      state: templates!,
      familyKey: FAMILY_KEY,
      language,
    });
    if (!resolved.ok) {
      // Not approved yet (or only in one language). Said once per family so
      // the office can see exactly who was missed and why.
      result.failed.push(`${who}: ${resolved.reason}`);
      continue;
    }
    const positions = templateVariablePositions(resolved.template, {
      guardianName: vars.guardianName,
      examDay: vars.examDay,
      childPapers: vars.childPapers,
    });
    const send = await sendWhatsAppTemplate({
      toMobile: family.mobile,
      name: resolved.template.metaName,
      language: resolved.template.metaLanguage || resolved.template.language,
      fromPhoneNumberId: resolved.sender?.phoneNumberId,
      // TEXT header with fixed words: body parameters only. A header
      // parameter here is refused as #132018.
      components: [
        {
          type: "body",
          parameters: Object.keys(positions)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => ({ type: "text", text: positions[k]! })),
        },
      ],
      clientMessageId: `exameve:${examDate}:${hh.id}`,
    });
    await logHouseholdWaSend({
      mobile: family.mobile,
      purpose: EXAM_EVE_PURPOSE,
      via: "template",
      templateName: resolved.template.metaName,
      preview: `${marker}${vars.examDay} · ${vars.childPapers}`.slice(0, 200),
      status: send.ok ? "sent" : "failed",
      error: send.ok ? undefined : send.error,
      waMessageId: send.ok ? send.providerId : undefined,
    }).catch(() => undefined);
    if (send.ok) {
      result.sent += 1;
      result.template += 1;
    } else {
      result.failed.push(`${who}: ${send.error}`);
    }
  }

  return result;
}

/* ─── The reply side: the button tap, and TIMETABLE ─────────────────── */

function istTimeLabel(iso: string, hindi: boolean): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  const hh = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const h12 = ((hh + 11) % 12) + 1;
  const ampm = hh < 12 ? "AM" : "PM";
  const dayMonth = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  return hindi ? `${dayMonth}, ${h12}:${mm} ${ampm} तक` : `until ${h12}:${mm} ${ampm} on ${dayMonth}`;
}

/**
 * Answer the exam-eve button or a TIMETABLE request. Returns null when the
 * message is neither, so the caller's normal bot carries on.
 *
 * The tap does, in order:
 *   1. finds each child's NEXT paper (tomorrow's, when tapped the evening
 *      before — which is what the message asked for);
 *   2. Nursery–UKG: practical tips for the parent, no tutor;
 *   3. school-age children: starts their one free day of the full tutor
 *      (once per child, ever — the table enforces it), then opens exam
 *      preparation on the first child's subject and asks the first question.
 *
 * The free day is announced plainly with the time it ends. What happens
 * after it ends is the tutor's ordinary pass message, said only when the
 * family next asks for something the free hints do not cover.
 */
export async function handleExamEveInbound(opts: {
  household: Household;
  children: import("@/lib/sis").SisStudent[];
  mobile10: string;
  text: string;
  now?: Date;
}): Promise<string | null> {
  const { isPracticeTap, isTimetableRequest, timetableReply, familyPapersOn, isPrePrimary, prePrimaryTips, practicePrompt } =
    await import("@/lib/examEve");
  const practice = isPracticeTap(opts.text);
  const timetable = !practice && isTimetableRequest(opts.text);
  if (!practice && !timetable) return null;

  const now = opts.now ?? new Date();
  const today = istTodayIso(now.getTime());
  const setup = await loadExamSetup();
  const family = eveFamilyFor(opts.household, setup.academicYearCode);
  const hindi = family.hindi;

  if (timetable) {
    return timetableReply(family, setup.slots, setup.subjectNames, today);
  }

  // The paper the tap is about: the next exam day AFTER today that one of
  // this family's children sits. Tapped before 8:30 on an exam morning, a
  // parent still means today's paper — so today counts until the paper starts.
  const istHour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  const fromDate = istHour < 9 ? today : tomorrowIso(today);
  const familyDates = [
    ...new Set(
      setup.slots
        .filter((s) => s.date >= fromDate && family.children.some((c) => c.classId === s.classId))
        .map((s) => s.date),
    ),
  ].sort();
  const date = familyDates[0];
  if (!date) {
    return hindi
      ? "इस परीक्षा के सभी पेपर हो चुके हैं। बच्चों को शुभकामनाएँ! 🙏\n\nपढ़ाई में मदद के लिए कभी भी *TUTOR* लिखें।"
      : "All papers of this exam are done. Well done to the children! 🙏\n\nReply *TUTOR* any time for study help.";
  }

  const papers = familyPapersOn(family, setup.slots, setup.subjectNames, date);
  const little = papers.filter((p) => isPrePrimary(p.child.className));
  const schoolAge = papers.filter((p) => !isPrePrimary(p.child.className));

  const parts: string[] = [];

  for (const p of little) {
    parts.push(prePrimaryTips(p.child, p.label, hindi));
  }

  if (schoolAge.length > 0) {
    const { startTutorTrial } = await import("@/lib/tutorPasses.server");
    const started: string[] = [];
    let runningUntil: string | null = null;
    for (const p of schoolAge) {
      const r = await startTutorTrial({
        householdId: family.householdId,
        studentId: p.child.studentId,
        source: `exam_eve:${date}`,
        now,
      });
      if (r.ok && r.started) {
        started.push(p.child.name);
        runningUntil = r.endsAt;
      } else if (r.ok && r.endsAt) {
        runningUntil = runningUntil ?? r.endsAt;
      }
    }

    if (started.length > 0 && runningUntil) {
      parts.push(
        hindi
          ? `🎁 *${started.join(", ")}* के लिए AI शिक्षक पूरी तरह *मुफ़्त* — ${istTimeLabel(runningUntil, true)}।\nपढ़ाना, उदाहरण, अभ्यास, उत्तर जाँचना — सब कुछ।`
          : `🎁 The full AI tutor is *free* for *${started.join(", ")}* ${istTimeLabel(runningUntil, false)}.\nTeaching, examples, practice, answer checking — everything.`,
      );
    } else if (runningUntil) {
      parts.push(
        hindi
          ? `🎁 मुफ़्त दिन चल रहा है — ${istTimeLabel(runningUntil, true)}।`
          : `🎁 Your free day is running ${istTimeLabel(runningUntil, false)}.`,
      );
    }

    const first = schoolAge[0]!;
    const { startExamPractice } = await import("@/lib/waTutorBot.server");
    const tutor = await startExamPractice({
      household: opts.household,
      children: opts.children,
      mobile10: opts.mobile10,
      studentId: first.child.studentId,
      prompt: practicePrompt(first.child, first.label, hindi),
    });
    parts.push(
      [
        hindi
          ? `📝 *${first.child.name} (${first.child.className}) — ${first.label}*`
          : `📝 *${first.child.name} (${first.child.className}) — ${first.label}*`,
        "",
        tutor.replyText,
      ].join("\n"),
    );

    // The tutor numbers children in the order the family's record lists
    // them; say which number reaches each sibling.
    const tutorOrder = opts.children.filter((s) => s.status === "active").map((s) => s.id);
    const others = schoolAge.slice(1).map((p) => {
      const n = tutorOrder.indexOf(p.child.studentId) + 1;
      return n > 0 ? `*TUTOR ${n}* — ${p.child.name} (${p.label})` : "";
    }).filter(Boolean);
    if (others.length > 0) {
      parts.push(
        (hindi ? "दूसरे बच्चे का अभ्यास:\n" : "Practice for the other child:\n") + others.join("\n"),
      );
    }

    parts.push(
      hindi
        ? "उत्तर सीधे यहीं लिखें। रोकने के लिए *TUTOR OFF*।"
        : "Type the answer right here. *TUTOR OFF* to stop.",
    );
  }

  return parts.join("\n\n");
}

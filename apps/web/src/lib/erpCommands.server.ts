/**
 * ERP command desk — server half.
 *
 * Runs inside the WhatsApp staff flows (owner / staff / teacher) before
 * the older keyword bots. Given one inbound message it:
 *
 *   1. transcribes a voice note when that is what arrived,
 *   2. honours the director's pause switch and the per-staff hourly cap,
 *   3. settles a pending confirm card (write commands),
 *   4. parses the message — regex first, model second, and only when the
 *      text looks like a command at all,
 *   5. checks RBAC exactly as the ERP screen would, with the sender's own
 *      staff record standing in for a signed-in session,
 *   6. resolves names to IDs against Masters, asking back when ambiguous,
 *   7. runs the command through the same data layer the app uses,
 *   8. writes an audit row carrying the original message,
 *
 * and returns text (plus optional buttons) for the caller to send. It never
 * sends anything itself, so the unified bot keeps one place that logs every
 * outbound line to the WhatsApp hub.
 *
 * `handled: false` means "not a command — carry on with whatever bot was
 * going to answer". That is the default, so nothing staff do today changes
 * unless the message clearly asks the ERP for something.
 */

import type { DemoSession } from "@/lib/auth";
import type { StaffRecord } from "@/lib/foundationMasters";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import {
  hasPermission,
  resolveSessionRoles,
  type RbacState,
} from "@/lib/rbac";
import { staffAllowedSections } from "@/lib/erpChatAccess";
import { loadServerMasters, loadServerRbac } from "@/lib/api/v1/auth";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { findRegister, loadAttendance, summarizeMarks } from "@/lib/attendance";
import { loadStaffAttendance } from "@/lib/staffAttendance";
import { ensureStaffAttendanceHydratedServer } from "@/lib/staffAttendancePersistence";
import { classifyClassHolidayDay } from "@/lib/holidayPolicy";
import { loadTimetable, teachingPeriods, WEEKDAY_SHORT } from "@/lib/timetable";
import { ensureTimetableHydratedServer } from "@/lib/timetablePersistence";
import {
  absentTeachersForDate,
  affectedPeriodsForDate,
  listSubstitutionsForDate,
} from "@/lib/timetableSubstitution";
import { isoDateWeekday } from "@/lib/examTimetable";
import { subjectLabel } from "@/lib/homework";
import { ensureStudentLeaveHydratedServer } from "@/lib/studentLeavePersistence";
import { ensureHomeworkHydratedServer } from "@/lib/homeworkPersistence";
import { loadHomework } from "@/lib/homework";
import {
  emptyStudentLeaveState,
  leaveDayCount,
  leaveTypeLabel,
  loadStudentLeave,
  pendingApproverHint,
  writeStudentLeaveLocalRaw,
} from "@/lib/studentLeave";
import { householdWhatsApp, loadSis, type SisStudent } from "@/lib/sis";
import { computeHouseholdDues, getDayCloseForDate, loadFees, openFeeDues } from "@/lib/fees";
import { flagFutureDues } from "@/lib/feeDueFuture";
import { listLiveDefaulters } from "@/lib/playbook";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { formatInr, loadMasters } from "@/lib/masters";
import { classLabel } from "@/lib/homework";
import { isOfficeLike } from "@/lib/erpChatAccess";
import { writeAudit } from "@/lib/audit.server";
import { istDateOf } from "@/lib/teaching";
import { TENANT } from "@/lib/types";
import type { WaInteractiveMenu } from "@/lib/waInteractive";
import {
  ERP_COMMANDS,
  ERP_COMMAND_LLM_MIN_CONFIDENCE,
  confirmButtonIds,
  confirmIsFresh,
  extractSectionRefs,
  findErpCommand,
  formatAbsentListReply,
  formatAttendanceSummaryReply,
  formatClassDefaultersReply,
  formatCollectionReply,
  formatFreeTeachersReply,
  formatHelpReply,
  formatHomeworkReply,
  formatPendingLeavesReply,
  periodAtTime,
  TENDER_MODE_LABEL,
  formatSectionProblem,
  formatStudentFeesReply,
  formatStudentMatchesAsk,
  looksLikeCommand,
  matchStudents,
  parseStudentFeesQuery,
  noteCommandUse,
  parseCommandsSwitch,
  parseConfirmReply,
  parseErpCommandLocal,
  resolveClassOrSectionRef,
  resolveCommandDate,
  resolveSectionRef,
  type ErpCommandDef,
  type ErpCommandFields,
  type ParsedErpCommand,
  type PendingErpConfirm,
  type SectionMatch,
} from "@/lib/erpCommands";

export type ErpCommandFlow = "owner" | "staff" | "teacher";

export type ErpCommandChannel = "whatsapp" | "app";

export type ErpCommandInbound = {
  /**
   * Who is talking, as a stable key for pending confirms and the hourly
   * cap: the 10-digit mobile on WhatsApp, `staff:<id>` from the app.
   */
  actorKey: string;
  channel: ErpCommandChannel;
  text: string;
  flow: ErpCommandFlow;
  staff: StaffRecord | null;
  displayName: string;
  /** Voice note, when the message had no text (WhatsApp only). */
  audio?: { mediaId: string; mimeType?: string } | null;
};

export type ErpCommandResult =
  | { handled: false }
  | {
      handled: true;
      audience: string;
      text?: string;
      /** WhatsApp rendering of a confirm card. */
      menu?: { menu: WaInteractiveMenu; textFallback: string };
      /** Channel-neutral confirm card, for the app to draw its own buttons. */
      confirm?: { token: string; summary: string; yesId: string; noId: string };
    };

type CommandStore = {
  version: 1;
  paused: boolean;
  pausedBy: string;
  pausedAt: string;
  pending: Record<string, PendingErpConfirm>;
  usage: Record<string, number[]>;
  /** IST date the director's daily digest last went out for. */
  digestSentFor?: string;
};

let memoryStore: CommandStore = {
  version: 1,
  paused: false,
  pausedBy: "",
  pausedAt: "",
  pending: {},
  usage: {},
};

async function readStore(): Promise<CommandStore> {
  const { loadWaBotSlice } = await import("@/lib/waBotStore.server");
  const remote = await loadWaBotSlice<CommandStore>("commands", memoryStore);
  if (remote?.version === 1) {
    memoryStore = {
      ...remote,
      pending: remote.pending ?? {},
      usage: remote.usage ?? {},
    };
  }
  return memoryStore;
}

async function writeStore(store: CommandStore): Promise<void> {
  memoryStore = store;
  const { saveWaBotSlice } = await import("@/lib/waBotStore.server");
  await saveWaBotSlice("commands", store);
}

/** Pause state and digest bookkeeping, for the daily digest job. */
export async function readCommandDeskState(): Promise<{
  paused: boolean;
  pausedBy: string;
  digestSentFor: string | null;
}> {
  const st = await readStore();
  return { paused: st.paused, pausedBy: st.pausedBy, digestSentFor: st.digestSentFor ?? null };
}

export async function markCommandDigestSent(date: string): Promise<void> {
  const st = await readStore();
  await writeStore({ ...st, digestSentFor: date });
}

/** Env kill switch — `ERP_WA_COMMANDS=off` disables the branch entirely. */
export function erpCommandsEnabledByEnv(): boolean {
  const v = (process.env.ERP_WA_COMMANDS || "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no");
}

/**
 * A staff record standing in for a signed-in session. roleCode stays empty
 * exactly as the staff login route leaves it — RBAC resolves the role from
 * the roster record (assignments, then designation), never from a string a
 * message could influence.
 */
export function staffSessionFor(
  staff: StaffRecord,
  masters: MastersState,
): DemoSession {
  return {
    persona: "staff",
    fullName: staff.fullName,
    roleCode: "",
    email: staff.email || undefined,
    staffId: staff.id,
    tenantSlug: TENANT.slug,
    academicYearCode: currentAcademicYearCode(masters),
  };
}

function allowedCommandsFor(
  session: DemoSession,
  masters: MastersState,
  rbac: RbacState,
): ErpCommandDef[] {
  return ERP_COMMANDS.filter((c) =>
    hasPermission(session, masters, c.module, c.action, rbac),
  );
}

async function transcribeVoiceNote(audio: {
  mediaId: string;
  mimeType?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const { fetchWaMediaAsDataUrl } = await import("@/lib/waInboundMedia.server");
  const { googleSpeechToText, speechConfigured } = await import(
    "@/lib/googleSpeech.server"
  );
  if (!speechConfigured()) {
    return { ok: false, error: "Speech recognition is not configured" };
  }
  const media = await fetchWaMediaAsDataUrl(audio.mediaId);
  if (!media.ok) return media;
  return googleSpeechToText({
    audioBase64: media.dataUrl,
    mimeType: media.mimeType || audio.mimeType,
    languageCode: "hi-IN",
  });
}

function random(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Entry point. See the file header for the order of checks.
 */
export async function handleErpStaffCommand(
  inbound: ErpCommandInbound,
): Promise<ErpCommandResult> {
  if (!erpCommandsEnabledByEnv()) return { handled: false };

  const nowMs = Date.now();
  const todayIso = istDateOf();
  let store = await readStore();

  // 1. Voice note → text. Only staff reach this branch, so the speech
  //    cost is bounded to people who may give commands at all.
  let text = (inbound.text || "").trim();
  let fromVoice = false;
  if (!text && inbound.audio?.mediaId) {
    const t = await transcribeVoiceNote(inbound.audio);
    if (!t.ok) {
      return {
        handled: true,
        audience: "erp_command_voice",
        text: "I couldn't make out that voice note. Please type the command, e.g. _5A me aaj kaun absent hai_.",
      };
    }
    text = t.text.trim();
    fromVoice = true;
  }
  if (!text) return { handled: false };

  const actor = inbound.actorKey;

  // 2a. Director pause switch.
  const sw = parseCommandsSwitch(text);
  if (sw) {
    if (inbound.flow !== "owner") {
      return {
        handled: true,
        audience: "erp_command_switch",
        text: "Only the director can pause or resume commands.",
      };
    }
    store = {
      ...store,
      paused: sw === "off",
      pausedBy: sw === "off" ? inbound.displayName || actor : "",
      pausedAt: sw === "off" ? new Date().toISOString() : "",
    };
    await writeStore(store);
    return {
      handled: true,
      audience: "erp_command_switch",
      text:
        sw === "off"
          ? "ERP commands are paused for all staff. Send *commands on* to resume."
          : "ERP commands are back on.",
    };
  }

  // 3. Pending confirm card (write commands).
  const pending = store.pending[actor] ?? null;
  const decision = parseConfirmReply(text, pending, {
    // A teacher's plain "yes" belongs to the class-channel draft flow.
    allowPlainWords: inbound.flow !== "teacher",
  });
  if (decision) {
    if (!pending || pending.token !== decision.token) {
      return {
        handled: true,
        audience: "erp_command_confirm",
        text: "That confirmation has already been used or was for something else. Send the command again.",
      };
    }
    const rest = { ...store.pending };
    delete rest[actor];
    store = { ...store, pending: rest };
    await writeStore(store);
    if (decision.decision === "no") {
      return { handled: true, audience: "erp_command_confirm", text: "Cancelled. Nothing was changed." };
    }
    if (!confirmIsFresh(pending, nowMs)) {
      return {
        handled: true,
        audience: "erp_command_confirm",
        text: "That confirmation expired (5 minutes). Send the command again and confirm sooner.",
      };
    }
    return runConfirmedWrite(inbound, pending);
  }

  // 4. Parse — regex first, then the model, only for command-shaped text.
  let parsed: ParsedErpCommand | null = parseErpCommandLocal(text);

  // Paused: answer anything command-shaped without spending a model call,
  // and leave everything else to the bots that were going to answer it.
  if (store.paused) {
    if (!parsed && !looksLikeCommand(text)) return { handled: false };
    return {
      handled: true,
      audience: "erp_command_paused",
      text: `ERP commands are paused${store.pausedBy ? ` by ${store.pausedBy}` : ""}. The director can send *commands on* to resume.`,
    };
  }

  // On WhatsApp the older bots still answer whatever this is not, so only
  // command-shaped text is worth a model call. In the app the bar exists
  // for commands alone, so anything beyond a stray tap gets the parser.
  const worthParsing =
    inbound.channel === "app" ? text.length >= 4 && text.length <= 300 : looksLikeCommand(text);
  if (!parsed && worthParsing) {
    const { generateErpCommandJson } = await import("@/lib/aiLlm.server");
    const r = await generateErpCommandJson({
      text,
      commands: ERP_COMMANDS,
      todayIso,
    });
    if (
      r.ok &&
      r.parse.command !== "none" &&
      r.parse.confidence >= ERP_COMMAND_LLM_MIN_CONFIDENCE
    ) {
      parsed = {
        commandId: r.parse.command,
        fields: {
          section: r.parse.section,
          date: r.parse.date,
          text: r.parse.text,
          student: r.parse.student,
        },
        source: "llm",
      };
    }
  }
  if (!parsed) return { handled: false };

  // 2b. Hourly cap per staff member.
  const use = noteCommandUse(store.usage[actor], nowMs);
  store = { ...store, usage: { ...store.usage, [actor]: use.history } };
  await writeStore(store);
  if (!use.allowed) {
    return {
      handled: true,
      audience: "erp_command_limited",
      text: "That's a lot of commands this hour. Please try again a little later, or open the ERP.",
    };
  }

  const command = findErpCommand(parsed.commandId);
  if (!command) return { handled: false };

  // 5. Identity → session → RBAC.
  if (!inbound.staff) {
    return {
      handled: true,
      audience: "erp_command_denied",
      text: "Your number isn't linked to a staff record in the ERP, so commands aren't available. Ask the office to add your mobile to your staff profile.",
    };
  }
  const [masters, rbac] = await Promise.all([loadServerMasters(), loadServerRbac()]);
  const session = staffSessionFor(inbound.staff, masters);
  const allowed = allowedCommandsFor(session, masters, rbac);

  if (command.id === "commands_digest") {
    if (inbound.flow !== "owner") {
      void audit(session, command, parsed.fields, text, "denied", {
        reason: "rbac",
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "The command desk report is for the director.",
      };
    }
    const { composeCommandDigestForDate } = await import("@/lib/erpCommandsDigest.server");
    const digest = await composeCommandDigestForDate(todayIso);
    void audit(session, command, parsed.fields, text, "ok", { channel: inbound.channel });
    return { handled: true, audience: "erp_command_commands_digest", text: digest.text };
  }

  if (command.id === "help") {
    return {
      handled: true,
      audience: "erp_command_help",
      text: formatHelpReply(
        allowed.filter((c) => c.id !== "help"),
        inbound.staff.fullName.split(" ")[0] || inbound.displayName,
      ),
    };
  }

  if (!allowed.some((c) => c.id === command.id)) {
    void audit(session, command, parsed.fields, text, "denied", {
      reason: "rbac",
      channel: inbound.channel,
    });
    return {
      handled: true,
      audience: "erp_command_denied",
      text: `Your role doesn't include *${command.module} · ${command.action}* in the ERP, so I can't run that. Ask the office or principal if you need it.`,
    };
  }

  // 6. Resolve fields.
  const resolved: Record<string, string> = {};
  let sectionMatch: SectionMatch | null = null;
  if (command.id === "class_defaulters") {
    const askedRaw = parsed.fields.section || "";
    const refs = extractSectionRefs(askedRaw || text);
    if (!refs.length) {
      return { handled: true, audience: "erp_command_ask", text: "Which class? e.g. _class 3 defaulters_ or _5A defaulters_." };
    }
    const res = resolveClassOrSectionRef(refs[0]!, masters);
    if (!res.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: formatSectionProblem(res.reason, res.options, askedRaw || text),
      };
    }
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    let sections = res.sections;
    let limitedTo: string[] | undefined;
    if (!isOfficeLike(roleCodes) && !roleCodes.includes("accounts")) {
      const mine = new Set(
        staffAllowedSections(inbound.staff, masters, session.academicYearCode, roleCodes).map((s) => s.sectionId),
      );
      const allowed = res.sections.filter((s) => mine.has(s.sectionId));
      if (!allowed.length) {
        void audit(session, command, parsed.fields, text, "denied", {
          reason: "scope",
          classId: res.classId,
          channel: inbound.channel,
        });
        return {
          handled: true,
          audience: "erp_command_denied",
          text: formatSectionProblem("not_allowed", [], res.wholeClass ? res.className : res.sections[0]!.label),
        };
      }
      if (allowed.length < res.sections.length) limitedTo = allowed.map((s) => s.label);
      sections = allowed;
    }
    resolved.classId = res.classId;
    resolved.title = res.wholeClass ? `Class ${res.className}` : res.sections[0]!.label;
    resolved.wholeClass = res.wholeClass ? "1" : "";
    resolved.sectionIds = sections.map((s) => s.sectionId).join(",");
    if (limitedTo) resolved.limitedTo = limitedTo.join("|");
  } else if (command.fields.some((f) => f.type === "section")) {
    const askedRaw = parsed.fields.section || "";
    const refs = extractSectionRefs(askedRaw || text);
    if (!refs.length) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Which class and section? e.g. _5A_ or _VIII B_.",
      };
    }
    const res = resolveSectionRef(refs[0]!, masters);
    if (!res.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: formatSectionProblem(res.reason, res.options, askedRaw || text),
      };
    }
    sectionMatch = res.match;
    if (command.scope === "own_sections") {
      const roleCodes = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
      const mine = staffAllowedSections(
        inbound.staff,
        masters,
        session.academicYearCode,
        roleCodes,
      );
      if (!mine.some((s) => s.sectionId === sectionMatch!.sectionId)) {
        void audit(session, command, parsed.fields, text, "denied", {
          reason: "scope",
          sectionId: sectionMatch.sectionId,
          channel: inbound.channel,
        });
        return {
          handled: true,
          audience: "erp_command_denied",
          text: formatSectionProblem(
            "not_allowed",
            mine.map((s) => ({
              classId: s.classId,
              sectionId: s.sectionId,
              className: s.className,
              sectionName: s.sectionName,
              label: s.label,
            })),
            sectionMatch.label,
          ),
        };
      }
    }
    resolved.classId = sectionMatch.classId;
    resolved.sectionId = sectionMatch.sectionId;
    resolved.sectionLabel = sectionMatch.label;
  }
  if (command.fields.some((f) => f.type === "student")) {
    const asked = (parsed.fields.student || text).trim();
    const q = parseStudentFeesQuery(`${asked} fees`) ?? { name: asked };
    const sis = loadSis();
    const ay = session.academicYearCode;
    let sectionId: string | null = null;
    if (q.section) {
      const res = resolveSectionRef(q.section, masters);
      if (res.ok) sectionId = res.match.sectionId;
    }
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    const mine = staffAllowedSections(inbound.staff, masters, ay, roleCodes);
    const mineIds = new Set(mine.map((s) => s.sectionId));
    const matches = matchStudents(q, sis.students, { academicYearCode: ay, sectionId });
    const label = (st: SisStudent) => classLabel(masters, st.classId, st.sectionId);
    if (matches.length !== 1) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: formatStudentMatchesAsk(
          matches.map((m) => ({
            fullName: m.student.fullName,
            classLabel: label(m.student),
            rollNo: m.student.rollNo,
          })),
          asked,
        ),
      };
    }
    const student = matches[0]!.student;
    if (command.scope === "own_sections" && !mineIds.has(student.sectionId)) {
      void audit(session, command, parsed.fields, text, "denied", {
        reason: "scope",
        studentId: student.id,
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: `${student.fullName} is in ${label(student)}, which isn't one of your sections. Ask the fee desk or principal.`,
      };
    }
    resolved.studentId = student.id;
    resolved.studentName = student.fullName;
    resolved.detail = isOfficeLike(roleCodes) || roleCodes.includes("accounts") ? "full" : "basic";
  }
  if (command.id === "collection_today") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    if (!isOfficeLike(roleCodes) && !roleCodes.includes("accounts")) {
      void audit(session, command, parsed.fields, text, "denied", {
        reason: "scope",
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "The collection report is for the fee desk, office and leadership.",
      };
    }
  }
  if (command.id === "homework_posted") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    const office = isOfficeLike(roleCodes);
    const mine = office ? [] : staffAllowedSections(inbound.staff, masters, session.academicYearCode, roleCodes);
    const askedRaw = parsed.fields.section || "";
    const refs = askedRaw ? extractSectionRefs(askedRaw) : [];
    if (refs.length) {
      const res = resolveSectionRef(refs[0]!, masters);
      if (!res.ok) {
        return { handled: true, audience: "erp_command_ask", text: formatSectionProblem(res.reason, res.options, askedRaw) };
      }
      if (!office && !mine.some((s) => s.sectionId === res.match.sectionId)) {
        void audit(session, command, parsed.fields, text, "denied", { reason: "scope", channel: inbound.channel });
        return {
          handled: true,
          audience: "erp_command_denied",
          text: formatSectionProblem("not_allowed", mine.map((s) => ({ classId: s.classId, sectionId: s.sectionId, className: s.className, sectionName: s.sectionName, label: s.label })), res.match.label),
        };
      }
      resolved.classId = res.match.classId;
      resolved.sectionId = res.match.sectionId;
      resolved.sectionLabel = res.match.label;
    } else if (office) {
      resolved.scope = "school";
    } else {
      if (!mine.length) {
        return { handled: true, audience: "erp_command_denied", text: "Homework is shown for your own sections; you have none linked. Ask the office to link your classes." };
      }
      resolved.scope = "mine";
      resolved.sectionIds = mine.map((s) => s.sectionId).join(",");
    }
  }
  if (command.id === "pending_leaves") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    const office = isOfficeLike(roleCodes);
    const mine = office
      ? []
      : staffAllowedSections(inbound.staff, masters, session.academicYearCode, roleCodes);
    const askedRaw = parsed.fields.section || "";
    const refs = askedRaw ? extractSectionRefs(askedRaw) : [];
    if (refs.length) {
      const res = resolveClassOrSectionRef(refs[0]!, masters);
      if (!res.ok) {
        return { handled: true, audience: "erp_command_ask", text: formatSectionProblem(res.reason, res.options, askedRaw) };
      }
      let sections = res.sections;
      if (!office) {
        const mineIds = new Set(mine.map((s) => s.sectionId));
        sections = sections.filter((s) => mineIds.has(s.sectionId));
        if (!sections.length) {
          void audit(session, command, parsed.fields, text, "denied", { reason: "scope", channel: inbound.channel });
          return {
            handled: true,
            audience: "erp_command_denied",
            text: formatSectionProblem("not_allowed", mine.map((s) => ({ classId: s.classId, sectionId: s.sectionId, className: s.className, sectionName: s.sectionName, label: s.label })), res.wholeClass ? res.className : res.sections[0]!.label),
          };
        }
      }
      resolved.scope = "section";
      resolved.scopeLabel = res.wholeClass ? `Class ${res.className}` : sections[0]!.label;
      resolved.sectionIds = sections.map((s) => s.sectionId).join(",");
    } else if (office) {
      resolved.scope = "school";
    } else {
      if (!mine.length) {
        return {
          handled: true,
          audience: "erp_command_denied",
          text: "Leave requests are shown to class teachers for their sections, and to the office and leadership for the school.",
        };
      }
      resolved.scope = "mine";
      resolved.sectionIds = mine.map((s) => s.sectionId).join(",");
    }
  }
  if (command.id === "free_teachers") {
    resolved.period = (parsed.fields.text || "now").trim().toLowerCase();
  }
  if (command.id === "attendance_summary") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    if (isOfficeLike(roleCodes)) {
      resolved.scope = "school";
    } else {
      const mine = staffAllowedSections(inbound.staff, masters, session.academicYearCode, roleCodes);
      if (!mine.length) {
        return {
          handled: true,
          audience: "erp_command_denied",
          text: "The school-wide attendance summary is for the office and leadership. You can ask for your own section, e.g. _5A me aaj kaun absent hai_.",
        };
      }
      resolved.scope = "mine";
      resolved.sectionIds = mine.map((s) => s.sectionId).join(",");
    }
  }
  if (command.fields.some((f) => f.type === "date")) {
    resolved.date =
      parsed.fields.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.fields.date)
        ? parsed.fields.date
        : resolveCommandDate(text, todayIso);
  }

  // 7. Write commands stop here and wait for the card.
  if (command.kind === "write") {
    const token = random();
    const summary = `${command.title} — ${Object.entries(resolved)
      .filter(([k]) => !/Id$/.test(k))
      .map(([, v]) => v)
      .join(" · ")}`;
    store = {
      ...store,
      pending: {
        ...store.pending,
        [actor]: {
          token,
          commandId: command.id,
          fields: parsed.fields,
          resolved,
          summary,
          createdAt: new Date().toISOString(),
          originalText: text,
        },
      },
    };
    await writeStore(store);
    const ids = confirmButtonIds(token);
    const body = `${summary}\n\nRun this?`;
    return {
      handled: true,
      audience: "erp_command_confirm",
      text: body,
      confirm: { token, summary, yesId: ids.yes, noId: ids.no },
      menu: {
        menu: {
          kind: "buttons",
          body,
          footer: "Expires in 5 minutes",
          buttons: [
            { id: ids.yes, title: "Confirm" },
            { id: ids.no, title: "Cancel" },
          ],
        },
        textFallback: `${body} Reply YES to confirm or NO to cancel.`,
      },
    };
  }

  // 8. Read commands run at once.
  const reply = await runReadCommand(command, resolved, session, todayIso);
  void audit(session, command, parsed.fields, text, "ok", {
    ...resolved,
    source: parsed.source,
    voice: fromVoice,
    channel: inbound.channel,
  });
  return { handled: true, audience: `erp_command_${command.id}`, text: reply };
}

async function runReadCommand(
  command: ErpCommandDef,
  resolved: Record<string, string>,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  switch (command.id) {
    case "absent_list":
      return absentList(resolved, session, todayIso);
    case "student_fees":
      return studentFees(resolved, session, todayIso);
    case "attendance_summary":
      return attendanceSummary(resolved, session, todayIso);
    case "class_defaulters":
      return classDefaulters(resolved, session, todayIso);
    case "collection_today":
      return collectionToday(resolved, session, todayIso);
    case "free_teachers":
      return freeTeachers(resolved, resolved.period || "now", session, todayIso);
    case "pending_leaves":
      return pendingLeaves(resolved, session, todayIso);
    case "homework_posted":
      return homeworkPosted(resolved, session, todayIso);
    default:
      return "That command isn't wired up yet.";
  }
}

async function absentList(
  resolved: Record<string, string>,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  await ensureAttendanceHydratedServer();
  const ay = session.academicYearCode;
  const sis = loadSis();
  const students = sis.students.filter(
    (s) =>
      s.status === "active" &&
      s.classId === resolved.classId &&
      s.sectionId === resolved.sectionId &&
      s.academicYearCode === ay,
  );
  const register = findRegister(ay, resolved.sectionId!, resolved.date!, loadAttendance());
  const byId = new Map(students.map((s) => [s.id, s]));
  const pick = (status: string) =>
    (register?.marks ?? [])
      .filter((m) => m.status === status && byId.has(m.studentId))
      .map((m) => ({
        rollNo: byId.get(m.studentId)!.rollNo,
        fullName: byId.get(m.studentId)!.fullName,
      }));
  return formatAbsentListReply({
    sectionLabel: resolved.sectionLabel || "",
    date: resolved.date!,
    todayIso,
    marked: !!register,
    total: students.length,
    absent: pick("A"),
    leave: pick("LE"),
    late: pick("L"),
    halfDay: pick("HD"),
  });
}

async function attendanceSummary(
  resolved: Record<string, string>,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  const school = resolved.scope === "school";
  await Promise.all([
    ensureAttendanceHydratedServer(),
    school ? ensureStaffAttendanceHydratedServer() : Promise.resolve(false),
  ]);
  const ay = session.academicYearCode;
  const date = resolved.date || todayIso;
  const masters = loadMasters();
  const sis = loadSis();
  const att = loadAttendance();
  const onlyIds = resolved.sectionIds ? new Set(resolved.sectionIds.split(",")) : null;
  const regs = (att.registers ?? []).filter((r) => r.academicYearCode === ay && r.date === date);
  const regBySection = new Map(regs.map((r) => [r.sectionId, r]));
  const studentsBySection = new Map<string, number>();
  for (const st of sis.students) {
    if (st.status !== "active" || st.academicYearCode !== ay) continue;
    studentsBySection.set(st.sectionId, (studentsBySection.get(st.sectionId) ?? 0) + 1);
  }
  const classes = [...masters.classes]
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => ({
      className: c.name,
      sections: masters.sections
        .filter((s) => s.classId === c.id && s.isActive !== false && (!onlyIds || onlyIds.has(s.id)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => {
          const reg = regBySection.get(s.id);
          const sum = reg ? summarizeMarks(reg.marks || []) : null;
          const total = studentsBySection.get(s.id) ?? (sum?.total ?? 0);
          return {
            label: classLabel(masters, c.id, s.id).replace(" · ", " "),
            total,
            marked: !!reg,
            holiday: !reg && classifyClassHolidayDay(masters, date, ay, c.id).status === "holiday",
            present: sum?.present ?? 0,
            absent: sum?.absent ?? 0,
            leave: sum?.leave ?? 0,
            late: sum?.late ?? 0,
            halfDay: sum?.halfDay ?? 0,
          };
        }),
    }))
    .filter((c) => c.sections.length > 0);

  let staff: Parameters<typeof formatAttendanceSummaryReply>[0]["staff"] = null;
  if (school) {
    const active = (masters.staff ?? []).filter((s) => s.status === "active");
    const reg = (loadStaffAttendance().registers ?? []).find(
      (r) => r.date === date && r.academicYearCode === ay,
    );
    const marks = new Map((reg?.marks ?? []).map((m) => [m.staffId, m.status]));
    staff = {
      activeStaff: active.length,
      registerMarked: !!reg,
      present: active.filter((s) => ["P", "L", "HD"].includes(marks.get(s.id) ?? "")).length,
      absent: active.filter((s) => marks.get(s.id) === "A").length,
      leave: active.filter((s) => marks.get(s.id) === "LE").length,
      notPunched: active
        .filter((s) => !marks.has(s.id))
        .map((s) => s.fullName.split(" ").slice(0, 2).join(" "))
        .sort(),
    };
  }
  return formatAttendanceSummaryReply({
    date,
    todayIso,
    scope: school ? "school" : "mine",
    classes,
    staff,
  });
}

async function homeworkPosted(
  resolved: Record<string, string>,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  await ensureHomeworkHydratedServer();
  const ay = session.academicYearCode;
  const date = resolved.date || todayIso;
  const masters = loadMasters();
  const posts = loadHomework().posts.filter(
    (p) => p.academicYearCode === ay && p.date === date && p.status === "published",
  );
  const teacherName = (id: string, fallback: string) =>
    (masters.staff ?? []).find((st) => st.id === id)?.fullName || fallback || "—";
  if (resolved.sectionId) {
    const mine = posts
      .filter((p) => p.sectionId === resolved.sectionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const subjectTeachers = (masters.staff ?? [])
      .filter((st) => st.status === "active")
      .flatMap((st) =>
        (st.subjectTeachingLinks ?? [])
          .filter(
            (l) =>
              (!l.academicYearCode || l.academicYearCode === ay) &&
              l.classId === resolved.classId &&
              (!l.sectionId || l.sectionId === resolved.sectionId),
          )
          .map((l) => ({ subject: subjectLabel(masters, l.subjectId), teacher: st.fullName })),
      )
      .sort((a, b) => a.subject.localeCompare(b.subject));
    return formatHomeworkReply({
      kind: "section",
      sectionLabel: (resolved.sectionLabel || "").replace(" · ", " "),
      date,
      todayIso,
      posts: mine.map((p) => ({
        subject: subjectLabel(masters, p.subjectId),
        title: p.title,
        teacher: teacherName(p.teacherStaffId, p.teacherName),
        dueAt: p.dueAt || "",
        requiresSubmit: !!p.requiresSubmit,
      })),
      subjectTeachers,
    });
  }
  const only = resolved.sectionIds ? new Set(resolved.sectionIds.split(",").filter(Boolean)) : null;
  const sections = [...masters.classes]
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .flatMap((c) =>
      masters.sections
        .filter((sct) => sct.classId === c.id && sct.isActive !== false && (!only || only.has(sct.id)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((sct) => {
          const here = posts.filter((p) => p.sectionId === sct.id);
          return {
            label: classLabel(masters, c.id, sct.id).replace(" · ", " "),
            count: here.length,
            subjects: [...new Set(here.map((p) => subjectLabel(masters, p.subjectId)))],
          };
        }),
    );
  return formatHomeworkReply({
    kind: "overview",
    scope: resolved.scope === "school" ? "school" : "mine",
    date,
    todayIso,
    sections,
  });
}

async function pendingLeaves(
  resolved: Record<string, string>,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  // Same reset-then-hydrate the app's leave list does, so the answer is what
  // the database holds rather than what an earlier request left cached.
  writeStudentLeaveLocalRaw(emptyStudentLeaveState());
  await ensureStudentLeaveHydratedServer();
  const ay = session.academicYearCode;
  const sis = loadSis();
  const masters = loadMasters();
  const only = resolved.sectionIds ? new Set(resolved.sectionIds.split(",").filter(Boolean)) : null;
  const byId = new Map(sis.students.map((st) => [st.id, st]));
  const inScope = (studentId: string) => {
    const st = byId.get(studentId);
    if (!st) return false;
    return !only || only.has(st.sectionId);
  };
  const all = loadStudentLeave().requests.filter(
    (r) => r.academicYearCode === ay && inScope(r.studentId),
  );
  const rows = all
    .filter((r) => r.status === "pending")
    .map((r) => {
      const st = byId.get(r.studentId)!;
      return {
        studentName: st.fullName,
        classLabel: classLabel(masters, st.classId, st.sectionId).replace(" · ", " "),
        rollNo: st.rollNo,
        fromDate: r.fromDate,
        toDate: r.toDate || r.fromDate,
        days: leaveDayCount(r),
        typeLabel: leaveTypeLabel(r.leaveType),
        reason: r.reason || "",
        requestedAt: r.createdAt,
        approver: pendingApproverHint(r).replace(/\s*\(.*\)$/, ""),
      };
    });
  const approvedToday = all.filter(
    (r) => r.status === "approved" && r.fromDate <= todayIso && (r.toDate || r.fromDate) >= todayIso,
  ).length;
  return formatPendingLeavesReply({
    todayIso,
    scope: (resolved.scope as "school" | "mine" | "section") || "school",
    scopeLabel: resolved.scopeLabel,
    rows,
    approvedToday,
  });
}

function istHhmm(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
}

async function freeTeachers(
  resolved: Record<string, string>,
  periodAsk: string,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  await Promise.all([ensureTimetableHydratedServer(), ensureStaffAttendanceHydratedServer()]);
  const ay = session.academicYearCode;
  const date = resolved.date || todayIso;
  const masters = loadMasters();
  const state = loadTimetable();
  const periods = teachingPeriods(state.bellTemplate);
  if (!periods.length) return "No bell timetable is set up yet (Timetable → Bell template).";
  const weekday = isoDateWeekday(date);
  if (weekday == null) return "I couldn't read that date.";
  if (state.workingWeekdays?.length && !state.workingWeekdays.includes(weekday)) {
    return `${WEEKDAY_SHORT[weekday]} ${date === todayIso ? "(today)" : date} is not a working day on the timetable.`;
  }
  const periodList = periods.map((p) => `${p.no} (${p.startTime}–${p.endTime})`).join(", ");
  let periodNo: number;
  const ask = (periodAsk || "").trim().toLowerCase();
  if (ask === "now" || ask === "next") {
    const at = periodAtTime(periods, istHhmm(), ask);
    if (!at) return "I couldn't work out the current period.";
    if ("before" in at) return `School hasn't started yet. Periods today: ${periodList}. Ask e.g. _who is free in period 1_.`;
    if ("after" in at) return `Periods are over for today. Periods: ${periodList}. Ask e.g. _who is free in period 3 tomorrow_.`;
    periodNo = at.no;
  } else {
    const n = parseInt(ask, 10);
    if (!Number.isFinite(n) || !periods.some((p) => p.no === n)) {
      return `Which period? Today has ${periodList}.`;
    }
    periodNo = n;
  }
  const bell = periods.find((p) => p.no === periodNo)!;

  const absent = absentTeachersForDate(masters, ay, date);
  const absentIds = new Set(absent.map((a) => a.staffId));
  const grids = state.grids.filter((g) => g.academicYearCode === ay);
  const busy = new Set<string>();
  const dayLoad = new Map<string, number>();
  for (const g of grids) {
    for (const sl of g.slots) {
      if (!sl.teacherId || sl.weekday !== weekday) continue;
      dayLoad.set(sl.teacherId, (dayLoad.get(sl.teacherId) ?? 0) + 1);
      if (sl.periodNo === periodNo) busy.add(sl.teacherId);
    }
  }
  const subs = listSubstitutionsForDate(ay, date, state);
  const subLoad = new Map<string, number>();
  for (const sb of subs) {
    subLoad.set(sb.substituteTeacherId, (subLoad.get(sb.substituteTeacherId) ?? 0) + 1);
    if (sb.periodNo === periodNo) busy.add(sb.substituteTeacherId);
  }
  const toMin = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(v);
    return m ? parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10) : NaN;
  };
  for (const b of state.teacherTimeBlocks ?? []) {
    if (b.date !== date || b.academicYearCode !== ay) continue;
    if (toMin(b.startTime) < toMin(bell.endTime) && toMin(b.endTime) > toMin(bell.startTime)) busy.add(b.staffId);
  }
  const designationName = (id: string | null) =>
    (masters.designations ?? []).find((d) => d.id === id)?.name || "";
  const teaching = (masters.staff ?? []).filter(
    (st) =>
      st.status === "active" &&
      ((st.classTeacherLinks ?? []).length > 0 ||
        (st.subjectTeachingLinks ?? []).length > 0 ||
        st.stream === "teaching" ||
        dayLoad.has(st.id)),
  );
  const free = teaching
    .filter((st) => !busy.has(st.id) && !absentIds.has(st.id))
    .map((st) => ({
      name: st.fullName,
      dayLoad: dayLoad.get(st.id) ?? 0,
      subLoad: subLoad.get(st.id) ?? 0,
      designation: designationName(st.designationId),
    }));

  const staffName = (id: string) => (masters.staff ?? []).find((st) => st.id === id)?.fullName || "—";
  const affected = affectedPeriodsForDate({ state, academicYearCode: ay, date, absentTeacherIds: [...absentIds] })
    .filter((a) => a.periodNo === periodNo && !a.examMasked);
  const subAt = subs.filter((sb) => sb.periodNo === periodNo);
  const covered = subAt.map((sb) => ({
    classLabel: classLabel(masters, sb.classId, sb.sectionId).replace(" · ", " "),
    subject: subjectLabel(masters, sb.subjectId),
    substitute: staffName(sb.substituteTeacherId),
  }));
  const uncovered = affected
    .filter((a) => !subAt.some((sb) => sb.classId === a.classId && sb.sectionId === a.sectionId))
    .map((a) => ({
      classLabel: classLabel(masters, a.classId, a.sectionId).replace(" · ", " "),
      subject: subjectLabel(masters, a.subjectId),
      absentTeacher: staffName(a.absentTeacherId),
    }));

  return formatFreeTeachersReply({
    date,
    todayIso,
    periodNo,
    periodLabel: bell.label || `Period ${bell.no}`,
    timeLabel: bell.startTime && bell.endTime ? `${bell.startTime}–${bell.endTime}` : "",
    weekdayLabel: WEEKDAY_SHORT[weekday] || "",
    free,
    absentCount: absent.length,
    uncovered,
    covered,
  });
}

async function collectionToday(
  resolved: Record<string, string>,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  await ensureFeesHydratedServer();
  const fees = loadFees();
  const ay = session.academicYearCode;
  const date = resolved.date || todayIso;
  const live = (fees.vouchers ?? []).filter((v) => !v.voidedAt && v.academicYearCode === ay);
  const day = live.filter((v) => v.collectionDate === date);
  const byMode = new Map<string, { paise: number; count: number }>();
  const cheques = { count: 0, paise: 0 };
  const cashiers = new Map<string, { paise: number; count: number }>();
  const bySource = { counter: 0, manualBook: 0, paymentLink: 0 };
  for (const v of day) {
    for (const t of v.tenders ?? []) {
      const label = t.gatewayProvider
        ? `Online (${t.gatewayProvider.charAt(0).toUpperCase()}${t.gatewayProvider.slice(1)})`
        : TENDER_MODE_LABEL[t.mode] || t.mode.toUpperCase();
      const cur = byMode.get(label) ?? { paise: 0, count: 0 };
      cur.paise += t.amountPaise;
      cur.count += 1;
      byMode.set(label, cur);
      if (t.realisation === "subject_to_clearance") {
        cheques.count += 1;
        cheques.paise += t.amountPaise;
      }
    }
    const who = v.cashierName || "—";
    const c = cashiers.get(who) ?? { paise: 0, count: 0 };
    c.paise += v.totalPaise;
    c.count += 1;
    cashiers.set(who, c);
    if (v.source === "manual_book") bySource.manualBook += 1;
    else if (v.source === "payment_link") bySource.paymentLink += 1;
    else bySource.counter += 1;
  }
  const monthPrefix = date.slice(0, 7);
  const monthToDatePaise = live
    .filter((v) => v.collectionDate.startsWith(monthPrefix) && v.collectionDate <= date)
    .reduce((s, v) => s + v.totalPaise, 0);
  const dc = getDayCloseForDate(date, fees);
  const monthLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    timeZone: "UTC",
  });
  return formatCollectionReply({
    date,
    todayIso,
    receiptCount: day.length,
    totalPaise: day.reduce((s, v) => s + v.totalPaise, 0),
    byMode: [...byMode.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.paise - a.paise),
    chequesPending: cheques,
    bySource,
    cashiers: [...cashiers.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.paise - a.paise),
    dayClose: dc
      ? {
          status: dc.status,
          cashierName: dc.cashierName,
          physicalCashPaise: dc.physicalCashPaise ?? null,
          systemCashPaise: dc.systemCashPaise ?? null,
        }
      : null,
    monthToDatePaise,
    monthLabel,
    formatInr,
  });
}

async function classDefaulters(
  resolved: Record<string, string>,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  await ensureFeesHydratedServer();
  const sis = loadSis();
  const masters = loadMasters();
  const want = new Set((resolved.sectionIds || "").split(",").filter(Boolean));
  const rows = listLiveDefaulters({
    asOf: todayIso,
    academicYearCode: session.academicYearCode,
    sis,
    masters,
  })
    .filter((d) => want.has(d.student.sectionId) && d.overdueDays > 0)
    .map((d) => ({
      sectionLabel: classLabel(masters, d.student.classId, d.student.sectionId).replace(" · ", " "),
      rollNo: d.student.rollNo,
      fullName: d.fullName,
      overdueAmountPaise: d.overdueAmountPaise,
      overdueDays: d.overdueDays,
      earliestDueOn: d.earliestDueOn,
      onPlan: !!d.planCode,
    }));
  return formatClassDefaultersReply({
    title: resolved.title || "Class",
    todayIso,
    wholeClass: resolved.wholeClass === "1",
    rows,
    limitedTo: resolved.limitedTo ? resolved.limitedTo.split("|") : undefined,
    formatInr,
  });
}

async function studentFees(
  resolved: Record<string, string>,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  await ensureFeesHydratedServer();
  const sis = loadSis();
  const masters = loadMasters();
  const fees = loadFees();
  const student = sis.students.find((s) => s.id === resolved.studentId);
  if (!student) return "That student record has gone missing. Please try again.";
  const label = (st: SisStudent) => classLabel(masters, st.classId, st.sectionId);
  const detail = resolved.detail === "full" ? "full" : "basic";
  const rows = student.householdId
    ? computeHouseholdDues(student.householdId, sis, masters, fees, {
        includeFuture: true,
        academicYearCode: session.academicYearCode,
      })
    : [{ student, dues: [] }];
  const mine = rows.find((r) => r.student.id === student.id)?.dues ?? [];
  const open = flagFutureDues(openFeeDues(mine).filter((d) => d.balancePaise > 0), todayIso);
  const dues = open.map((d) => ({
    label: d.installmentLabel || d.label || "",
    headName: d.feeHeadName || d.label || "Fee",
    kind: d.kind,
    dueOn: d.dueOn || "",
    balancePaise: d.balancePaise,
    billedPaise: d.billedPaise,
    concessionPaise: d.concessionPaise,
    concessionNames: (d.concessionDetails ?? []).map((c) => c.name).filter(Boolean),
    future: d.future,
  }));
  const siblings = rows
    .filter((r) => r.student.id !== student.id)
    .map((r) => ({
      name: r.student.fullName,
      classLabel: label(r.student),
      duePaise: flagFutureDues(openFeeDues(r.dues), todayIso)
        .filter((d) => !d.future)
        .reduce((s, d) => s + Math.max(0, d.balancePaise), 0),
    }));
  const receipts = (fees.vouchers ?? [])
    .filter(
      (v) =>
        !v.voidedAt &&
        v.academicYearCode === session.academicYearCode &&
        v.lines.some((l) => l.studentId === student.id),
    )
    .sort((a, b) => (b.collectionDate || "").localeCompare(a.collectionDate || ""));
  const last = receipts[0];
  const hh = student.householdId
    ? sis.households.find((h) => h.id === student.householdId)
    : undefined;
  return formatStudentFeesReply({
    studentName: student.fullName,
    classLabel: label(student),
    rollNo: student.rollNo,
    todayIso,
    dues,
    lastReceipt: last
      ? {
          receiptNo: last.receiptNo,
          date: last.collectionDate,
          amountPaise: last.lines
            .filter((l) => l.studentId === student.id)
            .reduce((s, l) => s + l.amountPaise, 0),
          modes: [...new Set(last.tenders.map((t) => t.mode.toUpperCase()))],
        }
      : null,
    parentMobile: hh ? householdWhatsApp(hh) || hh.mobile : "",
    siblings,
    detail,
    formatInr,
  });
}

/**
 * Confirmed write. No write command is registered yet — this is the path
 * Phase 2 commands plug into: resolve nothing again (IDs were frozen on
 * the card), run the same server function the app calls, audit, reply.
 */
async function runConfirmedWrite(
  inbound: ErpCommandInbound,
  pending: PendingErpConfirm,
): Promise<ErpCommandResult> {
  const command = findErpCommand(pending.commandId);
  if (!command || command.kind !== "write") {
    return {
      handled: true,
      audience: "erp_command_confirm",
      text: "That command is no longer available.",
    };
  }
  return {
    handled: true,
    audience: "erp_command_confirm",
    text: `"${command.title}" is not enabled for WhatsApp yet.`,
  };
}

async function audit(
  session: DemoSession,
  command: ErpCommandDef,
  fields: ErpCommandFields,
  originalText: string,
  outcome: "ok" | "denied" | "error",
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const r = await writeAudit({
      session,
      module: "erp_commands",
      action: command.kind === "write" ? "edit" : "view",
      entityType: "command",
      entityId: command.id,
      summary: `${detail.channel === "app" ? "App" : "WhatsApp"} command (${outcome}): ${originalText.slice(0, 200)}`,
      after: { command: command.id, fields, outcome, ...detail },
    });
    if (!r.ok) console.warn("[erpCommands] audit not recorded:", r.error);
  } catch (e) {
    console.warn("[erpCommands] audit failed", e);
  }
}

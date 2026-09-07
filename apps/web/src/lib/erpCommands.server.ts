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
import {
  findRegister,
  loadAttendance,
  summarizeMarks,
  type AttendanceStatus,
} from "@/lib/attendance";
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
import { ensureTransportHydratedServer } from "@/lib/transportPersistence";
import { loadTransport } from "@/lib/transport";
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
import { listSectionParentContacts } from "@/lib/homework";
import { publicOrigin } from "@/lib/birthday.server";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { formatInr, loadMasters } from "@/lib/masters";
import { classLabel } from "@/lib/homework";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
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
  formatBusManifestReply,
  formatHomeworkReply,
  formatAdmissionsPeriodReply,
  formatClassMessageCard,
  formatDecideLeaveCard,
  formatFeeReminderCard,
  formatPayLinkCard,
  formatBusDelayCard,
  matchTransportRoutes,
  BUS_DELAY_MAX_MINUTES,
  parseBusDelayQuery,
  formatBookPtmCard,
  formatPtmSlotPicker,
  parsePtmTime,
  ptmTimeCandidates,
  formatLeaveRequestPicker,
  formatRaiseComplaintCard,
  formatStaffBroadcastCard,
  guessComplaintCategory,
  complaintSubjectFrom,
  formatMarkAttendanceCard,
  messageScriptLanguage,
  noticeTitleFrom,
  renderTemplateBody,
  formatPostHomeworkCard,
  isCorrectingAttendance,
  parseAttendanceSpec,
  homeworkTitleFrom,
  parseDueDate,
  splitPostHomeworkRest,
  formatSchoolSnapshotReply,
  formatStudentDetailsReply,
  formatPendingLeavesReply,
  formatRouteNotFound,
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
  looksLikeBareName,
  followUpCommandFor,
  followUpIsFresh,
  parsePickNumber,
  pickIsFresh,
  templatesByLanguage,
  templateForFamily,
  formatTemplateMixLabel,
  parseCommandAllowList,
  commandActorAllowed,
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
  /** householdId → IST date of the last fee reminder, for the weekly cap. */
  feeRemindedOn?: Record<string, string>;
  /**
   * routeId → ISO timestamp of the last delay notice. Not a cap — a bus
   * that slips from 20 to 40 minutes must be able to say so — only so the
   * confirm card can warn that these families were just told.
   */
  busDelayedAt?: Record<string, string>;
  /**
   * The last list the desk showed each person, so a bare name typed in
   * reply resolves inside it. Scope, not names: a section id list is a
   * fraction of the size of the roster it stands for, and this slice is
   * shared with every other bot's state.
   */
  followUp?: Record<
    string,
    { at: string; commandId: string; sectionIds: string[]; label: string }
  >;
  /**
   * The numbered "which one did you mean?" list each person last saw, so
   * a reply of "2" resolves to a student. Ids only — the names were on
   * the message that asked, and this slice is shared with every other
   * bot's state.
   */
  pick?: Record<
    string,
    { at: string; commandId: string; originalText: string; studentIds: string[] }
  >;
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
 * `ERP_WA_COMMANDS_ALLOW` — a pilot list of mobiles. Empty or unset means
 * everyone, which is how the desk shipped.
 */
export function erpCommandAllowList(): string[] {
  return parseCommandAllowList(process.env.ERP_WA_COMMANDS_ALLOW);
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

/**
 * The per-language template set as frozen onto the confirm card.
 *
 * Undefined rather than an empty object when the card predates this, so
 * the send falls back to the single template it was built with instead of
 * finding nothing for every language.
 */
function parseTemplatesByLang(
  raw: string | undefined,
): Record<string, import("@/lib/erpCommands").PickedTemplate | null> | undefined {
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw) as Record<string, import("@/lib/erpCommands").PickedTemplate | null>;
    return j && typeof j === "object" ? j : undefined;
  } catch {
    return undefined;
  }
}

/** Mobiles bucketed by family language, as frozen onto the confirm card. */
function parseMobilesByLang(
  raw: string | undefined,
): Record<string, string[]> | undefined {
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw) as Record<string, string[]>;
    if (!j || typeof j !== "object") return undefined;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(j)) {
      if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === "string" && x);
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/** How many recipients read each language, for the confirm card. */
function countByLanguage(rows: { language?: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = r.language || "hi";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
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
/**
 * Commands whose reply is a list of children, and so can be followed by a
 * bare name. A reading about one student already names that student, and a
 * school-wide summary has no list to point into.
 */
const FOLLOW_UP_LIST_COMMANDS = new Set([
  "absent_list",
  "class_defaulters",
  "pending_leaves",
]);

export async function handleErpStaffCommand(
  inbound: ErpCommandInbound,
): Promise<ErpCommandResult> {
  if (!erpCommandsEnabledByEnv()) return { handled: false };

  // Pilot list. Silent for everyone else, exactly like the kill switch: a
  // staff member who is not on it must see the WhatsApp they saw before the
  // desk existed, not a message telling them about a feature they cannot
  // use. Checked here, before the voice note is transcribed, so a pilot
  // costs nothing for the people outside it.
  const allow = erpCommandAllowList();
  if (
    !commandActorAllowed(allow, [
      inbound.actorKey,
      inbound.staff?.mobile,
      inbound.staff?.altMobile,
    ])
  ) {
    return { handled: false };
  }

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
  // Set when a bare name was resolved against a list the desk just showed;
  // the student lookup below searches those sections instead of the school.
  let resolvedFollowUpSections: string[] | null = null;
  // Set when a bare number answered a numbered "which one?" list; the
  // student lookup below skips matching entirely and uses this id.
  let pinnedStudentId: string | null = null;

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
  // 4a2. A bare number in reply to the desk's own numbered list.
  //
  // Runs before the parse so that "2" is read as an answer rather than as
  // a fragment of nothing. Nothing else in the desk answers a bare digit,
  // and it only means anything for five minutes after THIS desk asked
  // THIS person to choose — so a "2" typed into any other conversation
  // still falls through untouched.
  if (!parsed) {
    const pk = (store.pick ?? {})[actor];
    if (pk && pickIsFresh(pk.at, nowMs) && pk.studentIds.length) {
      const n = parsePickNumber(text, pk.studentIds.length);
      if (n) {
        pinnedStudentId = pk.studentIds[n - 1]!;
        parsed = {
          commandId: pk.commandId,
          fields: { student: "", section: "" },
          source: "local",
        };
        // Spent. A second "2" is a new message, not the same choice again.
        const cleared = { ...(store.pick ?? {}) };
        delete cleared[actor];
        store = { ...store, pick: cleared };
        await writeStore(store);
      }
    }
  }

  // 4b. A bare name in reply to a list the desk just showed.
  //
  // The desk answers command-shaped text and stays quiet otherwise, which
  // is what keeps it out of ordinary staff conversation. The one bad case
  // is the most natural reply there is: it prints a class list, somebody
  // types a name, and that falls through to the older bots. Answered only
  // when THIS desk showed THIS person a list in the last few minutes, and
  // only for a name found inside it — anything else still falls through
  // untouched.
  if (!parsed && looksLikeBareName(text)) {
    const fu = (store.followUp ?? {})[actor];
    if (fu && followUpIsFresh(fu.at, nowMs) && fu.sectionIds.length) {
      parsed = {
        commandId: followUpCommandFor(fu.commandId),
        fields: { student: text.trim(), section: "" },
        source: "local",
      };
      resolvedFollowUpSections = fu.sectionIds;
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
  // A command restricted to other channels steps aside entirely, so
  // whatever handled that message before this desk existed still does.
  if (command.channels && !command.channels.includes(inbound.channel)) {
    return { handled: false };
  }

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
  if (command.id === "post_homework") {
    const parts = splitPostHomeworkRest(parsed.fields.text || "");
    if (!parts) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Tell me the subject and the work, with a colon between them:\n_Post homework 6B maths: exercise 4.2, due Monday_",
      };
    }
    const subjects = (masters.subjects ?? []).filter((sub) => sub.isActive !== false);
    const norm = (v: string) => (v || "").trim().toLowerCase().replace(/\s+/g, "");
    const want = norm(parts.subjectHint);
    const exact = subjects.filter(
      (sub) => norm(sub.nameEn) === want || norm(sub.code || "") === want,
    );
    const near = exact.length
      ? exact
      : subjects.filter(
          (sub) => norm(sub.nameEn).startsWith(want) || (want.length >= 4 && norm(sub.nameEn).includes(want)),
        );
    if (near.length !== 1) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: near.length
          ? `Which subject? ${near.map((sub) => sub.nameEn).join(", ")}`
          : `I don't have a subject called "${parts.subjectHint}". Subjects: ${subjects.slice(0, 12).map((sub) => sub.nameEn).join(", ")}`,
      };
    }
    resolved.subjectId = near[0]!.id;
    resolved.subjectName = near[0]!.nameEn;
    resolved.body = parts.body;
    resolved.title = homeworkTitleFrom(parts.body);
    resolved.dueAt = parts.dueHint ? parseDueDate(parts.dueHint, todayIso) : "";
    if (parts.dueHint && !resolved.dueAt) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `I couldn't read "${parts.dueHint}" as a due date. Try _due Monday_, _due tomorrow_ or _due 12/9_.`,
      };
    }
  }
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
    // A bare name is only ever looked for inside the list it replied to.
    // Searching the whole school here would let "Manvi" after a IV-A list
    // land on a Manvi in IX-B, which is a wrong answer wearing the clothes
    // of a right one.
    const pool = resolvedFollowUpSections
      ? sis.students.filter((st) => resolvedFollowUpSections!.includes(st.sectionId))
      : sis.students;
    const label = (st: SisStudent) => classLabel(masters, st.classId, st.sectionId);
    // A number already answered this question — the choice was made from a
    // list this desk printed, so there is nothing left to match.
    const pinned = pinnedStudentId
      ? sis.students.find((st) => st.id === pinnedStudentId)
      : undefined;
    const matches = pinned
      ? [{ student: pinned, score: 3 }]
      : matchStudents(q, pool, { academicYearCode: ay, sectionId });
    if (matches.length !== 1) {
      // Remember the list so a bare number answers it. Ids in the order
      // they were printed — the numbering IS the list.
      if (matches.length > 1) {
        const st = await readStore();
        await writeStore({
          ...st,
          pick: {
            ...(st.pick ?? {}),
            [actor]: {
              at: new Date(nowMs).toISOString(),
              commandId: command.id,
              originalText: text,
              studentIds: matches.map((m) => m.student.id),
            },
          },
        });
      }
      return {
        handled: true,
        audience: "erp_command_ask",
        text: formatStudentMatchesAsk(
          matches.map((m) => ({
            fullName: m.student.fullName,
            classLabel: label(m.student),
            rollNo: m.student.rollNo,
            fatherName: m.student.fatherName,
            admissionNo: m.student.admissionNo,
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
    // Fees detail (concession policy names, sibling line) is a fee-desk
    // reading. Student details unmask the parents' mobiles for the office
    // and for the child's own class teacher, who has to be able to call.
    resolved.detail =
      command.id === "student_details"
        ? isOfficeLike(roleCodes) || mineIds.has(student.sectionId)
          ? "full"
          : "basic"
        : isOfficeLike(roleCodes) || roleCodes.includes("accounts")
          ? "full"
          : "basic";
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
  if (command.id === "admissions_week") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    if (!isOfficeLike(roleCodes) && !roleCodes.includes("admissions")) {
      void audit(session, command, parsed.fields, text, "denied", { reason: "scope", channel: inbound.channel });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "The admissions report is for the admissions desk, office and leadership.",
      };
    }
    resolved.period = (parsed.fields.text || "week").trim().toLowerCase();
  }
  if (command.id === "school_snapshot") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    if (!isOfficeLike(roleCodes)) {
      void audit(session, command, parsed.fields, text, "denied", { reason: "scope", channel: inbound.channel });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "The school snapshot is for the office and leadership. You can ask about your own sections, e.g. _5A me aaj kaun absent hai_.",
      };
    }
  }
  if (command.id === "bus_manifest") {
    resolved.route = (parsed.fields.text || "").trim();
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
  if (command.id === "pay_link" && resolved.studentId) {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
    if (!isOfficeLike(roleCodes) && !roleCodes.includes("accounts")) {
      void audit(session, command, parsed.fields, text, "denied", {
        reason: "scope",
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "Raising payment links is for the fee desk, office and leadership.",
      };
    }
    const { openDuesForPayLink } = await import("@/lib/feePayLink.server");
    const due = await openDuesForPayLink({
      studentId: resolved.studentId,
      academicYearCode: session.academicYearCode,
      todayIso,
    });
    if (!due.ok) {
      return { handled: true, audience: "erp_command_ask", text: `${due.error}.` };
    }
    if (!due.mobile) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `No parent WhatsApp number on record for ${due.studentName}. Add it in the ERP first.`,
      };
    }
    const { approvedTemplatesServer } = await import("@/lib/waTemplatesRead.server");
    const readFeeTemplates = await approvedTemplatesServer("fees");
    if (!readFeeTemplates.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Couldn't read the school's WhatsApp templates just now, so I can't set up the pay link. Nothing was sent. Please try again in a minute.",
      };
    }
    // One family, so one language: theirs.
    const payLinkTpls = templatesByLanguage(readFeeTemplates.templates, ["fees_pay_link"]);
    const tpl = payLinkTpls.byLang[due.language] ?? payLinkTpls.any;
    resolved.templateMetaName = tpl?.metaName || "";
    resolved.templateLanguage = tpl?.language || "";
    resolved.templateVariables = (tpl?.variables ?? []).join(",");
    resolved.familyLanguage = due.language;
    resolved.totalPaise = String(due.totalPaise);
    resolved.expiresInDays = "7";
    resolved.cardSummary = formatPayLinkCard({
      studentName: due.studentName,
      classLabel: due.classLabel,
      guardianName: due.guardianName,
      mobileMasked: maskMobile10(due.mobile),
      rows: due.rows,
      totalPaise: due.totalPaise,
      expiresInDays: 7,
      templateReady: !!tpl,
      formatInr,
    });
  }
  if (command.id === "fee_reminder") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
    if (!isOfficeLike(roleCodes) && !roleCodes.includes("accounts")) {
      void audit(session, command, parsed.fields, text, "denied", {
        reason: "scope",
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "Sending fee reminders is for the fee desk, office and leadership.",
      };
    }
    const {
      inFeeReminderQuietHours,
      istHourNow,
      planFeeReminders,
      FEE_REMINDER_QUIET_START,
      FEE_REMINDER_QUIET_END,
    } = await import("@/lib/feeReminder.server");
    const hour = istHourNow();
    if (inFeeReminderQuietHours(hour)) {
      return {
        handled: true,
        audience: "erp_command_denied",
        text: `It's ${hour}:00 — fee reminders go out between ${FEE_REMINDER_QUIET_END}:00 and ${FEE_REMINDER_QUIET_START}:00 only. Nothing was sent.`,
      };
    }
    const askedRaw = parsed.fields.section || "";
    const refs = extractSectionRefs(askedRaw || text);
    if (!refs.length) {
      return { handled: true, audience: "erp_command_ask", text: "Which class? e.g. _fee reminder class 3 defaulters_." };
    }
    const res = resolveClassOrSectionRef(refs[0]!, masters);
    if (!res.ok) {
      return { handled: true, audience: "erp_command_ask", text: formatSectionProblem(res.reason, res.options, askedRaw || text) };
    }
    const { approvedTemplatesServer } = await import("@/lib/waTemplatesRead.server");
    const readFeeTemplates = await approvedTemplatesServer("fees");
    if (!readFeeTemplates.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Couldn't read the school's WhatsApp templates just now, so I can't set up the fee reminder. Nothing was sent. Please try again in a minute.",
      };
    }
    const reminderTpls = templatesByLanguage(readFeeTemplates.templates, [
      "fees_stage_reminder",
      "fees_soft_reminder",
    ]);
    const tpl = reminderTpls.any;
    if (!tpl) {
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "No approved fee reminder template yet, and free text can't reach parents outside the 24-hour window. Ask the office to get *Fee overdue stage reminder* approved in Masters → WhatsApp templates.",
      };
    }
    await ensureFeesHydratedServer();
    const sis = loadSis();
    const want = new Set(res.sections.map((x) => x.sectionId));
    const defaulters = listLiveDefaulters({
      asOf: todayIso,
      academicYearCode: session.academicYearCode,
      sis,
      masters,
    }).filter((d) => want.has(d.student.sectionId) && d.overdueDays > 0);
    if (!defaulters.length) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `No overdue fees in ${res.wholeClass ? `Class ${res.className}` : res.sections[0]!.label}. Nothing to send. ✅`,
      };
    }
    const recipients = defaulters
      .map((d) => {
        const hh = sis.households.find((h) => h.id === d.householdId);
        return {
          householdId: d.householdId,
          mobile: hh ? householdWhatsApp(hh) || hh.mobile : "",
          guardianName: hh?.guardianName || "",
          language: waTemplateLanguageFor(hh ?? {}),
          studentName: d.fullName,
          classLabel: classLabel(masters, d.student.classId, d.student.sectionId).replace(" · ", " "),
          amountPaise: d.overdueAmountPaise,
          overdueDays: d.overdueDays,
        };
      })
      .filter((x) => x.mobile);
    const store2 = await readStore();
    const plan = await planFeeReminders({
      recipients,
      lastRemindedByHousehold: store2.feeRemindedOn ?? {},
      todayIso,
    });
    if (!plan.send.length) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: plan.tooSoon.length
          ? `Every defaulting family in that class was reminded within the last week. Nothing was sent.`
          : "No family in that class can be messaged on WhatsApp right now.",
      };
    }
    resolved.title = res.wholeClass ? `Class ${res.className}` : res.sections[0]!.label;
    resolved.templateMetaName = tpl.metaName;
    resolved.templateLanguage = tpl.language;
    resolved.templateVariables = (tpl.variables ?? []).join(",");
    resolved.templatesByLang = JSON.stringify(reminderTpls.byLang);
    resolved.recipients = JSON.stringify(plan.send);
    resolved.cardSummary = formatFeeReminderCard({
      title: resolved.title,
      templateLabel: formatTemplateMixLabel(
        reminderTpls.byLang,
        countByLanguage(plan.send),
      ),
      send: plan.send.map((x) => ({
        studentName: x.studentName,
        classLabel: x.classLabel,
        amountPaise: x.amountPaise,
        overdueDays: x.overdueDays,
      })),
      tooSoon: plan.tooSoon.map((x) => ({ studentName: x.recipient.studentName, daysAgo: x.daysAgo })),
      optedOut: plan.optedOut.length,
      formatInr,
    });
  }
  if (command.id === "bus_delay") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
    if (!isOfficeLike(roleCodes) && !roleCodes.includes("transport")) {
      void audit(session, command, parsed.fields, text, "denied", {
        reason: "scope",
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "Sending a bus delay notice is for the transport desk, office and leadership.",
      };
    }
    // Re-read the raw message: the model may have filled `text` with a
    // phrasing of its own, and the numbers in it are what reach families.
    const asked = parseBusDelayQuery(text) ?? parseBusDelayQuery(parsed.fields.text || "");
    const routeAsked = (asked?.route || parsed.fields.text || "").trim();
    const minutes = asked?.minutes || parseInt(parsed.fields.date || "0", 10) || 0;
    if (!routeAsked) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Which bus? e.g. _Bus 3 ko batao: 20 minute late_.",
      };
    }
    if (!minutes) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "How late is it? Say the minutes with the unit, e.g. _bus 3 20 minute late_ — a bare number would be read as the bus.",
      };
    }
    if (minutes > BUS_DELAY_MAX_MINUTES) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `${minutes} minutes is more than ${BUS_DELAY_MAX_MINUTES / 60} hours — if that is right, ring the families instead of sending a delay notice. Nothing was sent.`,
      };
    }
    const { planBusDelayNotice } = await import("@/lib/busDelayNotice.server");
    const plan = await planBusDelayNotice({
      routeAsked,
      academicYearCode: session.academicYearCode,
    });
    if (!plan.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: formatRouteNotFound(routeAsked, plan.options),
      };
    }
    const p = plan.plan;
    if (!p.send.length) {
      const why =
        p.suspended || p.noMobile || p.optedOut
          ? ` (${[
              p.suspended ? `${p.suspended} suspended from boarding` : "",
              p.noMobile ? `${p.noMobile} with no WhatsApp number` : "",
              p.optedOut ? `${p.optedOut} opted out` : "",
            ]
              .filter(Boolean)
              .join(", ")})`
          : "";
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `No family on ${p.routeLabel} can be messaged right now${why}. Nothing was sent.`,
      };
    }
    const { approvedTemplatesServer } = await import("@/lib/waTemplatesRead.server");
    const readTransportTemplates = await approvedTemplatesServer("transport");
    if (!readTransportTemplates.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Couldn't read the school's WhatsApp templates just now, so I can't set up the bus delay notice. Nothing was sent. Please try again in a minute.",
      };
    }
    // Not the script the staff member typed in — each family's own.
    const delayTpls = templatesByLanguage(readTransportTemplates.templates, ["transport_delay"]);
    const tpl = delayTpls.any;
    if (!tpl) {
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "No approved bus delay template yet, and free text can't reach parents outside the 24-hour window. Ask the office to get *Bus running late* approved in Masters → WhatsApp templates.",
      };
    }
    const lastAt = (store.busDelayedAt ?? {})[p.route.id];
    const minutesAgo = lastAt
      ? Math.floor((nowMs - new Date(lastAt).getTime()) / 60000)
      : undefined;
    resolved.routeId = p.route.id;
    resolved.routeLabel = p.routeLabel;
    resolved.busNo = p.route.busNo || p.route.code || "";
    resolved.minutesLate = String(minutes);
    resolved.templateMetaName = tpl.metaName;
    resolved.templateLanguage = tpl.language;
    resolved.templateVariables = (tpl.variables ?? []).join(",");
    resolved.templatesByLang = JSON.stringify(delayTpls.byLang);
    resolved.recipients = JSON.stringify(p.send);
    resolved.cardSummary = formatBusDelayCard({
      routeLabel: p.routeLabel,
      minutesLate: minutes,
      send: p.send.map((x) => ({
        studentName: x.studentName,
        classLabel: x.classLabel,
        stopName: x.stopName,
      })),
      optedOut: p.optedOut,
      suspended: p.suspended,
      noMobile: p.noMobile,
      templateLabel: formatTemplateMixLabel(delayTpls.byLang, countByLanguage(p.send)),
      lastNoticeMinutesAgo:
        minutesAgo !== undefined && minutesAgo >= 0 && minutesAgo <= 60 ? minutesAgo : undefined,
    });
  }
  if (command.id === "book_ptm" && resolved.studentId) {
    const { ptmOptionsForStudent } = await import("@/lib/ptmBook.server");
    const opts = await ptmOptionsForStudent({
      studentId: resolved.studentId,
      academicYearCode: session.academicYearCode,
      todayIso,
    });
    if (!opts.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `${opts.error}. Create one in the ERP: PTM → events.`,
      };
    }
    const o = opts.options;
    if (o.existing) {
      const at = o.existing.slot ? `${o.existing.slot.startAt} with ${o.existing.slot.teacherName}` : "a slot";
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `${o.student.fullName} is already booked for ${o.event.name} — ${at}. Cancel it in the ERP first if the family wants a different time.`,
      };
    }
    const free = o.slots.filter((sl) => sl.free > 0);
    const asked = parsePtmTime(parsed.fields.text || text);
    const wanted = asked ? ptmTimeCandidates(asked) : [];
    const picked = wanted.length
      ? free.find((sl) => wanted.includes(sl.startAt)) ?? null
      : null;
    if (!picked) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: formatPtmSlotPicker({
          studentName: o.student.fullName,
          eventName: o.event.name,
          eventDate: o.event.date,
          slots: free.map((sl) => ({ startAt: sl.startAt, teacherName: sl.teacherName, free: sl.free })),
          // The normalized reading, not the raw words: the model may have
          // written the time differently from the staff member.
          askedTime: wanted[0],
        }),
      };
    }
    // The family is told on the app either way; WhatsApp needs an approved
    // notice template, because free text cannot reach a parent outside the
    // 24-hour window.
    const { approvedTemplatesServer } = await import("@/lib/waTemplatesRead.server");
    const readApproved = await approvedTemplatesServer("comms");
    if (!readApproved.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Couldn't read the school's WhatsApp templates just now, so I can't set up the PTM booking. Nothing was sent. Please try again in a minute.",
      };
    }
    // One family, so one language: theirs.
    const ptmSis = loadSis();
    const ptmHh = ptmSis.households.find((h) => h.id === o.householdId);
    const ptmLang = waTemplateLanguageFor(ptmHh ?? {});
    const ptmTpls = templatesByLanguage(readApproved.templates, ["comms_notice"]);
    const notice = ptmTpls.byLang[ptmLang] ?? ptmTpls.any;
    const { modeLabel } = await import("@/lib/ptm");
    const noticeBody = [
      `PTM booked for ${o.student.fullName}.`,
      `${o.event.name} · ${o.event.date} · ${picked.startAt}-${picked.endAt}`,
      `With ${picked.teacherName}${picked.roomOrLink ? ` · ${picked.roomOrLink}` : ""} (${modeLabel(o.event.mode)}).`,
    ].join(" ");
    const vars: Record<string, string> = {
      schoolName: TENANT.nameDisplay,
      noticeTitle: `PTM ${picked.startAt} · ${o.student.fullName}`,
      noticeBody,
      guardianName: o.guardianName || "Parent",
      childName: o.student.fullName,
    };
    resolved.eventId = o.event.id;
    resolved.eventName = o.event.name;
    resolved.slotId = picked.id;
    resolved.startAt = picked.startAt;
    resolved.householdId = o.householdId;
    resolved.guardianName = o.guardianName;
    resolved.templateMetaName = notice?.metaName || "";
    resolved.templateLanguage = notice?.language || "";
    // Frozen here rather than looked up again on confirm: Meta positions
    // template parameters, so the order the card was built from is the
    // order the send has to use.
    resolved.templateVariables = (notice?.variables ?? []).join(",");
    resolved.familyLanguage = ptmLang;
    resolved.vars = JSON.stringify(vars);
    resolved.cardSummary = formatBookPtmCard({
      studentName: o.student.fullName,
      classLabel: o.classLabel,
      eventName: o.event.name,
      eventDate: o.event.date,
      modeLabel: modeLabel(o.event.mode),
      startAt: picked.startAt,
      endAt: picked.endAt,
      teacherName: picked.teacherName,
      roomOrLink: picked.roomOrLink,
      guardianName: o.guardianName,
      mobileMasked: o.mobile ? maskMobile10(o.mobile) : "",
      familyLinked: !!o.householdId,
      templateLabel: notice
        ? `${ptmTpls.rawAny?.name || notice.metaName} (${notice.language.toUpperCase()})`
        : "",
    });
  }
  if (command.id === "decide_leave" && resolved.studentId) {
    writeStudentLeaveLocalRaw(emptyStudentLeaveState());
    await ensureStudentLeaveHydratedServer();
    const approve = (parsed.fields.date || "approve") === "approve";
    const pendingReqs = loadStudentLeave().requests.filter(
      (lr) =>
        lr.studentId === resolved.studentId &&
        lr.status === "pending" &&
        lr.academicYearCode === session.academicYearCode,
    );
    if (!pendingReqs.length) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `${resolved.studentName || "That student"} has no pending leave request.`,
      };
    }
    // Two pending requests for one child is rare but real (a sick day and a
    // planned trip). Deciding the wrong one is invisible, so ask.
    let picked = pendingReqs[0]!;
    if (pendingReqs.length > 1) {
      const askedDate = resolveCommandDate(text, todayIso);
      const byDate = pendingReqs.filter(
        (lr) => askedDate >= lr.fromDate && askedDate <= (lr.toDate || lr.fromDate),
      );
      if (byDate.length !== 1) {
        return {
          handled: true,
          audience: "erp_command_ask",
          text: formatLeaveRequestPicker(
            resolved.studentName || "This student",
            pendingReqs.map((lr) => ({
              id: lr.id,
              fromDate: lr.fromDate,
              toDate: lr.toDate || lr.fromDate,
              typeLabel: leaveTypeLabel(lr.leaveType),
              reason: lr.reason || "",
            })),
          ),
        };
      }
      picked = byDate[0]!;
    }
    const student = loadSis().students.find((st) => st.id === resolved.studentId);
    await ensureAttendanceHydratedServer();
    const att = loadAttendance();
    let applyDates = 0;
    let futureDates = 0;
    const from = picked.fromDate;
    const to = picked.toDate || picked.fromDate;
    for (const d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const exists = student
        ? !!findRegister(picked.academicYearCode, student.sectionId, iso, att)
        : false;
      if (exists || iso <= todayIso) applyDates += 1;
      else futureDates += 1;
    }
    resolved.leaveRequestId = picked.id;
    resolved.approve = approve ? "1" : "";
    resolved.note = (parsed.fields.text || "").trim();
    resolved.cardSummary = formatDecideLeaveCard({
      approve,
      studentName: resolved.studentName || "",
      classLabel: student ? classLabel(masters, student.classId, student.sectionId).replace(" · ", " ") : "",
      fromDate: from,
      toDate: to,
      days: leaveDayCount(picked),
      typeLabel: leaveTypeLabel(picked.leaveType),
      reason: picked.reason || "",
      note: resolved.note,
      approverHint: pendingApproverHint(picked),
      applyDates: approve ? applyDates : 0,
      futureDates: approve ? futureDates : 0,
    });
  }
  if (command.id === "raise_complaint" && resolved.studentId) {
    const body = (parsed.fields.text || "").trim();
    if (body.length < 3) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "What is the complaint? Put it after a colon:\n_Raise complaint for Riya Verma: bus did not come today_",
      };
    }
    if (body.length > 2000) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "That complaint is too long to file in one go (2000 characters).",
      };
    }
    const sis = loadSis();
    const student = sis.students.find((st) => st.id === resolved.studentId);
    if (!student?.householdId) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `${resolved.studentName || "That student"} has no family record linked, so a complaint can't be filed against it. Add the household in the ERP first.`,
      };
    }
    const hh = sis.households.find((h) => h.id === student.householdId);
    const { complaintCategoryLabel } = await import("@/lib/complaints");
    const category = guessComplaintCategory(body);
    resolved.householdId = student.householdId;
    resolved.category = category;
    resolved.subject = complaintSubjectFrom(body);
    resolved.body = body;
    resolved.guardianName = hh?.guardianName || "";
    resolved.guardianMobile = hh ? householdWhatsApp(hh) || hh.mobile : "";
    resolved.cardSummary = formatRaiseComplaintCard({
      studentName: student.fullName,
      classLabel: classLabel(masters, student.classId, student.sectionId).replace(" · ", " "),
      guardianName: resolved.guardianName,
      categoryLabel: complaintCategoryLabel(category as Parameters<typeof complaintCategoryLabel>[0]),
      subject: resolved.subject,
      body,
    });
  }
  if (command.id === "staff_broadcast") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
    if (!isOfficeLike(roleCodes)) {
      void audit(session, command, parsed.fields, text, "denied", {
        reason: "scope",
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "Broadcasting to all staff is for the office and leadership.",
      };
    }
    const message = (parsed.fields.text || "").trim();
    if (message.length < 3) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "What should the staff be told? Put it after a colon:\n_Staff broadcast: meeting 3 pm in library_",
      };
    }
    if (message.length > 700) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "That message is too long for one notice. Please shorten it to about 700 characters.",
      };
    }
    const activeStaff = (masters.staff ?? []).filter((st) => st.status === "active");
    const { approvedTemplatesServer } = await import("@/lib/waTemplatesRead.server");
    const readApproved = await approvedTemplatesServer("comms");
    if (!readApproved.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Couldn't read the school's WhatsApp templates just now, so I can't set up the staff broadcast. Nothing was sent. Please try again in a minute.",
      };
    }
    const approved = readApproved.templates;
    const wantLang = messageScriptLanguage(message);
    const notice =
      approved.find((tpl) => tpl.familyKey === "comms_notice" && tpl.language === wantLang) ??
      approved.find((tpl) => tpl.familyKey === "comms_notice") ??
      null;
    const vars: Record<string, string> = {
      schoolName: TENANT.nameDisplay,
      noticeTitle: noticeTitleFrom(message),
      noticeBody: message,
    };
    resolved.message = message;
    resolved.staffIds = activeStaff.map((st) => st.id).join(",");
    resolved.mobiles = activeStaff.map((st) => (st.mobile || "").trim()).filter(Boolean).join(",");
    resolved.templateId = notice?.id || "";
    resolved.templateMetaName = notice ? notice.metaName || notice.name : "";
    resolved.templateLanguage = notice ? notice.metaLanguage || notice.language : "";
    resolved.templateLabel = notice ? `${notice.name} (${notice.language.toUpperCase()})` : "";
    resolved.templateVariables = (notice?.variables ?? []).join(",");
    resolved.vars = JSON.stringify(vars);
    resolved.cardSummary = formatStaffBroadcastCard({
      message,
      staffCount: activeStaff.length,
      templateLabel: resolved.templateLabel,
      rendered: notice ? renderTemplateBody(notice.body, vars) : message,
    });
  }
  if (command.id === "class_message" && resolved.sectionId) {
    const message = (parsed.fields.text || "").trim();
    if (message.length < 3) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "What should the parents be told? Put it after a colon:\n_Class 4 parents ko bhejo: kal PTM 9 baje_",
      };
    }
    if (message.length > 700) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "That message is too long for one WhatsApp notice. Please shorten it to about 700 characters.",
      };
    }
    const { approvedTemplatesServer } = await import("@/lib/waTemplatesRead.server");
    const readApproved = await approvedTemplatesServer("comms");
    if (!readApproved.ok) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Couldn't read the school's WhatsApp templates just now, so I can't set up the class message. Nothing was sent. Please try again in a minute.",
      };
    }
    // Each family in their own language, not in the script the teacher
    // happened to type the notice in.
    const noticeTpls = templatesByLanguage(readApproved.templates, ["comms_notice"]);
    const notice = noticeTpls.any;
    if (!notice) {
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "There's no approved WhatsApp notice template yet, and free text can't be sent to parents outside the 24-hour window. Ask the office to get *School notice broadcast* approved in Masters → WhatsApp templates.",
      };
    }
    const classSis = loadSis();
    const contacts = listSectionParentContacts(resolved.sectionId, session.academicYearCode, classSis);
    if (!contacts.length) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `No parent WhatsApp numbers on record for ${resolved.sectionLabel || "that section"}.`,
      };
    }
    const vars: Record<string, string> = {
      schoolName: TENANT.nameDisplay,
      noticeTitle: noticeTitleFrom(message),
      noticeBody: message,
      guardianName: "Parent",
      childName: "your child",
    };
    // Mobiles bucketed by the language each family reads, so the confirm
    // step can send one broadcast per language instead of one message.
    const byLangMobiles: Record<string, string[]> = {};
    for (const c of contacts) {
      if (!c.mobile) continue;
      const hh = classSis.households.find((h) => h.id === c.householdId);
      const lang = waTemplateLanguageFor(hh ?? {});
      (byLangMobiles[lang] ??= []).push(c.mobile);
    }
    resolved.templateMetaName = notice.metaName;
    resolved.templateLanguage = notice.language;
    resolved.templateVariables = (notice.variables ?? []).join(",");
    resolved.templatesByLang = JSON.stringify(noticeTpls.byLang);
    resolved.mobilesByLang = JSON.stringify(byLangMobiles);
    resolved.templateLabel = formatTemplateMixLabel(
      noticeTpls.byLang,
      Object.fromEntries(
        Object.entries(byLangMobiles).map(([k, v]) => [k, v.length]),
      ),
    );
    resolved.message = message;
    resolved.vars = JSON.stringify(vars);
    resolved.mobiles = contacts.map((c) => c.mobile).filter(Boolean).join(",");
    resolved.cardSummary = formatClassMessageCard({
      sectionLabel: (resolved.sectionLabel || "").replace(" · ", " "),
      templateLabel: resolved.templateLabel,
      rendered: renderTemplateBody(noticeTpls.rawAny?.body || "", vars),
      familyCount: contacts.length,
      optedOut: 0,
    });
  }
  if (command.id === "mark_attendance" && resolved.sectionId) {
    const ay = session.academicYearCode;
    const date = resolveCommandDate(text, todayIso);
    const roster = loadSis()
      .students.filter(
        (st) =>
          st.status === "active" &&
          st.sectionId === resolved.sectionId &&
          st.academicYearCode === ay,
      )
      .sort((a, b) => (parseInt(a.rollNo, 10) || 9999) - (parseInt(b.rollNo, 10) || 9999));
    if (!roster.length) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `No active students found in ${resolved.sectionLabel || "that section"}.`,
      };
    }
    await ensureAttendanceHydratedServer();
    const existing = findRegister(ay, resolved.sectionId, date, loadAttendance());
    const correcting = isCorrectingAttendance(text);
    if (existing && !correcting) {
      const sum = summarizeMarks(existing.marks || []);
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `${resolved.sectionLabel || "That section"} is already marked for ${date === todayIso ? "today" : date} — present ${sum.present}, absent ${sum.absent}, leave ${sum.leave}, by ${existing.markedBy || "someone"}.\nTo replace it, send the same message starting with *correct*.`,
      };
    }
    const spec = parseAttendanceSpec(parsed.fields.text || text);
    const byRoll = new Map(roster.map((st) => [String(parseInt(st.rollNo, 10)), st]));
    const picked = new Map<string, "A" | "LE" | "L" | "HD">();
    const unresolved: string[] = [];
    const ambiguous: { token: string; options: string[] }[] = [];
    const take = (tokens: string[], status: "A" | "LE" | "L" | "HD") => {
      for (const raw of tokens) {
        const token = raw.trim();
        if (!token) continue;
        if (/^\d{1,3}$/.test(token)) {
          const st = byRoll.get(String(parseInt(token, 10)));
          if (!st) unresolved.push(`roll ${token}`);
          else picked.set(st.id, status);
          continue;
        }
        const hits = matchStudents({ name: token }, roster, { academicYearCode: ay });
        if (hits.length === 1) picked.set(hits[0]!.student.id, status);
        else if (hits.length > 1) {
          ambiguous.push({
            token,
            options: hits.map((h) => `${h.student.rollNo}. ${h.student.fullName}`),
          });
        } else unresolved.push(token);
      }
    };
    take(spec.absent, "A");
    take(spec.leave, "LE");
    take(spec.late, "L");
    take(spec.halfDay, "HD");
    if (unresolved.length) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `I couldn't find ${unresolved.map((u) => `"${u}"`).join(", ")} in ${resolved.sectionLabel || "that section"}. Nothing was marked — check the roll number or use the full name.`,
      };
    }
    if (ambiguous.length) {
      const a = ambiguous[0]!;
      return {
        handled: true,
        audience: "erp_command_ask",
        text: `"${a.token}" matches ${a.options.join(", ")}. Nothing was marked — say the roll number instead.`,
      };
    }
    if (!picked.size && !spec.allPresent) {
      return {
        handled: true,
        audience: "erp_command_ask",
        text: "Tell me who is absent, or say *all present*:\n_Mark 5A attendance: absent roll 4, 11, 19_",
      };
    }
    const row = (id: string) => {
      const st = roster.find((x) => x.id === id)!;
      return { rollNo: st.rollNo, fullName: st.fullName };
    };
    const ids = (status: string) => [...picked.entries()].filter(([, v]) => v === status).map(([k]) => k);
    resolved.date = date;
    resolved.correcting = correcting ? "1" : "";
    resolved.marks = JSON.stringify(
      roster.map((st) => ({ studentId: st.id, status: picked.get(st.id) ?? "P", note: "" })),
    );
    resolved.cardSummary = formatMarkAttendanceCard({
      sectionLabel: (resolved.sectionLabel || "").replace(" · ", " "),
      date,
      todayIso,
      total: roster.length,
      absent: ids("A").map(row),
      leave: ids("LE").map(row),
      late: ids("L").map(row),
      halfDay: ids("HD").map(row),
      correcting,
    });
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
    const summary =
      command.id === "bus_delay"
        ? resolved.cardSummary || command.title
        : command.id === "book_ptm"
        ? resolved.cardSummary || command.title
        : command.id === "pay_link"
        ? resolved.cardSummary || command.title
        : command.id === "fee_reminder"
        ? resolved.cardSummary || command.title
        : command.id === "decide_leave"
        ? resolved.cardSummary || command.title
        : command.id === "raise_complaint"
        ? resolved.cardSummary || command.title
        : command.id === "staff_broadcast"
        ? resolved.cardSummary || command.title
        : command.id === "class_message"
        ? resolved.cardSummary || command.title
        : command.id === "mark_attendance"
        ? resolved.cardSummary || command.title
        : command.id === "post_homework"
        ? formatPostHomeworkCard({
            sectionLabel: (resolved.sectionLabel || "").replace(" · ", " "),
            subjectName: resolved.subjectName || "",
            title: resolved.title || "",
            body: resolved.body || "",
            dueAt: resolved.dueAt || "",
            dateIso: todayIso,
            todayIso,
            parentCount: countSectionFamilies(resolved.sectionId || "", session.academicYearCode),
          })
        : `${command.title} — ${Object.entries(resolved)
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

  // Remember what was just listed, so a bare name in reply resolves inside
  // it. Only the commands that actually print students qualify.
  if (FOLLOW_UP_LIST_COMMANDS.has(command.id)) {
    const sections = [
      ...(resolved.sectionId ? [resolved.sectionId] : []),
      ...(resolved.sectionIds ? resolved.sectionIds.split(",").filter(Boolean) : []),
    ];
    if (sections.length) {
      const st = await readStore();
      await writeStore({
        ...st,
        followUp: {
          ...(st.followUp ?? {}),
          [actor]: {
            at: new Date().toISOString(),
            commandId: command.id,
            sectionIds: [...new Set(sections)],
            label: (resolved.sectionLabel || resolved.title || "").replace(" · ", " "),
          },
        },
      });
    }
  }
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
    case "bus_manifest":
      return busManifest(resolved, session, todayIso);
    case "student_details":
      return studentDetails(resolved, session);
    case "school_snapshot":
      return schoolSnapshot(session, todayIso);
    case "admissions_week":
      return admissionsPeriod(resolved.period || "week", session, todayIso);
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

async function admissionsPeriod(
  period: string,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  const { ensureAdmissionsHydratedServer } = await import("@/lib/admissionsPersistence");
  const { loadAdmissions, sourceLabel } = await import("@/lib/admissions");
  await ensureAdmissionsHydratedServer();
  const masters = loadMasters();
  const shift = (days: number) => {
    const d = new Date(`${todayIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const fromDate =
    period === "today" ? todayIso : period === "month" ? `${todayIso.slice(0, 7)}-01` : shift(-6);
  const periodLabel =
    period === "today" ? "today" : period === "month" ? "this month" : "last 7 days";
  const leads = loadAdmissions().leads.filter(
    (l) => !l.academicYearCode || l.academicYearCode === session.academicYearCode,
  );
  const inPeriod = (iso: string) => {
    const d = (iso || "").slice(0, 10);
    return !!d && d >= fromDate && d <= todayIso;
  };
  const fresh = leads.filter((l) => inPeriod(l.createdAt));
  const touched = leads.filter((l) => inPeriod(l.updatedAt));
  const tally = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  const className = (id: string) =>
    (masters.classes ?? []).find((c) => c.id === id)?.name || "";
  // A lead that arrived and moved on within the period counts in both, which
  // is what "what happened this week" means — not a funnel where each lead
  // appears once.
  const movedInto = (stage: string) =>
    touched.filter((l) => l.stage === stage).length;
  const open = leads.filter((l) => l.stage !== "enrolled" && l.stage !== "lost");
  return formatAdmissionsPeriodReply({
    periodLabel,
    fromDate,
    toDate: todayIso,
    todayIso,
    newEnquiries: fresh.length,
    bySource: tally(fresh, (l) => sourceLabel(l.source)),
    byClass: tally(fresh, (l) => className(l.classSoughtId)),
    moved: {
      applied: movedInto("applied"),
      verified: movedInto("verified"),
      enrolled: movedInto("enrolled"),
      lost: movedInto("lost"),
    },
    lostReasons: tally(
      touched.filter((l) => l.stage === "lost"),
      (l) => (l.lostReason || "").trim() || "not recorded",
    ).map((r) => ({ reason: r.label, count: r.count })),
    followUps: {
      overdue: open.filter(
        (l) => l.nextFollowUpAt && l.nextFollowUpAt.slice(0, 10) < todayIso,
      ).length,
      dueToday: open.filter(
        (l) => l.nextFollowUpAt && l.nextFollowUpAt.slice(0, 10) === todayIso,
      ).length,
    },
    pipelineOpen: open.length,
  });
}

async function schoolSnapshot(session: DemoSession, todayIso: string): Promise<string> {
  const { buildPrincipalSnapshot } = await import("@/lib/principalSnapshot.server");
  const { countRecentWaFailures } = await import("@/lib/waDeliveryLog.server");
  const [snapResult, waResult] = await Promise.allSettled([
    buildPrincipalSnapshot(session.academicYearCode),
    countRecentWaFailures(24),
  ]);
  if (snapResult.status !== "fulfilled") {
    console.warn("[erpCommands] snapshot failed", snapResult.reason);
    return "The snapshot couldn't be built just now. Please try again in a minute, or open the ERP home page.";
  }
  const snap = snapResult.value;
  return formatSchoolSnapshotReply({
    date: snap.attendance.date || todayIso,
    todayIso,
    academicYearCode: snap.academicYearCode,
    fees: {
      todayPaise: snap.fees.todayCollectionPaise,
      mtdPaise: snap.fees.mtdCollectionPaise,
      openDuesPaise: snap.fees.openDuesPaise,
      defaulterHouseholds: snap.fees.defaulterHouseholds,
    },
    attendance: {
      present: snap.attendance.studentPresent,
      absent: snap.attendance.studentAbsent,
      leave: snap.attendance.studentLeave,
      markedPct: snap.attendance.studentMarkedPct,
      sectionsMarked: snap.attendance.sectionsMarked,
      registersPending: snap.alerts.attendanceRegistersPending,
    },
    staff: {
      active: snap.staff.activeCount,
      present: snap.staff.presentToday,
      absent: snap.staff.absentToday,
    },
    admissions: snap.admissions,
    alerts: {
      vaultExpiring30d: snap.alerts.vaultExpiring30d,
      lowStockSkus: snap.alerts.lowStockSkus,
      // A failed WhatsApp count is a nice-to-have; the snapshot still
      // answers without it rather than failing whole.
      waFailures24h: waResult.status === "fulfilled" ? waResult.value : 0,
    },
    formatInr,
  });
}

async function studentDetails(
  resolved: Record<string, string>,
  session: DemoSession,
): Promise<string> {
  await ensureTransportHydratedServer();
  const sis = loadSis();
  const masters = loadMasters();
  const student = sis.students.find((st) => st.id === resolved.studentId);
  if (!student) return "That student record has gone missing. Please try again.";
  const hh = student.householdId
    ? sis.households.find((h) => h.id === student.householdId)
    : undefined;
  const siblings = student.householdId
    ? sis.students.filter(
        (st) =>
          st.id !== student.id &&
          st.householdId === student.householdId &&
          st.status === "active" &&
          st.academicYearCode === session.academicYearCode,
      )
    : [];
  const transport = loadTransport();
  const assignment = (transport.assignments ?? []).find(
    (a) => a.studentId === student.id && a.effectiveTo == null && !a.boardingSuspended,
  );
  const route = assignment
    ? (transport.routes ?? []).find((r) => r.id === assignment.routeId)
    : undefined;
  const stop = route ? (route.stops ?? []).find((sp) => sp.id === assignment!.stopId) : undefined;
  const routeLabel = route
    ? [route.busNo ? `Bus ${route.busNo}` : route.code, route.name].filter(Boolean).join(" · ")
    : student.transportRoute || "";
  return formatStudentDetailsReply({
    fullName: student.fullName,
    classLabel: classLabel(masters, student.classId, student.sectionId).replace(" · ", " "),
    rollNo: student.rollNo,
    admissionNo: student.admissionNo,
    status: student.status,
    gender: student.gender,
    dob: student.dob,
    bloodGroup: student.bloodGroup,
    guardianName: hh?.guardianName || "",
    fatherName: student.fatherName,
    motherName: student.motherName,
    fatherMobile: student.fatherMobile,
    motherMobile: student.motherMobile,
    householdMobile: hh ? householdWhatsApp(hh) || hh.mobile : "",
    locality: [hh?.locality, hh?.city].filter(Boolean).join(", "),
    transport: routeLabel ? { routeLabel, stopName: stop?.name || "" } : null,
    siblings: siblings.map((st) => ({
      fullName: st.fullName,
      classLabel: classLabel(masters, st.classId, st.sectionId).replace(" · ", " "),
    })),
    hasMedicalNote: !!(student.medicalNotes || "").trim(),
    isCwsn: !!student.isCwsn,
    detail: resolved.detail === "full" ? "full" : "basic",
  });
}

function maskMobile10(m: string): string {
  const d = (m || "").replace(/\D/g, "");
  return d.length < 6 ? d : `${d.slice(0, 2)}xxxxxx${d.slice(-2)}`;
}

async function busManifest(
  resolved: Record<string, string>,
  session: DemoSession,
  todayIso: string,
): Promise<string> {
  await ensureTransportHydratedServer();
  const state = loadTransport();
  const masters = loadMasters();
  const sis = loadSis();
  const date = resolved.date || todayIso;
  const asked = (resolved.route || "").trim();
  const routes = (state.routes ?? []).filter((r) => r.isActive !== false);
  const matches = matchTransportRoutes(routes, asked);
  if (matches.length !== 1) {
    return formatRouteNotFound(
      resolved.route || "",
      (matches.length ? matches : routes)
        .slice(0, 10)
        .map((r) => [r.busNo ? `Bus ${r.busNo}` : "", r.code, r.name].filter(Boolean).join(" · ")),
    );
  }
  const route = matches[0]!;
  const live = (state.assignments ?? []).filter(
    (a) => a.routeId === route.id && a.effectiveTo == null,
  );
  // Which year is actually on the bus — the latest year with live riders,
  // exactly as the driver's manifest endpoint derives it.
  const ay =
    live.map((a) => a.academicYearCode).filter(Boolean).sort().pop() || session.academicYearCode;
  const riders = live.filter((a) => a.academicYearCode === ay);
  const marks = new Map(
    (state.boardingEvents ?? [])
      .filter((e) => e.date === date && e.routeId === route.id)
      .map((e) => [e.studentId, e.status]),
  );
  const byId = new Map(sis.students.map((st) => [st.id, st]));
  const stops = [...(route.stops ?? [])]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map((stop) => ({
      name: stop.name,
      distanceLabel: stop.distanceKm > 0 ? `${stop.distanceKm} km` : "",
      riders: riders
        .filter((a) => a.stopId === stop.id)
        .map((a) => {
          const st = byId.get(a.studentId);
          const mark = marks.get(a.studentId);
          return {
            fullName: st?.fullName || "—",
            classLabel: st ? classLabel(masters, st.classId, st.sectionId).replace(" · ", " ") : "",
            rollNo: st?.rollNo || "",
            suspended: !!a.boardingSuspended,
            mark: mark === "boarded" ? "boarded" : mark === "absent" ? "absent" : mark ? String(mark) : "",
          };
        })
        .sort((a, b) => a.classLabel.localeCompare(b.classLabel) || a.fullName.localeCompare(b.fullName)),
    }));
  const vehicle = (state.vehicles ?? []).find((v) => v.id === route.vehicleId);
  const driverStaff = vehicle?.driverStaffId
    ? (masters.staff ?? []).find((st) => st.id === vehicle.driverStaffId)
    : undefined;
  return formatBusManifestReply({
    routeLabel: [route.busNo ? `Bus ${route.busNo}` : route.code, route.name].filter(Boolean).join(" · "),
    vehicleReg: route.vehicleReg || vehicle?.registrationNo || "",
    driver: {
      name: vehicle?.driverName || driverStaff?.fullName || "",
      mobile: vehicle?.driverMobile || driverStaff?.mobile || "",
    },
    date,
    todayIso,
    stops,
    markedCount: riders.filter((a) => marks.has(a.studentId)).length,
    formatMobile: maskMobile10,
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
/**
 * The order to fill a template's parameters in.
 *
 * Meta positions body parameters — {{1}}, {{2}} — so the order the confirm
 * card was built from is the order the send has to use. It is frozen onto
 * the card for exactly that reason; the lookup by id is only for a card
 * that was raised before this was stored, and returns an empty list rather
 * than throwing, which is what the old browser-path lookup did on every
 * single send.
 */
async function templateVariableOrder(
  r: Record<string, string>,
): Promise<string[]> {
  const frozen = (r.templateVariables || "").split(",").filter(Boolean);
  if (frozen.length) return frozen;
  if (!r.templateId) return [];
  const { getTemplateByIdServer } = await import("@/lib/waTemplatesRead.server");
  const tpl = await getTemplateByIdServer(r.templateId);
  return tpl?.variables ?? [];
}

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
  if (command.channels && !command.channels.includes(inbound.channel)) {
    return {
      handled: true,
      audience: "erp_command_confirm",
      text: `"${command.title}" isn't available on this channel.`,
    };
  }
  if (!inbound.staff) {
    return {
      handled: true,
      audience: "erp_command_denied",
      text: "Your number isn't linked to a staff record, so nothing was changed.",
    };
  }
  const [masters, rbac] = await Promise.all([loadServerMasters(), loadServerRbac()]);
  const session = staffSessionFor(inbound.staff, masters);
  // Permission is re-checked at confirm time, not trusted from the card:
  // a role can change in the minutes a card sits waiting.
  if (!hasPermission(session, masters, command.module, command.action, rbac)) {
    void audit(session, command, pending.fields, pending.originalText, "denied", {
      reason: "rbac_at_confirm",
      channel: inbound.channel,
    });
    return {
      handled: true,
      audience: "erp_command_denied",
      text: `Your role no longer includes *${command.module} · ${command.action}*, so nothing was changed.`,
    };
  }
  const r = pending.resolved;
  if (command.id === "post_homework") {
    if (r.sectionId) {
      const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
      const mine = staffAllowedSections(inbound.staff, masters, session.academicYearCode, roleCodes);
      if (!isOfficeLike(roleCodes) && !mine.some((x) => x.sectionId === r.sectionId)) {
        void audit(session, command, pending.fields, pending.originalText, "denied", {
          reason: "scope_at_confirm",
          channel: inbound.channel,
        });
        return {
          handled: true,
          audience: "erp_command_denied",
          text: "That section is no longer one of yours, so nothing was posted.",
        };
      }
    }
    const { postHomeworkServer } = await import("@/lib/homeworkPost.server");
    const res = await postHomeworkServer({
      session,
      masters,
      classId: r.classId || "",
      sectionId: r.sectionId || "",
      subjectId: r.subjectId || "",
      title: r.title || "",
      bodyEn: r.body || "",
      dueAt: r.dueAt || "",
    });
    if (!res.ok) {
      void audit(session, command, pending.fields, pending.originalText, "error", {
        reason: res.error,
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_error",
        text: `Couldn't post it: ${res.error}`,
      };
    }
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      postId: res.post.id,
      sectionId: res.post.sectionId,
      subjectId: res.post.subjectId,
      dueAt: res.post.dueAt || "",
    });
    const label = (r.sectionLabel || "").replace(" · ", " ");
    return {
      handled: true,
      audience: "erp_command_post_homework",
      text: `Posted. ${label} ${r.subjectName || ""} homework is live${res.push.sent ? ` · ${res.push.sent} phone${res.push.sent === 1 ? "" : "s"} notified` : ""}.\nUndo it in the ERP: Homework → today's posts.`,
    };
  }
  if (command.id === "pay_link") {
    if (!r.studentId) {
      return {
        handled: true,
        audience: "erp_command_error",
        text: "That payment link request is no longer valid. Send it again.",
      };
    }
    const { createAndSendPayLink } = await import("@/lib/feePayLink.server");
    const res = await createAndSendPayLink({
      session,
      masters,
      studentId: r.studentId,
      todayIso: istDateOf(),
      template: r.templateMetaName
        ? {
            metaName: r.templateMetaName,
            language: r.templateLanguage || "en",
            variables: (r.templateVariables || "").split(",").filter(Boolean),
          }
        : null,
      expiresInDays: 7,
    });
    if (!res.ok) {
      void audit(session, command, pending.fields, pending.originalText, "error", {
        reason: res.error,
        channel: inbound.channel,
        studentId: r.studentId,
      });
      return { handled: true, audience: "erp_command_error", text: `Couldn't raise the link: ${res.error}` };
    }
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      studentId: r.studentId,
      linkId: res.link.id,
      linkCode: res.link.code,
      amountPaise: res.link.amountPaise,
      gateway: res.gatewayMode,
      whatsappSent: res.whatsapp.sent,
    });
    const bits = [`Link ${res.link.code} raised for ${formatInr(res.link.amountPaise)}`];
    bits.push(
      res.whatsapp.sent
        ? "sent to the parent"
        : `not sent (${res.whatsapp.error || "no template"}) — share it yourself`,
    );
    return {
      handled: true,
      audience: "erp_command_pay_link",
      text: `${bits.join(" · ")}.\n${res.checkoutUrl}\nThe receipt posts itself once they pay.`,
    };
  }
  if (command.id === "fee_reminder") {
    let recipients: import("@/lib/feeReminder.server").FeeReminderRecipient[];
    try {
      recipients = JSON.parse(r.recipients || "[]") as typeof recipients;
    } catch {
      recipients = [];
    }
    if (!recipients.length || !r.templateMetaName) {
      return {
        handled: true,
        audience: "erp_command_error",
        text: "That reminder run is no longer valid. Send the command again.",
      };
    }
    const { inFeeReminderQuietHours, istHourNow, sendFeeReminders } = await import(
      "@/lib/feeReminder.server"
    );
    // Re-checked at confirm: a card can sit past 8 pm before anyone taps it.
    if (inFeeReminderQuietHours(istHourNow())) {
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "It's past 8 pm now — nothing was sent. Try again after 8 am.",
      };
    }
    const today = istDateOf();
    const res = await sendFeeReminders({
      recipients,
      template: {
        metaName: r.templateMetaName,
        language: r.templateLanguage || "en",
        variables: (r.templateVariables || "").split(",").filter(Boolean),
      },
      templatesByLang: parseTemplatesByLang(r.templatesByLang),
      todayIso: today,
    });
    // Record who was reminded so the weekly cap holds across channels.
    const st = await readStore();
    await writeStore({
      ...st,
      feeRemindedOn: { ...(st.feeRemindedOn ?? {}), ...res.remindedOn },
    });
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      title: r.title,
      template: r.templateMetaName,
      sent: res.sent,
      failed: res.failed,
    });
    const bits = [`Reminded ${res.sent} famil${res.sent === 1 ? "y" : "ies"} in ${r.title || "that class"}`];
    if (res.failed) bits.push(`${res.failed} failed`);
    return {
      handled: true,
      audience: "erp_command_fee_reminder",
      text: `${bits.join(" · ")}.${res.errors.length ? `\nFirst error: ${res.errors[0]}` : ""}\nReplies land in Comms → WhatsApp inbox.`,
    };
  }
  if (command.id === "bus_delay") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
    if (!isOfficeLike(roleCodes) && !roleCodes.includes("transport")) {
      void audit(session, command, pending.fields, pending.originalText, "denied", {
        reason: "scope_at_confirm",
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "Your role no longer allows sending transport notices, so nothing was sent.",
      };
    }
    let recipients: import("@/lib/busDelayNotice.server").BusDelayRecipient[];
    try {
      recipients = JSON.parse(r.recipients || "[]") as typeof recipients;
    } catch {
      recipients = [];
    }
    const minutes = parseInt(r.minutesLate || "0", 10) || 0;
    if (!recipients.length || !r.templateMetaName || !minutes) {
      return {
        handled: true,
        audience: "erp_command_error",
        text: "That delay notice is no longer valid. Send the command again.",
      };
    }
    const { sendBusDelayNotices } = await import("@/lib/busDelayNotice.server");
    const sentAt = new Date().toISOString();
    const res = await sendBusDelayNotices({
      recipients,
      busNo: r.busNo || "",
      minutesLate: minutes,
      template: {
        metaName: r.templateMetaName,
        language: r.templateLanguage || "en",
        variables: (r.templateVariables || "").split(",").filter(Boolean),
      },
      templatesByLang: parseTemplatesByLang(r.templatesByLang),
      // The minutes are part of the key so a second notice on the same
      // route is a new message, not a de-duplicated repeat of the first.
      noticeKey: `${r.routeId || ""}_${minutes}_${sentAt.slice(0, 16)}`,
    });
    if (r.routeId) {
      const st = await readStore();
      await writeStore({
        ...st,
        busDelayedAt: { ...(st.busDelayedAt ?? {}), [r.routeId]: sentAt },
      });
    }
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      routeId: r.routeId,
      routeLabel: r.routeLabel,
      minutesLate: minutes,
      template: r.templateMetaName,
      sent: res.sent,
      failed: res.failed,
    });
    const bits = [
      `Told ${res.sent} famil${res.sent === 1 ? "y" : "ies"} on ${r.routeLabel || "that route"} — ${minutes} minutes late`,
    ];
    if (res.failed) bits.push(`${res.failed} failed`);
    return {
      handled: true,
      audience: "erp_command_bus_delay",
      text: `${bits.join(" · ")}.${res.errors.length ? `\nFirst error: ${res.errors[0]}` : ""}\nReplies land in Comms → WhatsApp inbox.`,
    };
  }
  if (command.id === "book_ptm") {
    if (!r.slotId || !r.eventId || !r.studentId) {
      return {
        handled: true,
        audience: "erp_command_error",
        text: "That PTM booking is no longer valid. Send the command again.",
      };
    }
    {
      const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
      if (!isOfficeLike(roleCodes)) {
        const mine = staffAllowedSections(inbound.staff, masters, session.academicYearCode, roleCodes);
        const st = loadSis().students.find((x) => x.id === r.studentId);
        if (st && !mine.some((x) => x.sectionId === st.sectionId)) {
          void audit(session, command, pending.fields, pending.originalText, "denied", {
            reason: "scope_at_confirm",
            channel: inbound.channel,
          });
          return {
            handled: true,
            audience: "erp_command_denied",
            text: "That child's section is no longer one of yours, so nothing was booked.",
          };
        }
      }
    }
    let vars: Record<string, string> = {};
    try {
      vars = JSON.parse(r.vars || "{}") as Record<string, string>;
    } catch {
      vars = {};
    }
    const ptmVars = await templateVariableOrder(r);
    const { bookPtmSlotServer } = await import("@/lib/ptmBook.server");
    const res = await bookPtmSlotServer({
      studentId: r.studentId,
      eventId: r.eventId,
      slotId: r.slotId,
      // The booking belongs to the family, not to the staff member who
      // took the call, so the parent's name is what the register shows.
      parentName: r.guardianName || "Parent",
      householdId: r.householdId || "",
      notify: true,
      template: r.templateMetaName
        ? {
            metaName: r.templateMetaName,
            language: r.templateLanguage || "en",
            variables: ptmVars,
            vars,
          }
        : null,
    });
    if (!res.ok) {
      void audit(session, command, pending.fields, pending.originalText, "error", {
        reason: res.error,
        channel: inbound.channel,
        studentId: r.studentId,
      });
      return { handled: true, audience: "erp_command_error", text: `Couldn't book it: ${res.error}` };
    }
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      studentId: r.studentId,
      eventId: r.eventId,
      slotId: r.slotId,
      bookingId: res.booking.id,
      persisted: res.persisted,
      pushSent: res.pushSent,
      whatsappSent: res.whatsapp.sent,
    });
    const bits = [
      `Booked · ${res.studentName} · ${res.event.name} ${res.slot.startAt} with ${res.slot.teacherName}`,
    ];
    if (res.pushSent) bits.push("family told on the app");
    bits.push(res.whatsapp.sent ? "WhatsApp sent" : `WhatsApp not sent (${res.whatsapp.error || "no template"})`);
    const tail = res.persisted
      ? "Change it in the ERP: PTM → bookings."
      : `⚠️ Saved here but not to the database (${res.persistError}) — check PTM → bookings in the ERP.`;
    return {
      handled: true,
      audience: "erp_command_book_ptm",
      text: `${bits.join(" · ")}.\n${tail}`,
    };
  }
  if (command.id === "decide_leave") {
    if (!r.leaveRequestId) {
      return {
        handled: true,
        audience: "erp_command_error",
        text: "That leave request is no longer valid. Send the command again.",
      };
    }
    const { decideStudentLeaveServer } = await import("@/lib/studentLeaveDecide.server");
    const res = await decideStudentLeaveServer({
      session,
      masters,
      requestId: r.leaveRequestId,
      approve: !!r.approve,
      note: r.note || "",
      todayIso: istDateOf(),
    });
    if (!res.ok) {
      void audit(session, command, pending.fields, pending.originalText, "error", {
        reason: res.error,
        channel: inbound.channel,
      });
      return { handled: true, audience: "erp_command_error", text: `Couldn't record it: ${res.error}` };
    }
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      requestId: r.leaveRequestId,
      decision: res.request.status,
      appliedDates: res.appliedDates.length,
      pendingDates: res.pendingDates.length,
    });
    const bits = [`${res.request.status === "approved" ? "Approved" : "Rejected"} · ${res.studentName}`];
    if (res.appliedDates.length) bits.push(`marked on ${res.appliedDates.length} day${res.appliedDates.length === 1 ? "" : "s"}`);
    if (res.pendingDates.length) bits.push(`${res.pendingDates.length} day${res.pendingDates.length === 1 ? "" : "s"} still to be marked`);
    if (res.pushSent) bits.push("family told");
    return {
      handled: true,
      audience: "erp_command_decide_leave",
      text: `${bits.join(" · ")}.\nAttendance → Leave in the ERP has the full record.`,
    };
  }
  if (command.id === "raise_complaint") {
    if (!r.householdId || !r.body) {
      return {
        handled: true,
        audience: "erp_command_error",
        text: "That complaint is no longer valid. Send it again.",
      };
    }
    const { appendServerComplaintTicket } = await import("@/lib/complaintsServer");
    const res = await appendServerComplaintTicket({
      householdId: r.householdId,
      studentId: r.studentId || null,
      raisedByName: r.guardianName || session.fullName,
      raisedByMobile: r.guardianMobile || "",
      category: r.category as Parameters<typeof appendServerComplaintTicket>[0]["category"],
      subject: r.subject || "",
      description: r.body,
      // Taken by a staff member on the family's behalf — the same source
      // the office uses for a walk-in or a phone call.
      source: "office",
    });
    if (!res.ok) {
      void audit(session, command, pending.fields, pending.originalText, "error", {
        reason: res.error,
        channel: inbound.channel,
      });
      return { handled: true, audience: "erp_command_error", text: `Couldn't file it: ${res.error}` };
    }
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      ticketId: res.ticket.id,
      studentId: r.studentId,
      category: r.category,
    });
    return {
      handled: true,
      audience: "erp_command_raise_complaint",
      text: `Filed. Ref ${res.ticket.id.slice(-6).toUpperCase()} · ${r.studentName || ""} · ${r.category}.\nAssign and resolve it in the ERP: Complaints.`,
    };
  }
  if (command.id === "staff_broadcast") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
    if (!isOfficeLike(roleCodes)) {
      void audit(session, command, pending.fields, pending.originalText, "denied", {
        reason: "scope_at_confirm",
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "Your role no longer allows broadcasting to staff, so nothing was sent.",
      };
    }
    const staffIds = (r.staffIds || "").split(",").filter(Boolean);
    const mobiles = (r.mobiles || "").split(",").filter(Boolean);
    if (!staffIds.length) {
      return {
        handled: true,
        audience: "erp_command_error",
        text: "That broadcast is no longer valid. Send it again.",
      };
    }
    // Phones first: every staff member has the app, and push carries the
    // message as written whether or not a template exists.
    const { sendPushToSubjects } = await import("@/lib/webPush.server");
    const push = await sendPushToSubjects("staff", staffIds, {
      title: `${session.fullName} · ${TENANT.shortName}`,
      body: r.message && r.message.length > 200 ? `${r.message.slice(0, 197)}…` : r.message || "",
      url: "/notices",
      data: { kind: "broadcast" },
    }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));

    let wa = { recipientCount: 0, skippedOptOut: 0, sent: 0, failed: 0 };
    if (r.templateMetaName && mobiles.length) {
      let vars: Record<string, string> = {};
      try {
        vars = JSON.parse(r.vars || "{}") as Record<string, string>;
      } catch {
        vars = {};
      }
      const { buildWaTemplateBodyComponent } = await import("@/lib/waSend");
      const { broadcastTemplateToMobiles } = await import("@/lib/waBroadcast.server");
      wa = await broadcastTemplateToMobiles({
        mobiles,
        template: {
          name: r.templateMetaName,
          language: r.templateLanguage || "en",
          components: [
            buildWaTemplateBodyComponent(await templateVariableOrder(r), vars),
          ],
        },
        module: "notices",
        originUrl: publicOrigin(),
      });
    }
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      staffCount: staffIds.length,
      pushSent: push.sent,
      waSent: wa.sent,
      waFailed: wa.failed,
      template: r.templateMetaName || "(none)",
      message: r.message,
    });
    const bits = [`${push.sent} phone${push.sent === 1 ? "" : "s"} notified`];
    if (r.templateMetaName) {
      bits.push(`WhatsApp to ${wa.sent} of ${wa.recipientCount}`);
      if (wa.failed) bits.push(`${wa.failed} failed`);
    } else {
      bits.push("WhatsApp skipped (no approved notice template)");
    }
    return {
      handled: true,
      audience: "erp_command_staff_broadcast",
      text: `Sent to ${staffIds.length} staff · ${bits.join(" · ")}.`,
    };
  }
  if (command.id === "class_message") {
    const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
    const mine = staffAllowedSections(inbound.staff, masters, session.academicYearCode, roleCodes);
    if (!isOfficeLike(roleCodes) && !mine.some((x) => x.sectionId === r.sectionId)) {
      void audit(session, command, pending.fields, pending.originalText, "denied", {
        reason: "scope_at_confirm",
        channel: inbound.channel,
      });
      return {
        handled: true,
        audience: "erp_command_denied",
        text: "That section is no longer one of yours, so nothing was sent.",
      };
    }
    const mobiles = (r.mobiles || "").split(",").filter(Boolean);
    if (!mobiles.length || !r.templateMetaName) {
      return {
        handled: true,
        audience: "erp_command_error",
        text: "That message is no longer valid. Send it again.",
      };
    }
    let vars: Record<string, string> = {};
    try {
      vars = JSON.parse(r.vars || "{}") as Record<string, string>;
    } catch {
      vars = {};
    }
    const { buildWaTemplateBodyComponent } = await import("@/lib/waSend");
    const { broadcastTemplateToMobiles } = await import("@/lib/waBroadcast.server");
    const order = await templateVariableOrder(r);
    const fallbackTpl = {
      metaName: r.templateMetaName,
      language: r.templateLanguage || "en",
      variables: order,
    };
    const byLang = parseTemplatesByLang(r.templatesByLang);
    // One broadcast per language the section's families read. A single
    // send would have written to all of them in whichever language the
    // teacher happened to type the notice in.
    const groups = parseMobilesByLang(r.mobilesByLang) ?? { "": mobiles };
    const res = { recipientCount: 0, skippedOptOut: 0, sent: 0, failed: 0 };
    for (const [lang, groupMobiles] of Object.entries(groups)) {
      if (!groupMobiles.length) continue;
      const tpl = templateForFamily(byLang ?? null, lang, fallbackTpl) ?? fallbackTpl;
      const one = await broadcastTemplateToMobiles({
        mobiles: groupMobiles,
        template: {
          name: tpl.metaName,
          language: tpl.language,
          components: [buildWaTemplateBodyComponent(tpl.variables, vars)],
        },
        module: "notices",
        originUrl: publicOrigin(),
      });
      res.recipientCount += one.recipientCount;
      res.skippedOptOut += one.skippedOptOut;
      res.sent += one.sent;
      res.failed += one.failed;
    }
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      sectionId: r.sectionId,
      template: r.templateMetaName,
      languages: Object.keys(groups).filter((k) => groups[k]!.length).join(","),
      recipients: res.recipientCount,
      sent: res.sent,
      failed: res.failed,
      message: r.message,
    });
    const label = (r.sectionLabel || "").replace(" · ", " ");
    const bits = [`Sent to ${res.sent} of ${res.recipientCount} families in ${label}`];
    if (res.failed) bits.push(`${res.failed} failed`);
    if (res.skippedOptOut) bits.push(`${res.skippedOptOut} opted out`);
    return {
      handled: true,
      audience: "erp_command_class_message",
      text: `${bits.join(" · ")}.\nReplies land in the ERP: Comms → WhatsApp inbox.`,
    };
  }
  if (command.id === "mark_attendance") {
    if (r.sectionId) {
      const roleCodes = resolveSessionRoles(rbac, session, masters).map((x) => x.code);
      const mine = staffAllowedSections(inbound.staff, masters, session.academicYearCode, roleCodes);
      if (!isOfficeLike(roleCodes) && !mine.some((x) => x.sectionId === r.sectionId)) {
        void audit(session, command, pending.fields, pending.originalText, "denied", {
          reason: "scope_at_confirm",
          channel: inbound.channel,
        });
        return {
          handled: true,
          audience: "erp_command_denied",
          text: "That section is no longer one of yours, so nothing was marked.",
        };
      }
    }
    let marks: { studentId: string; status: AttendanceStatus; note: string }[];
    try {
      marks = JSON.parse(r.marks || "[]") as typeof marks;
    } catch {
      marks = [];
    }
    if (!marks.length) {
      return {
        handled: true,
        audience: "erp_command_error",
        text: "That register is no longer valid. Send the command again.",
      };
    }
    const { markAttendanceServer } = await import("@/lib/attendanceMark.server");
    const res = await markAttendanceServer({
      session,
      masters,
      classId: r.classId || "",
      sectionId: r.sectionId || "",
      date: r.date || istDateOf(),
      marks,
      remark: r.correcting ? "Corrected via ERP command" : "Marked via ERP command",
    });
    if (!res.ok) {
      void audit(session, command, pending.fields, pending.originalText, "error", {
        reason: res.error,
        channel: inbound.channel,
      });
      return { handled: true, audience: "erp_command_error", text: `Couldn't mark it: ${res.error}` };
    }
    const absent = marks.filter((m) => m.status === "A").length;
    const present = marks.filter((m) => m.status === "P").length;
    void audit(session, command, pending.fields, pending.originalText, "ok", {
      channel: inbound.channel,
      registerId: res.register.id,
      sectionId: r.sectionId,
      date: r.date,
      present,
      absent,
      correcting: !!r.correcting,
    });
    return {
      handled: true,
      audience: "erp_command_mark_attendance",
      text: `${r.correcting ? "Corrected" : "Marked"}. ${(r.sectionLabel || "").replace(" · ", " ")} · present ${present}, absent ${absent}${res.push.sent ? ` · ${res.push.sent} famil${res.push.sent === 1 ? "y" : "ies"} told` : ""}.\nChange it in the ERP: Attendance → register.`,
    };
  }
  return {
    handled: true,
    audience: "erp_command_confirm",
    text: `"${command.title}" is not enabled yet.`,
  };
}

/** Active families in a section — what "who will be notified" means. */
function countSectionFamilies(sectionId: string, academicYearCode: string): number {
  if (!sectionId) return 0;
  const households = new Set(
    loadSis()
      .students.filter(
        (st) =>
          st.status === "active" &&
          st.sectionId === sectionId &&
          st.academicYearCode === academicYearCode &&
          st.householdId,
      )
      .map((st) => st.householdId),
  );
  return households.size;
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

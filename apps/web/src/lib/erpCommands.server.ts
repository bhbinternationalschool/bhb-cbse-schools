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
import { findRegister, loadAttendance } from "@/lib/attendance";
import { householdWhatsApp, loadSis, type SisStudent } from "@/lib/sis";
import { computeHouseholdDues, loadFees, openFeeDues } from "@/lib/fees";
import { flagFutureDues } from "@/lib/feeDueFuture";
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
  formatHelpReply,
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
  if (command.fields.some((f) => f.type === "section")) {
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

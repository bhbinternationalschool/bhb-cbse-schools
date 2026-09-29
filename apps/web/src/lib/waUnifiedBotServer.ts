/**
 * Unified school WhatsApp entry — role-aware greeting + visitor onboarding + flow delegation.
 */

import { TENANT } from "@/lib/types";
import { handleWaGateVisit, type WaGateVisitPending } from "@/lib/waGateVisit.server";
import { handleLeaveCommand } from "@/lib/leaveCommand.server";
import {
  composeActiveFlowHint,
  composeCollectPurposePrompt,
  composeRolePickPrompt,
  composeUnifiedSchoolGreeting,
  detectVisitorPurpose,
  flowKindFromRole,
  flowKindFromVisitorPurpose,
  shouldShowUnifiedMenu,
  looksLikeForward,
  readVisitorName,
  visitorNameRetryText,
  VISITOR_ASK_LIMIT,
  parseStaffBotSwitch,
  composeStaffFallbackText,
  isStaffHumanAsk,
  looksLikeStaffAsk,
  looksLikeParentAsk,
  VISITOR_PURPOSE_OPTIONS,
  STAFF_BOT_WINDOW_MINUTES,
  type WaVisitorPurpose,
  categoryForKnownIdentity,
} from "@/lib/waUnifiedBotEngine";
import {
  pickRoleByInput,
  type WaResolvedIdentity,
  type WaRoleKind,
} from "@/lib/waRoleResolver";
import { resolveWaIdentityServer } from "@/lib/waRoleResolver.server";
import { replyStaffBotIntentWithAi } from "@/lib/waStaffBotEngine";
import { detectStaffBotKeyword } from "@/lib/waStaffBotPrompts";
import {
  detectTransportBotIntent,
  replyTransportBotIntentWithAi,
  resolveTransportDriverContext,
} from "@/lib/waTransportBotEngine";
import { handleWaClassChannelInbound } from "@/lib/waClassChannelServer";
import { isLikelyClassChannelPost } from "@/lib/waClassChannelEngine";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { expectedWindowForTiming } from "@/lib/schoolTiming";
import { classifyStaffHolidayDay } from "@/lib/holidayPolicy";
import { handleWaCrmBotInbound } from "@/lib/waCrmBotServer";
import { handleWaSisBotInbound } from "@/lib/waSisBotServer";
import { handleWaSurveyBotInbound } from "@/lib/waSurveyBotServer";
import { handleWaStaffAttendanceInbound } from "@/lib/waStaffAttendanceBotServer";
import {
  detectOwnAttendanceAsk,
  detectStaffAttBotIntent,
  isEarlyOutConfirm,
  parseStaffAttLanguage,
} from "@/lib/waStaffAttendanceBotEngine";
import {
  composeMorningAttendanceAsk,
  composeOpenWorkReminder,
  composeRolesFooter,
  composeStaffFeedbackAck,
  composeFeedbackRecipientAsk,
  parseFeedbackRecipient,
  PRIVATE_FEEDBACK_LOG_TEXT,
  composeStaffLinkFound,
  composeStaffLinkIntro,
  composeStaffLinkRequested,
  composeStaffWorkGuide,
  DEFERRED_MAX,
  isCancelOpenWork,
  isRolesAsk,
  makeStaffLinkCode,
  maskMobile10,
  matchStaffForLink,
  parseRoleSwitch,
  parseSkipOwnAttendance,
  parseStaffFeedback,
  parseStaffLinkDecision,
  shouldAskMorningAttendance,
  staffWorkProfile,
  switchableRoles,
  type OpenWork,
  type StaffRoleNote,
} from "@/lib/staffOnboarding";
import { parseMarkAskReply } from "@/lib/erpCommands";
import {
  composeLeaveApproverRequest,
  composeLeaveAskDates,
  composeLeaveAskReason,
  composeLeaveAskType,
  composeLeaveBalances,
  composeLeaveLwpOffer,
  composeLeaveSent,
  composeLeaveSummary,
  formatLeaveDates,
  isLeaveBalanceAsk,
  leaveDecisionOpen,
  leaveTypeLabel,
  leaveUsedInMonth,
  leaveVerdict,
  parseLeaveApplyStart,
  parseLeaveCodeDecision,
  parseLeaveDates,
  parseLeaveType,
  type WaLeaveType,
} from "@/lib/staffLeaveWa";
import { isProtectedSuperAdminEmail } from "@/lib/superAdmin";
import type { StaffRecord } from "@/lib/foundationMasters";
import { handleErpStaffCommand } from "@/lib/erpCommands.server";
import { transcribeInboundVoiceNote, voiceNoteTranscriptionEnabled } from "@/lib/voiceNote.server";
import {
  isHandledMessage,
  rememberHandledMessage,
  type HandledMap,
} from "@/lib/waMessageDedupe";
import {
  VOICE_NOTE_PARENT_ACK,
  voiceNoteHubNote,
  type VoiceNoteUnusableReason,
} from "@/lib/voiceNote";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";
import {
  detectSisBotIntent,
  detectSisFeeQuestion,
  detectSisFeeReplyIntent,
  looksLikeAutoReply,
} from "@/lib/sisParentBotEngine";
import { matchSeedQuickReply } from "@/lib/waTemplates";
import { SCHOOL_DEFAULT_WA_LANGUAGE, waTemplateLanguageFor } from "@/lib/householdPrefs";
import { loadSis } from "@/lib/sis";
import { sendWhatsAppInteractive } from "@/lib/waInteractive";
import {
  appendWaHubExchange,
  categoryForUnifiedAudience,
} from "@/lib/waChatHub.server";
import {
  interactiveIdToText,
  menuKnownUserGreeting,
  menuUnknownWelcome,
  menuVisitorPurpose,
  roleFlowInteractiveMenu,
} from "@/lib/waUnifiedMenus";
import type { WaInteractiveMenu } from "@/lib/waInteractive";

export type WaUnifiedFlow = WaRoleKind | WaVisitorPurpose;

export type WaUnifiedSession = {
  mobile: string;
  displayName: string;
  visitorName: string;
  phase: "menu" | "pick_role" | "collect_name" | "collect_purpose" | "active" | "parked";
  activeFlow: WaUnifiedFlow | null;
  updatedAt: string;
  /** Pending gate check-in (VISIT keyword / poster WhatsApp QR). */
  gate?: WaGateVisitPending | null;
  /**
   * A document that arrived before this person chose what they wanted.
   *
   * 19 Sep 2026: a teacher sent their CV as the opening message. The bot
   * was collecting a name, the document was not the job flow's yet, and
   * the CV was never filed — the office learned of it only because the
   * applicant then typed HUMAN four times. Held here so that choosing JOB
   * files the CV they already sent, instead of asking them to send it again.
   */
  pendingDocument?: { mediaId: string; mimeType?: string; fileName?: string; at: string } | null;
  /**
   * A job seeker we asked for what their CV did not say (subject, classes,
   * qualification). Their next message is read as the answer and saved on
   * this application; after JOB_ASK_LIMIT asks the bot stops asking.
   */
  jobAsk?: { applicationId: string; asks: number; at: string } | null;
  /**
   * Until when the staff keyword bot answers this person, ISO. Unset or
   * past means the desk answers their commands and anything else gets the
   * short "didn't understand — try these" reply (composeStaffFallbackText).
   * It used to get silence; 29 Sep 2026 showed what silence looks like to
   * staff.
   */
  staffBotUntil?: string;
  /** IST date the morning "mark your attendance first" was asked. */
  morningAskOn?: string;
  /** When it was asked; it stops holding other questions after MORNING_OPEN_MS. */
  morningAskAt?: string;
  /** IST date the day's guide (your classes, what to type) was sent. */
  guideSentOn?: string;
  /**
   * A suggestion / requirement / complaint waiting for "who should get it?"
   * — kept here, never in the inbox, until it is sent to the chosen people.
   */
  pendingFeedback?: { kind: "suggestion" | "requirement" | "complaint"; body: string; at: string } | null;
  /** A leave application being filled in over WhatsApp. */
  leaveApply?: {
    step: "type" | "dates" | "reason" | "lwp" | "confirm";
    typeCode?: WaLeaveType;
    /** The type asked for, when it is going as Leave Without Pay instead. */
    askedType?: WaLeaveType;
    from?: string;
    to?: string;
    halfDay?: boolean;
    reason?: string;
    lwpWhy?: string;
    at: string;
  } | null;
  /**
   * Questions asked while a job was open — a punch waiting for its pin, a
   * register waiting for its absentees, a draft waiting for YES. Answered
   * as soon as the job is finished or dropped (answerDeferred).
   */
  deferred?: { text: string; at: string }[];
  /**
   * An unknown number finding its staff record so the number can be added
   * to it: asked who, shown the record, then waiting for the director.
   */
  staffLink?: {
    step: "who" | "confirm" | "requested";
    staffId?: string;
    code?: string;
    asks?: number;
    at: string;
  } | null;
  /**
   * Until when a staff member asked for quiet ("bot off"), ISO. Commands
   * still answer; only the "didn't understand" reply is held back, for
   * someone using this number to talk to the office.
   */
  staffQuietUntil?: string;
  /**
   * How many times we have re-asked this unknown caller for a name or a
   * purpose. At VISITOR_ASK_LIMIT the bot stops asking and parks the
   * thread for a person, rather than sending the same menu forever.
   */
  visitorAsks?: number;
};

type WaUnifiedStore = {
  version: 1;
  sessions: Record<string, WaUnifiedSession>;
  /**
   * WhatsApp message ids already picked up, so Meta's retries do not buy a
   * second reply and a second paid transcription. Optional: a store written
   * before this existed loads without it.
   */
  handled?: HandledMap;
  /**
   * Leave requests sent to the principal and admins, by the code in the
   * message ("LEAVE OK 4821"). A stable code, never a list position: the
   * pending list shifts as requests are decided, and "LEAVE OK 1" could then
   * approve somebody else's leave.
   */
  leaveCodes?: Record<string, { requestId: string; staffId: string; staffMobile10: string; at: string }>;
};

let memoryStore: WaUnifiedStore = { version: 1, sessions: {} };

async function readStore(): Promise<WaUnifiedStore> {
  const { loadWaBotSlice } = await import("@/lib/waBotStore.server");
  const remote = await loadWaBotSlice<WaUnifiedStore>("unified", memoryStore);
  if (remote?.version === 1 && remote.sessions) {
    memoryStore = remote;
    return remote;
  }
  return memoryStore;
}

async function writeStore(store: WaUnifiedStore): Promise<void> {
  memoryStore = store;
  const { saveWaBotSlice } = await import("@/lib/waBotStore.server");
  await saveWaBotSlice("unified", store);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sessionFor(
  mobile10: string,
  identity: WaResolvedIdentity,
  profileName?: string,
): WaUnifiedSession {
  const displayName =
    identity.displayName || profileName?.trim() || "";
  return {
    mobile: mobile10,
    displayName,
    visitorName: identity.isKnown ? displayName : "",
    phase:
      identity.isKnown && identity.roles.length > 1
        ? "pick_role"
        : identity.isKnown
          ? "active"
          : "menu",
    activeFlow:
      identity.isKnown && identity.roles.length === 1
        ? identity.roles[0]!.kind
        : null,
    updatedAt: nowIso(),
  };
}

async function sendBotReply(opts: {
  mobile10: string;
  displayName: string;
  category: ReturnType<typeof categoryForUnifiedAudience>;
  audience: string;
  flow?: string | null;
  menu?: { menu: WaInteractiveMenu; textFallback: string };
  text?: string;
  inbound?: { text: string; waMessageId?: string; interactiveId?: string };
}): Promise<boolean> {
  const { mobile10, displayName, category, audience, flow } = opts;
  if (opts.inbound) {
    await appendWaHubExchange({
      mobile10,
      displayName,
      category,
      source: audience,
      status: "open",
      inbound: opts.inbound,
    });
  }
  let outText = opts.text || opts.menu?.textFallback || "";
  let usedInteractive = false;
  if (opts.menu) {
    const r = await sendWhatsAppInteractive({
      toMobile: mobile10,
      menu: opts.menu.menu,
      textFallback: opts.menu.textFallback,
    });
    outText = opts.menu.textFallback;
    usedInteractive = r.usedInteractive;
    if (!r.ok && opts.text) {
      const t = await sendWhatsAppText({ toMobile: mobile10, body: opts.text });
      return t.ok || t.mode === "stub";
    }
  } else if (opts.text) {
    const t = await sendWhatsAppText({ toMobile: mobile10, body: opts.text });
    if (!t.ok && t.mode !== "stub") return false;
  }
  if (outText) {
    await appendWaHubExchange({
      mobile10,
      displayName,
      category,
      source: audience,
      status: "open",
      outbound: {
        text: outText,
        by: usedInteractive ? "School bot (buttons/list)" : "School bot",
        cannedId: opts.menu ? "interactive_menu" : undefined,
      },
    });
  }
  void flow;
  return true;
}

async function delegateActiveFlow(
  flow: WaUnifiedFlow,
  opts: {
    fromWaId: string;
    text: string;
    waMessageId?: string;
    profileName?: string;
    location?: {
      lat: number;
      lng: number;
      name?: string;
      address?: string;
      accuracyM?: number;
    };
    audio?: { mediaId: string; mimeType?: string } | null;
    document?: { mediaId: string; mimeType?: string; fileName?: string } | null;
    /**
     * Set by handleWaUnifiedInbound when a voice note arrived but could not
     * be turned into words. Carried down here because the decision it drives
     * — hand this to a human — belongs with flow routing, not with the
     * transcription call.
     */
    voiceNoteFailure?: VoiceNoteUnusableReason | null;
  },
  identity: WaResolvedIdentity,
  session: WaUnifiedSession,
): Promise<{
  replied: boolean;
  escalate: boolean;
  audience: string;
  stub: boolean;
  error?: string;
}> {
  const mobile10 = waNormalizeLocal10(opts.fromWaId);
  const inbound = { ...opts, fromUnified: true as const };

  if (flow === "teacher" || flow === "staff" || flow === "owner") {
    // "Show my attendance", "Mera attendance present karna hai" — the
    // sender's own punch, in their own words. See detectOwnAttendanceAsk.
    const own = opts.location ? null : detectOwnAttendanceAsk(opts.text, { staffSelf: flow === "teacher" });
    const att = await handleWaStaffAttendanceInbound(own ? { ...inbound, forceIntent: own } : inbound);
    if (att.handled) {
      return {
        replied: att.replied,
        escalate: att.escalate,
        audience: "staff_attendance",
        stub: att.stub,
        error: att.error,
      };
    }
  }

  // Leave decisions from the 6 PM brief — LEAVE, LEAVE OK 1, LEAVE NO 2.
  //
  // Ahead of the ERP command desk deliberately: that desk sends free text
  // to a model, and "LEAVE OK 1" is a three-word instruction with a
  // person's leave on the end of it. It must be parsed, not interpreted.
  // parseLeaveCommand returns not_a_command for anything that is not
  // exactly this shape — "leave application for tomorrow" and friends fall
  // straight through to the desk as before.
  if (flow === "teacher" || flow === "staff" || flow === "owner") {
    const staffRole =
      identity.roles.find((r) => r.kind === flow && r.staff) ??
      identity.roles.find((r) => r.staff);
    const leave = await handleLeaveCommand({
      text: opts.text,
      staff: staffRole?.staff ?? null,
      by: session.displayName || identity.displayName || mobile10,
    });
    if (leave.handled) {
      const ok = await sendBotReply({
        mobile10,
        displayName: session.displayName || identity.displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: "staff_leave",
        flow,
        text: leave.text,
        inbound: { text: opts.text, waMessageId: opts.waMessageId },
      });
      return { replied: ok, escalate: false, audience: "staff_leave", stub: !ok };
    }
  }

  // ERP command desk — "5A me aaj kaun absent hai" and friends. Runs before
  // the keyword bots for every staff kind, and steps aside (handled:false)
  // for anything that is not clearly a command, so the class channel and
  // the leadership snapshots keep answering what they answer today.
  if (flow === "teacher" || flow === "staff" || flow === "owner") {
    const staffRole =
      identity.roles.find((r) => r.kind === flow && r.staff) ??
      identity.roles.find((r) => r.staff);
    // A teacher's plain YES/NO can answer the desk's confirm card when no
    // class draft is waiting for it — see ErpCommandInbound.allowPlainConfirm.
    let allowPlainConfirm = false;
    if (flow === "teacher" && /^(yes|y|haan|ha|han|ok|okay|confirm|no|n|nahi|nahin|cancel|हाँ|हां|ठीक|नहीं|रद्द)$/i.test((opts.text || "").trim())) {
      const { classChannelPendingDraftFor } = await import("@/lib/waClassChannelServer");
      allowPlainConfirm = !(await classChannelPendingDraftFor(opts.fromWaId));
    }
    const cmd = await handleErpStaffCommand({
      actorKey: mobile10,
      channel: "whatsapp",
      text: opts.text,
      flow,
      staff: staffRole?.staff ?? null,
      displayName: session.displayName || identity.displayName,
      audio: opts.audio ?? null,
      allowPlainConfirm,
    });
    if (cmd.handled) {
      // Help for someone with more than one role says which one it is for,
      // and how to switch.
      const rolesFooter =
        cmd.audience === "erp_command_help" && cmd.text ? composeRolesFooter(roleNotesFor(identity), flow) : "";
      const cmdText = rolesFooter ? `${cmd.text}\n\n${rolesFooter}` : cmd.text;
      const ok = await sendBotReply({
        mobile10,
        displayName: session.displayName || identity.displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: cmd.audience,
        flow,
        menu: cmd.menu,
        text: cmdText,
        inbound: {
          text: opts.text || (opts.audio ? "[voice note]" : ""),
          waMessageId: opts.waMessageId,
        },
      });
      return { replied: ok, escalate: false, audience: cmd.audience, stub: !ok };
    }
  }

  // A voice note nobody could turn into words goes to a person.
  //
  // Reached only after the ERP command desk has had its turn, so a staff
  // command spoken aloud is still handled there (and its own reply covers
  // its own failure). Everyone else — parents above all — would otherwise
  // fall through to a keyword bot that cannot match "[voice note]" and
  // would answer as though nothing had been said.
  //
  // The reply promises a human and asks for nothing: telling a parent who
  // cannot type to type is the failure this whole path exists to remove.
  if (opts.voiceNoteFailure && !opts.text.trim()) {
    const name = session.visitorName || session.displayName || identity.displayName;
    await handleWaCrmBotInbound({
      ...inbound,
      text: voiceNoteHubNote(opts.voiceNoteFailure),
      visitorName: name,
      forceEscalate: true,
    });
    const ok = await sendBotReply({
      mobile10,
      displayName: name,
      category: categoryForUnifiedAudience(flow, flow),
      audience: "voice_note_handoff",
      flow,
      text: VOICE_NOTE_PARENT_ACK,
      inbound: {
        text: `[voice note] ${opts.voiceNoteFailure}`,
        waMessageId: opts.waMessageId,
      },
    });
    return {
      replied: ok,
      escalate: true,
      audience: "voice_note_handoff",
      stub: !ok,
    };
  }

  if (flow === "owner" || flow === "staff") {
    // The staff keyword bot answers only when it has been summoned.
    //
    // Before this, it answered every staff message the desk stepped aside
    // from. On a number staff also use to talk to the school, that is a
    // bot cutting into conversation: a greeting got a menu, a half-typed
    // thought got a canned line about admissions. The desk stays where it
    // was — it answers commands and says nothing else — and this bot now
    // waits to be asked for.
    const nowMs = Date.now();
    const sw = parseStaffBotSwitch(opts.text);
    if (sw) {
      const store = await readStore();
      const base = store.sessions[mobile10] ?? session;
      await writeStore({
        ...store,
        sessions: {
          ...store.sessions,
          [mobile10]: {
            ...base,
            staffBotUntil:
              sw === "on"
                ? new Date(nowMs + STAFF_BOT_WINDOW_MINUTES * 60_000).toISOString()
                : "",
            staffQuietUntil: sw === "off" ? new Date(nowMs + STAFF_QUIET_MS).toISOString() : "",
            updatedAt: nowIso(),
          },
        },
      });
      if (sw === "off") {
        await sendBotReply({
          mobile10,
          displayName: session.displayName || identity.displayName,
          category: categoryForUnifiedAudience(flow, flow),
          audience: "staff_bot_off",
          flow,
          text: "OK — for the next 12 hours I'll stay quiet on messages I don't understand. Commands still work (send *help* for the list); send *school bot* to switch replies back on.",
          inbound: { text: opts.text, waMessageId: opts.waMessageId },
        });
        return { replied: true, escalate: false, audience: "staff_bot_off", stub: false };
      }
      const pack = menuKnownUserGreeting(identity, unifiedHindiFor(identity));
      await sendBotReply({
        mobile10,
        displayName: session.displayName || identity.displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: "staff_bot_on",
        flow,
        menu: pack,
        inbound: { text: opts.text, waMessageId: opts.waMessageId },
      });
      return { replied: true, escalate: false, audience: "staff_bot_on", stub: false };
    }

    const displayName = session.displayName || identity.displayName;
    // Asked for a person: say so, and hand it to the office.
    if (isStaffHumanAsk(opts.text)) {
      const ok = await sendBotReply({
        mobile10,
        displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: "staff_human",
        flow,
        text: "Your message has gone to the school office. Someone will reply here.",
        inbound: { text: opts.text || "", waMessageId: opts.waMessageId },
      });
      return { replied: ok, escalate: true, audience: "staff_human", stub: !ok };
    }

    // The staff menu's own keywords — STAFF, FEE, TIMING, REPORTS, MENU —
    // typed as the whole message. The menu lists them, so they must work
    // whenever it has been shown; before 29 Sep they answered only inside a
    // "school bot" window nobody knew to open.
    const keyword = detectStaffBotKeyword(opts.text);
    if (keyword === "menu") {
      const pack = menuKnownUserGreeting(identity, unifiedHindiFor(identity));
      await sendBotReply({
        mobile10,
        displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: flow,
        flow,
        menu: pack,
      });
      return { replied: true, escalate: false, audience: flow, stub: false };
    }
    if (keyword !== "unknown") {
      const bot = await replyStaffBotIntentWithAi(keyword, opts.text, {
        fullName: displayName,
        isOwner: flow === "owner",
      });
      await sendBotReply({
        mobile10,
        displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: flow,
        flow,
        text: bot.text,
      });
      return { replied: true, escalate: bot.escalate, audience: flow, stub: false };
    }

    // Never silence — and not the old keyword bot's substring guesses and
    // its model either, which knows nothing about class lists or
    // attendance and could only point at REPORTS or HUMAN.
    return replyStaffFallback({ mobile10, flow, identity, session, text: opts.text, waMessageId: opts.waMessageId });
  }

  if (flow === "parent") {
    // "आधार सर्टिफिकेट" — the school's UIDAI certificate, prepared for the
    // office to sign (aadhaarCertificateRequest.server.ts). Ahead of the
    // parent bot, which would read it as a question it cannot answer.
    const { isAadhaarCertificateRequest } = await import("@/lib/aadhaarCertificate");
    if (isAadhaarCertificateRequest(opts.text)) {
      const { handleAadhaarCertificateRequest } = await import("@/lib/aadhaarCertificateRequest.server");
      const cert = await handleAadhaarCertificateRequest({
        mobile10,
        fromWaId: opts.fromWaId,
        text: opts.text,
        waMessageId: opts.waMessageId,
        profileName: opts.profileName,
        hindi: unifiedHindiFor(identity),
      });
      if (cert.handled) {
        const ok = await sendBotReply({
          mobile10,
          displayName: session.displayName || identity.displayName,
          category: categoryForUnifiedAudience("sis_parent", "parent"),
          audience: "sis_parent_aadhaar_certificate",
          flow,
          text: cert.reply,
          inbound: { text: opts.text, waMessageId: opts.waMessageId },
        });
        return { replied: ok, escalate: false, audience: "sis_parent_aadhaar_certificate", stub: !ok };
      }
    }
    const r = await handleWaSisBotInbound(inbound);
    return {
      replied: r.replied,
      escalate: r.escalate,
      audience: "sis_parent",
      stub: r.stub,
      error: r.error,
    };
  }

  if (flow === "teacher") {
    // HUMAN, and questions the desk did not recognise, are not class posts:
    // the class channel would draft any sentence as a notice to parents.
    // See isLikelyClassChannelPost.
    if (isStaffHumanAsk(opts.text)) {
      const ok = await sendBotReply({
        mobile10,
        displayName: session.displayName || identity.displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: "staff_human",
        flow,
        text: "Your message has gone to the school office. Someone will reply here.",
        inbound: { text: opts.text || "", waMessageId: opts.waMessageId },
      });
      return { replied: ok, escalate: true, audience: "staff_human", stub: !ok };
    }
    const subjectNames = (loadMasters().subjects ?? []).map((sub) => sub.nameEn || sub.code || "");
    if (!isLikelyClassChannelPost(opts.text, { subjectNames })) {
      return replyStaffFallback({ mobile10, flow, identity, session, text: opts.text, waMessageId: opts.waMessageId });
    }
    const r = await handleWaClassChannelInbound({
      fromWaId: opts.fromWaId,
      text: opts.text,
      waMessageId: opts.waMessageId,
      profileName: opts.profileName,
      fromUnified: true,
    });
    return {
      replied: r.replied,
      escalate: r.escalate,
      audience: "class_channel_teacher",
      stub: r.stub ?? false,
      error: r.error,
    };
  }

  if (flow === "survey") {
    const r = await handleWaSurveyBotInbound(inbound);
    return {
      replied: r.replied,
      escalate: r.escalate,
      audience: "survey_agent",
      stub: r.stub,
      error: r.error,
    };
  }

  if (flow === "transport") {
    const ctx = resolveTransportDriverContext(mobile10);
    if (!ctx) {
      const name = session.visitorName || session.displayName || "Guest";
      const note = opts.text.trim();
      await handleWaCrmBotInbound({
        ...inbound,
        text: note ? `[TRANSPORT] ${note}` : `HUMAN`,
        visitorName: name,
        forceEscalate: true,
      });
      const hint = composeActiveFlowHint("transport", name, unifiedHindiFor(identity));
      await sendBotReply({
        mobile10,
        displayName: name,
        category: "transport",
        audience: "visitor_transport",
        flow: "transport",
        text: hint,
      });
      return {
        replied: true,
        escalate: true,
        audience: "visitor_transport",
        stub: false,
      };
    }
    const intent = detectTransportBotIntent(opts.text);
    if (intent === "menu") {
      const pack = menuKnownUserGreeting(identity, unifiedHindiFor(identity));
      await sendBotReply({
        mobile10,
        displayName: ctx.driverName,
        category: "transport",
        audience: "transport_driver",
        flow: "transport",
        menu: pack,
      });
      return {
        replied: true,
        escalate: false,
        audience: "transport_driver",
        stub: false,
      };
    }
    const bot = await replyTransportBotIntentWithAi(intent, opts.text, ctx);
    await sendBotReply({
      mobile10,
      displayName: ctx.driverName,
      category: "transport",
      audience: "transport_driver",
      flow: "transport",
      text: bot.text,
    });
    return {
      replied: true,
      escalate: bot.escalate,
      audience: "transport_driver",
      stub: false,
    };
  }

  if (flow === "admission_lead" || flow === "admission") {
    const r = await handleWaCrmBotInbound({
      ...inbound,
      visitorName: session.visitorName || session.displayName,
    });
    return {
      replied: r.replied,
      escalate: r.escalate,
      audience: "crm_admission_parent",
      stub: r.stub,
      error: r.error,
    };
  }

  if (flow === "vendor") {
    const name = session.displayName || identity.displayName;
    const note = opts.text.trim();
    await handleWaCrmBotInbound({
      ...inbound,
      text: note ? `[VENDOR] ${note}` : `HUMAN`,
      visitorName: name,
      forceEscalate: true,
    });
    await sendBotReply({
      mobile10,
      displayName: name,
      category: "vendor_enquiry",
      audience: "vendor",
      flow: "vendor",
      text: composeActiveFlowHint("vendor", name),
    });
    return {
      replied: true,
      escalate: true,
      audience: "vendor",
      stub: false,
    };
  }

  // The job desk. Not the admissions bot: handing a job seeker's message
  // to it filed them as an admission enquiry (18 Sep 2026: ENQ-2026-3709,
  // "Child — Rajnish_Kumar_Mishra_Resume.pdf") and told them they were
  // being connected to the admission office. Everything here stays in the
  // job applications inbox, and a person is reached through the office
  // relay's "Job applications" phone when it matters.
  if (flow === "job") {
    const name = session.visitorName || session.displayName || "Guest";
    const hindi = unifiedHindiFor(identity);
    const note = opts.text.trim();
    const jobDesk = await import("@/lib/jobDesk");
    const saveJobSession = async (patch: Partial<WaUnifiedSession>) => {
      const store = await readStore();
      const base = store.sessions[mobile10] ?? session;
      await writeStore({
        ...store,
        sessions: { ...store.sessions, [mobile10]: { ...base, ...patch, updatedAt: nowIso() } },
      });
    };
    const reply = async (text: string, escalate: boolean) => {
      const ok = await sendBotReply({
        mobile10,
        displayName: name,
        category: categoryForUnifiedAudience("visitor_job", "job"),
        audience: "visitor_job",
        flow,
        text,
        inbound: { text: opts.text || (opts.document ? "[CV]" : ""), waMessageId: opts.waMessageId },
      });
      return { replied: ok, escalate, audience: "visitor_job", stub: !ok };
    };
    const cvReminder = hindi
      ? "\n\nबायोडाटा (CV) भी यहीं PDF या फ़ोटो में भेज दें" + (TENANT.careersEmail ? ` या *${TENANT.careersEmail}* पर ईमेल करें।` : "।")
      : "\n\nPlease also send your CV here as a PDF or photo" + (TENANT.careersEmail ? `, or email it to *${TENANT.careersEmail}*.` : ".");

    // A CV sent after choosing JOB is the application. It may have arrived
    // with this message, or before the menu — a person sending a resume
    // sends the resume first and reads the menu afterwards.
    const cv = opts.document?.mediaId
      ? { mediaId: opts.document.mediaId }
      : session.pendingDocument?.mediaId
        ? { mediaId: session.pendingDocument.mediaId }
        : null;
    if (cv) {
      const { captureWhatsAppJobCv } = await import("@/lib/jobApplicationsIntake.server");
      const captured = await captureWhatsAppJobCv({ mediaId: cv.mediaId, mobile10, applicantName: name });
      // Used, or unusable — either way it is not pending any more, so a
      // later message cannot file the same CV a second time.
      await saveJobSession({ pendingDocument: null });
      if (!captured.ok || !captured.application) {
        return reply(
          hindi
            ? "धन्यवाद। यह फ़ाइल पढ़ी नहीं जा सकी — कृपया बायोडाटा PDF या साफ़ फ़ोटो में भेजें, या अपना विषय, कक्षाएँ और योग्यता लिखें।"
            : "Thank you. We could not read that file, so please send your CV as a PDF or a clear photo, or reply with your subject, the classes you teach and your qualification.",
          false,
        );
      }
      // Whatever the CV did not say is asked for now, while they are here.
      const missing = jobDesk.jobMissingFields(captured.application);
      if (missing.length) {
        await saveJobSession({ jobAsk: { applicationId: captured.application.id, asks: 1, at: nowIso() } });
        return reply(jobDesk.composeJobAsk(missing, hindi, true), captured.reason !== "duplicate");
      }
      await saveJobSession({ jobAsk: null });
      return reply(
        hindi
          ? "धन्यवाद 🙏 आपका बायोडाटा स्कूल ऑफिस को मिल गया है। किसी पद से मेल खाने पर आपको कॉल किया जाएगा।"
          : "Thank you — the school office has your CV. If it matches a vacancy, someone will call you.",
        captured.reason !== "duplicate",
      );
    }

    // They want a person. The relay forwards it to the job-applications phone.
    if (/^(human|office|call|call me|staff|baat karni hai|बात करनी है)$/i.test(note)) {
      return reply(
        hindi
          ? "आपका संदेश स्कूल ऑफिस को भेज दिया गया है। स्टाफ इसी WhatsApp पर जवाब देगा।"
          : "Your message has gone to the school office. Someone will reply on this WhatsApp.",
        true,
      );
    }

    // Typed details — the answer to our question, or offered unasked.
    const details = jobDesk.parseJobDetailsReply(note);
    const ask = session.jobAsk ?? null;
    if (jobDesk.jobDetailsFound(details)) {
      const { captureWhatsAppJobDetails } = await import("@/lib/jobApplicationsIntake.server");
      const saved = await captureWhatsAppJobDetails({
        mobile10,
        applicantName: name,
        details,
        applicationId: ask?.applicationId,
      });
      if (!saved.ok || !saved.application) {
        return reply(jobDesk.composeJobDone(hindi), true);
      }
      const missing = jobDesk.jobMissingFields(saved.application);
      const asks = (ask?.asks ?? 0) + 1;
      const needCv = !saved.application.cvPath;
      if (missing.length && asks <= jobDesk.JOB_ASK_LIMIT) {
        await saveJobSession({ jobAsk: { applicationId: saved.application.id, asks, at: nowIso() } });
        return reply(jobDesk.composeJobAsk(missing, hindi, !needCv) + (needCv ? cvReminder : ""), !!saved.created);
      }
      await saveJobSession({ jobAsk: null });
      return reply(jobDesk.composeJobDone(hindi) + (needCv ? cvReminder : ""), !!saved.created);
    }
    if (ask) {
      // Asked, and the reply had none of it. Ask once more, then stop —
      // a question repeated forever is the bot being broken, not thorough.
      const asks = ask.asks + 1;
      const current = await (await import("@/lib/jobApplications.server")).getJobApplication(ask.applicationId);
      const missing = current ? jobDesk.jobMissingFields(current) : [];
      if (missing.length && asks <= jobDesk.JOB_ASK_LIMIT) {
        await saveJobSession({ jobAsk: { ...ask, asks, at: nowIso() } });
        return reply(jobDesk.composeJobAsk(missing, hindi, !!current?.cvPath), false);
      }
      await saveJobSession({ jobAsk: null });
      return reply(jobDesk.composeJobDone(hindi), !!note);
    }
    // Anything else: where to send the CV, and a person sees the question.
    return reply(composeActiveFlowHint("job", name, hindi), !!note);
  }

  if (flow === "meeting" || flow === "other") {
    const name = session.visitorName || session.displayName || "Guest";
    const note = opts.text.trim();
    await handleWaCrmBotInbound({
      ...inbound,
      text: note ? `[${flow.toUpperCase()}] ${note}` : `HUMAN`,
      visitorName: name,
      forceEscalate: true,
    });
    const ack = composeActiveFlowHint(flow, name, unifiedHindiFor(identity));
    await sendBotReply({
      mobile10,
      displayName: name,
      category: categoryForUnifiedAudience(`visitor_${flow}`, flow),
      audience: `visitor_${flow}`,
      flow,
      text: ack,
    });
    return { replied: true, escalate: true, audience: `visitor_${flow}`, stub: false };
  }

  if (flow === "fee") {
    const parentRole = identity.roles.find((r) => r.kind === "parent");
    if (parentRole) {
      return delegateActiveFlow("parent", opts, identity, session);
    }
    const name = session.visitorName || session.displayName;
    const hint = composeActiveFlowHint("fee", name, unifiedHindiFor(identity));
    await sendBotReply({
      mobile10,
      displayName: name,
      category: "fee_enquiry",
      audience: "visitor_fee",
      flow: "fee",
      text: hint,
    });
    return { replied: true, escalate: false, audience: "visitor_fee", stub: false };
  }

  if (flow === "timing") {
    const name = session.visitorName || session.displayName;
    const hint = composeActiveFlowHint("timing", name, unifiedHindiFor(identity));
    await sendBotReply({
      mobile10,
      displayName: name,
      category: "general",
      audience: "visitor_timing",
      flow: "timing",
      text: hint,
    });
    return { replied: true, escalate: false, audience: "visitor_timing", stub: false };
  }

  return {
    replied: false,
    escalate: false,
    audience: "unknown",
    stub: false,
    error: "Unknown flow",
  };
}

/**
 * Single entry for all inbound WhatsApp parent/staff messages.
 */

const STAFF_SIDE_ROLES = new Set(["owner", "staff", "teacher", "survey", "vendor", "transport"]);

/**
 * Whether the unified bot should write to this sender in Hindi.
 *
 * Families get their own language, and a family that chose nothing gets the
 * school's default (Hindi). Unknown numbers get the default too. Anyone who
 * is also on the staff side stays in English — those menus are the school's
 * own working tools, and a teacher who is also a parent is a teacher first
 * when they message the school number.
 */
function unifiedHindiFor(identity: WaResolvedIdentity): boolean {
  if (identity.roles.some((r) => STAFF_SIDE_ROLES.has(r.kind))) return false;
  const parent = identity.roles.find((r) => r.kind === "parent" && r.householdId);
  if (parent) {
    try {
      const hh = loadSis().households.find((h) => h.id === parent.householdId);
      return waTemplateLanguageFor(hh ?? {}) === "hi";
    } catch {
      return SCHOOL_DEFAULT_WA_LANGUAGE === "hi";
    }
  }
  return SCHOOL_DEFAULT_WA_LANGUAGE === "hi";
}


/** Text only a parent sends: a fee-reminder button, a payment reply, a fee question, a parent keyword. */
function isParentBusiness(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (matchSeedQuickReply(t)) return true;
  if (detectSisFeeReplyIntent(t) || detectSisFeeQuestion(t)) return true;
  return ["dues", "pay", "receipts", "kids", "bus"].includes(detectSisBotIntent(t)) && /^[A-Za-z]+(\s+\S+)?$/.test(t);
}

/** How long "bot off" holds back the "didn't understand" reply. */
const STAFF_QUIET_MS = 12 * 60 * 60_000;

/**
 * What a staff member gets when nothing understood their message: the
 * short "didn't understand — try these" reply (composeStaffFallbackText),
 * never silence. A message with no words — a photo, a sticker — and anyone
 * who asked for quiet with "bot off" are logged for the office instead.
 */
async function replyStaffFallback(opts: {
  mobile10: string;
  flow: WaUnifiedFlow;
  identity: WaResolvedIdentity;
  session: WaUnifiedSession;
  text: string;
  waMessageId?: string;
}): Promise<{ replied: boolean; escalate: boolean; audience: string; stub: boolean }> {
  const { mobile10, flow, identity, session } = opts;
  const displayName = session.displayName || identity.displayName;
  const category = categoryForUnifiedAudience(flow, flow);
  const said = (opts.text || "").trim();
  const quietUntil = Date.parse(session.staffQuietUntil || "");
  if (!said || (Number.isFinite(quietUntil) && quietUntil > Date.now())) {
    await sendBotReply({
      mobile10,
      displayName,
      category,
      audience: "staff_quiet",
      flow,
      inbound: { text: said, waMessageId: opts.waMessageId },
    });
    return { replied: false, escalate: false, audience: "staff_quiet", stub: false };
  }
  const staffRole =
    identity.roles.find((r) => r.kind === flow && r.staff) ?? identity.roles.find((r) => r.staff);
  const ok = await sendBotReply({
    mobile10,
    displayName,
    category,
    audience: "staff_fallback",
    flow,
    text: composeStaffFallbackText({
      firstName: (staffRole?.staff?.fullName || displayName || "").split(" ")[0],
      text: said,
    }),
    inbound: { text: said, waMessageId: opts.waMessageId },
  });
  return { replied: ok, escalate: false, audience: "staff_fallback", stub: !ok };
}

/* ── Staff: the day, open work, roles, number linking ────────────────── */

/** How long the morning "mark your attendance first" holds other questions. */
const MORNING_OPEN_MS = 30 * 60_000;
/** How long a class draft waiting for YES counts as open work. */
const CLASS_DRAFT_OPEN_MS = 30 * 60_000;
/** A deferred question older than this is dropped rather than answered late. */
const DEFERRED_TTL_MS = 2 * 60 * 60_000;
/** How long a number-link conversation waits for the next step. */
const STAFF_LINK_OPEN_MS = 30 * 60_000;
/** How long a sent link request waits for the director. */
const STAFF_LINK_REQUEST_MS = 7 * 24 * 60 * 60_000;

function istNow(): { todayIso: string; hour: number } {
  const d = new Date(Date.now() + 330 * 60_000);
  return { todayIso: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

/** Merge a patch into this number's stored session (re-read first). */
async function patchSession(
  mobile10: string,
  base: WaUnifiedSession,
  patch: Partial<WaUnifiedSession>,
): Promise<WaUnifiedSession> {
  const store = await readStore();
  const next: WaUnifiedSession = { ...(store.sessions[mobile10] ?? base), ...patch, updatedAt: nowIso() };
  await writeStore({ ...store, sessions: { ...store.sessions, [mobile10]: next } });
  return next;
}

function staffRecordFor(identity: WaResolvedIdentity, flow: string): StaffRecord | null {
  return (
    identity.roles.find((r) => r.kind === flow && r.staff)?.staff ??
    identity.roles.find((r) => r.staff)?.staff ??
    null
  );
}

function roleNotesFor(identity: WaResolvedIdentity): StaffRoleNote[] {
  return identity.roles.map((r) => ({ kind: String(flowKindFromRole(r)), label: r.label, switchWord: r.pickKeyword }));
}

/** A school day for this staff member: timing says working, and no staff holiday. */
function isStaffWorkingDay(staff: StaffRecord, todayIso: string): boolean {
  const masters = loadMasters();
  const timing = masters.schoolTiming?.default;
  if (timing && !expectedWindowForTiming(timing, todayIso).isWorking) return false;
  try {
    const day = classifyStaffHolidayDay(masters, todayIso, currentAcademicYearCode(masters), staff.stream);
    return day.status !== "holiday";
  } catch {
    return true;
  }
}

/**
 * What this staff member has open and unfinished, or null. Never throws: a
 * store that cannot be read must not stop the message being answered.
 */
async function openWorkFor(opts: Parameters<typeof readOpenWork>[0]): Promise<OpenWork | null> {
  try {
    return await readOpenWork(opts);
  } catch (e) {
    console.error("[wa-unified] open-work check failed", e);
    return null;
  }
}

async function readOpenWork(opts: {
  mobile10: string;
  fromWaId: string;
  session: WaUnifiedSession;
  flow: string;
  staff: StaffRecord | null;
}): Promise<OpenWork | null> {
  const { todayIso } = istNow();
  const fb = opts.session.pendingFeedback;
  if (fb && freshAt(fb.at, FEEDBACK_OPEN_MS)) {
    return {
      kind: "feedback_recipient",
      what: `your ${fb.kind} — who should receive it`,
      how: "reply *1* Director only, *2* Principal only, or *3* Both",
    };
  }
  const lv = opts.session.leaveApply;
  if (lv && freshAt(lv.at, LEAVE_APPLY_OPEN_MS)) {
    const how =
      lv.step === "type"
        ? "reply *1* for CL or *2* for ML"
        : lv.step === "dates"
          ? "send the date — e.g. _tomorrow_ or _2 Oct to 4 Oct_"
          : lv.step === "reason"
            ? "send the reason in a few words"
            : lv.step === "lwp"
              ? "reply *YES* to apply as Leave Without Pay, or *NO*"
              : "reply *YES* to send it for approval, or *NO*";
    return { kind: "leave_application", what: "your leave application", how };
  }
  const askedAt = Date.parse(opts.session.morningAskAt || "");
  if (
    opts.staff &&
    opts.session.morningAskOn === todayIso &&
    Number.isFinite(askedAt) &&
    Date.now() - askedAt < MORNING_OPEN_MS
  ) {
    const { staffPunchToday } = await import("@/lib/staffAttendance.server");
    const today = await staffPunchToday(opts.staff.id);
    if (!today?.inTime) {
      return {
        kind: "morning_attendance",
        what: "today's attendance — waiting for your location",
        how: "send your location — 📎 → *Location* → *Send your current location* (or reply *SKIP*)",
      };
    }
  }
  const { staffAttendanceOpenWorkFor } = await import("@/lib/waStaffAttendanceBotServer");
  const punch = await staffAttendanceOpenWorkFor(opts.fromWaId);
  if (punch) return punch;
  const { commandDeskOpenWork } = await import("@/lib/erpCommands.server");
  const desk = await commandDeskOpenWork(opts.mobile10);
  if (desk) return desk;
  if (opts.flow === "teacher") {
    const { classChannelPendingDraftFor } = await import("@/lib/waClassChannelServer");
    const draft = await classChannelPendingDraftFor(opts.fromWaId);
    const at = Date.parse(draft?.createdAt || "");
    if (draft && Number.isFinite(at) && Date.now() - at < CLASS_DRAFT_OPEN_MS) {
      return {
        kind: "class_draft",
        what: `your draft for ${draft.label || "the class"} — "${draft.title.slice(0, 60)}"`,
        how: "reply *YES* to send it, or *NO* to drop it",
      };
    }
  }
  return null;
}

/** Is this message the answer the open job is waiting for? */
function answersOpenWork(work: OpenWork, text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (isCancelOpenWork(t) || isStaffHumanAsk(t)) return true;
  const attendanceWord =
    detectStaffAttBotIntent(t) !== "unknown" || !!detectOwnAttendanceAsk(t) || parseStaffAttLanguage(t) !== null;
  switch (work.kind) {
    case "morning_attendance":
      return attendanceWord || parseSkipOwnAttendance(t);
    case "punch":
      return attendanceWord || isEarlyOutConfirm(t);
    case "confirm_card":
      return /^(yes|y|haan|ha|han|ok|okay|confirm|no|n|nahi|nahin|cancel|हाँ|हां|ठीक|नहीं|रद्द)$/i.test(t) || /^cmd_(yes|no)_/.test(t);
    case "register":
      return parseMarkAskReply(t) !== null;
    case "class_draft":
      return /^(yes|y|ok|okay|confirm|approve|send|broadcast|publish|no|n|cancel|reject|discard|stop|edit)\b/i.test(t);
    case "feedback_recipient":
      return parseFeedbackRecipient(t) !== null;
    case "leave_application":
      // Its answers are taken before the open-work check (staffLeaveStep);
      // what reaches here is something else, kept for after.
      return false;
  }
}

/** Keep a question to answer once the open job is done. */
async function deferQuestion(mobile10: string, session: WaUnifiedSession, text: string): Promise<void> {
  const q = (text || "").trim();
  if (!q) return;
  const queue = [...(session.deferred ?? []).filter((d) => d.text !== q), { text: q, at: nowIso() }].slice(-DEFERRED_MAX);
  await patchSession(mobile10, session, { deferred: queue });
}

/**
 * Answer the questions kept while a job was open — only when nothing is
 * open any more. Each is run exactly as if it had just been sent.
 */
async function answerDeferred(
  flow: WaUnifiedFlow,
  opts: { fromWaId: string; profileName?: string },
  identity: WaResolvedIdentity,
): Promise<void> {
  const mobile10 = waNormalizeLocal10(opts.fromWaId);
  const session = (await readStore()).sessions[mobile10];
  const queue = session?.deferred ?? [];
  if (!session || !queue.length) return;
  const staff = staffRecordFor(identity, String(flow));
  if (await openWorkFor({ mobile10, fromWaId: opts.fromWaId, session, flow: String(flow), staff })) return;
  // Cleared before running, so a question that itself opens a job is not
  // answered twice.
  await patchSession(mobile10, session, { deferred: [] });
  for (const d of queue) {
    const at = Date.parse(d.at);
    if (!Number.isFinite(at) || Date.now() - at > DEFERRED_TTL_MS) continue;
    const now = (await readStore()).sessions[mobile10] ?? session;
    await sendBotReply({
      mobile10,
      displayName: now.displayName || identity.displayName,
      category: categoryForUnifiedAudience(flow, String(flow)),
      audience: "staff_deferred",
      flow: String(flow),
      text: `↩️ Now your earlier question: "${d.text.length > 80 ? `${d.text.slice(0, 77)}…` : d.text}"`,
    });
    try {
      await delegateStaffAware(flow, { fromWaId: opts.fromWaId, text: d.text, profileName: opts.profileName }, identity, now);
    } catch (e) {
      console.error("[wa-unified] deferred question failed", e);
    }
  }
}

/** The day's guide: what they teach, and what to type for each job. */
async function sendDayGuide(opts: {
  mobile10: string;
  identity: WaResolvedIdentity;
  flow: string;
  session: WaUnifiedSession;
  punchedJustNow: boolean;
}): Promise<void> {
  const staff = staffRecordFor(opts.identity, opts.flow);
  if (!staff) return;
  const masters = loadMasters();
  const profile = staffWorkProfile(staff, masters, currentAcademicYearCode(masters));
  const roles = opts.identity.roles.length > 1 ? roleNotesFor(opts.identity) : undefined;
  const text = composeStaffWorkGuide({
    firstName: (staff.fullName || opts.identity.displayName || "").split(" ")[0] || "",
    profile,
    office: opts.flow === "staff" || opts.flow === "owner",
    roles,
    currentKind: opts.flow,
    punchedJustNow: opts.punchedJustNow,
  });
  await sendBotReply({
    mobile10: opts.mobile10,
    displayName: staff.fullName || opts.identity.displayName,
    category: categoryForUnifiedAudience(opts.flow, opts.flow),
    audience: "staff_day_guide",
    flow: opts.flow,
    text,
  });
  await patchSession(opts.mobile10, opts.session, { guideSentOn: istNow().todayIso });
}

/* ── Who leadership is, for private messages and leave approval ───────── */

type LeaderContact = { staffId: string; name: string; mobile10: string };

/**
 * The owner (director), the principal and the admins, with usable mobiles.
 *
 * The owner is the protected super-admin account, or the "owner" role — not
 * every staff member whose designation says Director: at this school three
 * people carry that title, and "Director only" means the owner. The
 * principal is by designation (not vice principal). Admins are whoever holds
 * the ERP's admin role.
 */
async function leadershipContacts(): Promise<{ owner: LeaderContact[]; principal: LeaderContact[]; admin: LeaderContact[] }> {
  const masters = loadMasters();
  const { loadServerRbac } = await import("@/lib/api/v1/auth");
  const rbac = await loadServerRbac();
  const today = istNow().todayIso;
  const roleCode = (roleId: string) => rbac.roles.find((r) => r.id === roleId)?.code ?? "";
  const holders = (code: string) =>
    new Set(
      rbac.assignments
        .filter((a) => roleCode(a.roleId) === code && (!a.expiresOn || a.expiresOn >= today))
        .map((a) => a.staffId),
    );
  const designation = (s: StaffRecord) =>
    (masters.designations ?? []).find((d) => d.id === s.designationId)?.name ?? "";
  const active = (masters.staff ?? []).filter(
    (s) => s.status === "active" && waNormalizeLocal10(s.mobile || "").length === 10,
  );
  const contact = (s: StaffRecord): LeaderContact => ({ staffId: s.id, name: s.fullName, mobile10: waNormalizeLocal10(s.mobile) });
  const ownerIds = holders("owner");
  let owner = active.filter((s) => isProtectedSuperAdminEmail(s.email) || ownerIds.has(s.id));
  if (!owner.length) owner = active.filter((s) => /\b(owner|director|chairman|founder|trustee)\b/i.test(designation(s)));
  const principal = active.filter((s) => /\bprincipal\b/i.test(designation(s)) && !/\bvice\b/i.test(designation(s)));
  const adminIds = holders("admin");
  const admin = active.filter((s) => adminIds.has(s.id));
  return { owner: owner.map(contact), principal: principal.map(contact), admin: admin.map(contact) };
}

/* ── Staff leave over WhatsApp ──────────────────────────────────────── */

/** How long a half-filled leave application waits. */
const LEAVE_APPLY_OPEN_MS = 30 * 60_000;
/** How long "who should get it?" waits for an answer. */
const FEEDBACK_OPEN_MS = 30 * 60_000;

function freshAt(at: string | undefined, ms: number): boolean {
  const t = Date.parse(at || "");
  return Number.isFinite(t) && Date.now() - t < ms;
}

/** The HR desk, with this staff member's balances for the year in place. */
async function hrFor(staffId: string) {
  const { loadStaffHrServer, balancesFor } = await import("@/lib/api/v1/staffLeave");
  const base = await loadStaffHrServer();
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const { state, balances } = balancesFor(base, staffId, ay);
  return { state, ay, balances };
}

type LeaveDraft = NonNullable<WaUnifiedSession["leaveApply"]>;
type StaffAwareReply = { replied: boolean; escalate: boolean; audience: string; stub: boolean };

/** Leftover words after the type, the dates and the leave words — the reason, if they gave one. */
function leaveReasonFrom(text: string): string {
  const cleaned = (text || "")
    .replace(/(?<![\p{L}\p{M}\p{N}])(cl|ml|sl|lwp|casual|medical|sick|leave|chutti|chhutti|apply|need|want|chahiye|chaiye|for|on|mujhe|kal|aaj|today|tomorrow|parso|half\s*day|to|se|till|tak|i|please|pls|hai|ke|ki|ka|liye|a|the|leni|lena)(?![\p{L}\p{M}\p{N}])/giu, " ")
    .replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, " ")
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat)\b/gi, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned : "";
}

/**
 * Take the application one step further: whatever is missing is asked for;
 * when nothing is, the leave master's verdict decides what comes next.
 */
async function advanceLeave(opts: {
  mobile10: string;
  session: WaUnifiedSession;
  staff: StaffRecord;
  draft: LeaveDraft;
}): Promise<string> {
  const { mobile10, session, staff } = opts;
  const draft: LeaveDraft = { ...opts.draft, at: nowIso() };
  const save = (d: LeaveDraft | null) => patchSession(mobile10, session, { leaveApply: d });
  if (!draft.typeCode) {
    await save({ ...draft, step: "type" });
    return composeLeaveAskType();
  }
  if (!draft.from || !draft.to) {
    await save({ ...draft, step: "dates" });
    return composeLeaveAskDates(draft.typeCode);
  }
  if (!draft.reason) {
    await save({ ...draft, step: "reason" });
    return composeLeaveAskReason();
  }
  const { state, ay } = await hrFor(staff.id);
  const todayIso = istNow().todayIso;
  const verdict = leaveVerdict({
    state,
    staffId: staff.id,
    academicYearCode: ay,
    typeCode: draft.typeCode,
    from: draft.from,
    to: draft.to,
    halfDay: !!draft.halfDay,
    todayIso,
  });
  const dates = formatLeaveDates(draft.from, draft.to, !!draft.halfDay);
  if (verdict.kind === "refuse") {
    await save(null);
    return `${verdict.why}\n\nSend _CL tomorrow_ or _ML 2 Oct to 4 Oct_ to start again.`;
  }
  if (verdict.kind === "lwp") {
    await save({ ...draft, step: "lwp", lwpWhy: verdict.why });
    return composeLeaveLwpOffer({ why: verdict.why, asked: leaveTypeLabel(draft.typeCode), dates });
  }
  await save({ ...draft, step: "confirm" });
  return composeLeaveSummary({ typeCode: draft.typeCode, dates, days: verdict.days, reason: draft.reason });
}

/** Put the application in the ERP and send it to the principal and admins. */
async function submitLeave(opts: {
  mobile10: string;
  session: WaUnifiedSession;
  staff: StaffRecord;
  draft: LeaveDraft;
}): Promise<string> {
  const { mobile10, session, staff, draft } = opts;
  await patchSession(mobile10, session, { leaveApply: null });
  const { applyLeave } = await import("@/lib/staffHr");
  const { saveStaffHrServer } = await import("@/lib/api/v1/staffLeave");
  const { ay } = await hrFor(staff.id);
  const result = applyLeave({
    academicYearCode: ay,
    staffId: staff.id,
    typeCode: draft.typeCode!,
    fromDate: draft.from!,
    toDate: draft.halfDay ? draft.from! : draft.to!,
    halfDay: !!draft.halfDay,
    reason: `${draft.reason}${draft.askedType && draft.askedType !== draft.typeCode ? ` (asked as ${draft.askedType}: ${draft.lwpWhy})` : ""} · via WhatsApp`,
    appliedBy: staff.fullName || "Staff",
  });
  if (!result.ok) return `Could not apply: ${result.error}.`;
  try {
    await saveStaffHrServer(result.state);
  } catch {
    return "The leave could not be saved just now. Please try again in a minute.";
  }
  const req = result.request;
  const dates = formatLeaveDates(req.fromDate, req.toDate, req.halfDay);
  if (req.status === "approved") {
    const { markApprovedLeaveOnRegisters } = await import("@/lib/staffAttendance.server");
    await markApprovedLeaveOnRegisters({ staffId: staff.id, fromDate: req.fromDate, toDate: req.toDate, halfDay: req.halfDay, typeCode: req.typeCode, by: "Leave (auto-approved)" });
    return `✅ ${leaveTypeLabel(req.typeCode)} on ${dates} is approved and marked.`;
  }

  // A code the approvers answer with.
  const store = await readStore();
  // Codes of long-past leave are dropped, so the list stays small.
  const keepAfter = Date.now() - 60 * 24 * 60 * 60_000;
  const codes = Object.fromEntries(
    Object.entries(store.leaveCodes ?? {}).filter(([, v]) => (Date.parse(v.at) || 0) > keepAfter),
  );
  let code = "";
  for (let i = 0; i < 20 && (!code || codes[code]); i += 1) code = String(1000 + Math.floor(Math.random() * 9000));
  codes[code] = { requestId: req.id, staffId: staff.id, staffMobile10: mobile10, at: nowIso() };
  await writeStore({ ...store, leaveCodes: codes });

  const leaders = await leadershipContacts();
  const approvers = [...leaders.principal, ...leaders.admin].filter((c) => c.staffId !== staff.id);
  const to = approvers.length ? approvers : leaders.owner.filter((c) => c.staffId !== staff.id);
  const masters = loadMasters();
  const designation = (masters.designations ?? []).find((d) => d.id === staff.designationId)?.name ?? "";
  const { sendLeadershipDirect } = await import("@/lib/waRelay.server");
  await sendLeadershipDirect({
    toMobiles: to.map((c) => c.mobile10),
    label: "Staff leave",
    senderName: staff.fullName,
    sender10: mobile10,
    code,
    text: composeLeaveApproverRequest({
      code,
      staffName: staff.fullName,
      empCode: staff.empCode,
      designation,
      typeCode: req.typeCode,
      dates,
      days: req.days,
      reason: draft.reason || "",
      lwpWhy: req.typeCode === "LWP" ? draft.lwpWhy : undefined,
    }),
    clientKey: `leave:${req.id}`,
  });
  return composeLeaveSent(code);
}

/**
 * "LEAVE OK 4821" / "LEAVE NO 4821" from the principal, an admin or the
 * owner. The first decision is posted to the ERP (and the day marked); a
 * second one is told it is already done. Accepted until the end of the
 * leave's first day. Returns handled:false for anyone not allowed to decide,
 * so their message carries on as normal.
 */
export async function handleLeaveCodeDecision(opts: { fromWaId: string; text: string }): Promise<{ handled: boolean }> {
  const decision = parseLeaveCodeDecision(opts.text);
  if (!decision) return { handled: false };
  const approver10 = waNormalizeLocal10(opts.fromWaId);
  const identity = await resolveWaIdentityServer(opts.fromWaId);
  const approverStaff = identity.roles.find((r) => r.staff)?.staff ?? null;
  const leaders = await leadershipContacts();
  const allowed =
    !!approverStaff &&
    [...leaders.principal, ...leaders.admin, ...leaders.owner].some((c) => c.staffId === approverStaff.id);
  if (!allowed) return { handled: false };
  const say = (body: string) => sendWhatsAppText({ toMobile: approver10, body });

  const store = await readStore();
  const entry = (store.leaveCodes ?? {})[decision.code];
  if (!entry) {
    await say(`No leave request #${decision.code} was found. Check the number, or decide it in the ERP (Staff → Leave).`);
    return { handled: true };
  }
  const { loadStaffHrServer, saveStaffHrServer } = await import("@/lib/api/v1/staffLeave");
  const state = await loadStaffHrServer();
  const req = state.leaveRequests.find((r) => r.id === entry.requestId);
  const masters = loadMasters();
  const who = (masters.staff ?? []).find((s) => s.id === entry.staffId);
  const whoName = who?.fullName || "the staff member";
  if (!req) {
    await say(`Leave request #${decision.code} is no longer in the ERP.`);
    return { handled: true };
  }
  const dates = formatLeaveDates(req.fromDate, req.toDate, req.halfDay);
  if (req.status !== "pending" && req.status !== "pending_l2") {
    await say(
      `Leave #${decision.code} (${whoName}, ${dates}) was already ${req.status === "approved" ? "approved and posted" : req.status}${req.decidedBy ? ` by ${req.decidedBy}` : ""}. Nothing more to do.`,
    );
    return { handled: true };
  }
  if (approverStaff!.id === req.staffId) {
    await say("You cannot decide your own leave.");
    return { handled: true };
  }
  if (!leaveDecisionOpen(req.fromDate, istNow().todayIso)) {
    await say(`The day of leave #${decision.code} has passed. Please decide it in the ERP (Staff → Leave).`);
    return { handled: true };
  }

  const byName = approverStaff!.fullName || "Leadership";
  // Two approvers answering within seconds of each other both read the
  // request as pending. Only one may decide it: the claim is a unique row,
  // so the second is told it is already being settled.
  const { claimSendOnce, releaseSendClaim } = await import("@/lib/waSendClaim.server");
  const claimKey = `leave-decision:${req.id}:${req.status}`;
  const claim = await claimSendOnce(claimKey, byName, `leave #${decision.code}`);
  if (!claim.ok) {
    await say(
      claim.reason === "held"
        ? `Leave #${decision.code} (${whoName}, ${dates}) was already decided${claim.claimedBy ? ` by ${claim.claimedBy}` : ""} and posted. Nothing more to do.`
        : "The decision could not be recorded just now. Please try again in a minute.",
    );
    return { handled: true };
  }

  const { decideLeave } = await import("@/lib/staffHr");
  const result = decideLeave({
    requestId: req.id,
    decision: decision.approve ? "approved" : "rejected",
    decidedBy: byName,
    decisionNote: `Decided on WhatsApp by ${byName}`,
  });
  if (!result.ok) {
    await releaseSendClaim(claimKey);
    await say(`Could not record the decision: ${result.error}.`);
    return { handled: true };
  }
  try {
    await saveStaffHrServer(result.state);
  } catch {
    await releaseSendClaim(claimKey);
    await say("The decision could not be saved just now. Please try again in a minute.");
    return { handled: true };
  }
  const after = result.state.leaveRequests.find((r) => r.id === req.id) ?? req;
  const label = leaveTypeLabel(req.typeCode);

  if (after.status === "approved") {
    const { markApprovedLeaveOnRegisters } = await import("@/lib/staffAttendance.server");
    await markApprovedLeaveOnRegisters({
      staffId: req.staffId,
      fromDate: req.fromDate,
      toDate: req.toDate,
      halfDay: req.halfDay,
      typeCode: req.typeCode,
      by: `Leave approved by ${byName}`,
    });
    await say(`✅ Approved and posted to the ERP: ${whoName} · ${label} · ${dates}. The day is marked as leave.`);
    await sendWhatsAppText({
      toMobile: entry.staffMobile10,
      body: `✅ Your ${label} for ${dates} is approved by ${byName}, and marked in attendance.`,
    });
  } else if (after.status === "rejected") {
    await say(`Refused: ${whoName} · ${label} · ${dates}. They have been told.`);
    await sendWhatsAppText({
      toMobile: entry.staffMobile10,
      body: `Your ${label} for ${dates} was not approved by ${byName}. Please speak to them if you need to.`,
    });
  } else {
    await say(`Recorded at the first level: ${whoName} · ${label} · ${dates}. It now needs the final approval in the ERP.`);
  }
  return { handled: true };
}

const YES_WORD = /^(yes|y|haan|ha|han|ok|okay|confirm|send|हाँ|हां|ठीक)$/i;
const NO_WORD = /^(no|n|nahi|nahin|नहीं)$/i;

/**
 * A staff member's suggestion, requirement or complaint: first "who should
 * get it?", then sent privately to exactly the people they chose. Its words
 * never reach the office inbox or the relay log. Returns null when this
 * message is not part of it.
 */
async function staffFeedbackStep(opts: {
  mobile10: string;
  text: string;
  session: WaUnifiedSession;
  staff: StaffRecord | null;
  displayName: string;
  say: (body: string, audience: string) => Promise<StaffAwareReply>;
}): Promise<StaffAwareReply | null> {
  const { mobile10, text, session, staff, say } = opts;
  const fresh = parseStaffFeedback(text);
  if (fresh) {
    await patchSession(mobile10, session, { pendingFeedback: { kind: fresh.kind, body: fresh.body, at: nowIso() } });
    return say(composeFeedbackRecipientAsk(fresh.kind), "staff_feedback_recipient");
  }
  const pending = session.pendingFeedback;
  if (!pending) return null;
  if (!freshAt(pending.at, FEEDBACK_OPEN_MS)) {
    // Never answered: its words are not kept any longer than needed.
    await patchSession(mobile10, session, { pendingFeedback: null });
    return null;
  }
  if (isCancelOpenWork(text)) {
    await patchSession(mobile10, session, { pendingFeedback: null });
    return say(`OK — your ${pending.kind} was dropped. Nobody has seen it.`, "staff_feedback_dropped");
  }
  const to = parseFeedbackRecipient(text);
  if (!to) return null;

  const leaders = await leadershipContacts();
  const chosen = [
    ...(to === "principal" ? [] : leaders.owner),
    ...(to === "director" ? [] : leaders.principal),
  ].filter((c) => !staff || c.staffId !== staff.id);
  const masters = loadMasters();
  const designation = staff ? ((masters.designations ?? []).find((d) => d.id === staff.designationId)?.name ?? "") : "";
  const kindLabel = pending.kind.charAt(0).toUpperCase() + pending.kind.slice(1);
  const who = to === "director" ? "the Director" : to === "principal" ? "the Principal" : "the Director and the Principal";
  const senderName = staff?.fullName || opts.displayName || "Staff";
  const body = [
    `📨 *Staff ${pending.kind}* — private, sent only to ${who}`,
    `From: ${senderName}${staff?.empCode ? ` (${staff.empCode})` : ""}${designation ? ` · ${designation}` : ""} · ${mobile10}`,
    "",
    pending.body,
    "",
    `_To answer, message ${senderName.split(" ")[0]} directly on ${mobile10}._`,
  ].join("\n");
  let delivered = 0;
  if (chosen.length) {
    const { sendLeadershipDirect } = await import("@/lib/waRelay.server");
    const r = await sendLeadershipDirect({
      toMobiles: chosen.map((c) => c.mobile10),
      label: `Staff ${kindLabel}`,
      senderName,
      sender10: mobile10,
      code: makeStaffLinkCode(),
      text: body,
      clientKey: `feedback:${mobile10}:${Date.parse(pending.at) || Date.now()}`,
    });
    delivered = r.delivered;
  }
  if (delivered > 0) await patchSession(mobile10, session, { pendingFeedback: null });
  return say(composeStaffFeedbackAck(pending.kind, to, delivered > 0), "staff_feedback");
}

/**
 * CL / ML over WhatsApp: the application a step at a time, the leave
 * master's verdict, Leave Without Pay when CL for the month is used, then
 * the principal and admins. Returns null when this message is not part of
 * it, so it carries on as before.
 */
async function staffLeaveStep(opts: {
  mobile10: string;
  text: string;
  session: WaUnifiedSession;
  staff: StaffRecord | null;
  flow: string;
  say: (body: string, audience: string) => Promise<StaffAwareReply>;
}): Promise<StaffAwareReply | null> {
  const { mobile10, text, session, staff, say } = opts;
  if (!staff || !text) return null;
  const todayIso = istNow().todayIso;
  const draft = session.leaveApply && freshAt(session.leaveApply.at, LEAVE_APPLY_OPEN_MS) ? session.leaveApply : null;
  const go = async (d: LeaveDraft) => say(await advanceLeave({ mobile10, session, staff, draft: d }), "staff_leave_apply");
  const words = text.split(/\s+/).filter(Boolean).length;

  if (draft) {
    if (isCancelOpenWork(text)) {
      await patchSession(mobile10, session, { leaveApply: null });
      return say("OK — the leave application was cancelled. Nothing was sent.", "staff_leave_cancelled");
    }
    const t = text.replace(/[.!]+$/, "").trim();
    switch (draft.step) {
      case "type": {
        const typeCode: WaLeaveType | null = t === "1" ? "CL" : t === "2" ? "SL" : parseLeaveType(t);
        if (typeCode && typeCode !== "LWP") {
          const dates = draft.from ? null : parseLeaveDates(t, todayIso);
          return go({
            ...draft,
            typeCode,
            ...(dates ? { from: dates.from, to: dates.to } : {}),
            halfDay: draft.halfDay || /half\s*day/i.test(t),
          });
        }
        if (words <= 4 && !/[?？]/.test(t)) return say(`Please reply *1* for CL or *2* for ML.\n\n${composeLeaveAskType()}`, "staff_leave_apply");
        return null;
      }
      case "dates": {
        const dates = parseLeaveDates(t, todayIso);
        if (dates) return go({ ...draft, from: dates.from, to: dates.to, halfDay: draft.halfDay || /half\s*day/i.test(t) });
        if (words <= 4 && !/[?？]/.test(t)) {
          return say(`I couldn't read that date.\n\n${composeLeaveAskDates(draft.typeCode || "CL")}`, "staff_leave_apply");
        }
        return null;
      }
      case "reason": {
        if (/[?？]/.test(t) || YES_WORD.test(t) || NO_WORD.test(t) || t.length < 2) return null;
        return go({ ...draft, reason: t.slice(0, 200) });
      }
      case "lwp": {
        if (YES_WORD.test(t)) {
          return go({ ...draft, askedType: draft.askedType || draft.typeCode, typeCode: "LWP" });
        }
        if (NO_WORD.test(t)) {
          await patchSession(mobile10, session, { leaveApply: null });
          return say("OK — not applied. Nothing was sent.", "staff_leave_cancelled");
        }
        return null;
      }
      case "confirm": {
        if (YES_WORD.test(t)) {
          // A draft confirmed after midnight is for a day that has ended.
          if ((draft.from || "") < todayIso) {
            await patchSession(mobile10, session, { leaveApply: null });
            return say("That day has already ended, so it cannot be applied for here — please speak to the office.", "staff_leave_apply");
          }
          return say(await submitLeave({ mobile10, session, staff, draft }), "staff_leave_sent");
        }
        if (NO_WORD.test(t)) {
          await patchSession(mobile10, session, { leaveApply: null });
          return say("OK — not sent. Nothing was applied.", "staff_leave_cancelled");
        }
        return null;
      }
    }
    return null;
  }

  if (isLeaveBalanceAsk(text)) {
    try {
      const { state, balances } = await hrFor(staff.id);
      const ym = todayIso.slice(0, 7);
      const left: Record<string, number> = {};
      const usedThisMonth: Record<string, number> = {};
      for (const b of balances) left[String(b.typeCode)] = Number(b.remaining) || 0;
      for (const t of state.leaveTypes) usedThisMonth[t.code] = leaveUsedInMonth(state.leaveRequests, staff.id, t.code, ym);
      return say(composeLeaveBalances({ types: state.leaveTypes, left, usedThisMonth }), "staff_leave_balance");
    } catch (e) {
      console.error("[wa-unified] leave balance failed", e);
      return say("Your leave balance could not be read just now. Please try again in a minute.", "staff_leave_balance");
    }
  }

  let start = parseLeaveApplyStart(text, todayIso);
  // "LEAVE" alone is the approvers' queue; from anyone else it is an application.
  if (!start && /^\s*leave\s*$/i.test(text)) {
    const leaders = await leadershipContacts();
    const approver = [...leaders.principal, ...leaders.admin, ...leaders.owner].some((c) => c.staffId === staff.id);
    if (!approver) start = { typeCode: null, dates: null, halfDay: false };
  }
  if (!start) return null;
  return go({
    step: "type",
    typeCode: start.typeCode ?? undefined,
    from: start.dates?.from,
    to: start.dates?.to,
    halfDay: start.halfDay,
    reason: leaveReasonFrom(text) || undefined,
    at: nowIso(),
  });
}

const GREETING_ONLY =
  /^(hi+|hello+|hey|hii+|namaste|namaskar|good\s*(morning|afternoon|evening)|gm|pranam|jai\s*hind|नमस्ते|प्रणाम|सुप्रभात)[\s!.🙏]*$/iu;
const GUIDE_ASK =
  /^(my\s+(classes|class\s+list|work|day|duties|subjects)|guide|what\s+can\s+i\s+do|how\s+to\s+use|meri\s+classes|mera\s+kaam|मेरी\s+कक्षाएँ|मेरा\s+काम)[\s?!.]*$/iu;

/**
 * The staff side of delegateActiveFlow: the morning attendance question,
 * finishing open work before anything new, the day's guide, private
 * messages for the director / principal, and CL / ML applications. Other
 * flows pass straight through.
 */
async function delegateStaffAware(
  flow: WaUnifiedFlow,
  opts: Parameters<typeof delegateActiveFlow>[1],
  identity: WaResolvedIdentity,
  session: WaUnifiedSession,
): Promise<Awaited<ReturnType<typeof delegateActiveFlow>>> {
  if (flow !== "teacher" && flow !== "staff" && flow !== "owner") {
    return delegateActiveFlow(flow, opts, identity, session);
  }
  const mobile10 = waNormalizeLocal10(opts.fromWaId);
  const text = (opts.text || "").trim();
  const staff = staffRecordFor(identity, flow);
  const displayName = session.displayName || identity.displayName;
  // A private message's words never reach the office inbox.
  const inboundText = parseStaffFeedback(text) ? PRIVATE_FEEDBACK_LOG_TEXT : text || (opts.audio ? "[voice note]" : "");
  const reply = async (body: string, audience: string, escalate = false): Promise<StaffAwareReply> => {
    const ok = await sendBotReply({
      mobile10,
      displayName,
      category: categoryForUnifiedAudience(flow, flow),
      audience,
      flow,
      text: body,
      inbound: { text: inboundText, waMessageId: opts.waMessageId },
    });
    return { replied: ok, escalate, audience, stub: !ok };
  };

  // 0. The private message and the leave application answer their own
  // questions first — they are the open job when they are open.
  const feedbackStep = await staffFeedbackStep({ mobile10, text, session, staff, displayName, say: reply });
  if (feedbackStep) {
    if (!(await readStore()).sessions[mobile10]?.pendingFeedback) await answerDeferred(flow, opts, identity);
    return feedbackStep;
  }
  const leaveDraftOpen = !!session.leaveApply && freshAt(session.leaveApply.at, LEAVE_APPLY_OPEN_MS);
  if (leaveDraftOpen) {
    const step = await staffLeaveStep({ mobile10, text, session, staff, flow, say: reply });
    if (step) {
      if (!(await readStore()).sessions[mobile10]?.leaveApply) await answerDeferred(flow, opts, identity);
      return step;
    }
  }

  // 1. Something is open: finish it first, answer this after.
  const work = await openWorkFor({ mobile10, fromWaId: opts.fromWaId, session, flow, staff });
  if (work && text && !answersOpenWork(work, text)) {
    await deferQuestion(mobile10, session, text);
    return reply(composeOpenWorkReminder(work, text), "staff_open_work");
  }
  if (work?.kind === "morning_attendance" && parseSkipOwnAttendance(text)) {
    const next = await patchSession(mobile10, session, { morningAskAt: "" });
    await reply("OK — not marking it here today.", "staff_morning_skip");
    if (next.guideSentOn !== istNow().todayIso) {
      await sendDayGuide({ mobile10, identity, flow, session: next, punchedJustNow: false });
    }
    await answerDeferred(flow, opts, identity);
    return { replied: true, escalate: false, audience: "staff_morning_skip", stub: false };
  }

  // 1b. "CL tomorrow", "ML 2 Oct to 4 Oct fever", "my leave" — before the
  // morning question: someone applying for today's leave is not coming in.
  if (!work && !leaveDraftOpen) {
    const step = await staffLeaveStep({ mobile10, text, session, staff, flow, say: reply });
    if (step) return step;
  }

  // 2. The first message of a working morning: their own attendance first.
  if (!work && staff && text && !opts.location) {
    const { todayIso, hour } = istNow();
    const attendanceWord = detectStaffAttBotIntent(text) !== "unknown" || !!detectOwnAttendanceAsk(text);
    const lastAskedOn = session.morningAskOn || "";
    let punchedIn = true;
    let dayOn = false;
    if (lastAskedOn !== todayIso && hour >= 5 && hour < 15) {
      try {
        dayOn = isStaffWorkingDay(staff, todayIso);
        if (dayOn) {
          const { staffAttendanceExempt } = await import("@/lib/staffAttendance.server");
          // Not asked of those the attendance settings excuse from punching.
          if (await staffAttendanceExempt(staff.id)) dayOn = false;
        }
        if (dayOn) {
          const { staffPunchToday } = await import("@/lib/staffAttendance.server");
          punchedIn = !!(await staffPunchToday(staff.id))?.inTime;
        }
      } catch (e) {
        // Could not tell — do not stand between them and their question.
        console.error("[wa-unified] morning attendance check failed", e);
        dayOn = false;
      }
    }
    if (dayOn) {
      if (
        shouldAskMorningAttendance({ flow, todayIso, istHour: hour, lastAskedOn, punchedIn, workingDay: true }) &&
        !attendanceWord &&
        !isStaffHumanAsk(text)
      ) {
        const next = await patchSession(mobile10, session, { morningAskOn: todayIso, morningAskAt: nowIso() });
        const meaningful = !GREETING_ONLY.test(text) && !parseSkipOwnAttendance(text);
        if (meaningful) await deferQuestion(mobile10, next, text);
        return reply(
          composeMorningAttendanceAsk({
            firstName: (staff.fullName || displayName || "").split(" ")[0] || "",
            deferredText: meaningful ? text : "",
          }),
          "staff_morning_attendance",
        );
      }
      // Asked once a day at most — an attendance word or an existing punch
      // counts as the day's answer.
      await patchSession(mobile10, session, { morningAskOn: todayIso });
    }
  }

  // 3. "My classes", "guide" — the day's guide on demand.
  if (text && GUIDE_ASK.test(text)) {
    await sendDayGuide({ mobile10, identity, flow, session, punchedJustNow: false });
    return { replied: true, escalate: false, audience: "staff_day_guide", stub: false };
  }

  const r = await delegateActiveFlow(flow, opts, identity, session);
  // The job this message finished may have been holding questions.
  if (work) await answerDeferred(flow, opts, identity);
  return r;
}

/**
 * An unknown number that writes like staff: find their staff record, show
 * it (masked), and on YES ask the director to add this number to it.
 * Returns null when this is not a linking conversation.
 */
async function staffLinkStep(opts: {
  mobile10: string;
  text: string;
  session: WaUnifiedSession;
  displayName: string;
  inbound: { text: string; waMessageId?: string };
}): Promise<{ replied: boolean; escalate: boolean; audience: string; stub: boolean } | null> {
  const { mobile10, session } = opts;
  const text = (opts.text || "").trim();
  const link = session.staffLink ?? null;
  const age = link ? Date.now() - Date.parse(link.at) : Infinity;
  const live = !!link && Number.isFinite(age) && age < (link.step === "requested" ? STAFF_LINK_REQUEST_MS : STAFF_LINK_OPEN_MS);
  const say = async (body: string, audience = "visitor_staff_link", escalate = false) => {
    const ok = await sendBotReply({
      mobile10,
      displayName: opts.displayName,
      category: "general",
      audience,
      text: body,
      inbound: opts.inbound,
    });
    return { replied: ok, escalate, audience, stub: !ok };
  };
  const save = (patch: Partial<WaUnifiedSession>) => patchSession(mobile10, session, patch);

  if (!live) {
    if (!looksLikeStaffAsk(text) && !/^(i\s*(am|'m)\s+(a\s+)?(teacher|staff)|main\s+teacher|mai\s+teacher|staff\s+hu|teacher\s+hu|school\s+staff)\b/i.test(text)) {
      return null;
    }
    await save({ staffLink: { step: "who", asks: 0, at: nowIso() } });
    return say(composeStaffLinkIntro());
  }

  if (link!.step === "requested") {
    return say(
      `Your request *${link!.code}* to add this number to your staff record is waiting for approval. You'll get a message here as soon as it is done.`,
    );
  }

  const masters = loadMasters();
  if (link!.step === "who") {
    // Answering like a family or a visitor ("admission", "fees", a menu
    // tap) leaves the staff search and carries on as before.
    if (
      looksLikeParentAsk(text) ||
      VISITOR_PURPOSE_OPTIONS.some((p) => p.keyword === text.toUpperCase()) ||
      /^purpose_|^menu_/.test(text) ||
      /[?？]/.test(text) ||
      text.split(/\s+/).filter(Boolean).length > 5
    ) {
      await save({ staffLink: null });
      return null;
    }
    const { match, ambiguous } = matchStaffForLink(text, masters.staff ?? []);
    if (!match) {
      const asks = (link!.asks ?? 0) + 1;
      if (asks >= 3) {
        await save({ staffLink: null });
        return say(
          "I couldn't find your staff record. Please ask the office to add this number to your staff profile — your message has been passed to them.",
          "visitor_staff_unlinked",
          true,
        );
      }
      await save({ staffLink: { ...link!, asks, at: nowIso() } });
      return say(
        ambiguous > 1
          ? "More than one staff member has that name — please send your *employee code* (e.g. STF-007)."
          : "I couldn't find that on the staff record. Please send your *full name exactly as on the record*, or your *employee code* (e.g. STF-007).",
      );
    }
    const designation = (masters.designations ?? []).find((d) => d.id === match.designationId)?.name ?? "";
    await save({ staffLink: { step: "confirm", staffId: match.id, at: nowIso() } });
    return say(
      composeStaffLinkFound({
        fullName: match.fullName,
        empCode: match.empCode,
        designation,
        registeredMobile: match.mobile,
        thisMobile: mobile10,
      }),
    );
  }

  // step === "confirm"
  if (/^(yes|y|haan|ha|han|ok|okay|confirm|हाँ|हां)$/i.test(text)) {
    const staff = (masters.staff ?? []).find((s) => s.id === link!.staffId);
    if (!staff) {
      await save({ staffLink: null });
      return say("That staff record is no longer available. Please ask the office.", "visitor_staff_unlinked", true);
    }
    const code = makeStaffLinkCode();
    await save({ staffLink: { ...link!, step: "requested", code, at: nowIso() } });
    const { relayEscalation } = await import("@/lib/waRelay.server");
    await relayEscalation({
      fromWaId: mobile10,
      text: `Request ${code}: ${staff.fullName} (${staff.empCode || "no code"}) asks to add ${mobile10} to their staff record (registered mobile ${maskMobile10(staff.mobile)}). Reply LINK OK ${code} to approve or LINK NO ${code} to refuse.`,
      audience: "visitor_staff_link",
      category: "director",
      reason: `add a number to a staff record — reply LINK OK ${code} or LINK NO ${code}`,
    });
    return say(composeStaffLinkRequested(code));
  }
  if (/^(no|n|nahi|nahin|नहीं)$/i.test(text)) {
    await save({ staffLink: { step: "who", asks: 0, at: nowIso() } });
    return say("OK — please send your *full name* as on the staff record, or your *employee code* (e.g. STF-007).");
  }
  return say("Please reply *YES* to add this number to that record, or *NO* if it is not you.");
}

/**
 * "LINK OK 4821" / "LINK NO 4821" from the director or principal (or an
 * office phone that takes director or staff messages). Adds the requester's
 * number to their staff record and tells both sides. Returns handled:false
 * for anyone else, so their message carries on as normal.
 */
export async function handleStaffLinkDecision(opts: { fromWaId: string; text: string }): Promise<{ handled: boolean }> {
  const decision = parseStaffLinkDecision(opts.text);
  if (!decision) return { handled: false };
  const approver10 = waNormalizeLocal10(opts.fromWaId);
  const identity = await resolveWaIdentityServer(opts.fromWaId);
  let allowed = identity.roles.some((r) => r.kind === "owner");
  if (!allowed) {
    const { loadRelayRoutes } = await import("@/lib/waRelay.server");
    const rr = await loadRelayRoutes();
    allowed =
      rr.ok &&
      rr.routes.some(
        (r) => r.active && r.mobile10 === approver10 && (r.categories.includes("director") || r.categories.includes("staff")),
      );
  }
  if (!allowed) return { handled: false };

  const store = await readStore();
  const hit = Object.entries(store.sessions).find(
    ([, s]) => s.staffLink?.step === "requested" && s.staffLink.code === decision.code,
  );
  if (!hit) {
    await sendWhatsAppText({ toMobile: approver10, body: `No waiting request ${decision.code} — it may already have been decided.` });
    return { handled: true };
  }
  const [requester10, reqSession] = hit;
  const link = reqSession.staffLink!;
  const masters = loadMasters();
  const staff = (masters.staff ?? []).find((s) => s.id === link.staffId);
  const who = staff ? `${staff.fullName}${staff.empCode ? ` (${staff.empCode})` : ""}` : "the staff record";

  if (!decision.approve) {
    await patchSession(requester10, reqSession, { staffLink: null });
    await sendWhatsAppText({
      toMobile: requester10,
      body: "Your request to add this number to the staff record was not approved. Please speak to the office.",
    });
    await sendWhatsAppText({ toMobile: approver10, body: `Refused — ${requester10} was not added to ${who}.` });
    return { handled: true };
  }

  const { addStaffAltMobile } = await import("@/lib/waRoleResolver.server");
  const added = await addStaffAltMobile(link.staffId || "", requester10);
  if (!added.ok) {
    await sendWhatsAppText({ toMobile: approver10, body: `Could not add ${requester10} to ${who}: ${added.error}. Please add it in Staff → profile.` });
    return { handled: true };
  }
  // A fresh session: the next message is from a known staff member.
  const fresh = await readStore();
  const sessions = { ...fresh.sessions };
  delete sessions[requester10];
  await writeStore({ ...fresh, sessions });
  await sendWhatsAppText({
    toMobile: requester10,
    body: `✅ Approved — this number is now on your staff record (${added.staff.fullName}). Send *hi* to open your staff menu.`,
  });
  await sendWhatsAppText({
    toMobile: approver10,
    body: `✅ Added ${requester10} to ${who}${added.replaced ? ` (replacing ${maskMobile10(added.replaced)} as the second number)` : ""}.`,
  });
  return { handled: true };
}

export async function handleWaUnifiedInbound(opts: {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  location?: {
    lat: number;
    lng: number;
    name?: string;
    address?: string;
    accuracyM?: number;
  };
  /** Voice note (audio media) — transcribed only for staff command flows. */
  audio?: { mediaId: string; mimeType?: string } | null;
  /** What kind of media arrived ("audio", "image (image/jpeg)"…), for the thread line only. */
  mediaNote?: string | null;
  /**
   * A document or photo. Only the job flow reads it today, where the
   * attachment IS the application; every other flow ignores it exactly as
   * it did before, so a parent sending a photo is unaffected.
   */
  document?: { mediaId: string; mimeType?: string; fileName?: string } | null;
  /**
   * Internal. Set by this function after a voice note fails to transcribe and
   * read by delegateActiveFlow; callers pass audio, not this.
   */
  voiceNoteFailure?: VoiceNoteUnusableReason | null;
}): Promise<{
  replied: boolean;
  escalate: boolean;
  audience: string;
  stub: boolean;
  error?: string;
}> {
  await ensureSchoolMirrorHydrated();
  const mobile10 = waNormalizeLocal10(opts.fromWaId);

  // Meta re-delivers a webhook it did not get a prompt answer for, and a
  // voice note takes about six seconds — long enough to invite one. The id
  // is claimed here, before the work, so a retry that lands while the first
  // pass is still running is dropped rather than answered twice.
  if (opts.waMessageId) {
    const nowMs = Date.now();
    const seenStore = await readStore();
    if (isHandledMessage(seenStore.handled, opts.waMessageId, nowMs)) {
      return { replied: false, escalate: false, audience: "duplicate", stub: false };
    }
    await writeStore({
      ...seenStore,
      handled: rememberHandledMessage(seenStore.handled, opts.waMessageId, nowMs),
    });
  }

  // A voice note becomes words before anything is routed.
  //
  // Only when the message carries no text of its own — a caption always wins,
  // because the sender typed it deliberately. On failure `opts` is left
  // untouched, so the ERP command handler's own Google STT path still runs
  // for staff and every other flow behaves exactly as it did before.
  if (opts.audio?.mediaId && !(opts.text || "").trim()) {
    // The kill switch turns off the model call, not the handoff. A parent who
    // spoke still reaches a person — silently dropping them is the behaviour
    // this path exists to remove, and it should not come back with a flag.
    if (!voiceNoteTranscriptionEnabled()) {
      opts = { ...opts, voiceNoteFailure: "disabled" };
    }
  }
  if (opts.audio?.mediaId && !(opts.text || "").trim() && voiceNoteTranscriptionEnabled()) {
    const heard = await transcribeInboundVoiceNote({
      mediaId: opts.audio.mediaId,
      mimeType: opts.audio.mimeType,
      waMessageId: opts.waMessageId,
    });
    if (heard.kind === "transcribed") {
      opts = { ...opts, text: heard.text };
    } else {
      // Carried on opts so it survives the flow routing below and reaches
      // delegateActiveFlow, which decides to hand it to a human.
      opts = { ...opts, voiceNoteFailure: heard.reason };
    }
  }

  const rawText = (opts.text || "").trim();

  // Event RSVP button taps are self-describing and must be handled here,
  // before any per-contact flow routing — a contact with an active
  // "parent" flow (the common case) never has flows re-selected per
  // message, so a naive 7th-flow implementation would have this tap
  // silently swallowed by whatever bot the contact is already talking to.
  if (rawText.startsWith("evt_rsvp_")) {
    const { handleInboundEventRsvp } = await import("@/lib/waEventsRsvp.server");
    const handled = await handleInboundEventRsvp(opts.fromWaId, rawText);
    if (handled) {
      return { replied: true, escalate: false, audience: "event_rsvp", stub: false };
    }
  }

  const mapped = interactiveIdToText(rawText);
  const text = mapped || rawText;
  const inboundLog = {
    // A captionless photo or an unusable voice note still has to read as
    // something in the office's thread; `mediaNote` is what arrived, not
    // words put in the parent's mouth.
    text: rawText || text || (opts.mediaNote ? `[${opts.mediaNote}]` : ""),
    waMessageId: opts.waMessageId,
    interactiveId: mapped && mapped !== rawText ? rawText : undefined,
  };
  if (mobile10.length !== 10) {
    return {
      replied: false,
      escalate: false,
      audience: "invalid",
      stub: false,
      error: "Invalid mobile",
    };
  }

  // Another WhatsApp Business account's automatic reply ("You have contacted
  // Aqua RO Service… currently unavailable"). Answering it draws the next
  // auto-reply; logged for the office, never answered.
  if (looksLikeAutoReply(rawText)) {
    await sendBotReply({
      mobile10,
      displayName: opts.profileName?.trim() || "",
      category: "general",
      audience: "auto_reply",
      inbound: inboundLog,
    });
    return { replied: false, escalate: false, audience: "auto_reply", stub: false };
  }

  // ── A student's own number ──
  //
  // An early return, for the same reason the RSVP tap above is one: a
  // contact never has its flow re-selected per message, so a naive "eighth
  // flow" would be swallowed by whatever bot the number is already in.
  //
  // Safe to sit ahead of identity resolution because a linked student
  // number can never be a parent or staff number — issueStudentLinkCode
  // refuses a number that is already on the family record — so this
  // cannot shadow anyone. A number that is not a student's, and carries no
  // link code, is not claimed and routing continues untouched.
  try {
    const { handleWaStudentInbound } = await import(
      "@/lib/waStudentLink.server"
    );
    const student = await handleWaStudentInbound({
      fromWaId: opts.fromWaId,
      text,
    });
    if (student.handled) {
      await sendBotReply({
        mobile10,
        displayName: opts.profileName?.trim() || "Student",
        // The family's own category: a student's study help belongs on the
        // parent thread as far as the desk is concerned, not in a new
        // bucket nobody looks at.
        category: "parent",
        audience: "student_tutor",
        flow: "parent",
        text: student.replyText,
      });
      return {
        replied: true,
        escalate: false,
        audience: "student_tutor",
        stub: false,
      };
    }
  } catch (e) {
    // Study help for students failing must never take the whole bot with
    // it — every parent, teacher and lead message comes through here.
    console.error("[wa-unified] student study help failed", e);
  }

  const identity = await resolveWaIdentityServer(opts.fromWaId);
  if (opts.profileName?.trim() && !identity.displayName) {
    identity.displayName = opts.profileName.trim();
  }

  let store = await readStore();
  let session = store.sessions[mobile10];

  // Gate visit (VISIT / OUT / poster WhatsApp QR) — before any role flow so
  // a parent or staff session cannot swallow the gate keywords.
  const gate = await handleWaGateVisit({
    mobile10,
    rawText,
    profileName: opts.profileName,
    pending: session?.gate ?? null,
    // A staff member's OUT is their attendance punch, unless they really
    // are checked in at the gate as a visitor. See handleWaGateVisit.
    staff:
      identity.isKnown &&
      identity.roles.some((role) => ["teacher", "staff", "owner"].includes(flowKindFromRole(role))),
  });
  if (gate.handled) {
    const base = session ?? sessionFor(mobile10, identity, opts.profileName);
    store = {
      ...store,
      sessions: {
        ...store.sessions,
        [mobile10]: { ...base, gate: gate.pending ?? null, updatedAt: nowIso() },
      },
    };
    await writeStore(store);
    let ok = true;
    for (const r of gate.replies) {
      const sent = await sendBotReply({
        mobile10,
        displayName: identity.displayName || opts.profileName || "",
        category: "general",
        audience: gate.audience,
        ...("menu" in r ? { menu: r.menu } : { text: r.text }),
        inbound: inboundLog,
      });
      ok = ok && sent;
    }
    return { replied: ok, escalate: false, audience: gate.audience, stub: !ok };
  }

  // A staff member's greeting is a greeting, and their "help" is a
  // question for the command desk — neither is a request for the visitor
  // menu. Both are allowed past this branch and reach delegateActiveFlow
  // below. "menu", "main" and "start" still reset, for everyone.
  const isStaff =
    identity.isKnown &&
    identity.roles.some((role) => ["teacher", "staff", "owner"].includes(flowKindFromRole(role)));

  // A location pin from staff is their attendance punch — always, whatever
  // menu or role they were last in.
  //
  // 29 Sep 2026: every staff punch of the day failed. A pin carries no
  // text, and empty text read as "show the menu", so each pin was answered
  // with the greeting and never reached the attendance bot. Staff did it
  // right — IN, then 📎 → Location — and were not marked, five of them,
  // some twice. A teacher-parent last talking as a parent, or a staff
  // member sitting at the profile question, lost the pin the same way.
  if (opts.location && isStaff) {
    const att = await handleWaStaffAttendanceInbound({
      fromWaId: opts.fromWaId,
      text: "",
      waMessageId: opts.waMessageId,
      profileName: opts.profileName,
      location: opts.location,
      fromUnified: true,
    });
    if (att.handled) {
      // The morning punch: show the day (what they teach, what to type) once,
      // then answer whatever they asked while it was waiting.
      if (att.punched === "in") {
        const staffFlow: WaUnifiedFlow =
          session?.activeFlow && ["teacher", "staff", "owner"].includes(String(session.activeFlow))
            ? session.activeFlow
            : flowKindFromRole(identity.roles.find((r) => ["teacher", "staff", "owner"].includes(flowKindFromRole(r)))!);
        const base = session ?? sessionFor(mobile10, identity, opts.profileName);
        if (base.guideSentOn !== istNow().todayIso) {
          await sendDayGuide({ mobile10, identity, flow: String(staffFlow), session: base, punchedJustNow: true });
        }
        await answerDeferred(staffFlow, opts, identity);
      }
      return { replied: att.replied, escalate: att.escalate, audience: "staff_attendance", stub: att.stub, error: att.error };
    }
  }
  // An unknown caller already in a conversation who forwards a link or
  // drops a photo with no caption is not asking for the welcome menu.
  // Empty text reads as a menu command, so without this a bare photo
  // re-sent the whole welcome every time one arrived.
  if (
    shouldShowUnifiedMenu({
      text,
      staff: isStaff,
      known: identity.isKnown,
      hasSession: !!session,
      hasAudio: !!opts.audio,
      hasLocation: !!opts.location,
    })
  ) {
    // A number-link request survives "hi": it is waiting on the director.
    const keptLink = session?.staffLink ?? null;
    session = sessionFor(mobile10, identity, opts.profileName);
    if (!identity.isKnown && keptLink) session.staffLink = keptLink;
    if (identity.isKnown && identity.roles.length === 1) {
      session.phase = "active";
      session.activeFlow = identity.roles[0]!.kind;
    } else if (identity.isKnown && identity.roles.length > 1) {
      session.phase = "pick_role";
      session.activeFlow = null;
    } else {
      session.phase = "collect_name";
      session.activeFlow = null;
    }
    store = {
      ...store,
      sessions: { ...store.sessions, [mobile10]: session },
    };
    await writeStore(store);
    const pack = identity.isKnown
      ? menuKnownUserGreeting(identity, unifiedHindiFor(identity))
      : menuUnknownWelcome();
    const ok = await sendBotReply({
      mobile10,
      displayName: identity.displayName,
      category: identity.isKnown
        ? session.activeFlow
          ? categoryForUnifiedAudience("known_greeting", session.activeFlow)
          : categoryForKnownIdentity(identity)
        : "general",
      audience: identity.isKnown ? "known_greeting" : "visitor_greeting",
      flow: session.activeFlow,
      menu: pack,
      inbound: inboundLog,
    });
    return {
      replied: ok,
      escalate: false,
      audience: identity.isKnown ? "known_greeting" : "visitor_greeting",
      stub: !ok,
    };
  }

  if (!session) {
    session = sessionFor(mobile10, identity, opts.profileName);
    if (!identity.isKnown) session.phase = "collect_name";
    else if (identity.roles.length > 1) session.phase = "pick_role";
    else {
      session.phase = "active";
      session.activeFlow = identity.roles[0]?.kind ?? null;
    }
  }

  // ── An unknown caller who has been asked enough ───────────────────
  // The bot gave up and handed the thread to a person. Everything is
  // still logged; nothing more is sent. They get out by saying "hi" or
  // "menu" (handled above), or by finally naming what they want.
  // More than one role on this number — a teacher whose child studies here —
  // switches with the role's word on its own, at any time, and "ROLE" shows
  // them all. See parseRoleSwitch / composeRolesFooter.
  if (identity.isKnown && switchableRoles(roleNotesFor(identity)).length > 1 && text) {
    const notes = roleNotesFor(identity);
    const current = String(session.activeFlow ?? "");
    const target = parseRoleSwitch(text, notes, current);
    if (target || isRolesAsk(text)) {
      if (target) {
        const role = identity.roles.find((r) => String(flowKindFromRole(r)) === target)!;
        session.activeFlow = target as WaUnifiedFlow;
        session.phase = "active";
        session.displayName = role.staff?.fullName || identity.displayName;
        await patchSession(mobile10, session, {
          activeFlow: session.activeFlow,
          phase: "active",
          displayName: session.displayName,
        });
        const back = switchableRoles(notes).find((n) => n.kind !== target)?.switchWord ?? "MENU";
        await sendBotReply({
          mobile10,
          displayName: session.displayName,
          category: categoryForUnifiedAudience("role_pick", target),
          audience: "role_switch",
          flow: target,
          text: `🔁 Switched to *${role.pickKeyword}* — ${role.label}.\nEverything you send now is answered in this role. Send *${back}* to switch back, or *ROLE* to see your roles.`,
          inbound: inboundLog,
        });
        const hindi = unifiedHindiFor(identity);
        const menu = roleFlowInteractiveMenu(target, session.displayName, hindi);
        if (menu) {
          await sendBotReply({ mobile10, displayName: session.displayName, category: categoryForUnifiedAudience("role_pick", target), audience: target, flow: target, menu });
        }
        return { replied: true, escalate: false, audience: "role_switch", stub: false };
      }
      const ok = await sendBotReply({
        mobile10,
        displayName: session.displayName || identity.displayName,
        category: categoryForKnownIdentity(identity),
        audience: "role_list",
        text: composeRolesFooter(notes, current),
        inbound: inboundLog,
      });
      return { replied: ok, escalate: false, audience: "role_list", stub: !ok };
    }
  }

  // An unknown number that writes like staff — "Mere class ka attendance
  // lena hai" from a teacher whose number is not on the record — is offered
  // a way to find that record and ask for this number to be added to it.
  if (!identity.isKnown) {
    const linkStep = await staffLinkStep({
      mobile10,
      text,
      session,
      displayName: session.visitorName || identity.displayName,
      inbound: inboundLog,
    });
    if (linkStep) return linkStep;
  }

  if (!identity.isKnown && session.phase === "parked") {
    const purpose = detectVisitorPurpose(text);
    if (!purpose) {
      await sendBotReply({
        mobile10,
        displayName: session.visitorName || identity.displayName,
        category: "general",
        audience: "visitor_parked",
        inbound: inboundLog,
      });
      return { replied: false, escalate: false, audience: "visitor_parked", stub: false };
    }
    // They said something real after all. Pick them back up.
    session.phase = "collect_purpose";
    session.visitorAsks = 0;
  }

  if (!identity.isKnown && session.phase === "collect_name") {
    // A forwarded link or a bare media drop is a broadcast, not an
    // answer. Log it and say nothing — replying is how a "good morning"
    // chain became a three-week correspondence with a bot.
    if (looksLikeForward(text)) {
      await sendBotReply({
        mobile10,
        displayName: identity.displayName,
        category: "general",
        audience: "visitor_forward",
        inbound: inboundLog,
      });
      return { replied: false, escalate: false, audience: "visitor_forward", stub: false };
    }
    // A document arriving here is the thing they came to send, not their
    // name. Keep it, so JOB can file it in a moment.
    if (opts.document?.mediaId) {
      session.pendingDocument = {
        mediaId: opts.document.mediaId,
        mimeType: opts.document.mimeType,
        fileName: opts.document.fileName,
        at: nowIso(),
      };
    }
    const read = readVisitorName(text);
    if (!read.ok) {
      const asks = (session.visitorAsks ?? 0) + 1;
      session.visitorAsks = asks;
      const giveUp = asks >= VISITOR_ASK_LIMIT;
      if (giveUp) session.phase = "parked";
      store = {
        ...store,
        sessions: { ...store.sessions, [mobile10]: { ...session, updatedAt: nowIso() } },
      };
      await writeStore(store);
      await sendBotReply({
        mobile10,
        displayName: identity.displayName,
        category: "general",
        audience: giveUp ? "visitor_parked" : "visitor",
        text: giveUp
          ? "I'll pass this to the school office and someone will reply. Send *menu* any time to start again."
          : visitorNameRetryText(read.reason),
        inbound: inboundLog,
      });
      return {
        replied: true,
        // Parking is the point at which a person has to look at it.
        escalate: giveUp,
        audience: giveUp ? "visitor_parked" : "visitor",
        stub: false,
      };
    }
    const name = read.name;
    session.visitorName = name;
    session.displayName = name;
    session.visitorAsks = 0;
    session.phase = "collect_purpose";
    store = {
      ...store,
      sessions: { ...store.sessions, [mobile10]: { ...session, updatedAt: nowIso() } },
    };
    await writeStore(store);
    const purposePack = menuVisitorPurpose(name, unifiedHindiFor(identity));
    await sendBotReply({
      mobile10,
      displayName: name,
      category: "general",
      audience: "visitor",
      menu: purposePack,
      inbound: inboundLog,
    });
    return { replied: true, escalate: false, audience: "visitor", stub: false };
  }

  if (!identity.isKnown && session.phase === "collect_purpose") {
    const purpose = detectVisitorPurpose(text);
    if (!purpose) {
      // Same rule as the name step: a forward is logged, never answered.
      if (looksLikeForward(text)) {
        await sendBotReply({
          mobile10,
          displayName: session.visitorName || session.displayName,
          category: "general",
          audience: "visitor_forward",
          inbound: inboundLog,
        });
        return { replied: false, escalate: false, audience: "visitor_forward", stub: false };
      }
      const asks = (session.visitorAsks ?? 0) + 1;
      session.visitorAsks = asks;
      const giveUp = asks >= VISITOR_ASK_LIMIT;
      if (giveUp) session.phase = "parked";
      store = {
        ...store,
        sessions: { ...store.sessions, [mobile10]: { ...session, updatedAt: nowIso() } },
      };
      await writeStore(store);
      if (giveUp) {
        await sendBotReply({
          mobile10,
          displayName: session.visitorName || session.displayName,
          category: "general",
          audience: "visitor_parked",
          text: unifiedHindiFor(identity)
            ? "आपका संदेश स्कूल ऑफिस को भेज दिया गया है, जल्द ही जवाब मिलेगा। दोबारा शुरू करने के लिए कभी भी *menu* लिखें।"
            : "I'll pass this to the school office and someone will reply. Send *menu* any time to start again.",
          inbound: inboundLog,
        });
        return { replied: true, escalate: true, audience: "visitor_parked", stub: false };
      }
      const purposePack = menuVisitorPurpose(session.visitorName || "there", unifiedHindiFor(identity));
      await sendBotReply({
        mobile10,
        displayName: session.visitorName || session.displayName,
        category: "general",
        audience: "visitor",
        menu: purposePack,
        inbound: inboundLog,
      });
      return { replied: true, escalate: false, audience: "visitor", stub: false };
    }
    session.visitorAsks = 0;
    const flow = flowKindFromVisitorPurpose(purpose);
    session.activeFlow = flow;
    session.phase = "active";
    store = {
      ...store,
      sessions: { ...store.sessions, [mobile10]: { ...session, updatedAt: nowIso() } },
    };
    await writeStore(store);
    const hindi = unifiedHindiFor(identity);
    const flowMenu = roleFlowInteractiveMenu(String(flow), session.visitorName, hindi);
    const hint = composeActiveFlowHint(flow, session.visitorName, hindi);
    await sendBotReply({
      mobile10,
      displayName: session.visitorName,
      category: categoryForUnifiedAudience(`visitor_${purpose}`, String(flow)),
      audience: `visitor_${purpose}`,
      flow: String(flow),
      menu: flowMenu || undefined,
      text: flowMenu ? undefined : hint,
      inbound: inboundLog,
    });
    if (flow === "admission_lead") {
      await handleWaCrmBotInbound({
        fromWaId: opts.fromWaId,
        text: "STATUS",
        profileName: session.visitorName,
        visitorName: session.visitorName,
        fromUnified: true,
      });
    }
    return {
      replied: true,
      escalate: purpose === "meeting" || purpose === "job" || purpose === "other",
      audience: `visitor_${purpose}`,
      stub: false,
    };
  }

  if (
    identity.isKnown &&
    session.phase === "pick_role" &&
    !session.activeFlow
  ) {
    // A parent who is also staff, replying to a fee reminder ("थोड़ा समय
    // चाहिए", "भुगतान हो गया") or asking DUES, is answering as a parent. On
    // 13 Sep 2026 a teacher-parent got "Choose: 1. TEACHER 2. PARENT" and her
    // reply was never dealt with.
    const parentRole = identity.roles.find((r) => r.kind === "parent");
    if (parentRole && isParentBusiness(text)) {
      session.activeFlow = "parent";
      session.phase = "active";
      session.displayName = identity.displayName;
      store = {
        ...store,
        sessions: { ...store.sessions, [mobile10]: { ...session, updatedAt: nowIso() } },
      };
      await writeStore(store);
      return delegateActiveFlow("parent", { ...opts, text }, identity, session);
    }
    const role = pickRoleByInput(identity.roles, text);
    // Staff who type a real request at the profile question are asking as
    // staff. 29 Sep 2026: a teacher with an old admission enquiry on her
    // number got "1. TEACHER 2. ADMISSION" back for everything she typed.
    // Empty text (a sticker, a photo) still gets the menu.
    const staffSide = identity.roles.find((r) => ["teacher", "staff", "owner"].includes(flowKindFromRole(r)));
    if (!role && staffSide && text.trim()) {
      session.activeFlow = flowKindFromRole(staffSide);
      session.phase = "active";
      session.displayName = staffSide.staff?.fullName || identity.displayName;
      store = {
        ...store,
        sessions: { ...store.sessions, [mobile10]: { ...session, updatedAt: nowIso() } },
      };
      await writeStore(store);
      return delegateStaffAware(session.activeFlow, { ...opts, text }, identity, session);
    }
    if (!role) {
      const pack = menuKnownUserGreeting(identity, unifiedHindiFor(identity));
      await sendBotReply({
        mobile10,
        displayName: identity.displayName,
        category: categoryForKnownIdentity(identity),
        audience: "role_pick",
        menu: pack,
        inbound: inboundLog,
      });
      session.phase = "pick_role";
      store = {
        ...store,
        sessions: { ...store.sessions, [mobile10]: { ...session, updatedAt: nowIso() } },
      };
      await writeStore(store);
      return { replied: true, escalate: false, audience: "role_pick", stub: false };
    }
    session.activeFlow = flowKindFromRole(role);
    session.phase = "active";
    session.displayName = role.staff?.fullName || identity.displayName;
    store = {
      ...store,
      sessions: { ...store.sessions, [mobile10]: { ...session, updatedAt: nowIso() } },
    };
    await writeStore(store);
    const hindi = unifiedHindiFor(identity);
    const flowMenu = roleFlowInteractiveMenu(
      String(session.activeFlow),
      session.displayName,
      hindi,
    );
    await sendBotReply({
      mobile10,
      displayName: session.displayName,
      category: categoryForUnifiedAudience("role_pick", String(session.activeFlow)),
      audience: String(session.activeFlow),
      flow: String(session.activeFlow),
      menu: flowMenu || undefined,
      text: flowMenu
        ? undefined
        : composeActiveFlowHint(session.activeFlow!, session.displayName, hindi),
      inbound: inboundLog,
    });
    return {
      replied: true,
      escalate: false,
      audience: String(session.activeFlow),
      stub: false,
    };
  }

  if (session.phase === "active" && session.activeFlow) {
    store = {
      ...store,
      sessions: { ...store.sessions, [mobile10]: { ...session, updatedAt: nowIso() } },
    };
    await writeStore(store);
    return delegateStaffAware(
      session.activeFlow,
      { ...opts, text },
      identity,
      session,
    );
  }

  // Reached when the stored session still describes a visitor but the
  // sender resolves as known — the state every staff member was left in
  // while the roster lookup was failing. Greeting them without rewriting
  // the session would replay this same branch on every message and never
  // let them into a role flow, so rebuild it here.
  if (identity.isKnown) {
    session = sessionFor(mobile10, identity, opts.profileName);
    store = {
      ...store,
      sessions: { ...store.sessions, [mobile10]: session },
    };
    await writeStore(store);
  }

  const pack = menuKnownUserGreeting(identity, unifiedHindiFor(identity));
  await sendBotReply({
    mobile10,
    displayName: identity.displayName,
    category: "general",
    audience: "fallback_greeting",
    menu: pack,
    inbound: inboundLog,
  });
  return {
    replied: true,
    escalate: false,
    audience: "fallback_greeting",
    stub: false,
  };
}

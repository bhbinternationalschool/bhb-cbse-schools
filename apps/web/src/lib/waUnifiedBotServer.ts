/**
 * Unified school WhatsApp entry — role-aware greeting + visitor onboarding + flow delegation.
 */

import { handleWaGateVisit, type WaGateVisitPending } from "@/lib/waGateVisit.server";
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
  staffBotAwake,
  STAFF_BOT_WINDOW_MINUTES,
  type WaVisitorPurpose,
} from "@/lib/waUnifiedBotEngine";
import {
  pickRoleByInput,
  type WaResolvedIdentity,
  type WaRoleKind,
} from "@/lib/waRoleResolver";
import { resolveWaIdentityServer } from "@/lib/waRoleResolver.server";
import {
  detectStaffBotIntent,
  replyStaffBotIntentWithAi,
} from "@/lib/waStaffBotEngine";
import {
  detectTransportBotIntent,
  replyTransportBotIntentWithAi,
  resolveTransportDriverContext,
} from "@/lib/waTransportBotEngine";
import { handleWaClassChannelInbound } from "@/lib/waClassChannelServer";
import { handleWaCrmBotInbound } from "@/lib/waCrmBotServer";
import { handleWaSisBotInbound } from "@/lib/waSisBotServer";
import { handleWaSurveyBotInbound } from "@/lib/waSurveyBotServer";
import { handleWaStaffAttendanceInbound } from "@/lib/waStaffAttendanceBotServer";
import { handleErpStaffCommand } from "@/lib/erpCommands.server";
import { transcribeInboundVoiceNote, voiceNoteTranscriptionEnabled } from "@/lib/voiceNote.server";
import {
  VOICE_NOTE_PARENT_ACK,
  voiceNoteHubNote,
  type VoiceNoteUnusableReason,
} from "@/lib/voiceNote";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";
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
   * Until when the staff keyword bot answers this person, ISO. Unset or
   * past means the desk answers their commands and nothing answers the
   * rest — which is the point: on a number staff also use to talk to the
   * school, a bot that replies to everything is an interruption.
   */
  staffBotUntil?: string;
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
    const att = await handleWaStaffAttendanceInbound(inbound);
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

  // ERP command desk — "5A me aaj kaun absent hai" and friends. Runs before
  // the keyword bots for every staff kind, and steps aside (handled:false)
  // for anything that is not clearly a command, so the class channel and
  // the leadership snapshots keep answering what they answer today.
  if (flow === "teacher" || flow === "staff" || flow === "owner") {
    const staffRole =
      identity.roles.find((r) => r.kind === flow && r.staff) ??
      identity.roles.find((r) => r.staff);
    const cmd = await handleErpStaffCommand({
      actorKey: mobile10,
      channel: "whatsapp",
      text: opts.text,
      flow,
      staff: staffRole?.staff ?? null,
      displayName: session.displayName || identity.displayName,
      audio: opts.audio ?? null,
    });
    if (cmd.handled) {
      const ok = await sendBotReply({
        mobile10,
        displayName: session.displayName || identity.displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: cmd.audience,
        flow,
        menu: cmd.menu,
        text: cmd.text,
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
          text: "School bot closed. Commands still work as always — send *help* for the list.",
          inbound: { text: opts.text, waMessageId: opts.waMessageId },
        });
        return { replied: true, escalate: false, audience: "staff_bot_off", stub: false };
      }
      const pack = menuKnownUserGreeting(identity);
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

    if (!staffBotAwake(session.staffBotUntil, nowMs)) {
      // Silence, not a reply saying it will be silent — a "I'm not
      // answering that" on every message is the same interruption wearing
      // an apology. The message is still recorded in Comms → WhatsApp
      // inbox, so the office can see what was sent and answer as a human.
      await sendBotReply({
        mobile10,
        displayName: session.displayName || identity.displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: "staff_quiet",
        flow,
        inbound: { text: opts.text || "", waMessageId: opts.waMessageId },
      });
      return { replied: false, escalate: false, audience: "staff_quiet", stub: false };
    }

    // Awake, and this message keeps it awake.
    {
      const store = await readStore();
      const base = store.sessions[mobile10] ?? session;
      await writeStore({
        ...store,
        sessions: {
          ...store.sessions,
          [mobile10]: {
            ...base,
            staffBotUntil: new Date(nowMs + STAFF_BOT_WINDOW_MINUTES * 60_000).toISOString(),
            updatedAt: nowIso(),
          },
        },
      });
    }

    const intent = detectStaffBotIntent(opts.text);
    if (intent === "menu") {
      const pack = menuKnownUserGreeting(identity);
      await sendBotReply({
        mobile10,
        displayName: session.displayName || identity.displayName,
        category: categoryForUnifiedAudience(flow, flow),
        audience: flow,
        flow,
        menu: pack,
      });
      return { replied: true, escalate: false, audience: flow, stub: false };
    }
    const bot = await replyStaffBotIntentWithAi(intent, opts.text, {
      fullName: session.displayName || identity.displayName,
      isOwner: flow === "owner",
    });
    await sendBotReply({
      mobile10,
      displayName: session.displayName || identity.displayName,
      category: categoryForUnifiedAudience(flow, flow),
      audience: flow,
      flow,
      text: bot.text,
    });
    return {
      replied: true,
      escalate: bot.escalate,
      audience: flow,
      stub: false,
    };
  }

  if (flow === "parent") {
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
      const hint = composeActiveFlowHint("transport", name);
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
      const pack = menuKnownUserGreeting(identity);
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

  if (flow === "job" || flow === "meeting" || flow === "other") {
    const name = session.visitorName || session.displayName || "Guest";
    const note = opts.text.trim();

    // A CV sent after choosing JOB is the application. Capture it into the
    // same inbox the careers page fills, so the office has one pile rather
    // than a page, a CRM thread and somebody's phone. The CRM thread below
    // still gets the message either way — this adds a record, it does not
    // take the conversation away from the humans.
    if (flow === "job" && opts.document?.mediaId) {
      const { captureWhatsAppJobCv } = await import(
        "@/lib/jobApplicationsIntake.server"
      );
      const captured = await captureWhatsAppJobCv({
        mediaId: opts.document.mediaId,
        mobile10,
        applicantName: name,
      });
      await sendBotReply({
        mobile10,
        displayName: name,
        category: categoryForUnifiedAudience("visitor_job", "job"),
        audience: "visitor_job",
        flow,
        text: captured.ok
          ? "Thank you — the school office has your CV. If it matches a vacancy, someone will call you."
          : "Thank you. We could not read that file, so please send your CV as a PDF or a clear photo, or reply with your subject and the classes you teach.",
        inbound: { text: opts.text || "[CV]", waMessageId: opts.waMessageId },
      });
      return {
        replied: true,
        escalate: captured.ok,
        audience: "visitor_job",
        stub: false,
      };
    }
    await handleWaCrmBotInbound({
      ...inbound,
      text: note ? `[${flow.toUpperCase()}] ${note}` : `HUMAN`,
      visitorName: name,
      forceEscalate: true,
    });
    const ack =
      flow === "job"
        ? composeActiveFlowHint("job", name)
        : flow === "meeting"
          ? composeActiveFlowHint("meeting", name)
          : composeActiveFlowHint("other", name);
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
    const hint = composeActiveFlowHint("fee", name);
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
    const hint = composeActiveFlowHint("timing", name);
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
    text: rawText || text,
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
    })
  ) {
    session = sessionFor(mobile10, identity, opts.profileName);
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
      ? menuKnownUserGreeting(identity)
      : menuUnknownWelcome();
    const ok = await sendBotReply({
      mobile10,
      displayName: identity.displayName,
      category: identity.isKnown
        ? categoryForUnifiedAudience("known_greeting", session.activeFlow)
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
    const purposePack = menuVisitorPurpose(name);
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
          text: "I'll pass this to the school office and someone will reply. Send *menu* any time to start again.",
          inbound: inboundLog,
        });
        return { replied: true, escalate: true, audience: "visitor_parked", stub: false };
      }
      const purposePack = menuVisitorPurpose(session.visitorName || "there");
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
    const flowMenu = roleFlowInteractiveMenu(String(flow), session.visitorName);
    const hint = composeActiveFlowHint(flow, session.visitorName);
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
    const role = pickRoleByInput(identity.roles, text);
    if (!role) {
      const pack = menuKnownUserGreeting(identity);
      await sendBotReply({
        mobile10,
        displayName: identity.displayName,
        category: "general",
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
    const flowMenu = roleFlowInteractiveMenu(
      String(session.activeFlow),
      session.displayName,
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
        : composeActiveFlowHint(session.activeFlow!, session.displayName),
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
    return delegateActiveFlow(
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

  const pack = menuKnownUserGreeting(identity);
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

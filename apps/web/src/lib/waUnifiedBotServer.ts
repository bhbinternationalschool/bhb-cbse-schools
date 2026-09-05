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
  isUnifiedMenuCommand,
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
  phase: "menu" | "pick_role" | "collect_name" | "collect_purpose" | "active";
  activeFlow: WaUnifiedFlow | null;
  updatedAt: string;
  /** Pending gate check-in (VISIT keyword / poster WhatsApp QR). */
  gate?: WaGateVisitPending | null;
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

  if (flow === "owner" || flow === "staff") {
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
}): Promise<{
  replied: boolean;
  escalate: boolean;
  audience: string;
  stub: boolean;
  error?: string;
}> {
  await ensureSchoolMirrorHydrated();
  const mobile10 = waNormalizeLocal10(opts.fromWaId);
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

  if (isUnifiedMenuCommand(text)) {
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

  if (!identity.isKnown && session.phase === "collect_name") {
    const name = text.trim();
    if (name.length < 2) {
      await sendBotReply({
        mobile10,
        displayName: identity.displayName,
        category: "general",
        audience: "visitor",
        text: "Please send your full name (at least 2 characters).",
        inbound: inboundLog,
      });
      return { replied: true, escalate: false, audience: "visitor", stub: false };
    }
    session.visitorName = name;
    session.displayName = name;
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

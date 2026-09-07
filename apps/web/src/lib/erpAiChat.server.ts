/**
 * ERP AI assistant — local knowledge + optional LLM (OpenAI / Gemini).
 */

import type { DemoSession } from "@/lib/auth";
import {
  accessibleModuleLinks,
  replyErpAiChat,
  type ErpAiChatContext,
  type ErpAiMessage,
} from "@/lib/erpAiChat";
import {
  buildErpAiChatContext,
  buildErpAiGeminiSystemPrompt,
  inferLinksFromGeminiText,
} from "@/lib/erpAiContext.server";
import {
  generateTutorText,
  llmConfigured,
  startLlmPrecheck,
  type LlmEngine,
} from "@/lib/aiLlm.server";
import { geminiConfigured } from "@/lib/erpAiGemini.server";
import { loadMasters, type MastersState } from "@/lib/masters";
import { handleErpStaffCommand, type ErpCommandFlow } from "@/lib/erpCommands.server";
import { parseErpCommandLocal, waMarkersToAssistantText } from "@/lib/erpCommands";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { staffRolesFor } from "@/lib/waRoleResolver";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { formatKbContext, retrieveRelevantKb } from "@/lib/schoolKb.server";

function nid() {
  return `msg_${Math.random().toString(36).slice(2, 10)}`;
}

const GENERIC_FALLBACK_RE =
  /^I don’t have a precise guide for that yet|^I don't have a precise guide for that yet/;

export function isErpAiGenericFallback(msg: ErpAiMessage): boolean {
  return GENERIC_FALLBACK_RE.test(msg.text.trim());
}

export async function replyErpAiChatServer(opts: {
  session: DemoSession;
  message: string;
  history?: { role: "user" | "assistant"; text: string }[];
  pathname?: string;
  tab?: string;
  masters?: MastersState | null;
  /**
   * Stream the LLM part of the reply. Local (guide / canned) answers are
   * instant and arrive whole in the returned message, never as deltas.
   */
  onDelta?: (text: string) => void;
}): Promise<{
  message: ErpAiMessage;
  engine: "local" | LlmEngine;
  geminiConfigured: boolean;
  llmConfigured: boolean;
}> {
  await ensureSchoolMirrorHydrated();
  const masters = opts.masters ?? loadMasters();
  const ctx: ErpAiChatContext = buildErpAiChatContext(opts.session, masters);
  const local = replyErpAiChat(opts.message, ctx);
  const anyLlm = llmConfigured();

  // ERP command desk — the same engine that answers staff on WhatsApp and
  // in the app. Tried when the message reads as a command outright, or
  // when no page guide claimed it; a guide keyed on "attendance" must not
  // swallow "5A me aaj kaun absent hai".
  if (
    opts.session.persona === "staff" &&
    (parseErpCommandLocal(opts.message) || isErpAiGenericFallback(local))
  ) {
    const cmd = await runErpCommandForSession(opts.session, opts.message);
    if (cmd) {
      return {
        message: cmd,
        engine: "local",
        geminiConfigured: geminiConfigured(),
        llmConfigured: anyLlm,
      };
    }
  }

  if (!anyLlm || !isErpAiGenericFallback(local)) {
    return {
      message: local,
      engine: "local",
      geminiConfigured: geminiConfigured(),
      llmConfigured: anyLlm,
    };
  }

  // Everything the model call needs that touches the network starts now,
  // together: the requester + budget verdict, and the knowledge-base
  // lookup. Serial, they were the bulk of the wait before the first word.
  const precheck = startLlmPrecheck();

  const history = (opts.history || []).slice(-8).map((h) => ({
    role: h.role,
    content: h.text,
  }));

  const baseSystem = buildErpAiGeminiSystemPrompt({
    ctx,
    pathname: opts.pathname,
    tab: opts.tab,
  });

  const audiences =
    opts.session.persona === "staff"
      ? undefined
      : opts.session.persona === "parent"
        ? (["all", "parents"] as const)
        : opts.session.persona === "student"
          ? (["all", "students"] as const)
          : (["all"] as const);
  const kbMatches = await retrieveRelevantKb(opts.message, {
    audiences: audiences ? [...audiences] : undefined,
  });
  const kbContext = formatKbContext(kbMatches);
  const system = kbContext
    ? `${baseSystem}\n\nRELEVANT SCHOOL NOTICES (use these for date/policy/circular questions; never state a notice fact not shown here):\n${kbContext}`
    : baseSystem;

  const llm = await generateTutorText({
    system,
    history,
    userMessage: opts.message,
    onDelta: opts.onDelta,
    precheck,
  });

  if (!llm.ok) {
    return {
      message: {
        ...local,
        text: `${local.text}\n\n_(AI unavailable: ${llm.error})_`,
      },
      engine: "local",
      geminiConfigured: geminiConfigured(),
      llmConfigured: anyLlm,
    };
  }

  const links = inferLinksFromGeminiText(llm.text, ctx);
  const fallback = accessibleModuleLinks(ctx).slice(0, 2);

  return {
    message: {
      id: nid(),
      role: "assistant",
      at: new Date().toISOString(),
      text: llm.text,
      links: links.length ? links : fallback.length ? fallback : undefined,
    },
    engine: llm.engine,
    geminiConfigured: geminiConfigured(),
    llmConfigured: anyLlm,
  };
}

/**
 * Resolve the signed-in staff member's roster record and run the command
 * engine as them. Returns null when the engine does not recognise the
 * message, so the caller carries on to guides and the model.
 */
async function runErpCommandForSession(
  session: DemoSession,
  message: string,
): Promise<ErpAiMessage | null> {
  const masters = await loadServerMasters();
  const roster = masters.staff ?? [];
  const email = (session.email || "").trim().toLowerCase();
  const staff =
    roster.find((s) => s.id === session.staffId) ??
    (email
      ? roster.find(
          (s) =>
            (s.email || "").trim().toLowerCase() === email ||
            (s.loginUsername || "").trim().toLowerCase() === email,
        )
      : undefined) ??
    null;
  let flow: ErpCommandFlow = "staff";
  if (staff) {
    const kinds = staffRolesFor(staff, masters.designations ?? []).map((r) => r.kind);
    flow = kinds.includes("owner") ? "owner" : kinds.includes("staff") ? "staff" : "teacher";
  }
  const r = await handleErpStaffCommand({
    actorKey: `staff:${staff?.id || session.email || session.fullName}`,
    channel: "app",
    text: message,
    flow,
    staff,
    displayName: staff?.fullName || session.fullName,
  });
  if (!r.handled) return null;
  return {
    id: nid(),
    role: "assistant",
    at: new Date().toISOString(),
    text: waMarkersToAssistantText(r.text || r.menu?.textFallback || ""),
    confirm: r.confirm,
  };
}

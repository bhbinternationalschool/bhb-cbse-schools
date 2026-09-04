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
import { generateTutorText, llmConfigured, type LlmEngine } from "@/lib/aiLlm.server";
import { geminiConfigured } from "@/lib/erpAiGemini.server";
import { loadMasters, type MastersState } from "@/lib/masters";
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

  if (!anyLlm || !isErpAiGenericFallback(local)) {
    return {
      message: local,
      engine: "local",
      geminiConfigured: geminiConfigured(),
      llmConfigured: anyLlm,
    };
  }

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

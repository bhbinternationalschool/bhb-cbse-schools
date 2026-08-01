/**
 * ERP AI assistant — local knowledge + optional Gemini.
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
  geminiConfigured,
  generateGeminiText,
  type GeminiChatTurn,
} from "@/lib/erpAiGemini.server";
import { loadMasters, type MastersState } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

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
}): Promise<{
  message: ErpAiMessage;
  engine: "local" | "gemini";
  geminiConfigured: boolean;
}> {
  await ensureSchoolMirrorHydrated();
  const masters = opts.masters ?? loadMasters();
  const ctx: ErpAiChatContext = buildErpAiChatContext(opts.session, masters);
  const local = replyErpAiChat(opts.message, ctx);

  if (!geminiConfigured() || !isErpAiGenericFallback(local)) {
    return {
      message: local,
      engine: "local",
      geminiConfigured: geminiConfigured(),
    };
  }

  const history: GeminiChatTurn[] = (opts.history || [])
    .slice(-8)
    .map((h) => ({
      role: h.role === "assistant" ? ("model" as const) : ("user" as const),
      text: h.text,
    }));

  const system = buildErpAiGeminiSystemPrompt({
    ctx,
    pathname: opts.pathname,
    tab: opts.tab,
  });

  const gemini = await generateGeminiText({
    system,
    history,
    userMessage: opts.message,
  });

  if (!gemini.ok) {
    return {
      message: {
        ...local,
        text: `${local.text}\n\n_(Gemini unavailable: ${gemini.error})_`,
      },
      engine: "local",
      geminiConfigured: true,
    };
  }

  const links = inferLinksFromGeminiText(gemini.text, ctx);
  const fallback = accessibleModuleLinks(ctx).slice(0, 2);

  return {
    message: {
      id: nid(),
      role: "assistant",
      at: new Date().toISOString(),
      text: gemini.text,
      links: links.length ? links : fallback.length ? fallback : undefined,
    },
    engine: "gemini",
    geminiConfigured: true,
  };
}

import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { replyErpAiChatServer } from "@/lib/erpAiChat.server";
import { geminiConfigured, geminiModel } from "@/lib/erpAiGemini.server";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "erp-ai",
    geminiConfigured: geminiConfigured(),
    model: geminiConfigured() ? geminiModel() : null,
    note: geminiConfigured()
      ? "POST { message, history?, pathname?, tab? } — local guides first, Gemini for open questions"
      : "Set GEMINI_API_KEY in server env for live AI answers",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.persona !== "staff") {
    return NextResponse.json(
      { error: "ERP AI assistant is for staff sign-in only" },
      { status: 403 },
    );
  }

  let body: {
    message?: string;
    history?: { role: "user" | "assistant"; text: string }[];
    pathname?: string;
    tab?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();

  const result = await replyErpAiChatServer({
    session,
    message,
    history: body.history,
    pathname: body.pathname,
    tab: body.tab,
    masters,
  });

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    geminiConfigured: result.geminiConfigured,
    message: result.message,
  });
}

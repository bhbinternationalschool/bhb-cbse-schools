import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { generateTutorText, llmStatus } from "@/lib/aiLlm.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const status = llmStatus();
  return NextResponse.json({
    service: "thread-summary",
    configured: status.tutorEngine !== "none",
    engine: status.tutorEngine,
    note: "POST { categoryLabel, contactName, messages: [{direction, role, text, at}] }",
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }

  let body: {
    categoryLabel?: string;
    contactName?: string;
    messages?: {
      direction?: "in" | "out";
      role?: string;
      text?: string;
      at?: string;
    }[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const transcript = messages
    .slice(-40)
    .map(
      (m) =>
        `${m.direction === "in" ? "Them" : m.role === "staff" ? "Staff" : "Bot"}: ${(m.text || "").trim()}`,
    )
    .filter((l) => !l.endsWith(":"))
    .join("\n")
    .slice(0, 6000);

  const system = `You summarize a WhatsApp conversation for a school office staff member who is about to open it.
Use ONLY what's in the transcript given — never invent a fact, name, date, or amount not present in it.
Write 2-4 short sentences: what this contact wants/has said, and what (if anything) is still unanswered or needs staff action.
No greeting, no markdown, plain text only.`;

  const userMessage = `Category: ${body.categoryLabel || "General"}
Contact: ${body.contactName || "Unknown"}
School: ${TENANT.nameDisplay}

Transcript (oldest to newest):
${transcript}`;

  const result = await generateTutorText({ system, userMessage });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, engine: result.engine },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    generationId: result.generationId,
    summary: result.text.trim(),
  });
}

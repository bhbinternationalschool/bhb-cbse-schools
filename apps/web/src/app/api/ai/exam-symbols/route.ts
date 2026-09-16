import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { generateExamSymbolsJson } from "@/lib/aiLlm.server";

export const runtime = "nodejs";

/**
 * POST { query, subject } → { items: [{insert, label, note}], generationId }
 *
 * The editor's formula catalogue is a fixed list per subject; this is the
 * "not in the list" fallback. The model only proposes text; the teacher
 * picks what to insert, and nothing is saved here.
 */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  }
  await ensureSchoolMirrorHydrated();
  if (!hasPermission(session, loadMasters(), "exams", "edit")) {
    return NextResponse.json({ error: "Exams edit permission required" }, { status: 403 });
  }
  let body: { query?: string; subject?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const query = String(body.query || "").trim().slice(0, 200);
  if (query.length < 2) return NextResponse.json({ error: "Type what to search for" }, { status: 400 });
  const r = await generateExamSymbolsJson({ query, subject: String(body.subject || "").slice(0, 80) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  let items: { insert: string; label: string; note: string }[] = [];
  try {
    const parsed = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { items?: unknown };
    items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return {
          insert: String(o.insert ?? "").trim().slice(0, 200),
          label: String(o.label ?? "").trim().slice(0, 60),
          note: String(o.note ?? "").trim().slice(0, 160),
        };
      })
      .filter((x) => x.insert)
      .slice(0, 12);
  } catch {
    return NextResponse.json({ error: "The model did not return a list" }, { status: 502 });
  }
  return NextResponse.json({ items, generationId: r.generationId, engine: r.engine });
}

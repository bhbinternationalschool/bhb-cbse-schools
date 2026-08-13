/**
 * Owner-scoped school-wide WhatsApp broadcast — all parents or all staff.
 * Reuses /api/wa/dispatch's send logic directly (calling its exported POST
 * handler in-process per chunk) rather than duplicating the
 * template/text-send branching — same session context carries through via
 * next/headers, no cookie-forwarding needed.
 */
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  listAllHouseholdWaNumbers,
  listAllStaffMobiles,
} from "@/lib/bulkRecipients";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { POST as dispatchPost } from "@/app/api/wa/dispatch/route";

export const runtime = "nodejs";

type BroadcastBody = {
  audience?: "parents" | "staff";
  body?: string;
  dryRun?: boolean;
};

const CHUNK_SIZE = 100;

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "notifications", "edit");
  if (!auth.ok) return auth.response;

  let body: BroadcastBody | null = null;
  try {
    body = (await req.json()) as BroadcastBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const audience = body?.audience;
  const text = (body?.body || "").trim();
  // Default to dry-run unless the caller explicitly opts out — a
  // school-wide send must never happen because a flag was merely omitted.
  const dryRun = body?.dryRun !== false;

  if (audience !== "parents" && audience !== "staff") {
    return NextResponse.json(
      { error: 'audience must be "parents" or "staff"' },
      { status: 400 },
    );
  }
  if (!text) {
    return NextResponse.json(
      { error: "Message body is required" },
      { status: 400 },
    );
  }

  await Promise.all([ensureSisHydratedServer(), ensureSchoolMirrorHydrated()]);

  let numbers =
    audience === "parents" ? listAllHouseholdWaNumbers() : listAllStaffMobiles();
  let skippedOptOut = 0;

  if (audience === "parents") {
    // One batch query instead of one round trip per household — a
    // broadcast to hundreds of numbers must not serialize hundreds of
    // sequential DB calls. Fails open (empty set) on a lookup error,
    // matching lib/waContactState.server.ts's own documented convention.
    const optedOutSet = await listOptedOutSet(numbers).catch(() => new Set<string>());
    const kept: string[] = [];
    for (const mobile of numbers) {
      if (optedOutSet.has(toE164India(mobile))) skippedOptOut++;
      else kept.push(mobile);
    }
    numbers = kept;
  }

  if (numbers.length === 0) {
    return NextResponse.json({
      ok: true,
      mode: dryRun ? "dry_run" : "live",
      recipientCount: 0,
      skippedOptOut,
      results: [],
    });
  }

  const chunks: string[][] = [];
  for (let i = 0; i < numbers.length; i += CHUNK_SIZE) {
    chunks.push(numbers.slice(i, i + CHUNK_SIZE));
  }

  const dispatchUrl = new URL("/api/wa/dispatch", req.url).toString();
  const allResults: unknown[] = [];
  let sent = 0;
  let failed = 0;

  for (const chunk of chunks) {
    const chunkReq = new Request(dispatchUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        module: "notifications",
        dryRun,
        messages: chunk.map((mobile) => ({ mobile, body: text })),
      }),
    });
    const res = await dispatchPost(chunkReq);
    const json = (await res.json()) as {
      results?: unknown[];
      sent?: number;
      failed?: number;
    };
    if (Array.isArray(json.results)) allResults.push(...json.results);
    sent += json.sent ?? 0;
    failed += json.failed ?? 0;
  }

  return NextResponse.json({
    ok: true,
    mode: dryRun ? "dry_run" : "live",
    recipientCount: numbers.length,
    skippedOptOut,
    sent,
    failed,
    results: allResults,
  });
}

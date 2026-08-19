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
  listLanguageUnsetHouseholdWaNumbers,
  listAllStaffMobiles,
} from "@/lib/bulkRecipients";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { loadSis } from "@/lib/sis";
import { loadMasters } from "@/lib/masters";
import { sendPushToSubjects } from "@/lib/webPush.server";
import { fetchServerBlob } from "@/lib/serverBlob";
import {
  listApprovedTemplates,
  normalizeWaTemplatesState,
  type WaTemplatesState,
} from "@/lib/waTemplates";

/**
 * Human-readable text for a template send, for the app-push mirror: the
 * approved template's body with {{tokens}} filled from the same variables
 * the WA send used. Empty string if the template can't be resolved (the
 * push is then skipped rather than sent with a bare template name).
 */
async function renderTemplateForPush(t: BroadcastTemplate): Promise<string> {
  try {
    const { state: raw } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
    const tpl = listApprovedTemplates(normalizeWaTemplatesState(raw)).find(
      (x) => x.metaName === t.name && (x.metaLanguage || x.language) === t.language,
    );
    if (!tpl) return "";
    let body = tpl.body || "";
    for (const [k, v] of Object.entries(t.variables || {})) {
      body = body.split(`{{${k}}}`).join(v);
    }
    // Strip WhatsApp *bold* markers — plain text in a notification.
    return body.replace(/\*([^*]+)\*/g, "$1").trim();
  } catch {
    return "";
  }
}
import { POST as dispatchPost } from "@/app/api/wa/dispatch/route";

export const runtime = "nodejs";

type BroadcastTemplate = {
  name: string;
  language: string;
  variableKeys?: string[];
  variables?: Record<string, string>;
};

type BroadcastBody = {
  audience?: "parents" | "staff" | "parents_language_unset";
  body?: string;
  template?: BroadcastTemplate;
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
  const template = body?.template?.name ? body.template : null;
  // Default to dry-run unless the caller explicitly opts out — a
  // school-wide send must never happen because a flag was merely omitted.
  const dryRun = body?.dryRun !== false;

  if (audience !== "parents" && audience !== "staff" && audience !== "parents_language_unset") {
    return NextResponse.json(
      { error: 'audience must be "parents", "parents_language_unset" or "staff"' },
      { status: 400 },
    );
  }
  if (!text && !template) {
    return NextResponse.json(
      { error: "Message body or template is required" },
      { status: 400 },
    );
  }

  await Promise.all([ensureSisHydratedServer(), ensureSchoolMirrorHydrated()]);

  const parentsAudience = audience === "parents" || audience === "parents_language_unset";
  let numbers =
    audience === "parents"
      ? listAllHouseholdWaNumbers()
      : audience === "parents_language_unset"
        ? listLanguageUnsetHouseholdWaNumbers()
        : listAllStaffMobiles();
  let skippedOptOut = 0;

  if (parentsAudience) {
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
        messages: chunk.map((mobile) =>
          template ? { mobile, template } : { mobile, body: text },
        ),
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

  // Mirror a live broadcast to app/PWA push — free text as-is, template
  // sends rendered from the approved body. Best-effort — never affects the
  // WA result above.
  let push = { sent: 0, expired: 0, failed: 0 };
  const pushText = !dryRun
    ? text || (template ? await renderTemplateForPush(template) : "")
    : "";
  if (!dryRun && pushText) {
    const subjectIds =
      audience === "parents"
        ? loadSis().households.map((h) => h.id)
        : audience === "parents_language_unset"
          ? loadSis().households.filter((h) => !(h.preferredLanguage || "").trim()).map((h) => h.id)
          : (loadMasters().staff ?? [])
              .filter((s) => s.status === "active")
              .map((s) => s.id);
    push = await sendPushToSubjects(parentsAudience ? "parent" : "staff", subjectIds, {
      title: `${auth.ctx.session.fullName} · BHB International School`,
      body: pushText.length > 200 ? `${pushText.slice(0, 197)}…` : pushText,
      url: "/notices",
      data: { kind: "broadcast" },
    }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
  }

  return NextResponse.json({
    ok: true,
    mode: dryRun ? "dry_run" : "live",
    recipientCount: numbers.length,
    skippedOptOut,
    sent,
    failed,
    push,
    results: allResults,
  });
}

/**
 * Staff-initiated WhatsApp send — a teacher's own class parents, or
 * leadership (owner/principal/admin). Self-scoped by design: unlike
 * /api/v1/owner/broadcast (gated on the "notifications" RBAC module,
 * office/admin only), any signed-in staff member can use this for their
 * OWN assigned classes — the audience itself is what's restricted, not
 * the feature. sectionId is verified server-side against the caller's
 * actual class/subject-teacher links (staffAllowedSections) rather than
 * trusted from the client, so a teacher cannot message a class they don't
 * teach by editing the request.
 *
 * Reuses /api/wa/dispatch's send logic like the owner broadcast route
 * does, but via WA_DISPATCH_SECRET instead of RBAC — this route has
 * already done the real authorization (section ownership / leadership
 * lookup) by the time it calls dispatch, so re-checking a *different*
 * RBAC module there would either wrongly block a real class teacher or
 * require borrowing a module grant that doesn't actually describe this
 * action.
 */
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { chatSelfFromSession } from "@/lib/erpChat";
import { staffAllowedSections } from "@/lib/erpChatAccess";
import { listSectionParentContacts } from "@/lib/homework";
import { inferStaffIsOwner } from "@/lib/waRoleResolver";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { POST as dispatchPost } from "@/app/api/wa/dispatch/route";
import { sendPushToSubjects } from "@/lib/webPush.server";

export const runtime = "nodejs";

type Audience = "leadership" | "class_parents";

type BroadcastTemplate = {
  name: string;
  language: string;
  variableKeys?: string[];
  variables?: Record<string, string>;
};

type StaffBroadcastBody = {
  audience?: Audience;
  sectionId?: string;
  body?: string;
  template?: BroadcastTemplate;
  dryRun?: boolean;
};

const CHUNK_SIZE = 100;

export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await resolveApiAuth(req);
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.session.persona !== "staff") {
    return NextResponse.json(
      { error: "Staff session required" },
      { status: 403 },
    );
  }

  let body: StaffBroadcastBody | null = null;
  try {
    body = (await req.json()) as StaffBroadcastBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const audience = body?.audience;
  const text = (body?.body || "").trim();
  const template = body?.template?.name ? body.template : null;
  const dryRun = body?.dryRun !== false;

  if (audience !== "leadership" && audience !== "class_parents") {
    return NextResponse.json(
      { error: 'audience must be "leadership" or "class_parents"' },
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

  const actor = chatSelfFromSession(ctx.session, ctx.masters, loadSis());
  if (!actor || actor.kind !== "staff" || !actor.staffId) {
    return NextResponse.json(
      { error: "Could not resolve your staff record" },
      { status: 400 },
    );
  }
  const selfStaff = ctx.masters.staff?.find((s) => s.id === actor.staffId);

  let numbers: string[] = [];
  /** Push subjects mirroring the WA audience (staff ids / household ids). */
  let pushSubjectType: "staff" | "parent" = "staff";
  let pushSubjectIds: string[] = [];

  if (audience === "leadership") {
    const seen = new Set<string>();
    for (const s of ctx.masters.staff ?? []) {
      if (s.status !== "active") continue;
      if (s.id === actor.staffId) continue; // no point messaging yourself
      if (!inferStaffIsOwner(s, ctx.masters.designations ?? [])) continue;
      const mobile = (s.mobile || "").trim();
      if (mobile) seen.add(mobile);
      pushSubjectIds.push(s.id);
    }
    numbers = Array.from(seen);
  } else {
    const sectionId = body?.sectionId?.trim();
    if (!sectionId) {
      return NextResponse.json(
        { error: "sectionId is required for class_parents" },
        { status: 400 },
      );
    }
    const allowed = staffAllowedSections(
      selfStaff,
      ctx.masters,
      ctx.session.academicYearCode,
      actor.roleCodes,
    );
    if (!allowed.some((s) => s.sectionId === sectionId)) {
      return NextResponse.json(
        { error: "You are not a teacher for that class/section" },
        { status: 403 },
      );
    }
    const contacts = listSectionParentContacts(
      sectionId,
      ctx.session.academicYearCode,
      loadSis(),
    );
    numbers = Array.from(new Set(contacts.map((c) => c.mobile).filter(Boolean)));
    pushSubjectType = "parent";
    pushSubjectIds = contacts.map((c) => c.householdId).filter(Boolean);
  }

  // Native/PWA push alongside the WhatsApp send — live, free-text only
  // (template sends carry no readable body to mirror). Best-effort.
  let push = { sent: 0, expired: 0, failed: 0 };
  if (!dryRun && text && pushSubjectIds.length) {
    push = await sendPushToSubjects(pushSubjectType, pushSubjectIds, {
      title: `${ctx.session.fullName}${pushSubjectType === "parent" ? " (class teacher)" : ""}`,
      body: text.length > 200 ? `${text.slice(0, 197)}…` : text,
      url: "/notices",
      data: { kind: "broadcast" },
    }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
  }

  let skippedOptOut = 0;
  const optedOutSet = await listOptedOutSet(numbers).catch(() => new Set<string>());
  const kept: string[] = [];
  for (const mobile of numbers) {
    if (optedOutSet.has(toE164India(mobile))) skippedOptOut++;
    else kept.push(mobile);
  }
  numbers = kept;

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

  const dispatchSecret = process.env.WA_DISPATCH_SECRET?.trim();
  const dispatchUrl = new URL("/api/wa/dispatch", req.url).toString();
  const allResults: unknown[] = [];
  let sent = 0;
  let failed = 0;

  for (const chunk of chunks) {
    const chunkReq = new Request(dispatchUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(dispatchSecret ? { "x-wa-dispatch-secret": dispatchSecret } : {}),
      },
      body: JSON.stringify({
        module: "homework",
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

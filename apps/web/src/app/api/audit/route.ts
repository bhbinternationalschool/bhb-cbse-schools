import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";

export const runtime = "nodejs";

/**
 * Record an audit event raised by the browser.
 *
 * The actor is taken from the verified session, never from the request
 * body, so a caller cannot attribute an action to another user. Module
 * and action are allow-listed and free text is capped so the trail can't
 * be used as arbitrary storage.
 */

const ALLOWED_MODULES = new Set([
  "students",
  "admissions",
  "fees",
  "attendance",
  "exams",
  "staff",
  "masters",
  "settings",
]);

const ALLOWED_ACTIONS = new Set([
  "create",
  "update",
  "delete",
  "status_change",
  "merge",
  "import",
  "promote",
  "export",
]);

const MAX_SUMMARY = 500;
const MAX_STATE_BYTES = 20_000;

function capState(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_STATE_BYTES) {
      return { truncated: true, bytes: json.length };
    }
    return value;
  } catch {
    return null;
  }
}

type Body = {
  module?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
};

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const auditModule = String(body.module || "").trim();
  const action = String(body.action || "").trim();
  if (!ALLOWED_MODULES.has(auditModule) || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "Unknown module or action" },
      { status: 400 },
    );
  }

  const result = await writeAudit({
    session: auth.ctx.session,
    module: auditModule,
    action,
    entityType: String(body.entityType || "").slice(0, 100),
    entityId: String(body.entityId || "").slice(0, 200),
    summary: String(body.summary || "").slice(0, MAX_SUMMARY),
    before: capState(body.before),
    after: capState(body.after),
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  });

  // Report the truth. The browser call is fire-and-forget so a non-2xx
  // won't disrupt the user, but it must be visible in logs and monitoring
  // rather than reported as a success that never happened.
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Audit write failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

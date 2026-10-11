import { requireStaffApi, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import type { TemplateInput } from "@/lib/feeConcessionTemplates";
import {
  applyTemplate,
  createTemplate,
  listTemplates,
  updateTemplate,
} from "@/lib/feeConcessionTemplates.server";
import { toolsErrorResponse } from "@/lib/feeTools.server";
import type { ConcessionGround } from "@/lib/masters";
import { canGrantConcession } from "@/lib/rbac";

export const runtime = "nodejs";

/**
 * Concession templates (Fees → Bulk & PDC → Concession templates).
 *
 * GET   templates + the fee heads to pick from
 * POST {action:"create", name, ground, mode, value, feeHeadIds, siblingChildNo,
 *       endPolicy, autoApproveMaxPaise, defaultReason}
 *      {action:"update", id, baseUpdatedAt, name?, defaultReason?, autoApproveMaxPaise?, isActive?}
 *      {action:"apply", templateId, studentIds, fromMonth (YYYY-MM), reason, preview}
 *
 * PERMISSION. Everything that writes needs the authority to RECORD a
 * concession (canGrantConcession: fees·edit or an approver). Whether a grant
 * is approved at once is decided per grant by canApproveConcession — the
 * same rule as Masters and the fee counter.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  const rows = await listTemplates();
  if (!rows) return Response.json({ ok: false, error: "Could not read the templates — try again" }, { status: 503 });
  const feeHeads = (auth.ctx.masters.feeHeads ?? [])
    .filter((h) => h.isActive !== false)
    .map((h) => ({ id: h.id, name: h.nameEn || h.code }));
  return Response.json({ ok: true, templates: rows, feeHeads });
}

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) {
    return Response.json({ ok: false, error: "Concessions are given by a person, not a service" }, { status: 403 });
  }
  const { session, masters, rbac } = auth.ctx;
  if (!canGrantConcession(session, masters, rbac)) {
    return Response.json({ ok: false, error: "You do not have permission to record concessions" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const who = session.fullName || session.email || "fee desk";
  try {
    if (body.action === "create") {
      const input: TemplateInput = {
        name: String(body.name ?? ""),
        ground: String(body.ground ?? "") as ConcessionGround,
        mode: body.mode === "fixed" ? "fixed" : "percent",
        value: Number(body.value),
        feeHeadIds: Array.isArray(body.feeHeadIds) ? body.feeHeadIds.map(String) : [],
        siblingChildNo: body.siblingChildNo == null || body.siblingChildNo === "" ? null : Number(body.siblingChildNo),
        endPolicy: body.endPolicy === "open" ? "open" : "session_end",
        autoApproveMaxPaise:
          body.autoApproveMaxPaise == null || body.autoApproveMaxPaise === "" ? null : Number(body.autoApproveMaxPaise),
        defaultReason: String(body.defaultReason ?? ""),
      };
      const heads = new Set((masters.feeHeads ?? []).map((h) => h.id));
      const t = await createTemplate(input, heads, who);
      await writeAudit({
        session,
        module: "fees",
        action: "create",
        entityType: "concession_template",
        entityId: t.id,
        summary: `Concession template "${t.name}" created`,
        after: t,
      }).catch(() => null);
      return Response.json({ ok: true, template: t });
    }
    if (body.action === "update") {
      const t = await updateTemplate(
        String(body.id ?? ""),
        {
          name: body.name === undefined ? undefined : String(body.name),
          defaultReason: body.defaultReason === undefined ? undefined : String(body.defaultReason),
          autoApproveMaxPaise:
            body.autoApproveMaxPaise === undefined
              ? undefined
              : body.autoApproveMaxPaise === null || body.autoApproveMaxPaise === ""
                ? null
                : Number(body.autoApproveMaxPaise),
          isActive: body.isActive === undefined ? undefined : body.isActive === true,
        },
        String(body.baseUpdatedAt ?? ""),
      );
      await writeAudit({
        session,
        module: "fees",
        action: "edit",
        entityType: "concession_template",
        entityId: t.id,
        summary: `Concession template "${t.name}" updated${t.isActive ? "" : " (switched off)"}`,
        after: t,
      }).catch(() => null);
      return Response.json({ ok: true, template: t });
    }
    if (body.action === "apply") {
      const r = await applyTemplate(
        {
          templateId: String(body.templateId ?? ""),
          studentIds: Array.isArray(body.studentIds) ? body.studentIds.map(String) : [],
          fromMonth: String(body.fromMonth ?? ""),
          reason: String(body.reason ?? ""),
          preview: body.preview === true,
        },
        auth.ctx,
      );
      return Response.json({ ok: true, ...r });
    }
    return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return toolsErrorResponse(e);
  }
}

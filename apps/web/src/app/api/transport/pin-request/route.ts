/**
 * GET/POST /api/transport/pin-request — ask transport families where their
 * child actually waits for the bus.
 *
 * GET reports who would be asked and who has already answered, so the office
 * can look before sending anything. POST sends.
 *
 * WHY THIS IS NOT A ONE-BUTTON BLAST
 * It is a hundred and seventeen real WhatsApp messages to real parents,
 * charged per conversation, about their home location. So: nothing is sent
 * without an explicit `confirm`, the audience is narrowed by how badly we
 * need it rather than "everyone", a household already asked is never asked
 * twice by accident, a family who declined is never asked again at all, and
 * `limit` exists so the first run can be five families and not all of them.
 *
 * QUIET HOURS ARE OBSERVED
 * A family who set quiet hours is skipped rather than queued — this is not
 * urgent, and a 6 a.m. request for someone's location is the kind of thing
 * that makes a school's messages easy to ignore.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { writeAudit } from "@/lib/audit.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { householdWhatsApp } from "@/lib/sis";
import { isInQuietHours, waTemplateLanguageFor } from "@/lib/householdPrefs";
import { fetchBoardingHomes } from "@/lib/boardingHomes.server";
import {
  deskBundleToTransportState,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import { sendWhatsAppTemplate } from "@/lib/waSend";
import { fetchServerBlob } from "@/lib/serverBlob";
import {
  normalizeWaTemplatesState,
  resolveTemplateForSend,
  templateButtonComponents,
  templateVariablePositions,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { buildTransportMessage } from "@/lib/transportParentMessages";
import type { SisState } from "@/lib/sis";

export const runtime = "nodejs";
export const maxDuration = 300;

/** How precisely the school currently knows where this family lives. */
type Precision = "pin" | "household" | "village" | "none";

type Candidate = {
  householdId: string;
  guardianName: string;
  mobileMasked: string;
  childNames: string[];
  busNo: string;
  precision: Precision;
  status: "never_asked" | "asked" | "pinned" | "declined" | "failed";
  quietHours: boolean;
  sendable: boolean;
  blockedBecause: string;
};

function maskMobile(m: string): string {
  const d = (m || "").replace(/\D/g, "");
  return d.length >= 4 ? `••••${d.slice(-4)}` : "••••";
}

async function buildCandidates(): Promise<
  { ok: true; rows: Candidate[] } | { ok: false; error: string; status: number }
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Server tenant context unavailable", status: 503 };

  const [desk, sisRes, located] = await Promise.all([
    fetchTransportDeskFromDb(),
    fetchSisFromDb(),
    fetchBoardingHomes(ctx.sb, ctx.tenantId),
  ]);
  // A failed read is not an empty school. Asking against a bundle that did not
  // load would either message nobody and report success, or message the wrong
  // families about the wrong children.
  if (!desk.ok) return { ok: false, error: "Could not read the transport desk", status: 502 };
  if (!sisRes.ok) return { ok: false, error: "Could not read the student roster", status: 502 };
  if (!located.ok) return { ok: false, error: located.error, status: 502 };

  const state = deskBundleToTransportState(desk.bundle);
  const sis = sisRes.bundle as unknown as SisState;

  const live = state.assignments.filter((a) => a.effectiveTo == null);
  const ay = live.map((a) => a.academicYearCode).filter(Boolean).sort().pop();
  if (!ay) return { ok: true, rows: [] };

  const { data: reqRows } = await ctx.sb
    .from("sis_transport_pin_request")
    .select("household_id, status")
    .eq("tenant_id", ctx.tenantId);
  const statusByHousehold = new Map<string, string>(
    (reqRows ?? []).map((r) => [String(r.household_id), String(r.status)]),
  );

  const byHousehold = new Map<string, Candidate>();
  for (const a of live) {
    if (a.academicYearCode !== ay) continue;
    const student = sis.students.find((s) => s.id === a.studentId);
    if (!student?.householdId) continue;
    const household = sis.households.find((h) => h.id === student.householdId);
    if (!household) continue;

    const route = state.routes.find((r) => r.id === a.routeId);
    const existing = byHousehold.get(household.id);
    if (existing) {
      if (!existing.childNames.includes(student.fullName)) {
        existing.childNames.push(student.fullName);
      }
      continue;
    }

    // Best-known precision for this family, same three tiers the audit uses.
    const pin = located.pins.get(student.id);
    const home = located.homes.get(household.id);
    const precision: Precision = pin
      ? "pin"
      : home?.precision === "household"
        ? "household"
        : home?.precision === "village"
          ? "village"
          : "none";

    const mobile = householdWhatsApp(household);
    const status =
      (statusByHousehold.get(household.id) as Candidate["status"]) ?? "never_asked";
    const quiet = isInQuietHours(household);

    const blocked =
      !mobile
        ? "no WhatsApp number on the household"
        : status === "declined"
          ? "this family asked not to be contacted about this"
          : status === "pinned"
            ? "already sent their boarding point"
            : status === "asked"
              ? "already asked and waiting for a reply"
              : quiet
                ? "inside this family's quiet hours"
                : "";

    byHousehold.set(household.id, {
      householdId: household.id,
      guardianName: household.guardianName?.trim() || student.fatherName || "Parent",
      mobileMasked: maskMobile(mobile || ""),
      childNames: [student.fullName],
      busNo: route?.busNo || route?.code || "",
      precision,
      status,
      quietHours: quiet,
      sendable: !blocked,
      blockedBecause: blocked,
    });
  }

  return { ok: true, rows: [...byHousehold.values()] };
}

/** Which families this scope is about. */
function inScope(row: Candidate, scope: string): boolean {
  if (scope === "all") return true;
  if (scope === "no_location") return row.precision === "none";
  if (scope === "village_only") return row.precision === "village" || row.precision === "none";
  return false;
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const built = await buildCandidates();
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: built.status });
  }
  const rows = built.rows;
  return NextResponse.json({
    ok: true,
    households: rows.length,
    byPrecision: {
      pin: rows.filter((r) => r.precision === "pin").length,
      household: rows.filter((r) => r.precision === "household").length,
      village: rows.filter((r) => r.precision === "village").length,
      none: rows.filter((r) => r.precision === "none").length,
    },
    byStatus: {
      never_asked: rows.filter((r) => r.status === "never_asked").length,
      asked: rows.filter((r) => r.status === "asked").length,
      pinned: rows.filter((r) => r.status === "pinned").length,
      declined: rows.filter((r) => r.status === "declined").length,
      failed: rows.filter((r) => r.status === "failed").length,
    },
    rows,
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;

  let body: {
    scope?: unknown;
    householdIds?: unknown;
    limit?: unknown;
    confirm?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scope = String(body.scope ?? "village_only");
  const picked = Array.isArray(body.householdIds)
    ? new Set(body.householdIds.map((x) => String(x)))
    : null;
  const limit = Math.max(1, Math.min(200, Number(body.limit) || 25));

  const built = await buildCandidates();
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: built.status });
  }

  const targets = built.rows
    .filter((r) => (picked ? picked.has(r.householdId) : inScope(r, scope)))
    .filter((r) => r.sendable)
    .slice(0, limit);

  // A dry run by default. Sending is the irreversible half — a parent cannot
  // un-receive a message about their home location — so it takes a separate,
  // explicit confirm rather than being the default of a POST.
  if (body.confirm !== true) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldSend: targets.length,
      skipped: built.rows.filter((r) => !r.sendable).length,
      targets: targets.map((t) => ({
        householdId: t.householdId,
        guardianName: t.guardianName,
        mobileMasked: t.mobileMasked,
        childNames: t.childNames,
        precision: t.precision,
      })),
    });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const sisRes = await fetchSisFromDb();
  if (!sisRes.ok) {
    return NextResponse.json({ error: "Could not read the student roster" }, { status: 502 });
  }
  const sis = sisRes.bundle as unknown as SisState;
  const { state: rawTemplates } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
  const templates = normalizeWaTemplatesState(rawTemplates);

  const sentBy = auth.ctx.session.fullName || auth.ctx.session.email || "";
  const now = new Date().toISOString();
  let sent = 0;
  const failures: { householdId: string; error: string }[] = [];

  for (const t of targets) {
    const household = sis.households.find((h) => h.id === t.householdId);
    const mobile = householdWhatsApp(household);
    if (!household || !mobile) {
      failures.push({ householdId: t.householdId, error: "no WhatsApp number" });
      continue;
    }
    const language = waTemplateLanguageFor(household);
    const built2 = buildTransportMessage(
      "pin_request",
      {
        guardianName: t.guardianName,
        // One message per household, so the children are named together.
        childName: t.childNames.join(" / "),
        busNo: t.busNo || "—",
      },
      language,
    );
    if (!built2.ok) {
      failures.push({ householdId: t.householdId, error: built2.error });
      continue;
    }
    const resolved = resolveTemplateForSend({
      state: templates,
      familyKey: built2.message.familyKey,
      language,
    });
    if (!resolved.ok) {
      failures.push({ householdId: t.householdId, error: resolved.reason });
      continue;
    }
    const positions = templateVariablePositions(resolved.template, built2.message.values);
    const buttons = templateButtonComponents(resolved.template, {});

    const res = await sendWhatsAppTemplate({
      toMobile: mobile,
      name: resolved.template.metaName,
      language: resolved.template.metaLanguage || resolved.template.language,
      fromPhoneNumberId: resolved.sender?.phoneNumberId,
      components: [
        {
          type: "body",
          parameters: Object.keys(positions)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => ({ type: "text", text: positions[k]! })),
        },
        ...buttons.components,
      ],
      // One ask per household per day, whatever a double-click does.
      clientMessageId: `pin_request:${t.householdId}:${now.slice(0, 10)}`,
    });

    // Recorded whether or not it went: "failed" is a different fact from
    // "asked and ignored", and merging them would report a response rate that
    // flatters the send.
    const { error: upErr } = await ctx.sb.from("sis_transport_pin_request").upsert(
      {
        household_id: t.householdId,
        tenant_id: ctx.tenantId,
        status: res.ok ? "asked" : "failed",
        asked_at: now,
        ask_count: 1,
        asked_by: sentBy,
        note: res.ok ? "" : (res.error || "send failed").slice(0, 400),
        updated_at: now,
      },
      { onConflict: "household_id" },
    );
    if (upErr) failures.push({ householdId: t.householdId, error: upErr.message });
    if (res.ok) sent += 1;
    else failures.push({ householdId: t.householdId, error: res.error || "send failed" });
  }

  await writeAudit({
    module: "transport",
    action: "transport.pin_request.sent",
    entityType: "household",
    summary: `Boarding-point request sent to ${sent} of ${targets.length} families (${scope})`,
    after: { scope, limit, sent, attempted: targets.length, failures: failures.slice(0, 20) },
    ...requestMeta(req),
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    attempted: targets.length,
    sent,
    failed: failures.length,
    failures: failures.slice(0, 20),
  });
}

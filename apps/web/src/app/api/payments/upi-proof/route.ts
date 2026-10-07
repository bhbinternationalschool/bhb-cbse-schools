/**
 * POST — read a UPI app's success screenshot and check it against the
 * payment being recorded (lib/upiPay). Director, 7 Oct 2026: pay by GPay from
 * the ERP, and the UTR fills itself.
 *
 * Body: { imageBase64, mimeType?, expected: { amountPaise, payeeVpa?,
 * payeeName?, earliest? } }. Returns what the screenshot says, the check, and
 * where else this UTR is already recorded (a screenshot used twice is the
 * commonest way one payment gets booked twice). Staff session. Reads only:
 * the screen that asked fills its own UTR field, and the person saves.
 */

import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { visionConfigured, visionExtractText } from "@/lib/googleVision.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { checkUpiProof, parseUpiProofText } from "@/lib/upiPay";

export const runtime = "nodejs";

const MAX_BASE64 = 8 * 1024 * 1024;

function todayIst(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** Where this UTR is already written down, so a screenshot is not used twice. */
async function utrSeenAt(utr: string): Promise<string[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { sb, tenantId } = ctx;
  const like = `%${utr}%`;
  const [lines, vouchers, payroll, advances] = await Promise.all([
    sb.from("ledger_lines").select("voucher_id").eq("tenant_id", tenantId).eq("instrument_ref", utr).limit(5),
    sb.from("ledger_vouchers").select("voucher_no").eq("tenant_id", tenantId).ilike("narration", like).limit(5),
    sb.from("payroll_desk_run_lines").select("full_name, run_id").eq("tenant_id", tenantId).ilike("note", like).limit(5),
    // The advances register is one small JSON slice: searched here, not in SQL.
    sb.from("staff_advances_desk_slices").select("payload").eq("tenant_id", tenantId).eq("slice_key", "advances").limit(1),
  ]);
  const seen: string[] = [];
  if (lines.data?.length) {
    const ids = lines.data.map((r) => (r as { voucher_id: string }).voucher_id);
    const { data } = await sb.from("ledger_vouchers").select("voucher_no").eq("tenant_id", tenantId).in("id", ids);
    for (const v of (data ?? []) as { voucher_no: string }[]) seen.push(`ledger voucher ${v.voucher_no}`);
  }
  for (const v of (vouchers.data ?? []) as { voucher_no: string }[]) seen.push(`ledger voucher ${v.voucher_no}`);
  for (const l of (payroll.data ?? []) as { full_name: string }[]) seen.push(`salary line of ${l.full_name}`);
  const advText = JSON.stringify((advances.data?.[0] as { payload?: unknown } | undefined)?.payload ?? "");
  if (advText.includes(utr)) seen.push("the staff advances register");
  return [...new Set(seen)];
}

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;

  let body: {
    imageBase64?: string;
    mimeType?: string;
    expected?: { amountPaise?: number; payeeVpa?: string; payeeName?: string; earliest?: string };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const image = (body.imageBase64 || "").replace(/^data:[^,]+,/, "");
  if (!image) return NextResponse.json({ ok: false, error: "Attach the payment screenshot." }, { status: 400 });
  if (image.length > MAX_BASE64) {
    return NextResponse.json({ ok: false, error: "The screenshot is too large — send a normal phone screenshot." }, { status: 413 });
  }
  const amountPaise = Math.round(Number(body.expected?.amountPaise) || 0);
  if (!(amountPaise > 0)) {
    return NextResponse.json({ ok: false, error: "The payment's amount is missing." }, { status: 400 });
  }
  if (!visionConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Screenshot reading is not set up on this server — type the UTR from the app instead." },
      { status: 503 },
    );
  }

  const vision = await visionExtractText({ imageBase64: image, mimeType: body.mimeType });
  if (!vision.ok) {
    return NextResponse.json(
      { ok: false, error: `Could not read the screenshot (${vision.error}). Type the UTR from the app instead.` },
      { status: 422 },
    );
  }

  const proof = parseUpiProofText(vision.text);
  const check = checkUpiProof(proof, {
    amountPaise,
    payeeVpa: body.expected?.payeeVpa || "",
    payeeName: body.expected?.payeeName || "",
    earliest: body.expected?.earliest || "",
    today: todayIst(),
  });
  const seenAt = proof.utr ? await utrSeenAt(proof.utr) : [];
  if (seenAt.length) {
    check.ok = false;
    check.problems.push(`This UTR is already recorded in ${seenAt.join(", ")} — the same payment cannot be recorded twice.`);
  }
  return NextResponse.json({ ok: true, proof, check, seenAt });
}

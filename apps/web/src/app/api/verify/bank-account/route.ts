import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  findVerification,
  verificationKeysPresent,
  verificationsForSubject,
  verifyBankAccount,
} from "@/lib/secureId.server";

export const runtime = "nodejs";

/**
 * Verify a bank account before the school pays it.
 *
 * GET  ?subjectKind=staff&subjectId=…   every verification held for a record
 *      ?accountNumber=&ifsc=            the cached answer, without spending a call
 * POST {accountNumber, ifsc, expectedName?, phone?, subjectKind?, subjectId?, force?}
 *
 * WHY POST IS GATED ON `accounts: edit` AND GET IS NOT. A verification costs
 * the school money on every call, so asking for one is a spend and belongs
 * behind the same permission as other accounts-desk spending. Reading an answer
 * already paid for is not.
 *
 * WHY THE ACCOUNT NUMBER IS ONLY EVER IN THE BODY. A GET with an account number
 * in the query string ends up in access logs and browser history. The cached
 * lookup accepts it because it must, and the response never echoes it back —
 * only the last four digits, which is all a human needs to recognise a row.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const subjectKind = (url.searchParams.get("subjectKind") || "").trim();
  const subjectId = (url.searchParams.get("subjectId") || "").trim();
  const accountNumber = (url.searchParams.get("accountNumber") || "").trim();
  const ifsc = (url.searchParams.get("ifsc") || "").trim();

  if (subjectKind && subjectId) {
    return NextResponse.json({
      ok: true,
      configured: verificationKeysPresent(),
      verifications: await verificationsForSubject(subjectKind, subjectId),
    });
  }

  if (accountNumber && ifsc) {
    const found = await findVerification(accountNumber, ifsc);
    return NextResponse.json({
      ok: true,
      configured: verificationKeysPresent(),
      // Null is "never checked", which is different from "checked and bad".
      verification: found,
    });
  }

  return NextResponse.json(
    { ok: false, error: "Pass subjectKind and subjectId, or accountNumber and ifsc" },
    { status: 400 },
  );
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "edit");
  if (!auth.ok) return auth.response;

  let body: {
    accountNumber?: unknown;
    ifsc?: unknown;
    expectedName?: unknown;
    phone?: unknown;
    subjectKind?: unknown;
    subjectId?: unknown;
    force?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const accountNumber = String(body.accountNumber ?? "").trim();
  const ifsc = String(body.ifsc ?? "").trim();
  if (!accountNumber || !ifsc) {
    return NextResponse.json(
      { ok: false, error: "accountNumber and ifsc are both required" },
      { status: 400 },
    );
  }

  const outcome = await verifyBankAccount({
    accountNumber,
    ifsc,
    expectedName: String(body.expectedName ?? "").trim() || undefined,
    phone: String(body.phone ?? "").trim() || undefined,
    subjectKind: String(body.subjectKind ?? "").trim() || undefined,
    subjectId: String(body.subjectId ?? "").trim() || undefined,
    verifiedBy: auth.ctx.session.fullName || "accounts desk",
    force: body.force === true,
  });

  if (!outcome.ok) {
    // 400, not 500, and the `configured` flag travels with it: a missing set of
    // keys is a setup problem the office can act on, and it must not render as
    // though the bank rejected the account.
    return NextResponse.json(outcome, { status: outcome.configured ? 400 : 503 });
  }
  return NextResponse.json(outcome);
}

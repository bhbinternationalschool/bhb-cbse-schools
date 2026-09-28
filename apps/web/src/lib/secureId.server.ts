/**
 * Verifying a bank account with Cashfree, before the school pays it.
 *
 * Server-only: this carries the Verification Suite credentials, and the
 * account number must never reach a browser response.
 *
 * SEPARATE CREDENTIALS FROM THE PAYMENT GATEWAY. The Verification Suite is its
 * own Cashfree product with its own App ID and secret, on its own host. Reusing
 * CASHFREE_APP_ID here would fail with an unhelpful secret-invalid error, so the
 * env vars are named apart and their absence is reported as "not configured"
 * rather than as a verification failure — the two mean very different things to
 * whoever is looking at a staff record.
 *
 * EVERY CALL IS BILLED. So a result is cached against a fingerprint of the
 * account and IFSC, and `verifyBankAccount` returns the cached answer unless
 * asked to re-check. Without that, a staff list of thirty would bill the school
 * thirty times on every page load.
 *
 * NOTHING HERE STORES AN ACCOUNT NUMBER. The fingerprint is a hash and only the
 * last four digits are kept. This module is the only place the full number is
 * held in memory, and only for the length of one request.
 */

import "server-only";
import { createHash } from "node:crypto";

import {
  bankFingerprintSource,
  bankVerdict,
  buildBankVerifyRequest,
  maskAccount,
  readBankVerifyResult,
  safeToPay,
  verdictSentence,
  type BankVerdict,
} from "@/lib/secureId";
import { getServerTenantContext } from "@/lib/serverTenant";

export function verificationKeysPresent(): boolean {
  return !!(
    process.env.CASHFREE_VERIFICATION_APP_ID?.trim() &&
    process.env.CASHFREE_VERIFICATION_SECRET_KEY?.trim()
  );
}

/**
 * The Verification Suite host. Its own product, its own path prefix — not the
 * PG base, which would 404 every one of these calls.
 */
export function verificationBaseUrl(): string {
  const prod =
    (process.env.CASHFREE_VERIFICATION_ENV || process.env.CASHFREE_ENV || "")
      .trim()
      .toLowerCase() === "production";
  return prod
    ? "https://api.cashfree.com/verification"
    : "https://sandbox.cashfree.com/verification";
}

function verificationHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-client-id": process.env.CASHFREE_VERIFICATION_APP_ID?.trim() ?? "",
    "x-client-secret": process.env.CASHFREE_VERIFICATION_SECRET_KEY?.trim() ?? "",
  };
}

function fingerprint(accountNumber: string, ifsc: string): string {
  return createHash("sha256").update(bankFingerprintSource(accountNumber, ifsc)).digest("hex");
}

export type StoredVerification = {
  fingerprint: string;
  accountLast4: string;
  ifsc: string;
  status: string;
  nameAtBank: string;
  expectedName: string;
  nameMatchScore: number | null;
  verdict: BankVerdict["kind"];
  reference: string;
  message: string;
  verifiedBy: string;
  createdAt: string;
  updatedAt: string;
};

function rowToStored(r: Record<string, unknown>): StoredVerification {
  const score = Number(r.name_match_score);
  return {
    fingerprint: String(r.fingerprint ?? ""),
    accountLast4: String(r.account_last4 ?? ""),
    ifsc: String(r.ifsc ?? ""),
    status: String(r.status ?? ""),
    nameAtBank: String(r.name_at_bank ?? ""),
    expectedName: String(r.expected_name ?? ""),
    nameMatchScore: Number.isFinite(score) ? score : null,
    verdict: String(r.verdict ?? "unknown") as BankVerdict["kind"],
    reference: String(r.reference ?? ""),
    message: String(r.message ?? ""),
    verifiedBy: String(r.verified_by ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export async function findVerification(
  accountNumber: string,
  ifsc: string,
): Promise<StoredVerification | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("bank_account_verifications")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("fingerprint", fingerprint(accountNumber, ifsc))
    .maybeSingle();
  return data ? rowToStored(data as Record<string, unknown>) : null;
}

/** Every verification recorded against one staff member or vendor. */
export async function verificationsForSubject(
  subjectKind: string,
  subjectId: string,
): Promise<StoredVerification[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("bank_account_verifications")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("subject_kind", subjectKind)
    .eq("subject_id", subjectId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((r) => rowToStored(r as Record<string, unknown>));
}

export type VerifyOutcome =
  | {
      ok: true;
      verdict: BankVerdict;
      sentence: string;
      safeToPay: boolean;
      accountLast4: string;
      /** True when this answer came from the cache and cost nothing. */
      cached: boolean;
    }
  | { ok: false; error: string; configured: boolean };

/**
 * Verify an account, or hand back the answer the school already paid for.
 *
 * `force` re-checks a cached account. Used when the name on the school's record
 * has changed, or when somebody wants a fresh answer before a large payment —
 * and it is a deliberate act because it costs money.
 */
export async function verifyBankAccount(input: {
  accountNumber: string;
  ifsc: string;
  /** The name the school holds. Turns the check into a name match. */
  expectedName?: string;
  phone?: string;
  subjectKind?: string;
  subjectId?: string;
  verifiedBy?: string;
  force?: boolean;
}): Promise<VerifyOutcome> {
  const built = buildBankVerifyRequest({
    accountNumber: input.accountNumber,
    ifsc: input.ifsc,
    name: input.expectedName,
    phone: input.phone,
  });
  // Refused locally: a malformed account or an unverifiable bank never becomes
  // a billed call, and the desk gets a sentence it can act on.
  if (!built.ok) return { ok: false, error: built.error, configured: verificationKeysPresent() };

  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context", configured: verificationKeysPresent() };

  const fp = fingerprint(input.accountNumber, input.ifsc);
  const expected = (input.expectedName || "").trim();

  if (!input.force) {
    const cached = await findVerification(input.accountNumber, input.ifsc);
    // Only a CONCLUSIVE cached answer is reused. A stored FAILED or RECEIVED
    // means nobody ever found out, and serving that back for ever would turn a
    // transient failure into a permanent "not verified".
    if (cached && (cached.status === "VALID" || cached.status === "INVALID")) {
      // A rename since the check is a real reason to re-ask: the account may be
      // fine and the name no longer what the school holds.
      const nameChanged = expected !== "" && cached.expectedName !== expected;
      if (!nameChanged) {
        const verdict = bankVerdict({
          result: {
            status: cached.status === "VALID" ? "VALID" : "INVALID",
            nameAtBank: cached.nameAtBank,
            nameMatchScore: cached.nameMatchScore,
            reference: cached.reference,
            message: cached.message,
          },
          expectedName: cached.expectedName || undefined,
        });
        return {
          ok: true,
          verdict,
          sentence: verdictSentence(verdict),
          safeToPay: safeToPay(verdict),
          accountLast4: cached.accountLast4,
          cached: true,
        };
      }
    }
  }

  if (!verificationKeysPresent()) {
    // Deliberately distinct from a failed verification. "Not set up" and "the
    // bank says this account is wrong" must never read the same on a staff record.
    return {
      ok: false,
      error:
        "Bank verification is not configured. It needs its own Cashfree Verification Suite keys (CASHFREE_VERIFICATION_APP_ID and CASHFREE_VERIFICATION_SECRET_KEY) — the payment-gateway keys will not work.",
      configured: false,
    };
  }

  let payload: unknown;
  try {
    const res = await fetch(`${verificationBaseUrl()}/bank-account/sync`, {
      method: "POST",
      headers: verificationHeaders(),
      body: JSON.stringify(built.body),
    });
    payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const p = (payload ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        error: String(p.message || p.code || `Verification HTTP ${res.status}`),
        configured: true,
      };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not reach the verification service",
      configured: true,
    };
  }

  const result = readBankVerifyResult(payload);
  if (!result) {
    // An unreadable reply is NOT an invalid account. Saying so would condemn a
    // perfectly good account on the strength of a response shape we did not
    // recognise.
    return { ok: false, error: "The verification service gave an answer we could not read", configured: true };
  }

  const verdict = bankVerdict({ result, expectedName: expected || undefined });
  const accountLast4 = maskAccount(input.accountNumber).slice(-4);

  // Stored whatever the answer, including INVALID: the school paid for it, and
  // "this account was checked and the bank said no" is exactly the record the
  // office needs next time somebody tries to pay it.
  await ctx.sb.from("bank_account_verifications").upsert(
    {
      fingerprint: fp,
      tenant_id: ctx.tenantId,
      account_last4: accountLast4,
      ifsc: built.body.ifsc,
      status: result.status,
      name_at_bank: result.nameAtBank,
      expected_name: expected,
      name_match_score: result.nameMatchScore,
      verdict: verdict.kind,
      reference: result.reference,
      message: result.message,
      subject_kind: input.subjectKind || "",
      subject_id: input.subjectId || "",
      verified_by: input.verifiedBy || "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "fingerprint" },
  );

  return {
    ok: true,
    verdict,
    sentence: verdictSentence(verdict),
    safeToPay: safeToPay(verdict),
    accountLast4,
    cached: false,
  };
}

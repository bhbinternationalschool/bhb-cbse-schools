import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { AccountsState } from "@/lib/accounts";
import { accountsDualWriteDbEnabled } from "@/lib/accountsDbConfig";
import {
  fetchAccountsDeskFromDb,
  pushAccountsDeskToDb,
} from "@/lib/accountsNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["accounts-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta } = await fetchAccountsDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    coaCount: bundle.coaAccounts.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["accounts-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!accountsDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Omit<AccountsState, "version">;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushAccountsDeskToDb({
    version: 1,
    cashPools: body.cashPools ?? [],
    cashLedger: body.cashLedger ?? [],
    bankAccounts: body.bankAccounts ?? [],
    bankLedger: body.bankLedger ?? [],
    modeBankMap: body.modeBankMap ?? [],
    reconSessions: body.reconSessions ?? [],
    expenseCategories: body.expenseCategories ?? [],
    expenseVouchers: body.expenseVouchers ?? [],
    recurringRules: body.recurringRules ?? [],
    vendors: body.vendors ?? [],
    vendorBills: body.vendorBills ?? [],
    payables: body.payables ?? [],
    trustees: body.trustees ?? [],
    ownerLoans: body.ownerLoans ?? [],
    ownerLoanSchedule: body.ownerLoanSchedule ?? [],
    ownerCashHandovers: body.ownerCashHandovers ?? [],
    coaAccounts: body.coaAccounts ?? [],
    journalEntries: body.journalEntries ?? [],
    fiscalYears: body.fiscalYears ?? [],
    settings: body.settings ?? {
      expenseApprovalPaise: 1_000_000,
      pettyThresholdPaise: 200_000,
    },
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    coaCount: body.coaAccounts?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}

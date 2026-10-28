import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { AccountsState } from "@/lib/accountsTypes";
import { accountsDualWriteDbEnabled } from "@/lib/accountsDbConfig";
import {
  ACCOUNTS_DELETABLE_TABLES,
  fetchAccountsDeskFromDb,
  pushAccountsDeskToDb,
} from "@/lib/accountsNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { readStampsParam } from "@/lib/rowStampClient";
import { ACCOUNTS_STAMPED_SLICES } from "@/lib/accountsStampSlices";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["accounts-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok, error, stamps, settingsStamp } = await fetchAccountsDeskFromDb();
  // Unknown is not empty: a failed read answered 200 with an empty desk, and
  // the browser took it as the school's accounts.
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: `Could not read the accounts desk: ${error || "read failed"}` },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    ...bundle,
    coaCount: bundle.coaAccounts.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
    stamps,
    settingsStamp,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["accounts-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!accountsDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Omit<AccountsState, "version"> & {
    deletes?: unknown;
    stamps?: unknown;
    settingsBase?: string | null;
  };
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
  }, readNamedDeletes(body.deletes, ACCOUNTS_DELETABLE_TABLES), {
    // Stamped saves carry only the rows that changed; no stamps = a tab from
    // before 10 Oct 2026, which may add rows but never replace one.
    stamps: readStampsParam(body.stamps, ACCOUNTS_STAMPED_SLICES),
    settingsBase: typeof body.settingsBase === "string" ? body.settingsBase : null,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  if (result.kept) {
    console.warn(`[accounts-desk] unstamped save left ${result.kept} stored row(s) as they were`);
  }

  return NextResponse.json({
    ok: true,
    coaCount: body.coaAccounts?.length ?? 0,
    updatedAt: new Date().toISOString(),
    stamps: result.stamps,
    conflicts: result.conflicts,
    settingsStamp: result.settingsStamp,
  });
}

/**
 * The vehicle-costs bundle (lib/transportVehicleCosts) — server reads.
 *
 * No query of its own: the fuel register, the vehicle papers and the ledger
 * loans are each read by the function that owns them. A part that fails to
 * read comes back null / { known: false } with the reason — never as empty.
 */
import "server-only";

import { buildVehicleLoans, readVehicleDocs } from "@/lib/transportFinance.server";
import { readRegisterFills } from "@/lib/transportFuelRegister.server";
import { toCostFill, toCostLoan, type CostLoans, type VehicleCosts } from "@/lib/transportVehicleCosts";

export const LOANS_FORBIDDEN_REASON = "loan figures need Accounts · view and Accounts position · view";

export async function readVehicleCosts(opts: { mayReadLoans: boolean }): Promise<VehicleCosts> {
  const [fillsRes, docs, loansRes] = await Promise.all([
    readRegisterFills({}).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
    readVehicleDocs().catch(() => null),
    opts.mayReadLoans
      ? buildVehicleLoans().catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
      : Promise.resolve(null),
  ]);
  let loans: CostLoans;
  if (!loansRes) loans = { known: false, reason: LOANS_FORBIDDEN_REASON };
  else if (!loansRes.ok) loans = { known: false, reason: `the loan accounts could not be read (${loansRes.error})` };
  else loans = { known: true, loans: loansRes.loans.map(toCostLoan) };
  return {
    fills: fillsRes.ok ? fillsRes.fills.map(toCostFill) : null,
    ...(fillsRes.ok ? {} : { fillsError: fillsRes.error }),
    docs: docs ? docs.state.docs : null,
    loans,
  };
}

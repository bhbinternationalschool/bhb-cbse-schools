"use client";

/**
 * Transport → Finance → Vehicle loans.
 *
 * The same panel and the same server code as Accounts → Loans
 * (components/accounts/LoansPanel.tsx, /api/accounts/loans): balances from
 * the books, EMIs proposed on their due date and posted only on approval,
 * prepayments / top-ups, history, projection and export. One place decides
 * what a loan owes; Transport shows it, it does not keep its own copy.
 */

import { LoansPanel } from "@/components/accounts/LoansPanel";

export function VehicleLoansPanel() {
  return <LoansPanel scope="transport" />;
}

/**
 * Accounts — chart-of-accounts administration.
 *
 * Add, edit, and remove COA rows. Removal is guarded: an account carrying
 * journal activity cannot be deleted, because the trial balance and every
 * report resolve lines by coaId.
 */

import {
} from "@/lib/accountsTypes";
import type {
  AccountsRemovalCheck,
  AccountsState,
  CoaAccount,
  CoaGroup,
} from "@/lib/accountsTypes";
import {
  fail,
  id,
} from "@/lib/accountsUtil";
import {
  normalizeCoa,
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  saveAccounts,
} from "@/lib/accountsStore";


export function upsertCoaAccount(
  patch: Partial<CoaAccount> & { code: string; name: string; group: CoaGroup },
): { ok: true; account: CoaAccount } | { ok: false; error: string } {
  const code = patch.code.trim();
  const name = patch.name.trim();
  if (!code) return fail("Account code required");
  if (!name) return fail("Account name required");
  const state = loadAccounts();
  const dup = state.coaAccounts.find(
    (c) => c.code === code && c.id !== patch.id,
  );
  if (dup) return fail(`Account code ${code} already exists`);
  const existing = patch.id
    ? state.coaAccounts.find((c) => c.id === patch.id)
    : undefined;
  const account = normalizeCoa({
    ...existing,
    ...patch,
    code,
    name,
    id: existing?.id ?? patch.id ?? id("coa"),
  });
  const coaAccounts = existing
    ? state.coaAccounts.map((c) => (c.id === account.id ? account : c))
    : [...state.coaAccounts, account];
  saveAccounts({ ...state, coaAccounts });
  return { ok: true, account };
}

/** Non-void journal lines posted against a COA account. */
export function coaAccountHasJournalActivity(
  coaId: string,
  state?: AccountsState,
): boolean {
  const s = state ?? loadAccounts();
  return s.journalEntries.some(
    (j) =>
      !j.voidedAt &&
      j.lines.some(
        (l) =>
          l.coaId === coaId && (l.debitPaise > 0 || l.creditPaise > 0),
      ),
  );
}

export function checkCoaAccountRemoval(
  coaId: string,
  state?: AccountsState,
): AccountsRemovalCheck {
  const s = state ?? loadAccounts();
  const account = s.coaAccounts.find((c) => c.id === coaId);
  const label = account ? `${account.code} · ${account.name}` : "this account";
  const blockers: string[] = [];
  if (coaAccountHasJournalActivity(coaId, s)) {
    blockers.push("journal entries");
  }
  const categoryN = account
    ? s.expenseCategories.filter((c) => c.coaCode === account.code).length
    : 0;
  if (categoryN > 0) {
    blockers.push(`${categoryN} expense categor${categoryN === 1 ? "y" : "ies"}`);
  }
  if (blockers.length > 0) {
    return {
      canRemove: false,
      blockers,
      suggestion: `Cannot delete — linked to ${blockers.join(" and ")}. Mark inactive instead.`,
      confirmMessage: `Delete account “${label}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "This cannot be undone.",
    confirmMessage: `Delete account “${label}”?`,
  };
}

export function deleteCoaAccount(
  coaId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const account = state.coaAccounts.find((c) => c.id === coaId);
  if (!account) return fail("Account not found");
  const check = checkCoaAccountRemoval(coaId, state);
  if (!check.canRemove) return fail(check.suggestion);
  saveAccounts({
    ...state,
    coaAccounts: state.coaAccounts.filter((c) => c.id !== coaId),
  });
  return { ok: true };
}


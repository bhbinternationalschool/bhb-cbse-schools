"use client";

import { useEffect, useState } from "react";

import { loadAccounts } from "@/lib/accountsStore";
import type { AccountsState } from "@/lib/accountsTypes";

/**
 * The accounts desk, hydrated rather than assumed.
 *
 * Bank accounts only exist in a browser after the accounts desk has been
 * pulled from the server, which used to happen only if someone opened
 * Accounts (or Transport) first. A counter machine that went straight to
 * Fee Take, the store, or registration therefore saw cash and nothing else —
 * and any "which account received this?" picker would have been empty, or
 * worse, would have claimed no bank accepts UPI.
 *
 * ensureAccountsHydrated() marks the module hydrated the moment the FIRST
 * caller enters it, so when the app shell kicked hydration off just before us
 * our call returns while that pull is still in flight. A single read would
 * freeze an empty store into the dropdown, so re-read on a short ladder until
 * banks appear.
 */
export function useAccountsDesk(): AccountsState | null {
  const [state, setState] = useState<AccountsState | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { ensureAccountsHydrated } = await import(
          "@/lib/accountsPersistence"
        );
        await ensureAccountsHydrated();
      } catch {
        // Offline or first load — fall through to whatever is cached locally.
      }
      if (!live) return;
      setState(loadAccounts());
      for (const delay of [1500, 3500, 8000]) {
        await new Promise((r) => setTimeout(r, delay));
        if (!live) return;
        const next = loadAccounts();
        if (next.bankAccounts.length > 0) {
          setState(next);
          break;
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return state;
}

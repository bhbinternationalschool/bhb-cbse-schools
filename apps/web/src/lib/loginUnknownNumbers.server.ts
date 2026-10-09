import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import {
  normalizeUnknownLoginState,
  recordUnknownLogin,
  type LoginApp,
} from "@/lib/loginUnknownNumbers";

/**
 * Record an app login attempt from a number the ERP does not know, for the
 * office to follow up (lib/loginUnknownNumbers). Best effort: never throws,
 * never delays the "No parent record found" reply by more than one read and
 * one write, and a failed read records nothing rather than overwrite the
 * list with a single entry (unknown is not empty).
 */
export async function noteUnknownLoginServer(mobile10: string, app: LoginApp): Promise<void> {
  try {
    if (!/^\d{10}$/.test(mobile10)) return;
    const row = await readModuleLocalState<unknown>("login_unknown_numbers");
    if (!row) return;
    const next = recordUnknownLogin(normalizeUnknownLoginState(row.state), mobile10, app, new Date().toISOString());
    const w = await writeModuleLocalState("login_unknown_numbers", next);
    if (!w.ok) console.warn("[unknown-login] not recorded:", w.error);
  } catch (e) {
    console.warn("[unknown-login] not recorded:", e instanceof Error ? e.message : e);
  }
}

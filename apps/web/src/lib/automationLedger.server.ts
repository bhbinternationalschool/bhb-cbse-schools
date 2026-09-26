/**
 * The "when was this family last reminded" ledger, shared between the
 * WhatsApp command desk (`fee reminder class 3`) and scheduled automation.
 *
 * One ledger, not two: the fee desk, a class teacher and an automation can
 * each think of reminding on the same Tuesday. It lives on the command
 * desk's own store slice (`feeRemindedOn`, householdId → IST date), which
 * is where the command already keeps it — so neither path needs a new
 * table and both see each other's sends.
 */

import "server-only";

import { loadWaBotSlice, saveWaBotSlice } from "@/lib/waBotStore.server";

type CommandStoreLike = {
  version?: number;
  feeRemindedOn?: Record<string, string>;
  [key: string]: unknown;
};

/** householdId → IST date (YYYY-MM-DD) of the last fee reminder. */
export async function loadAutomationSendLedger(): Promise<Record<string, string>> {
  try {
    const store = await loadWaBotSlice<CommandStoreLike>("commands", { version: 1 });
    return { ...(store.feeRemindedOn ?? {}) };
  } catch (e) {
    console.warn("[automation-ledger] read failed", e);
    return {};
  }
}

/** Record today's sends. Fail-open: a ledger write must not undo a send that happened. */
export async function recordAutomationSends(
  remindedOn: Record<string, string>,
): Promise<void> {
  if (!Object.keys(remindedOn).length) return;
  try {
    const store = await loadWaBotSlice<CommandStoreLike>("commands", { version: 1 });
    await saveWaBotSlice("commands", {
      ...store,
      version: 1,
      feeRemindedOn: { ...(store.feeRemindedOn ?? {}), ...remindedOn },
    });
  } catch (e) {
    console.warn("[automation-ledger] write failed", e);
  }
}

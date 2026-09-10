/**
 * Turning an HTTP status from a WhatsApp panel into a sentence.
 *
 * These three screens — delivery ticks, numbers to fix, usage and cost —
 * used to live in Masters → Automation, where only someone holding the
 * `wa_automation` grant could ever open them. Moving them next to sending
 * in Communications puts them in front of office staff who send messages
 * every day and may hold no automation grant at all, so a 403 is now a
 * normal thing for a real person to hit.
 *
 * "Missing permission wa_automation.view" is true and useless. It names a
 * module nobody outside this repo has heard of and does not say who can fix
 * it. This says both.
 */

export function waPanelErrorText(
  status: number,
  apiError: string | undefined,
  fallback: string,
): string {
  if (status === 403) {
    return "You do not have access to this screen. It reads the WhatsApp delivery log through the Automation grant — ask an owner to add Automation (view) to your role in Settings → Roles. Sending messages does not need it, so the other WhatsApp sections keep working.";
  }
  if (status === 401) {
    return "Your session has ended. Please sign in again.";
  }
  return apiError || fallback;
}

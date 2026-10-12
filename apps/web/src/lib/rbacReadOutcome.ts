/**
 * What the server enforces with after one read of the saved roles and
 * grants (lib/api/v1/auth.ts loadServerRbac). Pure, so the rule is tested.
 *
 *   read ok              → that copy; it becomes the last known copy
 *   read failed, had one → the last known copy (its personal denies too)
 *   read failed, none    → built-in defaults, marked UNKNOWN: function-only
 *                          access and desk saves are refused, never answered
 *                          from defaults that carry no denies.
 */
import type { RbacState } from "@/lib/rbac";

export type RbacReadOutcome = { state: RbacState; known: boolean; remember: boolean };

export function rbacReadOutcome(input: {
  readOk: boolean;
  /** The copy the read produced (desk, or legacy blob / defaults when the desk is empty). */
  read: RbacState | null;
  lastKnown: RbacState | null;
  defaults: () => RbacState;
}): RbacReadOutcome {
  if (input.readOk && input.read) return { state: input.read, known: true, remember: true };
  if (input.lastKnown) return { state: input.lastKnown, known: true, remember: false };
  return { state: input.defaults(), known: false, remember: false };
}

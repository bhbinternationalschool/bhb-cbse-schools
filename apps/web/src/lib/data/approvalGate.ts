/**
 * Writes that are a DECISION, not data entry, and need a second permission.
 *
 * Most of a desk is typing: a name, an amount, a paragraph. A few writes are
 * different because they change what the world can see or what the books
 * say — publishing a page to the open internet is the case this was built
 * for. "Author drafts, director approves" is only a rule if the server
 * enforces it; a UI that hides the Publish button is a suggestion, because
 * the API is one fetch away.
 *
 * Declarative rather than a callback, so the rule can be read off the
 * registry entry and asserted in a test without running a request.
 *
 * The distinction that matters: saving a DRAFT must stay ordinary work. A
 * gate that fired on any write to `status` would stop an author saving at
 * all, and the desk would be unusable by the people it is for. So the gate
 * fires on the VALUE, not the column.
 */

import type { RbacModule } from "@/lib/rbac";

export type ApprovalRule = {
  /** Permission checked when the gate fires. Usually the collection's own. */
  readonly module: RbacModule;
  /**
   * Column → the values that make a write a decision.
   * e.g. { status: ['published', 'scheduled'] }
   */
  readonly whenEquals?: Readonly<Record<string, readonly string[]>>;
  /**
   * Columns that need approval whenever they are set to anything at all —
   * for dates, where every non-null value means the same decision.
   */
  readonly whenSet?: readonly string[];
  /** Shown to the author when they are refused, in their words not ours. */
  readonly message: string;
};

/**
 * Does this batch of writes contain a decision?
 *
 * Checked op by op, because one batch may hold a harmless draft edit and a
 * publish, and the batch is applied atomically — letting it through because
 * most of it was innocent would publish the page.
 */
export function batchNeedsApproval(
  rule: ApprovalRule | undefined,
  ops: readonly { readonly op?: string; readonly row?: Record<string, unknown> }[],
): boolean {
  if (!rule) return false;
  return ops.some((o) => rowNeedsApproval(rule, o.row));
}

export function rowNeedsApproval(
  rule: ApprovalRule | undefined,
  row: Record<string, unknown> | undefined,
): boolean {
  if (!rule || !row) return false;

  for (const [col, values] of Object.entries(rule.whenEquals ?? {})) {
    const v = row[col];
    // `undefined` means the write does not touch this column and so decides
    // nothing. An explicit null is the same. Only a real value can trip it.
    if (v === undefined || v === null) continue;
    if (values.includes(String(v))) return true;
  }

  for (const col of rule.whenSet ?? []) {
    const v = row[col];
    if (v === undefined || v === null) continue;
    // Clearing a date is UNPUBLISHING, which needs no approval: taking
    // something off the website is always allowed to whoever can edit it.
    // Nobody was ever harmed by a page coming down too easily.
    if (typeof v === "string" && v.trim() === "") continue;
    return true;
  }

  return false;
}

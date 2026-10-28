/**
 * When a tab running an old build reloads itself (data-layer 0.5g).
 *
 * The update bar (components/pwa/UpdateBar) knows a newer build is live but
 * only offered a tap; staff kept old tabs open for days, saving with old
 * code. Now the tab reloads itself on the NEXT client-side navigation — the
 * moment the person has already left what they were doing — and never:
 *  - before a newer build is known,
 *  - on first render or a same-path re-render (a query/hash change is not
 *    leaving the page),
 *  - while focus is in a field (typing on the page just opened),
 *  - while a save is pending, retrying or failed (page memory is the only
 *    copy of unsaved work; a reload would drop it).
 * The bar stays, so a person can still choose to refresh by hand.
 */
export type UpdateReloadInput = {
  /** A newer build than this tab's has been seen. */
  stale: boolean;
  /** Pathname before this render (null on the first). */
  previousPath: string | null;
  path: string;
  /** Focus is in an editable field. */
  editing: boolean;
  /** A desk save has not landed yet (pending, retrying or failed). */
  savesPending: boolean;
};

export function shouldReloadForUpdate(i: UpdateReloadInput): boolean {
  if (!i.stale) return false;
  if (i.previousPath === null || i.previousPath === i.path) return false;
  if (i.editing || i.savesPending) return false;
  return true;
}

/** An element a person types into. */
export function isEditableElement(
  el: { tagName?: string; isContentEditable?: boolean; type?: string } | null | undefined,
): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el.type || "text").toLowerCase();
  return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"].includes(type);
}

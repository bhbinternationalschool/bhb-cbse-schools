/**
 * When has a screen's main content rendered? (data-layer 1.2, `page-ready`)
 *
 * The staff shell renders a screen as
 *   <main> CoreDataGate → Suspense → ErpModuleGate → <div class="erp-module-root"> page </div>
 * (app/(erp)/layout.tsx, components/shell/AppShell.tsx). Until the screen
 * itself is on the page, one of four placeholders stands in its place:
 *   - "Loading workspace…" before the shell boots — no <main> at all;
 *   - CoreDataGate's "Loading school data…" spinner — no .erp-module-root;
 *   - ErpModuleGate's "Checking access…" — no .erp-module-root;
 *   - the route skeleton (app/(erp)/loading.tsx, role="status") as the
 *     first thing INSIDE .erp-module-root while the page's code loads.
 * So: ready = .erp-module-root exists under <main> and its first element is
 * not a role="status" placeholder. A screen that shows its own spinner first
 * (role="status") is ready when that is replaced. One querySelector — cheap
 * enough to run on every animation frame that follows a DOM change.
 *
 * It says the screen has PAINTED, not that its data has arrived: the desks a
 * screen reads report separately (`desk-hydrate`), and data-ready per screen
 * comes with useErpQuery (step 1.4).
 */

export type ElementLike = {
  querySelector(selector: string): ElementLike | null;
  readonly firstElementChild: ElementLike | null;
  getAttribute(name: string): string | null;
};

export function pageContentReady(doc: { querySelector(selector: string): ElementLike | null } | null): boolean {
  if (!doc) return false;
  const root = doc.querySelector("main .erp-module-root");
  if (!root) return false;
  const first = root.firstElementChild;
  if (!first) return false;
  return first.getAttribute("role") !== "status";
}

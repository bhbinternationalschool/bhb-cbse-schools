import "server-only";

import { fetchDeskSliceFromDb } from "@/lib/deskSliceNormalized.server";
import {
  listApprovedTemplates,
  type WaTemplate,
  type WaTemplateModule,
  type WaTemplatesState,
} from "@/lib/waTemplates";

/**
 * The school's WhatsApp templates, read on the server.
 *
 * `ensureWaTemplatesHydrated` in waTemplatesPersistence is the BROWSER path:
 * underneath, it fetches the relative URL `/api/school-data/desk-slice/...`,
 * which Node rejects outright. Called from server code it throws, is caught,
 * and reports "not hydrated" — so `loadWaTemplates()` returns the built-in
 * defaults, in which nothing is approved.
 *
 * Every command that sends a parent a template was asking that question the
 * browser way. The answer was always "no approved template", whatever the
 * school had actually got approved with Meta — the pay link said it would
 * not be sent, the fee reminder and the class message refused outright, and
 * the bus delay notice with them. Found on 2026-09-07, the first day the
 * desk was used, against a school whose Hindi pay-link template had been
 * approved for weeks.
 *
 * This reads the desk slice directly, the way every other server-side desk
 * reader does.
 */
export async function loadWaTemplatesServer(): Promise<WaTemplatesState> {
  const read = await fetchDeskSliceFromDb("wa_templates");
  if (!read.ok) {
    // A failed read is not an empty template list. Saying "no approved
    // template" because the database was unreachable would send a family
    // nothing and tell the staff member it was their configuration.
    throw new Error(read.error || "Could not read WhatsApp templates");
  }
  const templates = Array.isArray(read.bundle.templates)
    ? (read.bundle.templates as WaTemplate[])
    : [];
  // `senders` / `moduleSenders` came with multi-number routing on main. The
  // desk only ever asks this state which templates are approved, and the
  // slice does not carry them, so an empty routing table is the honest
  // value: it means "the default sending number", which is what the desk
  // has always used.
  return {
    version: 1,
    templates,
    audit: [],
    lastMetaSyncAt: "",
    senders: [],
    moduleSenders: {},
  };
}

/**
 * Approved templates for one module, server-side.
 *
 * A result rather than a throw, and never a bare empty array: the caller
 * has to say which it is handling. "None approved" is a real answer the
 * school can act on; "could not read" is not, and telling a staff member
 * to go and get a template approved when the database was merely
 * unreachable sends them after a problem they do not have.
 */
export async function approvedTemplatesServer(
  module?: WaTemplateModule,
): Promise<
  { ok: true; templates: WaTemplate[] } | { ok: false; error: string }
> {
  try {
    const state = await loadWaTemplatesServer();
    return {
      ok: true,
      templates: listApprovedTemplates(state, module ? { module } : undefined),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not read WhatsApp templates",
    };
  }
}

/**
 * One template by id, server-side.
 *
 * The confirm step needs the variable ORDER to build the body component —
 * Meta positions parameters, it does not name them. Same browser-path
 * problem as above: looked up with `loadWaTemplates()` on the server it
 * always came back undefined, so the body went out with no parameters at
 * all. Only reached when a pending card is missing its stored order.
 */
export async function getTemplateByIdServer(
  id: string,
): Promise<WaTemplate | undefined> {
  if (!id) return undefined;
  try {
    const state = await loadWaTemplatesServer();
    return state.templates.find((t) => t.id === id);
  } catch {
    return undefined;
  }
}

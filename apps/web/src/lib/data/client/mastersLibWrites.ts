/**
 * The browser side of lib/ Masters writes (data-layer 2.2e): the fee counter's
 * concession grants (lib/counterConcession), the RTE head waivers (lib/rteEws),
 * the referral reward (lib/referralRewards), the revoke on a voided receipt
 * (lib/fees), the fee-setup clone (lib/feeAdjustments). They used to push the
 * tab's whole book (saveMasters); now each states its element changes
 * (lib/data/mastersElementChanges.ts) and this:
 *
 *  1. reads each list it touches FRESH from the server
 *     (GET /api/data/masters.<list>, every element with its `_rev`) —
 *     never the tab's copy, which carries no `_rev` and may be behind;
 *  2. plans the ops against what is stored now (a key changed elsewhere that
 *     this action also sets = a conflict, nothing sent);
 *  3. sends them as ONE all-or-none batch (POST /api/data/masters/batch →
 *     desk_slice_rows_write): one user action, one request, all or nothing;
 *  4. invalidates the masters view and waits for its next answer, which
 *     replaces the tab's masters copy (the old loadMasters readers) — also
 *     after a refusal: the screen must show what the server holds.
 *
 * Never throws.
 */
import { invalidateTabDesks, refetchMastersAnswer } from "./hooks";
import { readAll } from "./query";
import {
  mastersListCollection,
  planMastersElementChanges,
  type MastersElementChange,
  type PlannedElementOp,
} from "../mastersElementChanges";
import { MASTERS_BATCH_PATH } from "./mastersElementPlan";

type Row = Record<string, unknown>;

export type MastersLibWriteOutcome =
  | { ok: true; written: number }
  | { ok: false; kind: "conflict" | "invalid" | "auth" | "unavailable" | "not_found" | "network"; message: string };

/** Read these lists as stored now (every element with its `_rev`). */
export async function readStoredMastersLists(
  sliceKeys: readonly string[],
): Promise<{ ok: true; lists: Map<string, Map<string, Row>> } | { ok: false; message: string }> {
  const lists = new Map<string, Map<string, Row>>();
  for (const key of new Set(sliceKeys)) {
    const collection = mastersListCollection(key);
    if (!collection) return { ok: false, message: `${key} is not a Masters list written element by element.` };
    const read = await readAll<Row>(collection, { limit: 1000, maxPages: 5 });
    if (!read.ok) return { ok: false, message: `Could not read ${key} from the server — nothing was saved (${read.error}).` };
    if (!read.complete) return { ok: false, message: `${key} is too long to read in one go — nothing was saved.` };
    lists.set(key, new Map(read.rows.filter((r) => typeof r.id === "string").map((r) => [String(r.id), r])));
  }
  return { ok: true, lists };
}

export type BatchGuard = { noActiveFeeGroupsIn?: string };

async function postBatch(ops: readonly PlannedElementOp[], guard?: BatchGuard): Promise<MastersLibWriteOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/data/${MASTERS_BATCH_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ ops: ops.map((o) => ({ collection: o.collection, ...o.op })), ...(guard ? { guard } : {}) }),
    });
  } catch (e) {
    return { ok: false, kind: "network", message: e instanceof Error ? e.message : "Network request failed" };
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; kind?: string; message?: string; error?: string } | null;
  if (res.ok && body?.ok) return { ok: true, written: ops.length };
  const kind = (body?.kind ??
    (res.status === 409 ? "conflict" : res.status === 403 ? "auth" : res.status === 400 ? "invalid" : "unavailable")) as Exclude<MastersLibWriteOutcome, { ok: true }>["kind"];
  const message =
    kind === "conflict" && !/already has fee groups/.test(body?.message ?? "")
      ? "Someone changed this on another device a moment ago — nothing was saved. Reload and try again."
      : body?.message ?? body?.error ?? `Request failed (${res.status})`;
  return { ok: false, kind, message };
}

/** Write one user action's Masters element changes, all or none. */
export async function writeMastersChanges(
  changes: readonly MastersElementChange[],
  opts: { guard?: BatchGuard } = {},
): Promise<MastersLibWriteOutcome> {
  if (typeof window === "undefined") {
    return { ok: false, kind: "invalid", message: "writeMastersChanges runs in the browser; the server writes through mastersLibWrites.server." };
  }
  if (changes.length === 0) return { ok: true, written: 0 };
  const read = await readStoredMastersLists(changes.map((c) => c.sliceKey));
  if (!read.ok) return { ok: false, kind: "unavailable", message: read.message };
  const plan = planMastersElementChanges(changes, (k) => read.lists.get(k) ?? new Map());
  if (!plan.ok) {
    await settle();
    return { ok: false, kind: plan.kind, message: plan.message };
  }
  if (plan.ops.length === 0) return { ok: true, written: 0 };
  const out = await postBatch(plan.ops, opts.guard);
  await settle();
  return out;
}

/** The masters view (and through it the tab's page copy) follow the server. */
async function settle(): Promise<void> {
  invalidateTabDesks(["masters"]);
  await refetchMastersAnswer();
}

/**
 * The server side of lib/ Masters writes (data-layer 2.2e). A receipt voided
 * by a SERVER route (a Cashfree refund, a Cashgram refund) must revoke the
 * concession grants it created. Before 2.2e the shared void code "saved" the
 * revoke with saveMasters, which on the server only changed this process's
 * mirror copy — the grants stayed approved in the database and the discount
 * kept coming off the family's bill.
 *
 * Here the stored grants are read from masters_desk_slices, the revoke is
 * planned on them (lib/data/mastersElementChanges) and written as ONE
 * all-or-none desk_slice_rows_write batch at each grant's `_rev`.
 */
import "server-only";
import { invalidateServerMastersCache } from "@/lib/api/v1/auth";
import { clearDeskProbeCache } from "@/lib/deskProbeCache.server";
import { collectionDef } from "../registry";
import {
  mastersListCollection,
  planMastersElementChanges,
  revokeChangesForVoucher,
  type MastersElementChange,
} from "../mastersElementChanges";
import { readSliceList, writeMastersBatch, type Row } from "./repo";

export type ServerMastersWrite = { ok: true; written: number } | { ok: false; message: string };

export async function writeMastersChangesServer(changes: readonly MastersElementChange[]): Promise<ServerMastersWrite> {
  if (changes.length === 0) return { ok: true, written: 0 };
  const lists = new Map<string, Map<string, Row>>();
  try {
    for (const key of new Set(changes.map((c) => c.sliceKey))) {
      const id = mastersListCollection(key);
      const src = id ? collectionDef(id)?.slice : null;
      if (!src) return { ok: false, message: `${key} is not a Masters list written element by element` };
      lists.set(key, new Map((await readSliceList(src)).filter((r) => typeof r.id === "string").map((r) => [String(r.id), r])));
    }
  } catch (e) {
    return { ok: false, message: `could not read Masters (${e instanceof Error ? e.message : String(e)})` };
  }
  const plan = planMastersElementChanges(changes, (k) => lists.get(k) ?? new Map());
  if (!plan.ok) return { ok: false, message: plan.message };
  if (plan.ops.length === 0) return { ok: true, written: 0 };
  const res = await writeMastersBatch(plan.ops.map((o) => ({ collection: o.collection, op: o.op })));
  if (!res.ok) return { ok: false, message: res.message };
  clearDeskProbeCache("masters-desk-rows");
  invalidateServerMastersCache();
  return { ok: true, written: plan.ops.length };
}

/** Revoke the grants a voided receipt created, from the database. Never throws. */
export async function revokeVoucherGrantsServer(voucher: { id: string; receiptNo: string }): Promise<ServerMastersWrite> {
  try {
    const src = collectionDef("masters.concession-grants")?.slice;
    if (!src) return { ok: false, message: "no concession grants collection" };
    const grants = await readSliceList(src);
    const changes = revokeChangesForVoucher(grants, voucher, new Date().toISOString().slice(0, 10));
    const out = await writeMastersChangesServer(changes);
    if (!out.ok) console.warn(`[masters] grants of voided receipt ${voucher.receiptNo} not revoked: ${out.message}`);
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[masters] grants of voided receipt ${voucher.receiptNo} not revoked: ${message}`);
    return { ok: false, message };
  }
}

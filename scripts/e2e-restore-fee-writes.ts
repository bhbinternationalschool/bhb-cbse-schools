/**
 * Take the fee-writes case back out of the local e2e stack
 * (apps/web/e2e/specs/fee-writes.spec.ts, data-layer 2.2e): every Masters fee
 * element the spec made — ids "e2e_fw_…", fee groups coded "E2E-FW…" (the
 * clone's copies) and their lines, grants and rules marked "e2e-fw". The
 * kernel refuses to leave a Masters list empty (2.2b), and on the stack these
 * are the only fee lines, so this goes through the app's slice write path
 * (pushMastersSlicesToDb — masters_write_slices, at the stamps just read),
 * like e2e-seed-certificate-dues.ts. Refuses anything but the 127.0.0.1
 * stack (assertLocalStack). Run from apps/web with .env.e2e loaded.
 */
import { assertLocalStack } from "../apps/web/e2e/session";
import type { MastersState } from "../apps/web/src/lib/masters";

const KEYS = ["concessionGrants", "concessions", "feeStructureLines", "feeGroups", "installments", "feeHeads"] as const;

async function restore(): Promise<void> {
  assertLocalStack();
  const { fetchMastersDeskFromDb, fetchMastersSliceStamps, pushMastersSlicesToDb } = await import(
    "../apps/web/src/lib/mastersNormalized.server"
  );
  const read = await fetchMastersDeskFromDb();
  if (read.readFailed) throw new Error("masters desk unreadable");
  const stamps = await fetchMastersSliceStamps();
  if (!stamps) throw new Error("masters slice stamps unreadable");
  const b = read.bundle as MastersState;
  type R = Record<string, unknown>;
  const ourGroups = new Set(
    (b.feeGroups ?? [])
      .filter((g) => g.id.startsWith("e2e_fw_") || String(g.code ?? "").startsWith("E2E-FW"))
      .map((g) => g.id),
  );
  const ours: Record<(typeof KEYS)[number], (e: R) => boolean> = {
    concessionGrants: (e) => String(e.id).startsWith("e2e_fw_") || String(e.reason ?? "").includes("e2e-fw"),
    concessions: (e) => String(e.id).startsWith("e2e_fw_") || String(e.notes ?? "").includes("e2e-fw") || String(e.id).startsWith("cnc_rtew_e2e_fw_"),
    feeStructureLines: (e) => String(e.id).startsWith("e2e_fw_") || ourGroups.has(String(e.feeGroupId)),
    feeGroups: (e) => ourGroups.has(String(e.id)),
    installments: (e) => String(e.id).startsWith("e2e_fw_"),
    feeHeads: (e) => String(e.id).startsWith("e2e_fw_"),
  };
  const next: R = { ...b };
  const changed: string[] = [];
  for (const k of KEYS) {
    const list = ((b as unknown as R)[k] as R[] | undefined) ?? [];
    const kept = list.filter((e) => !ours[k](e));
    if (kept.length !== list.length) {
      next[k] = kept;
      changed.push(k);
    }
  }
  if (!changed.length) return;
  const pushed = await pushMastersSlicesToDb(next as unknown as MastersState, changed as never, stamps);
  if (!pushed.ok) throw new Error(`fee-writes restore not saved: ${JSON.stringify(pushed)}`);
  console.log(`fee-writes restore: ${changed.join(", ")}`);
}

restore().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);

/**
 * The TC / no-dues gate case (specs/certificates-dues-gate.spec.ts): a
 * TUITION fee structure for one class, so its children owe fees that only a
 * reader of the FULL Masters book can see. The fixture school bills nothing
 * from a structure (one inactive group), so without this case no dues
 * figure on the stack depends on the fee structure — the part of Masters the
 * teaching subset withholds.
 *
 * Written through the app's own Masters write path (pushMastersSlicesToDb —
 * masters_write_slices, slice-level, so a concurrent Masters edit by another
 * spec is not overwritten) by scripts/e2e-seed-certificate-dues.ts under tsx.
 * Only the four fee slices are touched, only items whose id starts "e2e_cg_"
 * are added, and `restore` takes exactly those out again.
 *
 * The billed class is chosen so that no child another money spec reads (its
 * household's children included) sits in it.
 */
import { AY_CURRENT, buildFixture, UPGRADE_CHILD_INDEX } from "./fixture";
import { assertLocalStack } from "./session";
import type { MastersState } from "@/lib/masters";

const fx = buildFixture();
const PREFIX = "e2e_cg_";
const MONTHLY_PAISE = 100_000;

const current = fx.sis.students.filter((s) => s.academicYearCode === AY_CURRENT && s.status === "active");
const moneyChildren = new Set<string>([
  ...fx.growing.receipts.flatMap((v) => v.lines.map((l) => l.studentId)),
  ...fx.growing.chargeVouchers.map((c) => c.studentId),
]);
// The transport cases take the first spare children (e2e/transportPaidCase.ts,
// e2e/duesTransportCase.ts, the parent-web family); keep well clear of them.
const spares = current.filter((s) => !moneyChildren.has(s.id) && s.householdId).slice(0, 4);
const upgrade = current.find((s) => s.admissionNo === `E2E-${String(UPGRADE_CHILD_INDEX).padStart(4, "0")}`);
const busyHouseholds = new Set<string>([
  ...current.filter((s) => moneyChildren.has(s.id)).map((s) => s.householdId),
  ...spares.map((s) => s.householdId),
  current[0]!.householdId, // parent-web-dues' "other family"
  ...(upgrade ? [upgrade.householdId] : []),
]);
const busyClasses = new Set<string>(current.filter((s) => busyHouseholds.has(s.householdId)).map((s) => s.classId));
if (upgrade) {
  const order = fx.masters.classes.map((c) => c.id);
  busyClasses.add(upgrade.classId);
  const next = order[order.indexOf(upgrade.classId) + 1];
  if (next) busyClasses.add(next);
}

/** The class the case bills (the last class with children and no busy family). */
export const BILLED_CLASS = [...fx.masters.classes]
  .reverse()
  .find((c) => !busyClasses.has(c.id) && current.some((s) => s.classId === c.id))?.id;
/** Owes twelve months of ₹1,000 tuition (₹12,000), from the structure only. */
export const OWES = current.find((s) => s.classId === BILLED_CLASS && s.householdId && !moneyChildren.has(s.id));
/** Owes nothing: another class, no receipts, no charges, no transport. */
export const CLEAR = current.find(
  (s) => s.classId !== BILLED_CLASS && !busyClasses.has(s.classId) && s.householdId && !moneyChildren.has(s.id),
);
export const OWES_PAISE = 12 * MONTHLY_PAISE;

type FeeSlices = Pick<MastersState, "feeHeads" | "feeGroups" | "feeStructureLines" | "installments">;
const FEE_SLICES = ["feeHeads", "feeGroups", "feeStructureLines", "installments"] as const;

async function writeFeeSlices(change: (b: FeeSlices) => FeeSlices): Promise<void> {
  assertLocalStack();
  const { fetchMastersDeskFromDb, fetchMastersSliceStamps, pushMastersSlicesToDb } = await import(
    "@/lib/mastersNormalized.server"
  );
  const read = await fetchMastersDeskFromDb();
  if (read.readFailed) throw new Error("masters desk unreadable");
  const stamps = await fetchMastersSliceStamps();
  if (!stamps) throw new Error("masters slice stamps unreadable");
  const bundle = read.bundle as MastersState;
  const next = change({
    feeHeads: bundle.feeHeads ?? [],
    feeGroups: bundle.feeGroups ?? [],
    feeStructureLines: bundle.feeStructureLines ?? [],
    installments: bundle.installments ?? [],
  });
  const pushed = await pushMastersSlicesToDb({ ...bundle, ...next } as MastersState, [...FEE_SLICES], stamps);
  if (!pushed.ok) throw new Error(`masters fee slices not saved: ${JSON.stringify(pushed)}`);
}

const mine = <T extends { id: string }>(rows: T[]) => rows.filter((r) => !r.id.startsWith(PREFIX));

export async function seedCertificateDuesCase(): Promise<void> {
  if (!BILLED_CLASS || !OWES || !CLEAR) throw new Error("fixture: no free class for the certificate dues case");
  const { buildSessionInstallments } = await import("@/lib/masters");
  await writeFeeSlices((b) => {
    const existing = b.installments.filter((i) => i.academicYearCode === AY_CURRENT && !i.id.startsWith(PREFIX));
    const installments =
      existing.length > 0
        ? existing
        : buildSessionInstallments(AY_CURRENT, "monthly").map((i) => ({ ...i, id: `${PREFIX}inst_${i.code}` }));
    const groupId = `${PREFIX}fg`;
    return {
      installments: [...mine(b.installments), ...(existing.length > 0 ? [] : installments)],
      feeHeads: [
        ...mine(b.feeHeads),
        {
          id: `${PREFIX}fh_tuition`,
          code: "E2E-CG-TUI",
          nameEn: "E2E Tuition",
          category: "academic",
          frequency: "monthly",
          isOptional: false,
          isRefundable: false,
          isActive: true,
          sortOrder: 1,
        } as MastersState["feeHeads"][number],
      ],
      feeGroups: [
        ...mine(b.feeGroups),
        {
          id: groupId,
          code: "E2E-CG",
          name: "E2E certificate dues",
          academicYearCode: AY_CURRENT,
          studentType: OWES.studentType,
          classIds: [BILLED_CLASS],
          isActive: true,
          structurePublishedAt: "2026-04-01T00:00:00.000Z",
          structurePublishedBy: "e2e",
        },
      ],
      feeStructureLines: [
        ...mine(b.feeStructureLines),
        ...installments
          .filter((i) => i.isActive)
          .map((i) => ({
            id: `${PREFIX}fsl_${i.code}`,
            feeGroupId: groupId,
            feeHeadId: `${PREFIX}fh_tuition`,
            classId: null,
            amountPaise: MONTHLY_PAISE,
            installmentId: i.id,
          })),
      ],
    };
  });
}

export async function restoreCertificateDuesCase(): Promise<void> {
  await writeFeeSlices((b) => ({
    installments: mine(b.installments),
    feeHeads: mine(b.feeHeads),
    feeGroups: mine(b.feeGroups),
    feeStructureLines: mine(b.feeStructureLines),
  }));
}

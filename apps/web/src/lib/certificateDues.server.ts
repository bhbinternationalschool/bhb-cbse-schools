import "server-only";

/**
 * One child's open fee dues, computed on the server from the whole fee book,
 * for the certificate gate (GET /api/data/views/certificate-dues).
 *
 * Why the server: the Certificates screen used to count dues from the
 * browser's page copies. For a person without the Masters grant that copy is
 * the teaching subset — fee groups, heads, structure and grants withheld — so
 * every child came out at ₹0 and a TC or a no-dues certificate could be
 * issued for a child who owed fees (found 21 Oct 2026). The page copies of
 * the fees and transport desks are just as partial for a role that cannot
 * read those desks. Here the inputs are the ones every server-side dues
 * figure uses (the parent's checkout, the fee ledger): the school mirror
 * (students, Masters, receipts) plus transport and fee adjustments
 * (lib/feeDuesInputs.server.ts), and the count is the screen's own
 * (openBalanceFrom in lib/certificates.ts).
 *
 * An unreadable school is a failed read, never "no dues": no students or no
 * classes in the mirror means the database was not read.
 */

import { openBalanceFrom, type CertificateDuesView } from "@/lib/certificates";
import { loadFees } from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";

export type CertificateDuesRead =
  | { ok: true; view: CertificateDuesView }
  | { ok: false; status: 404 | 503; error: string };

/**
 * `fresh`: re-read every input now instead of trusting this instance's copy
 * (which may be up to 45 s old — lib/schoolMirrorRemote.server.ts). The
 * screen asks for it once, at the moment it issues a TC or a fee clearance;
 * the figure shown while the clerk fills the form uses the cheap read.
 */
export async function readCertificateDues(
  studentId: string,
  opts: { fresh?: boolean } = {},
): Promise<CertificateDuesRead> {
  const force = opts.fresh === true;
  try {
    await ensureSchoolMirrorHydrated({ force });
    const { ensureFeeDuesInputsHydrated } = await import("@/lib/feeDuesInputs.server");
    await ensureFeeDuesInputsHydrated({ force });
  } catch {
    return { ok: false, status: 503, error: "Could not read the fee records — please try again." };
  }
  const sis = loadSis();
  const masters = loadMasters();
  if (sis.students.length === 0 || masters.classes.length === 0) {
    return { ok: false, status: 503, error: "Could not read the fee records — please try again." };
  }
  const student = sis.students.find((s) => s.id === studentId);
  if (!student) return { ok: false, status: 404, error: "Student not found" };
  return { ok: true, view: { studentId, ...openBalanceFrom(student, masters, loadFees()) } };
}

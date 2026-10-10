import { MpdFeeDisclosurePage } from "@/components/fees/MpdFeeDisclosurePage";
import { buildMpdFeeDisclosure, type MpdFeeGroupRow } from "@/lib/feeFinance";
import { currentAcademicYearCode } from "@/lib/masters";
import {
  deskBundleToMastersState,
  fetchMastersDeskFromDb,
} from "@/lib/mastersNormalized.server";

export const metadata = {
  title: `Fee structure · ${process.env.NEXT_PUBLIC_SCHOOL_NAME ?? "School"}`,
  description: "Mandatory public disclosure — fee structure",
};

// Public statutory page: fee rows come from the DB per request, never from a
// visitor's (empty) localStorage.
export const dynamic = "force-dynamic";

export default async function MpdPage() {
  let rows: MpdFeeGroupRow[] = [];
  let ay = "";
  try {
    const { bundle } = await fetchMastersDeskFromDb();
    if (bundle.classes.length > 0 || bundle.feeGroups.length > 0) {
      const masters = deskBundleToMastersState(bundle);
      ay = currentAcademicYearCode(masters);
      rows = buildMpdFeeDisclosure(masters, ay);
    }
  } catch (e) {
    console.warn("[mpd] masters desk read failed", e);
  }
  return <MpdFeeDisclosurePage rows={rows} academicYearCode={ay} />;
}

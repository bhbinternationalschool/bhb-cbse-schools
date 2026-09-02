import type { Metadata } from "next";
import { AdmissionsWorkspace } from "@/components/admissions/AdmissionsWorkspace";

export const metadata: Metadata = { title: "Lead · Admissions" };

/**
 * One lead, on its own page.
 *
 * The list and the lead were fighting for one screen: the table is a call
 * list you run down, the lead is a form you work through, and stacking them
 * meant scrolling past hundreds of rows to reach the form. The list now opens
 * each lead here in a new tab, so a counsellor keeps the list where it was
 * and can have two families open at once.
 *
 * A real route rather than a modal, so it can be bookmarked, sent to a
 * colleague, and reopened after a browser restart.
 */
export default async function AdmissionLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdmissionsWorkspace soloLeadId={id} />;
}

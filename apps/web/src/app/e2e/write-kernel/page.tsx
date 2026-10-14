/**
 * /e2e/write-kernel — a test-only screen for data-layer step 1.5.
 *
 * Exists only on the local e2e stack (E2E=1): everywhere else it is a 404.
 * It reads Masters subjects through GET /api/data/masters.subjects and saves
 * one through the write kernel (useSaveMutation → POST /api/data/… →
 * desk_slice_row_write), so the Playwright gate can drive two browsers at
 * the same subject (e2e/specs/write-conflict.spec.ts). No product screen
 * uses the kernel's write path yet; Phase 2 converts them.
 */
import { notFound } from "next/navigation";
import { WriteKernelSubjects } from "@/components/e2e/WriteKernelSubjects";

export const dynamic = "force-dynamic";

export default function WriteKernelPage() {
  if (process.env.E2E !== "1") notFound();
  return <WriteKernelSubjects />;
}

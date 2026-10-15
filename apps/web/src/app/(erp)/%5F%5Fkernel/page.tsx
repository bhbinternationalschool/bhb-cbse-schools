import { notFound } from "next/navigation";
import { KernelProbe } from "@/components/data/KernelProbe";

/**
 * /__kernel — the query kernel's test page (data-layer 1.4). Not a screen:
 * it exists only on the local e2e stack (E2E=1, read on the server at request
 * time) and is a 404 everywhere else, production included. It lists the
 * school's classes through useMasters() so propagation.spec.ts can watch a
 * Masters change reach an open tab through the versions poll.
 *
 * The folder is `%5F%5Fkernel` because a folder starting with `_` is private
 * in the App Router (never routed); `%5F` is the documented escape for a
 * URL segment that starts with an underscore.
 */
export const dynamic = "force-dynamic";

export default function KernelPage() {
  if (process.env.E2E !== "1") notFound();
  return <KernelProbe />;
}

#!/usr/bin/env npx tsx
/**
 * Backfill payment_desk_links from school mirror blob or payments_state blob.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-payment-desk.ts
 *   cd apps/web && npx tsx scripts/backfill-payment-desk.ts --from-mirror=.data/school_mirror.json
 */

import { readFile } from "fs/promises";
import path from "path";
import type { PaymentsState } from "../src/lib/payments";
import {
  fetchPaymentDeskFromDb,
  pushPaymentDeskToDb,
} from "../src/lib/paymentsNormalized.server";

async function loadFromFile(file: string): Promise<PaymentsState | null> {
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw) as { payments?: PaymentsState };
  if (parsed.payments?.links) return parsed.payments;
  const direct = parsed as PaymentsState;
  if (direct.version === 1 && Array.isArray(direct.links)) return direct;
  return null;
}

async function loadFromPaymentsBlob(): Promise<PaymentsState | null> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<PaymentsState>("payments_state");
  return blob.state ?? null;
}

async function loadFromMirrorBlob(): Promise<PaymentsState | null> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<{ payments?: PaymentsState }>(
    "school_mirror_state",
  );
  return blob.state?.payments ?? null;
}

async function resolvePayments(): Promise<{ state: PaymentsState; source: string }> {
  const fromArg = process.argv.find((a) => a.startsWith("--from-mirror="));
  if (fromArg) {
    const file = fromArg.split("=")[1]!;
    const state = await loadFromFile(path.resolve(file));
    if (!state?.links?.length) {
      throw new Error(`No payment links in ${file}`);
    }
    return { state, source: file };
  }

  const mirrorPath = path.join(process.cwd(), ".data", "school_mirror.json");
  try {
    const local = await loadFromFile(mirrorPath);
    if ((local?.links?.length ?? 0) > 0) {
      return { state: local!, source: mirrorPath };
    }
  } catch {
    /* fall through */
  }

  const payBlob = await loadFromPaymentsBlob();
  if ((payBlob?.links?.length ?? 0) > 0) {
    return { state: payBlob!, source: "payments_state blob" };
  }

  const mirrorBlob = await loadFromMirrorBlob();
  if ((mirrorBlob?.links?.length ?? 0) > 0) {
    return { state: mirrorBlob!, source: "school_mirror_state blob" };
  }

  throw new Error(
    "No payment links found in local mirror or payments_state blob. Create pay-links in ERP first.",
  );
}

async function main() {
  const { state, source } = await resolvePayments();
  console.log(`Loaded from ${source}:`, {
    links: state.links.length,
    open: state.links.filter((l) => l.status === "open").length,
    paid: state.links.filter((l) => l.status === "paid").length,
  });

  const before = await fetchPaymentDeskFromDb();
  console.log(`DB before: ${before.links.length} links`);

  const result = await pushPaymentDeskToDb(state);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchPaymentDeskFromDb();
  console.log(`Backfill OK — wrote ${result.linkCount} links`);
  console.log(
    `DB after: ${after.links.length} links (${after.meta?.openLinkCount ?? 0} open, ${after.meta?.paidLinkCount ?? 0} paid)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

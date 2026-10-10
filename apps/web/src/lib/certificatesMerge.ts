/**
 * The certificate register, written from more than one place.
 *
 * Until 21 Sep 2026 the register was written only from the Certificates
 * screen, and every save replaced the whole list with the browser's copy —
 * last browser wins. Once a WhatsApp request also adds rows on the server,
 * that is a lost certificate the next time an office PC with an older copy
 * saves: a numbered, printed, signed document missing from the register.
 * So saves union by id (as fee adjustments do since #294): nothing a save
 * does not mention is dropped. Certificates are never deleted, only voided.
 *
 * Pure.
 */

import type { CertificateIssue, CertificateKind } from "@/lib/certificates";

type IssueLike = Pick<CertificateIssue, "id" | "createdAt" | "voidedAt">;

/** The later truth of two copies of one certificate: a void is never undone by a stale copy. */
function laterOf<T extends IssueLike>(server: T, incoming: T): T {
  if (server.voidedAt && !incoming.voidedAt) return server;
  return incoming;
}

export function mergeCertificateIssues<T extends IssueLike>(server: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  for (const s of server) if (s?.id) byId.set(s.id, s);
  for (const r of incoming) {
    if (!r?.id) continue;
    const had = byId.get(r.id);
    byId.set(r.id, had ? laterOf(had, r) : r);
  }
  return [...byId.values()].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

const PREFIX: Partial<Record<CertificateKind, string>> = { aadhaar_uidai: "AAD" };

/**
 * The next number for a certificate issued off the Certificates screen, by
 * the screen's own fallback rule (PREFIX-AAAA-0001 per year), so both
 * places number one series. Never a number already on the register.
 */
export function nextCertNoFor(
  kind: CertificateKind,
  academicYearCode: string,
  issues: Pick<CertificateIssue, "kind" | "academicYearCode" | "certNo" | "voidedAt">[],
): string {
  const prefix = PREFIX[kind] ?? "CRT";
  const ayTag = academicYearCode.replace(/[^0-9]/g, "").slice(0, 4) || "AY";
  const taken = new Set(issues.map((i) => i.certNo));
  let n = issues.filter((i) => i.kind === kind && i.academicYearCode === academicYearCode && !i.voidedAt).length + 1;
  let no = `${prefix}-${ayTag}-${String(n).padStart(4, "0")}`;
  while (taken.has(no)) {
    n += 1;
    no = `${prefix}-${ayTag}-${String(n).padStart(4, "0")}`;
  }
  return no;
}

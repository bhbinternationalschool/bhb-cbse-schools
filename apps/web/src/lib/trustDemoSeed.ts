/**
 * The trust demo seed, recognised by content.
 *
 * Until #475, seedTrustIfEmpty wrote a demo project, its work item, a made-up
 * contractor (with a GSTIN) and two sample rate-card rows into any empty
 * browser before the desk was pulled — and pushed them. On 9 Oct 2026 the
 * production trust desk held exactly that and nothing else. Their ids were
 * random, so they are matched on several fields at once: a real row would
 * have to repeat the demo's code, name and figures together to be caught.
 */

type Row = Record<string, unknown>;

const DEMO_RATE_CARD: { workName: string; ratePaise: number }[] = [
  { workName: "Vitrified tile flooring", ratePaise: 8500 },
  { workName: "Electrical point", ratePaise: 45000 },
];

export function isTrustDemoRow(slice: string, row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Row;
  switch (slice) {
    case "projects":
      return (
        r.note === "Demo seed project" &&
        r.code === "CAP/25-26/001" &&
        r.name === "New Primary Wing — Block B"
      );
    case "workItems":
      return r.code === "WRK-01" && r.name === "Classroom flooring — GF" && r.qtyPlanned === 2500;
    case "contractors":
      return r.name === "Sharma Civil Contractors" && r.gstin === "09AABCS1234A1Z5";
    case "rateCard":
      return (
        r.locality === "Lucknow" &&
        DEMO_RATE_CARD.some((d) => d.workName === r.workName && d.ratePaise === r.ratePaise)
      );
    default:
      return false;
  }
}

/** The list without demo rows. */
export function withoutTrustDemo(slice: string, list: unknown[]): unknown[] {
  return list.filter((r) => !isTrustDemoRow(slice, r));
}

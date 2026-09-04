/**
 * The UDISE+ workbook the office is working through, kept between sittings.
 *
 * Reconciling a UDISE+ export against SIS is days of work, not minutes: the
 * office chases a PEN, verifies a child on the portal, comes back. Until now
 * the parsed list lived in React state alone, so closing the tab — or simply
 * logging in again — threw the whole working table away and the file had to
 * be uploaded from scratch.
 *
 * What is stored is the ROWS, not the matched preview. That distinction is
 * the whole design:
 *
 *   The preview is DERIVED from the rows plus the current state of SIS. Store
 *   the preview and it is a photograph — it would still show a child as
 *   missing a PEN long after somebody wrote one in. Store the rows and the
 *   table is recomputed against SIS every time it is opened, so a row that
 *   has since been settled simply reports itself settled, and the list shrinks
 *   as the work gets done. Nothing has to be marked off by hand.
 *
 * A second upload MERGES rather than replaces. UDISE+ exports come out class
 * by class and month by month; replacing would throw away the rows the office
 * had already reconciled from an earlier file, and re-uploading everything to
 * get them back is exactly the loop this is meant to end.
 */

import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const KEY = "bhb_udise_upload_v1";

export type StoredUdiseUpload = {
  version: 1;
  /** The academic session these rows belong to. */
  academicYearCode: string;
  /** Every file that has fed this working set, newest last. */
  files: { name: string; at: string; rows: number }[];
  /** The raw sheet rows, header row included. */
  matrix: unknown[][];
  updatedAt: string;
};

/**
 * What makes two rows the same child.
 *
 * PEN first — it is the portal's own identifier and the thing the whole
 * exercise exists to collect. APAAR next. Failing both, the name and date of
 * birth together, which is weak but is all an unregistered child has; a name
 * alone is not enough to merge two records on.
 */
export function udiseRowKey(
  row: unknown[],
  cols: { pen: number; apaar: number; name: number; dob: number },
): string {
  const at = (i: number) =>
    i >= 0 && i < row.length ? String(row[i] ?? "").trim().toLowerCase() : "";
  const pen = at(cols.pen).replace(/\s+/g, "");
  if (pen && pen !== "-") return `pen:${pen}`;
  const apaar = at(cols.apaar).replace(/\s+/g, "");
  if (apaar && apaar !== "-") return `apaar:${apaar}`;
  const name = at(cols.name).replace(/\s+/g, " ");
  const dob = at(cols.dob).replace(/\s+/g, "");
  if (name && dob) return `nd:${name}|${dob}`;
  // Nothing identifying at all: keep it, but never let it collide with
  // another such row — two blank rows are not the same child.
  return `row:${row.map((c) => String(c ?? "")).join("|")}`;
}

export type MergeReport = {
  matrix: unknown[][];
  added: number;
  updated: number;
  unchanged: number;
};

/**
 * Fold a freshly uploaded sheet into the working set.
 *
 * A row present in both is replaced by the NEW one — the portal is the
 * authority on its own data, and a later export is later news. A row only the
 * old set had is kept: the office may have reconciled it already, and a
 * class-wise export simply does not mention other classes.
 */
export function mergeUdiseMatrices(input: {
  existing: unknown[][] | null;
  incoming: unknown[][];
  headerRowIndex: number;
  cols: { pen: number; apaar: number; name: number; dob: number };
}): MergeReport {
  const { incoming, cols } = input;
  if (!input.existing || input.existing.length === 0) {
    return {
      matrix: incoming,
      added: Math.max(0, incoming.length - input.headerRowIndex - 1),
      updated: 0,
      unchanged: 0,
    };
  }

  // The header and everything above it come from whichever sheet is in hand;
  // the columns are the same shape or the parse would have refused the file.
  const head = incoming.slice(0, input.headerRowIndex + 1);
  const oldBody = input.existing.slice(input.headerRowIndex + 1);
  const newBody = incoming.slice(input.headerRowIndex + 1);

  const order: string[] = [];
  const byKey = new Map<string, unknown[]>();
  for (const r of oldBody) {
    const k = udiseRowKey(r, cols);
    if (!byKey.has(k)) order.push(k);
    byKey.set(k, r);
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of newBody) {
    const k = udiseRowKey(r, cols);
    const before = byKey.get(k);
    if (!before) {
      order.push(k);
      added += 1;
    } else if (JSON.stringify(before) === JSON.stringify(r)) {
      unchanged += 1;
    } else {
      updated += 1;
    }
    byKey.set(k, r);
  }

  return {
    matrix: [...head, ...order.map((k) => byKey.get(k)!)],
    added,
    updated,
    unchanged,
  };
}

export function loadUdiseUpload(): StoredUdiseUpload | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // A browser with site data blocked throws on read. No working file is a
    // fine answer; a crashed panel is not.
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as StoredUdiseUpload;
    if (p?.version !== 1 || !Array.isArray(p.matrix)) return null;
    return p;
  } catch {
    // A corrupt working file is not worth crashing the panel over: the office
    // can upload again, and this way they are told to rather than shown a
    // blank screen.
    return null;
  }
}

export function saveUdiseUpload(value: StoredUdiseUpload): boolean {
  // Guarded: a UDISE+ export of 700 children is large, and a bare setItem
  // throws on a full origin — which is how an unrelated desk lost a roster
  // once already.
  return writeCacheOrInvalidate(KEY, JSON.stringify(value));
}

export function clearUdiseUpload(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing useful to do — the panel treats a failed clear as cleared */
  }
}

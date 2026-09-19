/**
 * The capture a bookmark makes on a Nucleus page.
 *
 * Every Nucleus reading used to arrive as a table the principal selected and
 * copied. That works, but a clipboard table is a lossy thing: cells wrap,
 * blank lines appear between them, and the numbers have to be pulled back out
 * of sentences like "36% Course (50/140 day plans)" with a regular
 * expression. A bookmark reading the same table cell by cell can hand over
 * the numbers themselves.
 *
 * So each reading now accepts either: a pasted table, exactly as before, or a
 * capture. This module recognises a capture and hands back its sections; the
 * table parsers stay where they are, untouched, for the day somebody pastes a
 * table again.
 *
 * One object carries every section, because one click on the assessments page
 * can read both what the publisher has prepared and how to fetch it, and the
 * office should not have to care which box wants which half.
 */

export type CaptureSection = "timeliness" | "assessments" | "papers";

export type NucleusCapture = {
  capturedOn: string;
  timeliness?: unknown[];
  assessments?: unknown[];
  papers?: unknown[];
};

/**
 * Is this text a capture, and if so which sections does it carry?
 *
 * A paste that is not JSON is not a capture — it is a table, and saying so is
 * how the caller knows to fall back rather than report a parse failure.
 */
export function readCapture(text: string): NucleusCapture | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as Record<string, unknown>;

  // The papers capture shipped first and called its one section `rows`.
  const legacyPapers = Array.isArray(body.rows) && body.kind !== "timeliness" && body.kind !== "assessments"
    ? (body.rows as unknown[])
    : undefined;
  // A capture written for one section may still name it `rows` beside a kind.
  const named = (section: CaptureSection): unknown[] | undefined => {
    if (Array.isArray(body[section])) return body[section] as unknown[];
    if (body.kind === section && Array.isArray(body.rows)) return body.rows as unknown[];
    return undefined;
  };

  const capture: NucleusCapture = {
    capturedOn: typeof body.capturedOn === "string" ? body.capturedOn.slice(0, 20) : "",
    timeliness: named("timeliness"),
    assessments: named("assessments"),
    papers: named("papers") ?? legacyPapers,
  };
  if (!capture.timeliness && !capture.assessments && !capture.papers) return null;
  return capture;
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function str(v: unknown, max = 200): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

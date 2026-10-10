/**
 * Punches refused only because they came from a not-yet-approved phone
 * (director, 30 Sep 2026: "record at attempt time"). Each one already
 * passed the office-screen code and the phone's own signature, so the time
 * it was made is proven; it is kept on the pending phone and recorded at
 * that time when the office approves.
 *
 * Today (IST) only: an older attempt belongs to a register the office may
 * already have closed by hand. Per kind, the one that matters: the FIRST
 * IN of the day and the LAST OUT.
 */

export type PunchAttempt = { kind: "in" | "out"; at: string };

export function istDateTime(ms: number): { date: string; time: string } {
  const d = new Date(ms + 330 * 60_000); // IST, no DST
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}

function clean(raw: unknown): PunchAttempt[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is PunchAttempt =>
      !!a &&
      (a.kind === "in" || a.kind === "out") &&
      typeof a.at === "string" &&
      Number.isFinite(Date.parse(a.at)),
  );
}

/** Today's attempts, with `next` folded in: earliest IN, latest OUT. */
export function mergePunchAttempt(existing: unknown, next: PunchAttempt, nowMs: number): PunchAttempt[] {
  const today = istDateTime(nowMs).date;
  const all = [...clean(existing), next].filter((a) => istDateTime(Date.parse(a.at)).date === today);
  const ins = all.filter((a) => a.kind === "in").sort((a, b) => a.at.localeCompare(b.at));
  const outs = all.filter((a) => a.kind === "out").sort((a, b) => a.at.localeCompare(b.at));
  return [...(ins.length ? [ins[0]!] : []), ...(outs.length ? [outs[outs.length - 1]!] : [])];
}

/** What to record on approval: today's attempts, IN before OUT, as IST date + time. */
export function attemptsToRecord(
  raw: unknown,
  nowMs: number,
): { kind: "in" | "out"; date: string; time: string }[] {
  const today = istDateTime(nowMs).date;
  return clean(raw)
    .map((a) => ({ kind: a.kind, ...istDateTime(Date.parse(a.at)) }))
    .filter((a) => a.date === today)
    .sort((a, b) => (a.kind === b.kind ? a.time.localeCompare(b.time) : a.kind === "in" ? -1 : 1));
}

/**
 * Admissions → lead scoring.
 *
 * Turns three facts we actually hold — how far the family is, how many times
 * we have spoken to them, and whether the child is the right age — into one
 * 0-100 number and a temperature the desk can sort by.
 *
 * Deliberately arithmetic, not a model. We have 919 leads and 29 enrolments;
 * that is nowhere near enough to fit anything, and a fitted model on that
 * sample would mostly encode which villages the agents happened to visit.
 * An explicit rubric can be read, argued with, and corrected by the office —
 * a 3-feature logistic regression on 29 positives cannot. When there are a
 * few thousand outcomes across two or three intakes, revisit this.
 *
 * Every component says what it is worth and why, because a score nobody can
 * explain is a score the office will quietly stop trusting.
 */

/** Temperature is a different axis from pipeline stage — see LEAD_STATUS. */
export type LeadStatus = "cold" | "warm" | "hot" | "enrolled";

export const LEAD_STATUSES: LeadStatus[] = ["cold", "warm", "hot", "enrolled"];

export type LeadScoreInput = {
  /** Road distance to campus in km; null when we have not resolved it. */
  distanceKm: number | null;
  /** Logged calls, visits and messages. */
  touchpoints: number;
  /** Child's age in years at the coming session; null when DOB is unknown. */
  childAgeYears: number | null;
  /** Pipeline stage, which overrides temperature once enrolled or lost. */
  stage: string;
  /** Whether an agent recorded a positive disposition on the last contact. */
  lastOutcomePositive?: boolean;
};

export type LeadScoreResult = {
  score: number;
  status: LeadStatus;
  /** Per-component contributions, so the desk can see why. */
  breakdown: { label: string; points: number; note: string }[];
};

/* ─── Weights ──────────────────────────────────────────────── */

/**
 * Distance: 40 points.
 *
 * The heaviest single factor because it is the one the school cannot change.
 * A family 3 km away can walk; at 15 km they need a bus seat that may not
 * exist on their side of the river. Full marks inside 5 km, nothing beyond
 * 25 km — past that the bus economics stop working regardless of intent.
 */
const DISTANCE_POINTS = 40;
const DISTANCE_FULL_KM = 5;
const DISTANCE_ZERO_KM = 25;

/**
 * Touchpoints: 25 points.
 *
 * Engagement, with sharply diminishing returns. The first two contacts say
 * the family answers the phone; the eighth says a counsellor is chasing
 * someone who has already decided. Capped so persistence cannot manufacture
 * a hot lead.
 */
const TOUCHPOINT_POINTS = 25;
const TOUCHPOINT_SATURATION = 5;

/**
 * Child age fit: 25 points.
 *
 * Nursery intake is 3-4. A 5-year-old is a mid-year or Class 1 case, still
 * good. Under 2 is a real family we cannot seat this session, and over 8 is
 * a transfer case that follows a different process — both score low here
 * without being written off, because next year they may be exactly right.
 */
const AGE_POINTS = 25;

/** A logged positive disposition: 10 points. Small, and evidence-based. */
const OUTCOME_POINTS = 10;

/* ─── Scoring ──────────────────────────────────────────────── */

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Distance score, linear between the two thresholds.
 *
 * An unresolved distance scores HALF, not zero. Zero would rank every
 * un-geocoded village below every known one and quietly bury the villages we
 * simply have not measured yet — the same "unknown is not bad news" rule the
 * penetration figures follow.
 */
function distanceScore(distanceKm: number | null): { points: number; note: string } {
  if (distanceKm === null || !Number.isFinite(distanceKm)) {
    return {
      points: Math.round(DISTANCE_POINTS / 2),
      note: "distance not resolved — scored as neutral, not as far",
    };
  }
  const d = Math.max(0, distanceKm);
  if (d <= DISTANCE_FULL_KM) {
    return { points: DISTANCE_POINTS, note: `${d.toFixed(1)} km — within walking/short-hop range` };
  }
  if (d >= DISTANCE_ZERO_KM) {
    return { points: 0, note: `${d.toFixed(1)} km — beyond practical bus range` };
  }
  const ratio = (DISTANCE_ZERO_KM - d) / (DISTANCE_ZERO_KM - DISTANCE_FULL_KM);
  return {
    points: Math.round(DISTANCE_POINTS * ratio),
    note: `${d.toFixed(1)} km from campus`,
  };
}

function touchpointScore(touchpoints: number): { points: number; note: string } {
  const t = clamp(Math.round(touchpoints || 0), 0, 99);
  if (t === 0) return { points: 0, note: "never contacted" };
  const ratio = Math.min(1, t / TOUCHPOINT_SATURATION);
  return {
    points: Math.round(TOUCHPOINT_POINTS * ratio),
    note: `${t} contact${t === 1 ? "" : "s"} logged`,
  };
}

function ageScore(childAgeYears: number | null): { points: number; note: string } {
  if (childAgeYears === null || !Number.isFinite(childAgeYears)) {
    return {
      points: Math.round(AGE_POINTS / 2),
      note: "date of birth missing — scored as neutral",
    };
  }
  const a = childAgeYears;
  if (a >= 3 && a <= 4.5) return { points: AGE_POINTS, note: `age ${a.toFixed(1)} — nursery intake` };
  if (a > 4.5 && a <= 6) return { points: Math.round(AGE_POINTS * 0.8), note: `age ${a.toFixed(1)} — KG / Class 1` };
  if (a >= 2 && a < 3) return { points: Math.round(AGE_POINTS * 0.6), note: `age ${a.toFixed(1)} — ready next session` };
  if (a > 6 && a <= 8) return { points: Math.round(AGE_POINTS * 0.4), note: `age ${a.toFixed(1)} — transfer case` };
  return { points: Math.round(AGE_POINTS * 0.15), note: `age ${a.toFixed(1)} — outside normal intake` };
}

/**
 * Score one lead.
 *
 * Enrolled and lost are facts, not predictions, so they short-circuit: an
 * enrolled family is "enrolled" whatever the arithmetic says, and a lost one
 * is cold no matter how close it lives.
 */
export function scoreLead(input: LeadScoreInput): LeadScoreResult {
  const stage = (input.stage || "").toLowerCase();

  if (stage === "enrolled") {
    return {
      score: 100,
      status: "enrolled",
      breakdown: [{ label: "Enrolled", points: 100, note: "already joined — not a prediction" }],
    };
  }
  if (stage === "lost") {
    return {
      score: 0,
      status: "cold",
      breakdown: [{ label: "Lost", points: 0, note: "closed by the desk" }],
    };
  }

  const distance = distanceScore(input.distanceKm);
  const touch = touchpointScore(input.touchpoints);
  const age = ageScore(input.childAgeYears);
  const outcome = input.lastOutcomePositive
    ? { points: OUTCOME_POINTS, note: "last contact was positive" }
    : { points: 0, note: "no positive disposition logged" };

  const score = clamp(
    distance.points + touch.points + age.points + outcome.points,
    0,
    100,
  );

  return {
    score,
    status: statusForScore(score),
    breakdown: [
      { label: "Distance", points: distance.points, note: distance.note },
      { label: "Engagement", points: touch.points, note: touch.note },
      { label: "Child age fit", points: age.points, note: age.note },
      { label: "Last outcome", points: outcome.points, note: outcome.note },
    ],
  };
}

/**
 * Bands.
 *
 * Hot is deliberately hard to reach: it means "a counsellor should call today",
 * and a desk where half the list is hot has no priority order at all.
 */
export function statusForScore(score: number): LeadStatus {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

/** Years between a date of birth and a reference date; null if unparseable. */
export function childAgeYears(dob: string, asOf: Date = new Date()): number | null {
  const raw = (dob || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const years = (asOf.getTime() - parsed.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  // A negative age is a typo (a future DOB), not a newborn.
  if (years < 0 || years > 25) return null;
  return Math.round(years * 10) / 10;
}

/** Dispositions that count as a positive signal from the family. */
const POSITIVE_OUTCOMES = new Set(["interested", "visit_scheduled", "connected"]);

export function isPositiveOutcome(outcome: string): boolean {
  return POSITIVE_OUTCOMES.has((outcome || "").trim().toLowerCase());
}

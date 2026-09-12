/**
 * Where should this child board? — the shortlist, and the sentence that
 * explains it.
 *
 * WHAT THE MODEL DECIDES, AND WHAT IT DOES NOT
 * It does not find the candidates and it does not compute a single number.
 * The route builds the shortlist from the desk — walking distance from the
 * child's home to every pinned stop, seats on that bus, whether a sibling is
 * already on it, whether Fleet Edge has actually seen the bus halt there — and
 * the model's job is to weigh those against each other and say which one, in
 * words the office can argue with. `parseBoardingSuggestionJson` refuses any
 * stop id that was not on the shortlist, so the one thing it cannot do is
 * invent a place to put a child.
 *
 * WHY IT IS ALLOWED TO DECLINE
 * Most families here are located by a VILLAGE CENTROID — right village, wrong
 * corner, good to about a kilometre. Against that, two stops 400 m apart are
 * indistinguishable, and picking between them would be a coin toss wearing a
 * paragraph of reasoning. So the facts carry the precision and the noise
 * floor, and the prompt requires an empty stopId and a plain "we cannot tell
 * from here" when the difference is inside it. A confident answer from a
 * centroid is worse than no answer: it gets acted on.
 *
 * WHAT IT MAY NEVER SAY
 * Anything about roads. We have a walking distance and nothing else — no
 * crossing, no footbridge, no traffic, no "safer side of the road". Those are
 * the sentences a reader would most want to believe and the ones we have no
 * basis for, so the prompt forbids them outright.
 */

/**
 * Beyond this, it is not a walk and the LOCATION is the thing in doubt.
 *
 * Children here do walk a long way — two kilometres to a stop is ordinary and
 * three is not unheard of. Ten is not a school run, it is a wrong pin.
 *
 * Found on real data, 2026-09-12: a household in "Pahriya" was matched to a
 * census village 15 km from school, while the school's own stop list has
 * "Paharia" two kilometres away. Every candidate came back 10–13 km on foot
 * and the shortlist was, in its own terms, correct — the nearest pinned stop
 * really is 9.96 km from where the record says that family lives. Recommending
 * it would have been a confident answer to the wrong question.
 */
export const MAX_SENSIBLE_WALK_KM = 3;

export type BoardingWalkSource = "google" | "straight";
export type BoardingHomePrecision = "village" | "household" | "pin";

export type BoardingCandidateFact = {
  stopId: string;
  stopName: string;
  /** The bus that serves it, as the office names it. */
  routeLabel: string;
  walkKm: number;
  /** Only ever from Google. null on a straight-line fallback. */
  walkMinutes: number | null;
  walkSource: BoardingWalkSource;
  /** Distance from school, which drives the fee. null = never measured. */
  schoolKm: number | null;
  /** null = nobody has priced this stop. NOT free. */
  monthlyFeePaise: number | null;
  /** null = the vehicle's seat capacity was never recorded. NOT full. */
  seatsLeft: number | null;
  /** A sibling already riding this bus, named. "" when there is none. */
  siblingOnRoute: string;
  /** Mornings Fleet Edge saw the bus halt here. null = not enough history. */
  haltDays: number | null;
  /** True for the stop the child is assigned to now. */
  isCurrent: boolean;
};

export type BoardingSuggestFacts = {
  studentId: string;
  firstName: string;
  classLabel: string;
  /** Village name, address or pin label — whatever located them. */
  homeLabel: string;
  homePrecision: BoardingHomePrecision;
  /** Below this gap, two candidates cannot be told apart. */
  noiseFloorKm: number;
  candidates: BoardingCandidateFact[];
};

export type BoardingSuggestDraft = {
  /** A stop id from the shortlist, or "" when the model declines to choose. */
  stopId: string;
  recommendation: string;
  reasons: string[];
  /** What a human should check before acting. May be "". */
  caution: string;
};

const PRECISION_WORDS: Record<BoardingHomePrecision, string> = {
  pin: "a point somebody dropped for this child specifically — accurate to the doorstep",
  household: "the family's own geocoded address — accurate to about a doorstep",
  village:
    "the CENTROID of their village — the right village but not the right corner, accurate to roughly a kilometre",
};

export function buildBoardingSuggestSystemPrompt(opts: {
  schoolName: string;
}): string {
  return `You advise the transport office at ${opts.schoolName} (a school in rural Varanasi district, India) on where one child should board the school bus. A clerk reads your answer and decides; nothing you say is applied automatically.

You are given a shortlist of stops that already exist on the school's routes, each with a walking distance from the child's home, the bus that serves it, and whatever else is known. Choose ONE, or decline.

HOW TO WEIGH THEM
- Walking distance for the child is the first consideration. A shorter walk wins unless something below outweighs it.
- A sibling already on that bus matters a great deal — families here buy transport per household, and splitting siblings across buses is the mistake the office most often has to undo.
- A stop the bus has actually been seen halting at is better than one it has not, because the second means the child waits somewhere the driver does not stop.
- Seats: never recommend a bus with no seats left. "Seats not recorded" is NOT "no seats" — it is unknown, and it is not a reason to avoid a bus.
- Fee: mention it only if two options differ materially. Do not advise the family to pay less; the fee follows the distance rule and is the office's business, not yours.

RULES YOU MUST NOT BREAK
- "stopId" MUST be copied exactly from the shortlist. Never invent one, never return a stop name in that field.
- Use ONLY the numbers given. Never invent a distance, a time, a fee, a seat count or a halt count.
- Say NOTHING about roads, crossings, traffic, footbridges, which side of a road a stop is on, or how safe a walk is. You have a walking distance and nothing else. These are the most tempting sentences to write and there is no basis for any of them.
- Do not mention any stop that is not on the shortlist.
- If a distance is marked "straight line", describe it as a straight-line estimate, never as a walking distance.
- If the child's home is located only to a village centroid AND the best options are within the stated noise floor of each other, you MUST return "" for stopId and explain in one or two sentences that the family's location is not precise enough to choose between them — say that pinning the child's actual boarding point would settle it. Do not pick anyway.
- If one option is clearly best despite a coarse location (much shorter walk, or a sibling already aboard), you may still choose it.
- If the SHORTEST walk on the shortlist is more than ${MAX_SENSIBLE_WALK_KM} km, do not recommend any of them. Return "" for stopId and say that no stop is within walking distance of where the school has this family placed, so the family's recorded location is the thing to check first — a wrong village match will do this. Children here walk a long way; ten kilometres is not a school run.

TONE
Plain, direct English for a school clerk. No greeting, no sign-off, no markdown, no bullet symbols.

Respond with JSON only, exactly:
{"stopId":"…","recommendation":"…","reasons":["…","…"],"caution":"…"}
- recommendation: one or two sentences naming the stop and the bus, or explaining why you cannot choose.
- reasons: 2 to 4 short phrases, each one fact from the shortlist.
- caution: one sentence on what the clerk should check before acting, or "" if there is nothing.`;
}

function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

export function buildBoardingSuggestUserPrompt(f: BoardingSuggestFacts): string {
  const L: string[] = [];
  L.push(`Child: ${f.firstName}${f.classLabel ? ` · Class ${f.classLabel}` : ""}`);
  L.push(
    `Home location: ${f.homeLabel} — this is ${PRECISION_WORDS[f.homePrecision]}.`,
  );
  L.push(
    `Noise floor: differences smaller than ${f.noiseFloorKm} km cannot be told apart at this precision.`,
  );
  L.push("");
  L.push("Shortlist of existing stops:");

  for (const c of f.candidates) {
    const bits: string[] = [];
    bits.push(
      c.walkSource === "google"
        ? `${c.walkKm} km walk${c.walkMinutes != null ? ` (about ${c.walkMinutes} min on foot)` : ""}`
        : `${c.walkKm} km in a straight line (walking route not available)`,
    );
    bits.push(`bus ${c.routeLabel}`);
    bits.push(
      c.schoolKm == null
        ? "distance from school never measured"
        : `${c.schoolKm} km from school`,
    );
    bits.push(
      c.monthlyFeePaise == null
        ? "not priced yet"
        : `${rupees(c.monthlyFeePaise)}/month`,
    );
    bits.push(
      c.seatsLeft == null
        ? "seats not recorded for this bus"
        : c.seatsLeft <= 0
          ? "NO SEATS LEFT"
          : `${c.seatsLeft} seats left`,
    );
    if (c.siblingOnRoute) bits.push(`sibling ${c.siblingOnRoute} already on this bus`);
    bits.push(
      c.haltDays == null
        ? "not enough GPS history to say whether the bus stops here"
        : c.haltDays === 0
          ? "the bus has NOT been seen halting here"
          : `the bus was seen halting here on ${c.haltDays} morning${c.haltDays === 1 ? "" : "s"}`,
    );
    if (c.isCurrent) bits.push("THIS IS WHERE THE CHILD BOARDS NOW");
    L.push(`- [${c.stopId}] ${c.stopName} — ${bits.join("; ")}`);
  }

  return L.join("\n");
}

/**
 * Parse the model's answer, refusing anything off the shortlist.
 *
 * `allowedStopIds` is the whole no-invention guarantee. A model that returns a
 * plausible stop name, an id from an earlier conversation, or a hallucinated
 * id gets rejected here rather than surfacing as a place to send a child.
 */
export function parseBoardingSuggestionJson(
  text: string,
  allowedStopIds: string[],
): BoardingSuggestDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const str = (v: unknown, max: number) =>
    String(v ?? "")
      .replace(/\r\n/g, "\n")
      .trim()
      .slice(0, max);

  const recommendation = str(r.recommendation, 800);
  if (!recommendation) return null;

  const allowed = new Set(allowedStopIds);
  const claimed = str(r.stopId, 80);
  // An id that is not on the shortlist is not a near miss to be corrected —
  // it is the model having made something up, and the honest rendering is
  // "no stop chosen" with its words left visible for the clerk to judge.
  const stopId = allowed.has(claimed) ? claimed : "";

  const reasons = Array.isArray(r.reasons)
    ? r.reasons
        .map((x) => str(x, 240))
        .filter(Boolean)
        .slice(0, 4)
    : [];

  return {
    stopId,
    recommendation,
    reasons,
    caution: str(r.caution, 400),
  };
}

/**
 * The shortest walk on the shortlist, or null when there are no candidates.
 */
export function shortestWalkKm(f: BoardingSuggestFacts): number | null {
  if (f.candidates.length === 0) return null;
  return Math.min(...f.candidates.map((c) => c.walkKm));
}

/**
 * True when not one stop is within walking distance of where we think this
 * family lives — which says more about the location than about the stops.
 */
export function noStopIsWalkable(f: BoardingSuggestFacts): boolean {
  const best = shortestWalkKm(f);
  return best != null && best > MAX_SENSIBLE_WALK_KM;
}

/**
 * Is there anything here worth asking a model about?
 *
 * One candidate is not a choice, and no candidates is not a question. Both
 * return false so the route answers from the facts instead of spending a call
 * to be told the only option is the only option.
 */
export function boardingSuggestionWorthAsking(f: BoardingSuggestFacts): boolean {
  return f.candidates.length >= 2;
}

/**
 * Stops close enough to each other that this home's precision cannot separate
 * them. Computed here so the route can say so even when the model does not.
 */
export function candidatesWithinNoise(f: BoardingSuggestFacts): BoardingCandidateFact[] {
  if (f.candidates.length === 0) return [];
  const best = Math.min(...f.candidates.map((c) => c.walkKm));
  return f.candidates.filter((c) => c.walkKm - best <= f.noiseFloorKm);
}

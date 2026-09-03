/**
 * What the admissions desk should do next, in order.
 *
 * The CRM opens on 859 leads with "Overdue 858" above them. That number is an
 * artefact: 919 door-to-door survey records were imported in bulk with a
 * default follow-up date that has since passed, and not one of them has ever
 * been called. So the screen reports 858 urgent items that are all identical
 * and none of which is more urgent than any other — which is the same as
 * reporting nothing, except it also makes the desk feel hopeless.
 *
 * A worklist has to be finishable. This sorts every open lead into the ONE
 * thing it needs next, puts the buckets in the order the money moves
 * (a child ready to admit is worth more than a survey record from 2024), and
 * hands back a day's worth of calls rather than a year's.
 *
 * The order is deliberate and is not "most items first":
 *
 *   1  ready to admit      — the school has been paid; finish it
 *   2  ready to register   — nothing is blocking it but somebody pressing go
 *   3  waiting on papers   — the family is engaged, we are the hold-up
 *   4  callback due        — we promised to ring today
 *   5  never contacted     — the long tail, newest first
 */

export type LeadLike = {
  id: string;
  enquiryNo?: string;
  childName?: string;
  guardianName?: string;
  mobile?: string;
  stage?: string;
  source?: string;
  leadDate?: string;
  motherName?: string;
  declarationAccepted?: boolean;
  docsBirthCert?: boolean;
  docsPhoto?: boolean;
  nextFollowUpAt?: string;
  followUps?: unknown[];
};

export type WorkKind =
  | "admit"
  | "register"
  | "documents"
  | "callback"
  | "first_call";

export type WorkBucket = {
  kind: WorkKind;
  /** What the office would call it. */
  label: string;
  /** The single action, in the words of the button that does it. */
  action: string;
  /** Why this bucket sits where it does — shown, not assumed. */
  why: string;
  leads: LeadLike[];
};

const CLOSED = new Set(["enrolled", "lost"]);

/** A mother's name of "—" is how the old import wrote "not recorded". */
function hasMother(l: LeadLike): boolean {
  const m = (l.motherName ?? "").trim();
  return m !== "" && m !== "—" && m !== "-";
}

export function registrationReady(l: LeadLike): boolean {
  return (
    hasMother(l) &&
    !!l.declarationAccepted &&
    !!l.docsBirthCert &&
    !!l.docsPhoto
  );
}

export function contacted(l: LeadLike): boolean {
  return (l.followUps ?? []).length > 0;
}

export function workKindOf(l: LeadLike, today: string): WorkKind {
  // Past registration already: the only thing left is to admit.
  if (l.stage === "verified" || l.stage === "applied") return "admit";
  if (registrationReady(l)) return "register";
  if (!contacted(l)) return "first_call";
  const due = (l.nextFollowUpAt ?? "").slice(0, 10);
  if (due && due <= today) return "callback";
  return "documents";
}

const META: Record<WorkKind, Omit<WorkBucket, "leads">> = {
  admit: {
    kind: "admit",
    label: "Ready to admit",
    action: "Admit to Students",
    why: "Registered and verified — the school has the fee and the papers.",
  },
  register: {
    kind: "register",
    label: "Ready to register",
    action: "Register",
    why: "Nothing is blocking these; they need somebody to press the button.",
  },
  documents: {
    kind: "documents",
    label: "Waiting on documents",
    action: "Chase the papers",
    why: "The family is engaged. We are the hold-up, not them.",
  },
  callback: {
    kind: "callback",
    label: "Callback promised",
    action: "Call",
    why: "Somebody told this parent we would ring. That promise is due.",
  },
  first_call: {
    kind: "first_call",
    label: "Never contacted",
    action: "Start calling",
    why: "Survey records nobody has rung yet. Newest first — a family that enquired last month remembers doing so.",
  },
};

export const WORK_ORDER: WorkKind[] = [
  "admit",
  "register",
  "documents",
  "callback",
  "first_call",
];

/**
 * `dailyCallTarget` caps the never-contacted bucket at a day's work.
 *
 * 858 names is not a list, it is a wall — and a wall gets ignored. Fifteen
 * gets rung.
 */
export function buildLeadWorklist(input: {
  leads: LeadLike[];
  today: string;
  dailyCallTarget?: number;
}): { buckets: WorkBucket[]; openCount: number; contactedCount: number } {
  const open = input.leads.filter((l) => !CLOSED.has(l.stage ?? ""));
  const byKind = new Map<WorkKind, LeadLike[]>();
  for (const k of WORK_ORDER) byKind.set(k, []);
  for (const l of open) byKind.get(workKindOf(l, input.today))!.push(l);

  // Newest enquiry first everywhere: a family that walked in last week is a
  // warmer call than a survey record from 2024, whatever bucket it lands in.
  for (const list of byKind.values()) {
    list.sort((a, b) => (b.leadDate ?? "").localeCompare(a.leadDate ?? ""));
  }

  const cap = input.dailyCallTarget ?? 15;
  const buckets = WORK_ORDER.map((k) => ({
    ...META[k],
    leads: k === "first_call" ? byKind.get(k)!.slice(0, cap) : byKind.get(k)!,
  })).filter((b) => b.leads.length > 0);

  return {
    buckets,
    openCount: open.length,
    contactedCount: open.filter(contacted).length,
  };
}

/** The full size of a bucket, for "showing 15 of 858". */
export function bucketTotal(
  leads: LeadLike[],
  kind: WorkKind,
  today: string,
): number {
  return leads.filter(
    (l) => !CLOSED.has(l.stage ?? "") && workKindOf(l, today) === kind,
  ).length;
}

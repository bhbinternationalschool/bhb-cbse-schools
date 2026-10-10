/**
 * Uttar Pradesh holiday calendar — session 2026-27 (1 Apr 2026 – 31 Mar 2027).
 *
 * Curated from the UP government's published 2026 list (as carried by several
 * secondary publishers) and cross-checked across at least two sources per
 * date on 2026-08-26. The state's OFFICIAL 2027 notification is not out yet,
 * so every moon- or panchang-dependent date in Jan–Mar 2027 is marked
 * `tentative` — the office should re-confirm those when the notification
 * lands, which is also why approval here is per-row, never automatic.
 *
 * House rule applied: dates that could NOT be verified in at least one
 * reliable source (Shab-e-Barat 2027, Ravidas Jayanti 2027, Guru Gobind
 * Singh Jayanti 2027…) are deliberately ABSENT rather than guessed.
 */

export type UpCalendarKind = "national" | "gazetted" | "restricted";

export type UpCalendarEntry = {
  /** ISO start date. */
  date: string;
  /** ISO end date for multi-day spells; same as date when absent. */
  endDate?: string;
  title: string;
  kind: UpCalendarKind;
  /** Moon-sighting or unpublished-notification dependent. */
  tentative?: boolean;
  note?: string;
};

export const UP_HOLIDAY_CALENDAR_SESSION = "2026-27";

export const UP_HOLIDAY_CALENDAR: UpCalendarEntry[] = [
  /* ── April – June 2026 ─────────────────────────────────── */
  { date: "2026-04-03", title: "Good Friday", kind: "gazetted" },
  { date: "2026-04-14", title: "Dr. B.R. Ambedkar Jayanti", kind: "gazetted" },
  { date: "2026-05-01", title: "Buddha Purnima", kind: "gazetted" },
  {
    date: "2026-05-27",
    title: "Eid-ul-Adha (Bakrid)",
    kind: "gazetted",
    tentative: true,
    note: "Subject to moon sighting",
  },
  {
    date: "2026-06-26",
    title: "Muharram (Ashura)",
    kind: "gazetted",
    tentative: true,
    note: "Subject to moon sighting — some lists say 25 June",
  },

  /* ── July – September 2026 ─────────────────────────────── */
  {
    date: "2026-08-04",
    title: "Chehallum",
    kind: "restricted",
    tentative: true,
  },
  { date: "2026-08-15", title: "Independence Day", kind: "national" },
  {
    date: "2026-08-25",
    title: "Eid-e-Milad / Barawafat",
    kind: "gazetted",
    tentative: true,
    note: "Subject to moon sighting — some lists say 26 August",
  },
  { date: "2026-08-28", title: "Raksha Bandhan", kind: "gazetted" },
  { date: "2026-09-04", title: "Shri Krishna Janmashtami", kind: "gazetted" },
  { date: "2026-09-17", title: "Vishwakarma Puja", kind: "restricted" },
  { date: "2026-09-25", title: "Anant Chaturdashi", kind: "restricted" },

  /* ── October – December 2026 ───────────────────────────── */
  { date: "2026-10-02", title: "Gandhi Jayanti", kind: "national" },
  {
    date: "2026-10-19",
    title: "Dussehra — Maha Navami",
    kind: "gazetted",
    note: "UP lists usually give Navami + Dashami together",
  },
  { date: "2026-10-20", title: "Dussehra — Vijaya Dashami", kind: "gazetted" },
  {
    date: "2026-10-26",
    title: "Maharishi Valmiki / Sardar Patel Jayanti",
    kind: "restricted",
  },
  { date: "2026-10-31", title: "Narak Chaturdashi", kind: "restricted" },
  {
    date: "2026-11-08",
    endDate: "2026-11-09",
    title: "Deepawali & Govardhan Puja",
    kind: "gazetted",
    note: "Deepawali falls on a Sunday in 2026",
  },
  { date: "2026-11-11", title: "Bhai Dooj / Chitragupta Jayanti", kind: "gazetted" },
  {
    date: "2026-11-15",
    title: "Chhath Puja",
    kind: "gazetted",
    note: "Observed school-wide across eastern UP",
  },
  {
    date: "2026-11-24",
    title: "Guru Nanak Jayanti / Kartik Purnima",
    kind: "gazetted",
  },
  {
    date: "2026-12-23",
    title: "Ch. Charan Singh Jayanti / Hazrat Ali Jayanti",
    kind: "gazetted",
    tentative: true,
  },
  { date: "2026-12-25", title: "Christmas Day", kind: "gazetted" },

  /* ── January – March 2027 (official UP list pending) ───── */
  { date: "2027-01-01", title: "New Year's Day", kind: "restricted" },
  { date: "2027-01-26", title: "Republic Day", kind: "national" },
  {
    date: "2027-02-11",
    title: "Vasant Panchami",
    kind: "restricted",
    tentative: true,
  },
  {
    date: "2027-03-06",
    title: "Maha Shivratri",
    kind: "gazetted",
    tentative: true,
  },
  {
    date: "2027-03-10",
    title: "Eid-ul-Fitr",
    kind: "gazetted",
    tentative: true,
    note: "Subject to moon sighting — could be 9 or 11 March",
  },
  {
    date: "2027-03-22",
    endDate: "2027-03-23",
    title: "Holi",
    kind: "gazetted",
    tentative: true,
    note: "Holika Dahan 21 March evening; UP usually gives two days",
  },
];

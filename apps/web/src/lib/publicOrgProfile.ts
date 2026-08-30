/**
 * Single source of truth for the public-facing identity of the business:
 * legal name, address, contacts, and the catalogue of paid services.
 *
 * Payment gateways (and their onboarding reviewers) require the *registered
 * legal name* of the merchant to appear on the website, plus a listed
 * catalogue of what the customer is actually paying for. Everything the
 * public pages render comes from here so there is exactly one place to fix
 * when the registered particulars change.
 */

/**
 * The name the merchant account is registered under.
 *
 * If the school is run by a registered Trust / Society / Section-8 company,
 * set `PARENT_BODY_LEGAL_NAME` below to that entity's exact registered name —
 * it must match the name on the bank account and PAN submitted to the payment
 * gateway, character for character, or onboarding will be rejected again.
 */
export const LEGAL_ENTITY_NAME = "BHB International School";

/**
 * Exact registered name of the Trust / Society / company that operates the
 * school, if the merchant account is held in that name rather than the
 * school's. Leave as `null` when the school itself is the registered entity.
 */
/**
 * Spelled HARBANS — no trailing "h" — to match the PAN card exactly.
 *
 * The trust deed (clause I) and its Hindi registration endorsement both spell
 * it HARBANSH (बाबू हरबंश बहादुर सिंह). The PAN issued on the same date drops
 * that "h". Payment gateways verify the merchant name against the Income Tax
 * database, so the PAN spelling is the one that has to appear here; matching
 * the deed instead would fail name verification. Do not "correct" this to
 * Harbansh without first correcting the PAN.
 */
export const PARENT_BODY_LEGAL_NAME: string | null =
  "Babu Harbans Bahadur Singh Smriti Vidya Nyas";

/**
 * How the entity is constituted. The 4th character of the trust's PAN is "T",
 * which is the Income Tax Department's code for a trust, and the instrument is
 * a Deed of Declaration of Trust dated 27 November 2008 registered with the
 * Sub-Registrar I, Varanasi.
 */
export const ENTITY_TYPE: string | null = "registered trust";

/** Registration / CBSE affiliation particulars shown on the About page. */
export const REGISTRATION_DETAILS: { label: string; value: string }[] = [
  {
    label: "Constitution",
    value:
      "Trust, created by Deed of Declaration of Trust dated 27 November 2008",
  },
  {
    label: "Registered with",
    value: "Office of the Sub-Registrar I, Varanasi, Uttar Pradesh",
  },
  {
    label: "Registration no.",
    value: "158 of 2008 (Book 4, Volume 23, pages 177–220)",
  },
  {
    label: "Recognition",
    value:
      "Recognised by the State Government of Uttar Pradesh for Nursery to Class VIII",
  },
  // No central-board affiliation number is held, so none is listed. Do NOT add
  // the trust's PAN either — the gateway takes it through KYC, it has no
  // business on a public page.
];

export const TRADING_NAME = "BHB International School";

/**
 * The school's recognition, in the words published on every public page.
 *
 * The school is recognised by the State Government of Uttar Pradesh for
 * Nursery to Class VIII and holds no central-board affiliation number. Saying
 * so plainly, in the footer of every page, is what stops an automated merchant
 * review from classifying the site as a CBSE high school and then demanding an
 * affiliation letter that does not exist.
 *
 * Do not describe the school as CBSE-affiliated anywhere on the public site
 * unless and until an affiliation number is actually held; "follows the
 * NCERT/CBSE curriculum framework" is a statement about syllabus, which is
 * true, and is as far as this may go.
 */
export const RECOGNITION_STATEMENT =
  "BHB International School is recognized by the State Government of Uttar Pradesh (Nursery to Class VIII) and follows the standard NCERT/CBSE curriculum framework.";

/** The class range the school is authorised to run, for public copy. */
export const CLASS_RANGE = "Nursery to Class VIII";

/**
 * Name on the bank account the payment gateway settles into, which is also
 * the name customers see on their card or bank statement.
 *
 * The school banks separately from the trust, so this is the school's own
 * account name rather than the registered entity's. Indian gateways allow a
 * settlement account in the operating/trade name provided it sits under the
 * same PAN as the registered entity — the site therefore has to state both
 * names, or a parent seeing "BHB International School" on a statement cannot
 * reconcile it against the legal name published here.
 */
export const SETTLEMENT_ACCOUNT_NAME = "BHB International School";

export const POSTAL_ADDRESS = {
  line1: "Piyamilan Chauraha, Baniyavapar",
  line2: "Ayar, Varanasi",
  state: "Uttar Pradesh",
  pin: "221202",
  country: "India",
} as const;

export type PostalAddress = {
  line1: string;
  line2: string;
  state: string;
  /** Null when the PIN for that locality has not been confirmed. */
  pin: string | null;
  country: string;
};

/**
 * The trust's registered office, when it is not the school campus.
 *
 * Payment gateways check the address published on the site against the one on
 * the entity's PAN / registration certificate. Set this only if the trust deed
 * records an address different from the campus; leave `null` when they are the
 * same, and the campus address is used for both.
 */
export const REGISTERED_OFFICE_ADDRESS: PostalAddress | null = {
  line1: "Village Jagdishpur (Kote), Post Office Katari",
  line2: "Varanasi",
  state: "Uttar Pradesh",
  // TODO: confirm the PIN for Katari before quoting it to the gateway.
  pin: null,
  country: "India",
};

/** Address to publish as the registered address of the legal entity. */
export const LEGAL_ADDRESS: PostalAddress =
  REGISTERED_OFFICE_ADDRESS ?? POSTAL_ADDRESS;

export function addressOneLine(address: PostalAddress) {
  return [
    address.line1,
    address.line2,
    address.pin ? `${address.state} ${address.pin}` : address.state,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Campus address — where the service is actually delivered. */
export const ADDRESS_ONE_LINE = addressOneLine(POSTAL_ADDRESS);

/** Registered address of the legal entity. */
export const LEGAL_ADDRESS_ONE_LINE = addressOneLine(LEGAL_ADDRESS);

export const CONTACT = {
  email: "director@bhbinternational.school",
  /**
   * Office line published for customers.
   *
   * This is the school's verified WhatsApp Business number, which is the line
   * parents already use and the office actually answers. A payment gateway's
   * risk review requires a reachable phone number on the Contact page, so it
   * is published rather than held back.
   */
  phone: "+91 94519 38805" as string | null,
  /** Office hours shown on the Contact page. */
  hours:
    "Monday to Saturday, 8:00 am – 3:00 pm IST (excluding school holidays)",
  website: "https://bhbinternational.school",
} as const;

export type PublicService = {
  code: string;
  name: string;
  /** One-line description of what the payer receives. */
  summary: string;
  /** Human-readable price, already formatted. */
  price: string;
  /** How the price is charged, e.g. "per academic session". */
  cadence: string;
  /** Longer breakdown shown under the price. */
  detail: string;
};

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatInr(rupees: number) {
  return INR.format(rupees);
}

/**
 * The paid services offered to parents. Amounts mirror the school's published
 * 2026-27 fee schedule (see `feeStructure*202627.ts`, which are self-tested
 * against the fee PDF) so the site and the ERP can never drift apart.
 */
export const PUBLIC_SERVICES: PublicService[] = [
  {
    code: "FOUNDATION",
    name: "Foundation programme — Nursery, LKG, UKG",
    summary:
      "Full-session pre-primary schooling: tuition, amenities, examinations and school communications.",
    price: formatInr(25500),
    cadence: "per academic session (2026-27), new admission",
    detail:
      "New admission ₹25,500 for the session, which includes a refundable security deposit. Students continuing from the previous session pay ₹21,500. Payable in full or in monthly instalments from April to March.",
  },
  {
    code: "PRIMARY",
    name: "Primary programme — Classes I to V",
    summary:
      "Full-session primary schooling: tuition, amenities, examinations and school communications.",
    price: formatInr(27800),
    cadence: "per academic session (2026-27), new admission",
    detail:
      "New admission ₹27,800 for the session, which includes a refundable security deposit. Students continuing from the previous session pay ₹23,800. Payable in full or in monthly instalments from April to March.",
  },
  {
    code: "MIDDLE",
    name: "Middle school programme — Classes VI to VIII",
    summary:
      "Full-session middle-school education: tuition, amenities, examinations and school communications.",
    price: formatInr(32300),
    cadence: "per academic session (2026-27), new admission",
    detail:
      "New admission ₹32,300 for the session, which includes a refundable security deposit. Students continuing from the previous session pay ₹27,300. Payable in full or in monthly instalments from April to March.",
  },
  {
    code: "TRANSPORT",
    name: "School bus transport",
    summary:
      "Optional door-to-school pick-up and drop on the school's own bus routes, charged by distance.",
    // TODO: these slabs come from `defaultFeePolicy()` in transport.ts, not from
    // a published fee notice — replace with the notified rates when confirmed.
    price: `${formatInr(400)} – ${formatInr(900)}`,
    cadence: "per month, by distance slab (indicative)",
    detail:
      "Indicative slabs: up to 3 km ₹400 per month · up to 5 km ₹550 · up to 8 km ₹700 · beyond 8 km ₹900. The slab is fixed by the stop assigned to the student. Transport is optional and billed separately from the session fee. Please confirm the rate for your stop with the school office before enrolling for transport.",
  },
  {
    code: "EXAM",
    name: "Examination fee",
    summary:
      "Conduct of the half-yearly and annual examinations, including question papers, answer books and reporting.",
    price: formatInr(500),
    cadence: "per examination cycle",
    detail:
      "₹500 per cycle for every class from Nursery to Class VIII, charged in September and February. Already counted inside the session fee shown above; listed separately because it appears as its own line on the fee receipt.",
  },
  {
    code: "AMENITY",
    name: "Annual amenities charge",
    summary:
      "Upkeep of laboratories, library, sports facilities, ICT equipment and campus utilities for the session.",
    price: `${formatInr(1000)} – ${formatInr(2000)}`,
    cadence: "once per academic session, in April",
    detail:
      "₹1,500 for Foundation and Primary and ₹2,000 for Classes VI to VIII on new admission, with a lower rate for Foundation students continuing from the previous session. Already counted inside the session fee shown above; listed separately because it appears as its own line on the fee receipt.",
  },
];

/** Legal name as it should be shown to customers and to the payment gateway. */
export function displayLegalName() {
  return PARENT_BODY_LEGAL_NAME ?? LEGAL_ENTITY_NAME;
}

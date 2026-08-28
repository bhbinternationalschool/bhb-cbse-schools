export type Persona = "staff" | "parent" | "field" | "student";

export type AcademicYearOption = {
  code: string;
  label: string;
  status: "current" | "closed" | "upcoming";
};

/** Colours sampled from the official crest (navy + gold). */
export const TENANT = {
  slug: "bhb-international",
  name: "BHB International School",
  nameDisplay: "BHB INTERNATIONAL SCHOOL",
  shortName: "BHB International",
  tagline: "Tradition of excellence",
  domain: "bhbinternational.school",
  /** Public school portal (enquiry / apply links & QR — not ERP subdomain) */
  publicPortal: "bhbinternational.school",
  city: "Varanasi",
  state: "Uttar Pradesh",
  logoUrl: "/logo.png?v=2",
  logoCrestUrl: "/logo-crest.png?v=1",
  primaryColor: "#203050",
  primaryMid: "#384870",
  accentColor: "#C5A028",
  goldColor: "#C5A028",
  creamColor: "#F8F8F0",
  timezone: "Asia/Kolkata",
  boardMode: "DUAL" as const,
  /** Demo CBSE identifiers — replace with real affiliation when live */
  affiliationNo: "213XXXX",
  schoolCode: "70XXX",
  /**
   * Printed on receipts and slips. Empty values are simply NOT printed —
   * a receipt must never carry an invented UDISE code or phone number, so
   * fill these with the real ones before handing printed copies to parents.
   */
  udiseCode: "",
  officePhone: "",
  whatsappNumber: "",
  officeEmail: "director@bhbinternational.school",
  /** Campus — Google Maps: Piyamilan chauraha, Baniyavapar, Ayar 221202 */
  schoolAddress:
    "Piyamilan Chauraha, Baniyavapar, Ayar, Varanasi, Uttar Pradesh 221202",
  schoolLat: 25.4354328,
  schoolLng: 82.9439863,
  schoolStatus: "Senior Secondary",
};

/** Fallback shell list — prefer Masters academicYears via listSessionYearOptions(). */
export const ACADEMIC_YEARS: AcademicYearOption[] = [
  { code: "2025-26", label: "2025-26", status: "current" },
  { code: "2024-25", label: "2024-25", status: "closed" },
];

export type HoldCode =
  | "HOLD_REPORT_CARD"
  | "HOLD_TC"
  | "HOLD_CERT"
  | "HOLD_TRANSPORT"
  | "HOLD_STORE_CREDIT"
  | "HOLD_LIBRARY"
  | "HOLD_ADMIT_CARD"
  | "HOLD_TRIP"
  | "HOLD_NEXT_AY";

export type OverdueStage = "S0" | "S1" | "S2" | "S3" | "S4";

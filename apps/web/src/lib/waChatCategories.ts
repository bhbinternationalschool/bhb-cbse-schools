/**
 * WhatsApp chat hub — audience categories for filtering inboxes & analytics.
 */

export type WaChatCategory =
  | "parent"
  | "staff"
  | "admission_enquiry"
  | "job_enquiry"
  | "vendor_enquiry"
  | "transport"
  | "fee_enquiry"
  | "meeting"
  | "field_survey"
  | "class_teacher"
  | "general";

export const WA_CHAT_CATEGORIES: {
  id: WaChatCategory;
  label: string;
  short: string;
  tone: string;
  description: string;
}[] = [
  {
    id: "parent",
    label: "Parents (SIS)",
    short: "Parents",
    tone: "teal",
    description: "Enrolled families — fees, homework, kids",
  },
  {
    id: "staff",
    label: "Staff / Leadership",
    short: "Staff",
    tone: "navy",
    description: "Employees, director, office desk",
  },
  {
    id: "class_teacher",
    label: "Class teachers",
    short: "Teachers",
    tone: "violet",
    description: "HW / notice drafts to class channels",
  },
  {
    id: "admission_enquiry",
    label: "Admission enquiry",
    short: "Admission",
    tone: "amber",
    description: "CRM leads & registration parents",
  },
  {
    id: "field_survey",
    label: "Field survey",
    short: "Survey",
    tone: "orange",
    description: "Survey team capture & GPS",
  },
  {
    id: "job_enquiry",
    label: "Job / career",
    short: "Jobs",
    tone: "sky",
    description: "Recruitment & HR enquiries",
  },
  {
    id: "vendor_enquiry",
    label: "Vendor / supplier",
    short: "Vendor",
    tone: "rose",
    description: "Accounts vendors & purchase",
  },
  {
    id: "transport",
    label: "Transport",
    short: "Transport",
    tone: "lime",
    description: "Bus routes, fleet, drivers",
  },
  {
    id: "fee_enquiry",
    label: "Fee enquiry",
    short: "Fees",
    tone: "emerald",
    description: "Fee questions (non-parent)",
  },
  {
    id: "meeting",
    label: "Meeting / visit",
    short: "Meetings",
    tone: "indigo",
    description: "Visit & appointment requests",
  },
  {
    id: "general",
    label: "General / other",
    short: "General",
    tone: "slate",
    description: "Uncategorised or help desk",
  },
];

export function waCategoryLabel(id: WaChatCategory): string {
  return WA_CHAT_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/** Map bot audience / unified flow → hub category. */
export function audienceToWaCategory(
  audience: string,
  flow?: string | null,
): WaChatCategory {
  const key = `${audience}|${flow || ""}`.toLowerCase();
  if (key.includes("sis_parent") || flow === "parent") return "parent";
  if (flow === "owner" || flow === "staff" || audience.includes("staff"))
    return "staff";
  if (key.includes("class_channel") || flow === "teacher") return "class_teacher";
  if (
    key.includes("crm") ||
    key.includes("admission") ||
    flow === "admission_lead"
  )
    return "admission_enquiry";
  if (key.includes("survey") || flow === "survey") return "field_survey";
  if (flow === "job" || key.includes("visitor_job")) return "job_enquiry";
  if (flow === "vendor" || key.includes("vendor")) return "vendor_enquiry";
  if (flow === "transport" || key.includes("transport")) return "transport";
  if (flow === "fee" || key.includes("visitor_fee")) return "fee_enquiry";
  if (flow === "meeting" || key.includes("visitor_meeting")) return "meeting";
  return "general";
}

export function visitorPurposeToCategory(
  purpose: string,
): WaChatCategory {
  switch (purpose) {
    case "admission":
      return "admission_enquiry";
    case "job":
      return "job_enquiry";
    case "vendor":
      return "vendor_enquiry";
    case "transport":
      return "transport";
    case "fee":
      return "fee_enquiry";
    case "meeting":
      return "meeting";
    default:
      return "general";
  }
}

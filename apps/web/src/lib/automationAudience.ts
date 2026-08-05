import type { AutomationModule } from "@/lib/automation";

export type AutomationAudiencePreset = {
  id: string;
  label: string;
  summary: string;
  /** Shown under the label in the picker */
  hint: string;
  modules: AutomationModule[] | "*";
};

export const AUTOMATION_AUDIENCE_PRESETS: AutomationAudiencePreset[] = [
  {
    id: "fee_overdue",
    label: "Overdue fee households",
    summary: "Households with overdue fees (stages S1–S4)",
    hint: "Parents with unpaid balances past due date",
    modules: ["fees"],
  },
  {
    id: "fee_due_soon",
    label: "Fees due in next 3 days",
    summary: "Dues within next 3 days",
    hint: "Soft reminder before due date",
    modules: ["fees"],
  },
  {
    id: "admission_followup",
    label: "Admission leads — follow-up due",
    summary: "Open leads with overdue follow-up",
    hint: "CRM leads where next follow-up date has passed",
    modules: ["admissions"],
  },
  {
    id: "admission_reg_fee",
    label: "Unpaid registration fee",
    summary: "Leads with unpaid/partial registration fee",
    hint: "Prospective parents who have not paid registration",
    modules: ["admissions"],
  },
  {
    id: "attendance_absent",
    label: "Absent today",
    summary: "Parents of students marked absent today",
    hint: "Triggered after attendance is saved",
    modules: ["attendance"],
  },
  {
    id: "homework_class",
    label: "Class parents",
    summary: "Class parents",
    hint: "Guardians of students in the homework class",
    modules: ["homework"],
  },
  {
    id: "exam_cohort",
    label: "Exam cohort parents",
    summary: "Exam cohort parents",
    hint: "Parents of students in the published exam group",
    modules: ["exams"],
  },
  {
    id: "ptm_eligible",
    label: "PTM eligible parents",
    summary: "PTM eligible parents",
    hint: "Parents who can book the open PTM slot",
    modules: ["ptm"],
  },
  {
    id: "leave_requester",
    label: "Leave requester",
    summary: "Leave requester / guardian",
    hint: "Guardian who submitted the leave request",
    modules: ["leave"],
  },
  {
    id: "vault_expiry",
    label: "Document expiry owners",
    summary: "Document owners / office",
    hint: "Staff or parents with documents expiring soon",
    modules: ["vault"],
  },
  {
    id: "notice_audience",
    label: "Notice audience",
    summary: "Notice audience",
    hint: "Recipients selected when the notice was published",
    modules: ["comms"],
  },
  {
    id: "campaign_queue",
    label: "Campaign queue",
    summary: "Queued campaign messages due now",
    hint: "Messages scheduled in admissions campaigns",
    modules: ["campaigns", "admissions"],
  },
  {
    id: "transport_route",
    label: "Transport route parents",
    summary: "Parents on selected transport route",
    hint: "Guardians of students assigned to a route",
    modules: ["transport"],
  },
  {
    id: "all_parents",
    label: "All active parents",
    summary: "All active parent/guardian contacts",
    hint: "Whole-school broadcast — use with care",
    modules: "*",
  },
  {
    id: "custom",
    label: "Custom description…",
    summary: "",
    hint: "Write your own short audience note for approvals",
    modules: "*",
  },
];

export function audiencePresetsForModule(
  module: AutomationModule,
): AutomationAudiencePreset[] {
  return AUTOMATION_AUDIENCE_PRESETS.filter(
    (p) => p.modules === "*" || p.modules.includes(module),
  );
}

export function findAudiencePresetBySummary(
  summary: string,
): AutomationAudiencePreset | null {
  const needle = summary.trim().toLowerCase();
  if (!needle) return null;
  return (
    AUTOMATION_AUDIENCE_PRESETS.find(
      (p) => p.id !== "custom" && p.summary.toLowerCase() === needle,
    ) || null
  );
}

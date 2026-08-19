/**
 * Admissions CRM + field survey report catalog.
 * Filters: dates, stage, source, class, beat, counsellor, fee, follow-up, locality.
 */

import { campaignAttribution, inrPaise, loadMarketingSpend } from "@/lib/marketingSpend";
import {
  ADMISSION_SOURCES,
  ADMISSION_STAGES,
  captureYear,
  followUpChannelLabel,
  followUpOutcomeLabel,
  funnelCounts,
  leadFollowUpBucket,
  listCaptureYears,
  listSurveyBeats,
  loadAdmissions,
  registrationBalancePaise,
  registrationCollectedPaise,
  sourceCounts,
  sourceLabel,
  stageLabel,
  type AdmissionLead,
  type AdmissionSource,
  type AdmissionStage,
  type AdmissionsState,
  type LeadFollowUpBucket,
  type RegistrationPaymentStatus,
} from "@/lib/admissions";
import {
  formatSurveyHours,
  sessionBreakMs,
  sessionWorkedMs,
  surveyAgentProductivity,
  surveyDayAnalytics,
} from "@/lib/fieldSurvey";
import { formatInr, loadMasters, type MastersState } from "@/lib/masters";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { TENANT } from "@/lib/types";

export type AdmissionReportFormat = "excel" | "pdf";

export type AdmissionReportCategory =
  | "downloads"
  | "analytics"
  | "crm"
  | "survey"
  | "registration";

export type AdmissionReportId =
  | "custom_download"
  | "lead_register"
  | "enquiry_open"
  | "registration_desk"
  | "admitted_list"
  | "lost_list"
  | "funnel_summary"
  | "source_summary"
  | "class_sought_summary"
  | "monthly_enquiry"
  | "capture_year_summary"
  | "locality_summary"
  | "counsellor_summary"
  | "campaign_attribution"
  | "overdue_follow_ups"
  | "due_today_follow_ups"
  | "follow_up_activity_log"
  | "unassigned_leads"
  | "survey_day_agents"
  | "survey_day_sessions"
  | "survey_beat_funnel"
  | "survey_captures"
  | "survey_agent_productivity"
  | "registration_fee_status"
  | "unpaid_registration"
  | "registration_payments"
  | "paid_registration";

export type AdmissionReportDef = {
  id: AdmissionReportId;
  category: AdmissionReportCategory;
  label: string;
  hint?: string;
};

export const ADMISSION_REPORT_CATEGORIES: {
  id: AdmissionReportCategory;
  title: string;
  headerClass: string;
}[] = [
  { id: "downloads", title: "Downloads", headerClass: "bg-[#43a047]" },
  { id: "analytics", title: "Analytics", headerClass: "bg-[#ef6c00]" },
  { id: "crm", title: "CRM follow-up", headerClass: "bg-[#1565c0]" },
  { id: "survey", title: "Field survey", headerClass: "bg-[#c2410c]" },
  { id: "registration", title: "Registration fee", headerClass: "bg-[#0f766e]" },
];

export const ADMISSION_REPORTS: AdmissionReportDef[] = [
  {
    id: "custom_download",
    category: "downloads",
    label: "Custom lead download",
    hint: "Pick columns, then Excel / PDF",
  },
  {
    id: "lead_register",
    category: "downloads",
    label: "Full lead register",
    hint: "All filtered leads (excl. lost unless included)",
  },
  {
    id: "enquiry_open",
    category: "downloads",
    label: "Open enquiries",
  },
  {
    id: "registration_desk",
    category: "downloads",
    label: "Registration / verified desk",
  },
  {
    id: "admitted_list",
    category: "downloads",
    label: "Admitted list",
  },
  {
    id: "lost_list",
    category: "downloads",
    label: "Lost leads",
  },
  {
    id: "funnel_summary",
    category: "analytics",
    label: "Stage funnel summary",
  },
  {
    id: "source_summary",
    category: "analytics",
    label: "Source-wise summary",
  },
  {
    id: "class_sought_summary",
    category: "analytics",
    label: "Class sought summary",
  },
  {
    id: "monthly_enquiry",
    category: "analytics",
    label: "Monthly enquiry / capture",
    hint: "By lead capture month",
  },
  {
    id: "capture_year_summary",
    category: "analytics",
    label: "Capture year summary",
  },
  {
    id: "locality_summary",
    category: "analytics",
    label: "Locality / area summary",
  },
  {
    id: "counsellor_summary",
    category: "analytics",
    label: "Counsellor / assignee summary",
  },
  {
    id: "campaign_attribution",
    category: "analytics",
    label: "Campaign & source attribution",
    hint: "Leads → registered → enrolled per source and ad campaign; cost per lead / enrolment from Marketing → spend",
  },
  {
    id: "overdue_follow_ups",
    category: "crm",
    label: "Overdue follow-ups",
  },
  {
    id: "due_today_follow_ups",
    category: "crm",
    label: "Due today follow-ups",
  },
  {
    id: "follow_up_activity_log",
    category: "crm",
    label: "Follow-up activity log",
    hint: "Every call / visit note",
  },
  {
    id: "unassigned_leads",
    category: "crm",
    label: "Unassigned leads",
  },
  {
    id: "survey_day_agents",
    category: "survey",
    label: "Survey day — agent timesheet",
    hint: "Uses Survey date filter",
  },
  {
    id: "survey_day_sessions",
    category: "survey",
    label: "Survey day — sessions + GPS",
  },
  {
    id: "survey_beat_funnel",
    category: "survey",
    label: "Beat funnel (all time / filters)",
  },
  {
    id: "survey_captures",
    category: "survey",
    label: "Field survey household captures",
  },
  {
    id: "survey_agent_productivity",
    category: "survey",
    label: "Agent productivity (survey date)",
  },
  {
    id: "registration_fee_status",
    category: "registration",
    label: "Registration fee status",
  },
  {
    id: "unpaid_registration",
    category: "registration",
    label: "Unpaid / partial registration",
  },
  {
    id: "registration_payments",
    category: "registration",
    label: "Registration payment vouchers",
  },
  {
    id: "paid_registration",
    category: "registration",
    label: "Fully paid registration",
  },
];

export type AdmissionFeeFilter =
  | "any"
  | "paid"
  | "unpaid"
  | "partial"
  | "pending"
  | "none"
  | "waived";

export type AdmissionReportFilters = {
  fromDate?: string;
  toDate?: string;
  /** YYYY-MM-DD — field survey day reports */
  surveyDate?: string;
  stage?: AdmissionStage | "all" | "open";
  source?: AdmissionSource | "all";
  academicYearCode?: string;
  captureYear?: string;
  classSoughtId?: string;
  beatId?: string;
  assignedTo?: string;
  feeStatus?: AdmissionFeeFilter;
  followUpBucket?: LeadFollowUpBucket | "any";
  localityContains?: string;
  includeLost?: boolean;
  customColumns?: string[];
  admissions?: AdmissionsState;
  masters?: MastersState;
  format: AdmissionReportFormat;
};

export const CUSTOM_LEAD_COLUMNS: { key: string; header: string }[] = [
  { key: "enquiryNo", header: "Enquiry no" },
  { key: "applicationNo", header: "Application no" },
  { key: "leadDate", header: "Lead date" },
  { key: "captureYear", header: "Capture year" },
  { key: "academicYear", header: "Academic year" },
  { key: "stage", header: "Stage" },
  { key: "source", header: "Source" },
  { key: "childName", header: "Child" },
  { key: "dob", header: "DOB" },
  { key: "gender", header: "Gender" },
  { key: "classSought", header: "Class sought" },
  { key: "classAdmitted", header: "Class admitted" },
  { key: "guardianName", header: "Guardian" },
  { key: "motherName", header: "Mother" },
  { key: "mobile", header: "Mobile" },
  { key: "whatsapp", header: "WhatsApp" },
  { key: "email", header: "Email" },
  { key: "locality", header: "Locality" },
  { key: "address", header: "Address" },
  { key: "city", header: "City" },
  { key: "pincode", header: "Pincode" },
  { key: "beat", header: "Survey beat" },
  { key: "assignedTo", header: "Assigned to" },
  { key: "nextFollowUpAt", header: "Next follow-up" },
  { key: "followUpBucket", header: "Follow-up bucket" },
  { key: "transport", header: "Transport interest" },
  { key: "previousSchool", header: "Previous school" },
  { key: "registrationDate", header: "Registration date" },
  { key: "feeStatus", header: "Reg. fee status" },
  { key: "feeAmount", header: "Reg. fee amount" },
  { key: "feeCollected", header: "Reg. fee collected" },
  { key: "feeBalance", header: "Reg. fee balance" },
  { key: "admissionNo", header: "Admission no" },
  { key: "admissionDate", header: "Admission date" },
  { key: "lostReason", header: "Lost reason" },
  { key: "campaignNote", header: "Campaign / note" },
  { key: "note", header: "Office note" },
  { key: "createdBy", header: "Created by" },
  { key: "createdAt", header: "Created at" },
];

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function classNameOf(masters: MastersState, id: string): string {
  if (!id) return "";
  return masters.classes.find((c) => c.id === id)?.name || id;
}

function beatNameOf(state: AdmissionsState, beatId: string): string {
  if (!beatId) return "";
  const b = (state.surveyBeats || []).find((x) => x.id === beatId);
  return b ? `${b.code ? `${b.code} · ` : ""}${b.name}` : beatId;
}

function feeStatusOf(
  state: AdmissionsState,
  lead: AdmissionLead,
): RegistrationPaymentStatus {
  return lead.registrationPaymentStatus || "none";
}

function inr(paise: number): string {
  return formatInr(paise);
}

function leadMatchesFilters(
  state: AdmissionsState,
  lead: AdmissionLead,
  f: Omit<AdmissionReportFilters, "format" | "customColumns" | "admissions" | "masters">,
): boolean {
  if (!f.includeLost && lead.stage === "lost") return false;

  const leadDay = (lead.leadDate || lead.createdAt || "").slice(0, 10);
  if (f.fromDate && leadDay && leadDay < f.fromDate) return false;
  if (f.toDate && leadDay && leadDay > f.toDate) return false;

  if (f.captureYear && captureYear(lead) !== f.captureYear) return false;
  if (f.academicYearCode && lead.academicYearCode !== f.academicYearCode) {
    return false;
  }

  if (f.stage && f.stage !== "all") {
    if (f.stage === "open") {
      if (lead.stage === "enrolled" || lead.stage === "lost") return false;
    } else if (lead.stage !== f.stage) return false;
  }

  if (f.source && f.source !== "all" && lead.source !== f.source) return false;

  if (f.classSoughtId) {
    if (
      lead.classSoughtId !== f.classSoughtId &&
      lead.classAdmittedId !== f.classSoughtId
    ) {
      return false;
    }
  }

  if (f.beatId && lead.surveyBeatId !== f.beatId) return false;

  if (f.assignedTo) {
    const q = f.assignedTo.trim().toLowerCase();
    const assigned = (lead.assignedTo || "").trim().toLowerCase();
    if (!assigned.includes(q) && assigned !== q) return false;
  }

  if (f.localityContains) {
    const q = f.localityContains.toLowerCase();
    const hay = `${lead.locality} ${lead.address} ${lead.city} ${lead.campaignNote}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  if (f.followUpBucket && f.followUpBucket !== "any") {
    if (leadFollowUpBucket(lead) !== f.followUpBucket) return false;
  }

  if (f.feeStatus && f.feeStatus !== "any") {
    const st = feeStatusOf(state, lead);
    const bal = registrationBalancePaise(state, lead);
    if (f.feeStatus === "paid") {
      if (st !== "paid" && !(lead.registrationFeePaid && bal <= 0)) return false;
    } else if (f.feeStatus === "waived") {
      if (st !== "waived") return false;
    } else if (f.feeStatus === "partial") {
      if (st !== "partial") return false;
    } else if (f.feeStatus === "pending") {
      if (st !== "pending") return false;
    } else if (f.feeStatus === "none") {
      if (st !== "none" && lead.registrationFeeAmountPaise > 0) return false;
    } else if (f.feeStatus === "unpaid") {
      if (st === "paid" || st === "waived") return false;
      if (
        !(
          bal > 0 ||
          st === "pending" ||
          st === "partial" ||
          (st === "none" && lead.registrationFeeAmountPaise > 0)
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

export function filterAdmissionLeads(
  state: AdmissionsState,
  filters: Omit<
    AdmissionReportFilters,
    "format" | "customColumns" | "admissions" | "masters"
  >,
): AdmissionLead[] {
  return state.leads
    .filter((l) => leadMatchesFilters(state, l, filters))
    .sort((a, b) =>
      (b.leadDate || b.createdAt).localeCompare(a.leadDate || a.createdAt),
    );
}

function filterNote(
  f: AdmissionReportFilters,
  masters: MastersState,
  state: AdmissionsState,
): string {
  return describeFilters([
    f.fromDate ? `From ${f.fromDate}` : null,
    f.toDate ? `To ${f.toDate}` : null,
    f.surveyDate ? `Survey day ${f.surveyDate}` : null,
    f.captureYear ? `Capture ${f.captureYear}` : null,
    f.academicYearCode ? `AY ${f.academicYearCode}` : null,
    f.stage && f.stage !== "all"
      ? f.stage === "open"
        ? "Open pipeline"
        : stageLabel(f.stage)
      : null,
    f.source && f.source !== "all" ? sourceLabel(f.source) : null,
    f.classSoughtId
      ? `Class ${classNameOf(masters, f.classSoughtId)}`
      : null,
    f.beatId ? `Beat ${beatNameOf(state, f.beatId)}` : null,
    f.assignedTo ? `Assignee ${f.assignedTo}` : null,
    f.feeStatus && f.feeStatus !== "any" ? `Fee ${f.feeStatus}` : null,
    f.followUpBucket && f.followUpBucket !== "any"
      ? `Follow-up ${f.followUpBucket}`
      : null,
    f.localityContains ? `Locality ~${f.localityContains}` : null,
    f.includeLost ? "Includes lost" : null,
  ]);
}

function leadRow(
  state: AdmissionsState,
  masters: MastersState,
  lead: AdmissionLead,
): Record<string, string | number> {
  const bal = registrationBalancePaise(state, lead);
  const collected = registrationCollectedPaise(state, lead.id);
  return {
    enquiryNo: lead.enquiryNo || "",
    applicationNo: lead.applicationNo || "",
    leadDate: (lead.leadDate || "").slice(0, 10),
    captureYear: captureYear(lead),
    academicYear: lead.academicYearCode || "",
    stage: stageLabel(lead.stage),
    source: sourceLabel(lead.source),
    childName: lead.childName || "",
    dob: (lead.dob || "").slice(0, 10),
    gender: lead.gender || "",
    classSought: classNameOf(masters, lead.classSoughtId),
    classAdmitted: classNameOf(masters, lead.classAdmittedId),
    guardianName: lead.guardianName || "",
    motherName: lead.motherName || "",
    mobile: lead.mobile || "",
    whatsapp: lead.whatsapp || "",
    email: lead.email || "",
    locality: lead.locality || "",
    address: lead.address || "",
    city: lead.city || "",
    state: lead.state || "",
    pincode: lead.pincode || "",
    beat: beatNameOf(state, lead.surveyBeatId),
    assignedTo: lead.assignedTo || "",
    nextFollowUpAt: (lead.nextFollowUpAt || "").slice(0, 10),
    followUpBucket: leadFollowUpBucket(lead),
    transport: lead.transportInterest || "",
    previousSchool: lead.previousSchool || "",
    registrationDate: (lead.registrationDate || "").slice(0, 10),
    feeStatus: feeStatusOf(state, lead),
    feeAmount: inr(lead.registrationFeeAmountPaise || 0),
    feeCollected: inr(collected),
    feeBalance: inr(bal),
    admissionNo: lead.admissionNo || "",
    admissionDate: (lead.admissionDate || "").slice(0, 10),
    lostReason: lead.lostReason || "",
    campaignNote: lead.campaignNote || "",
    note: lead.note || "",
    createdBy: lead.createdBy || "",
    createdAt: (lead.createdAt || "").slice(0, 19).replace("T", " "),
  };
}

const LEAD_REGISTER_COLS: ReportColumn[] = [
  { key: "enquiryNo", header: "Enquiry", width: 1.1 },
  { key: "leadDate", header: "Date", width: 0.9 },
  { key: "stage", header: "Stage", width: 0.9 },
  { key: "source", header: "Source", width: 0.9 },
  { key: "childName", header: "Child", width: 1.3 },
  { key: "classSought", header: "Class", width: 0.8 },
  { key: "guardianName", header: "Guardian", width: 1.2 },
  { key: "mobile", header: "Mobile", width: 1 },
  { key: "locality", header: "Locality", width: 1.1 },
  { key: "assignedTo", header: "Assignee", width: 1 },
  { key: "nextFollowUpAt", header: "Next FU", width: 0.9 },
  { key: "feeStatus", header: "Fee", width: 0.8 },
];

function exportLeads(
  title: string,
  fileBase: string,
  leads: AdmissionLead[],
  state: AdmissionsState,
  masters: MastersState,
  filters: AdmissionReportFilters,
  columns: ReportColumn[] = LEAD_REGISTER_COLS,
): { ok: true; message: string } | { ok: false; error: string } {
  const rows = leads.map((l) => leadRow(state, masters, l));
  const r = exportFilterReport(
    {
      title,
      subtitle: `${TENANT.shortName} · Admissions`,
      filterNote: filterNote(filters, masters, state),
      columns,
      rows,
      fileBaseName: fileBase,
    },
    filters.format,
  );
  if (!r.ok) return r;
  return { ok: true, message: `${title}: ${rows.length} row(s) exported` };
}

export function listAssigneeOptions(state: AdmissionsState): string[] {
  const set = new Set<string>();
  for (const l of state.leads) {
    const a = (l.assignedTo || "").trim();
    if (a) set.add(a);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function runAdmissionReport(
  id: AdmissionReportId,
  filters: AdmissionReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  const state = filters.admissions ?? loadAdmissions();
  const masters = filters.masters ?? loadMasters();
  const base = {
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    surveyDate: filters.surveyDate,
    stage: filters.stage,
    source: filters.source,
    academicYearCode: filters.academicYearCode,
    captureYear: filters.captureYear,
    classSoughtId: filters.classSoughtId,
    beatId: filters.beatId,
    assignedTo: filters.assignedTo,
    feeStatus: filters.feeStatus,
    followUpBucket: filters.followUpBucket,
    localityContains: filters.localityContains,
    includeLost: filters.includeLost,
  };
  const filtered = filterAdmissionLeads(state, base);
  const note = filterNote(filters, masters, state);

  switch (id) {
    case "custom_download": {
      const keys =
        filters.customColumns && filters.customColumns.length > 0
          ? filters.customColumns
          : CUSTOM_LEAD_COLUMNS.slice(0, 12).map((c) => c.key);
      const columns: ReportColumn[] = keys.map((key) => {
        const def = CUSTOM_LEAD_COLUMNS.find((c) => c.key === key);
        return { key, header: def?.header || key, width: 1 };
      });
      if (!columns.length) {
        return { ok: false, error: "Select at least one column" };
      }
      return exportLeads(
        "Custom lead download",
        "adm_custom_leads",
        filtered,
        state,
        masters,
        filters,
        columns,
      );
    }
    case "lead_register":
      return exportLeads(
        "Full lead register",
        "adm_lead_register",
        filtered,
        state,
        masters,
        filters,
      );
    case "enquiry_open":
      return exportLeads(
        "Open enquiries",
        "adm_enquiry_open",
        filtered.filter((l) => l.stage === "enquiry"),
        state,
        masters,
        filters,
      );
    case "registration_desk":
      return exportLeads(
        "Registration / verified",
        "adm_registration_desk",
        filtered.filter(
          (l) => l.stage === "applied" || l.stage === "verified",
        ),
        state,
        masters,
        filters,
        [
          ...LEAD_REGISTER_COLS,
          { key: "applicationNo", header: "App no", width: 1 },
          { key: "feeAmount", header: "Fee amt", width: 0.9 },
          { key: "feeBalance", header: "Balance", width: 0.9 },
          { key: "registrationDate", header: "Reg date", width: 0.9 },
        ],
      );
    case "admitted_list":
      return exportLeads(
        "Admitted students",
        "adm_admitted",
        filtered.filter((l) => l.stage === "enrolled"),
        state,
        masters,
        filters,
        [
          { key: "admissionNo", header: "Adm no", width: 1 },
          { key: "admissionDate", header: "Adm date", width: 0.9 },
          { key: "childName", header: "Student", width: 1.3 },
          { key: "classAdmitted", header: "Class", width: 0.9 },
          { key: "guardianName", header: "Guardian", width: 1.2 },
          { key: "mobile", header: "Mobile", width: 1 },
          { key: "source", header: "Source", width: 0.9 },
          { key: "leadDate", header: "Lead date", width: 0.9 },
        ],
      );
    case "lost_list": {
      const lost = filterAdmissionLeads(state, {
        ...base,
        includeLost: true,
        stage: "lost",
      });
      return exportLeads(
        "Lost leads",
        "adm_lost",
        lost,
        state,
        masters,
        { ...filters, includeLost: true, stage: "lost" },
        [
          ...LEAD_REGISTER_COLS.filter((c) => c.key !== "feeStatus"),
          { key: "lostReason", header: "Lost reason", width: 1.4 },
        ],
      );
    }
    case "funnel_summary": {
      const counts = funnelCounts(state);
      // Recompute funnel on filtered set for accuracy with filters
      const byStage: Record<AdmissionStage, number> = {
        enquiry: 0,
        applied: 0,
        verified: 0,
        enrolled: 0,
        lost: 0,
      };
      const pool = filters.includeLost
        ? filterAdmissionLeads(state, { ...base, includeLost: true })
        : filtered;
      for (const l of pool) byStage[l.stage] += 1;
      const rows = ADMISSION_STAGES.map((s) => ({
        stage: s.label,
        count: byStage[s.value],
        unfiltered: counts[s.value],
      }));
      const r = exportFilterReport(
        {
          title: "Stage funnel summary",
          subtitle: `${TENANT.shortName} · Admissions`,
          filterNote: note,
          columns: [
            { key: "stage", header: "Stage", width: 1.4 },
            { key: "count", header: "Filtered count", width: 1, align: "right" },
            {
              key: "unfiltered",
              header: "All-time total",
              width: 1,
              align: "right",
            },
          ],
          rows,
          fileBaseName: "adm_funnel",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Funnel: ${pool.length} lead(s) in filter` }
        : r;
    }
    case "source_summary": {
      const map = new Map<string, number>();
      for (const l of filtered) {
        map.set(l.source, (map.get(l.source) || 0) + 1);
      }
      const all = sourceCounts(state);
      const rows = ADMISSION_SOURCES.map((s) => ({
        source: s.label,
        count: map.get(s.value) || 0,
        allTimeOpen: all[s.value] || 0,
      })).filter((r) => r.count > 0 || r.allTimeOpen > 0);
      const r = exportFilterReport(
        {
          title: "Source-wise summary",
          subtitle: `${TENANT.shortName} · Admissions`,
          filterNote: note,
          columns: [
            { key: "source", header: "Source", width: 1.4 },
            { key: "count", header: "Filtered", width: 1, align: "right" },
            {
              key: "allTimeOpen",
              header: "All non-lost",
              width: 1,
              align: "right",
            },
          ],
          rows,
          fileBaseName: "adm_sources",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Sources: ${rows.length} row(s)` }
        : r;
    }
    case "class_sought_summary": {
      const map = new Map<string, { className: string; count: number; open: number; registered: number; admitted: number }>();
      for (const l of filtered) {
        const id = l.classSoughtId || l.classAdmittedId || "_none";
        const cur = map.get(id) || {
          className: classNameOf(masters, id === "_none" ? "" : id) || "Unspecified",
          count: 0,
          open: 0,
          registered: 0,
          admitted: 0,
        };
        cur.count += 1;
        if (l.stage === "enquiry") cur.open += 1;
        if (l.stage === "applied" || l.stage === "verified") cur.registered += 1;
        if (l.stage === "enrolled") cur.admitted += 1;
        map.set(id, cur);
      }
      const rows = [...map.values()].sort((a, b) => b.count - a.count);
      const r = exportFilterReport(
        {
          title: "Class sought summary",
          subtitle: `${TENANT.shortName} · Admissions`,
          filterNote: note,
          columns: [
            { key: "className", header: "Class", width: 1.4 },
            { key: "count", header: "Total", width: 0.8, align: "right" },
            { key: "open", header: "Open", width: 0.8, align: "right" },
            { key: "registered", header: "Registered+", width: 1, align: "right" },
            { key: "admitted", header: "Admitted", width: 0.8, align: "right" },
          ],
          rows,
          fileBaseName: "adm_class_sought",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Class summary: ${rows.length} class(es)` }
        : r;
    }
    case "monthly_enquiry": {
      const map = new Map<string, number>();
      for (const l of filtered) {
        const d = (l.leadDate || l.createdAt || "").slice(0, 7);
        if (!d) continue;
        map.set(d, (map.get(d) || 0) + 1);
      }
      const rows = [...map.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([month, count]) => ({ month, count }));
      const r = exportFilterReport(
        {
          title: "Monthly enquiry / capture",
          subtitle: `${TENANT.shortName} · Admissions`,
          filterNote: note,
          columns: [
            { key: "month", header: "Month", width: 1.2 },
            { key: "count", header: "Leads", width: 1, align: "right" },
          ],
          rows,
          fileBaseName: "adm_monthly",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Monthly: ${rows.length} month(s)` }
        : r;
    }
    case "capture_year_summary": {
      const years = listCaptureYears(state);
      const map = new Map<string, number>();
      for (const l of filtered) {
        const y = captureYear(l);
        map.set(y, (map.get(y) || 0) + 1);
      }
      const rows = (years.length ? years : [...map.keys()])
        .map((y) => ({ year: y, count: map.get(y) || 0 }))
        .filter((r) => r.count > 0);
      const r = exportFilterReport(
        {
          title: "Capture year summary",
          subtitle: `${TENANT.shortName} · Admissions`,
          filterNote: note,
          columns: [
            { key: "year", header: "Capture year", width: 1.2 },
            { key: "count", header: "Leads", width: 1, align: "right" },
          ],
          rows,
          fileBaseName: "adm_capture_year",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Capture years: ${rows.length}` }
        : r;
    }
    case "locality_summary": {
      const map = new Map<string, number>();
      for (const l of filtered) {
        const key = (l.locality || l.city || "—").trim() || "—";
        map.set(key, (map.get(key) || 0) + 1);
      }
      const rows = [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([locality, count]) => ({ locality, count }));
      const r = exportFilterReport(
        {
          title: "Locality / area summary",
          subtitle: `${TENANT.shortName} · Admissions`,
          filterNote: note,
          columns: [
            { key: "locality", header: "Locality", width: 2 },
            { key: "count", header: "Leads", width: 1, align: "right" },
          ],
          rows,
          fileBaseName: "adm_locality",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Localities: ${rows.length}` }
        : r;
    }
    case "campaign_attribution": {
      const rows = campaignAttribution(filtered, loadMarketingSpend().entries).map((r) => ({
        level: r.level === "source" ? "Source" : "Campaign",
        label: r.label,
        source: r.source,
        leads: r.leads,
        registered: r.registered,
        enrolled: r.enrolled,
        lost: r.lost,
        conversion: `${r.conversionPct}%`,
        spend: inrPaise(r.spendPaise),
        cpl: inrPaise(r.costPerLeadPaise),
        cpe: inrPaise(r.costPerEnrolmentPaise),
      }));
      const r = exportFilterReport(
        {
          title: "Campaign & source attribution",
          subtitle: `${TENANT.shortName} · Admissions · spend as recorded in Marketing`,
          filterNote: note,
          columns: [
            { key: "level", header: "Level", width: 0.8 },
            { key: "label", header: "Source / campaign", width: 1.8 },
            { key: "leads", header: "Leads", width: 0.7, align: "right" },
            { key: "registered", header: "Registered", width: 0.9, align: "right" },
            { key: "enrolled", header: "Enrolled", width: 0.8, align: "right" },
            { key: "lost", header: "Lost", width: 0.6, align: "right" },
            { key: "conversion", header: "Conv.", width: 0.7, align: "right" },
            { key: "spend", header: "Spend", width: 0.9, align: "right" },
            { key: "cpl", header: "Cost / lead", width: 0.9, align: "right" },
            { key: "cpe", header: "Cost / enrolment", width: 1, align: "right" },
          ],
          rows,
          fileBaseName: "adm_attribution",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Attribution · ${rows.length} rows` }
        : r;
    }
    case "counsellor_summary": {
      const map = new Map<
        string,
        { assignee: string; total: number; open: number; overdue: number; dueToday: number }
      >();
      for (const l of filtered) {
        const key = (l.assignedTo || "").trim() || "Unassigned";
        const cur = map.get(key) || {
          assignee: key,
          total: 0,
          open: 0,
          overdue: 0,
          dueToday: 0,
        };
        cur.total += 1;
        if (l.stage !== "enrolled" && l.stage !== "lost") cur.open += 1;
        const b = leadFollowUpBucket(l);
        if (b === "overdue") cur.overdue += 1;
        if (b === "due_today") cur.dueToday += 1;
        map.set(key, cur);
      }
      const rows = [...map.values()].sort((a, b) => b.total - a.total);
      const r = exportFilterReport(
        {
          title: "Counsellor / assignee summary",
          subtitle: `${TENANT.shortName} · Admissions`,
          filterNote: note,
          columns: [
            { key: "assignee", header: "Assignee", width: 1.5 },
            { key: "total", header: "Leads", width: 0.8, align: "right" },
            { key: "open", header: "Open", width: 0.8, align: "right" },
            { key: "overdue", header: "Overdue FU", width: 1, align: "right" },
            { key: "dueToday", header: "Due today", width: 1, align: "right" },
          ],
          rows,
          fileBaseName: "adm_counsellor",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Assignees: ${rows.length}` }
        : r;
    }
    case "overdue_follow_ups":
      return exportLeads(
        "Overdue follow-ups",
        "adm_fu_overdue",
        filtered.filter((l) => leadFollowUpBucket(l) === "overdue"),
        state,
        masters,
        filters,
      );
    case "due_today_follow_ups":
      return exportLeads(
        "Due today follow-ups",
        "adm_fu_today",
        filtered.filter((l) => leadFollowUpBucket(l) === "due_today"),
        state,
        masters,
        filters,
      );
    case "unassigned_leads":
      return exportLeads(
        "Unassigned leads",
        "adm_unassigned",
        filtered.filter((l) => !(l.assignedTo || "").trim()),
        state,
        masters,
        filters,
      );
    case "follow_up_activity_log": {
      const rows: Record<string, string>[] = [];
      for (const l of filtered) {
        for (const fu of l.followUps || []) {
          const day = (fu.at || "").slice(0, 10);
          if (filters.fromDate && day && day < filters.fromDate) continue;
          if (filters.toDate && day && day > filters.toDate) continue;
          rows.push({
            at: (fu.at || "").slice(0, 19).replace("T", " "),
            enquiryNo: l.enquiryNo || "",
            childName: l.childName || "",
            mobile: l.mobile || "",
            stage: stageLabel(l.stage),
            channel: followUpChannelLabel(fu.channel),
            outcome: followUpOutcomeLabel(fu.outcome),
            nextFollowUpAt: (fu.nextFollowUpAt || "").slice(0, 10),
            by: fu.by || "",
            note: fu.note || "",
          });
        }
      }
      rows.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
      const r = exportFilterReport(
        {
          title: "Follow-up activity log",
          subtitle: `${TENANT.shortName} · Admissions`,
          filterNote: note,
          columns: [
            { key: "at", header: "When", width: 1.2 },
            { key: "enquiryNo", header: "Enquiry", width: 1 },
            { key: "childName", header: "Child", width: 1.2 },
            { key: "mobile", header: "Mobile", width: 1 },
            { key: "channel", header: "Channel", width: 0.9 },
            { key: "outcome", header: "Outcome", width: 1 },
            { key: "nextFollowUpAt", header: "Next FU", width: 0.9 },
            { key: "by", header: "By", width: 1 },
            { key: "note", header: "Note", width: 1.5 },
          ],
          rows,
          fileBaseName: "adm_fu_log",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Follow-up log: ${rows.length} row(s)` }
        : r;
    }
    case "survey_day_agents": {
      const date = filters.surveyDate || todayYmd();
      const day = surveyDayAnalytics(state, date);
      const rows = day.byAgent.map((a) => ({
        agent: a.agentName,
        status: a.status,
        beat: beatNameOf(state, a.beatId),
        worked: formatSurveyHours(a.workedMs),
        break: formatSurveyHours(a.breakMs),
        captures: a.captures,
        startGps: a.startLabel,
        endGps: a.endLabel,
        salary: a.salaryLabel,
      }));
      const r = exportFilterReport(
        {
          title: `Survey day agents · ${date}`,
          subtitle: `${TENANT.shortName} · Field survey`,
          filterNote: note,
          columns: [
            { key: "agent", header: "Agent", width: 1.3 },
            { key: "status", header: "Status", width: 0.9 },
            { key: "beat", header: "Beat", width: 1.2 },
            { key: "worked", header: "Worked", width: 0.8 },
            { key: "break", header: "Break", width: 0.8 },
            { key: "captures", header: "Captures", width: 0.8, align: "right" },
            { key: "startGps", header: "Start GPS", width: 1.2 },
            { key: "endGps", header: "End GPS", width: 1.2 },
            { key: "salary", header: "Salary day", width: 1.2 },
          ],
          rows,
          fileBaseName: "adm_survey_agents",
        },
        filters.format,
      );
      return r.ok
        ? {
            ok: true,
            message: `Survey agents ${date}: ${rows.length} · ${day.captures} capture(s)`,
          }
        : r;
    }
    case "survey_day_sessions": {
      const date = filters.surveyDate || todayYmd();
      const sessions = (state.surveySessions || []).filter((s) => s.date === date);
      const rows = sessions.map((s) => ({
        agent: s.agentName,
        beat: beatNameOf(state, s.beatId),
        status: s.status,
        started: (s.startedAt || "").slice(0, 19).replace("T", " "),
        ended: (s.endedAt || "").slice(0, 19).replace("T", " ") || "—",
        worked: formatSurveyHours(sessionWorkedMs(s)),
        break: formatSurveyHours(sessionBreakMs(s)),
        breaks: String(s.breaks?.length || 0),
        startGps: s.startGeo
          ? `${s.startGeo.lat.toFixed(5)}, ${s.startGeo.lng.toFixed(5)}`
          : "—",
        endGps: s.endGeo
          ? `${s.endGeo.lat.toFixed(5)}, ${s.endGeo.lng.toFixed(5)}`
          : "—",
      }));
      const r = exportFilterReport(
        {
          title: `Survey sessions · ${date}`,
          subtitle: `${TENANT.shortName} · Field survey`,
          filterNote: note,
          columns: [
            { key: "agent", header: "Agent", width: 1.2 },
            { key: "beat", header: "Beat", width: 1.2 },
            { key: "status", header: "Status", width: 0.8 },
            { key: "started", header: "Started", width: 1.2 },
            { key: "ended", header: "Ended", width: 1.2 },
            { key: "worked", header: "Worked", width: 0.8 },
            { key: "break", header: "Break", width: 0.8 },
            { key: "breaks", header: "Breaks#", width: 0.6, align: "right" },
            { key: "startGps", header: "Start GPS", width: 1.3 },
            { key: "endGps", header: "End GPS", width: 1.3 },
          ],
          rows,
          fileBaseName: "adm_survey_sessions",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Sessions ${date}: ${rows.length}` }
        : r;
    }
    case "survey_beat_funnel": {
      let beats = listSurveyBeats(state);
      if (filters.beatId) {
        beats = beats.filter((b) => b.beatId === filters.beatId);
      }
      // Optionally restrict counts by filtered survey leads
      const surveyLeads = filtered.filter((l) => l.source === "field_survey");
      const rows = beats.map((b) => {
        const subset = surveyLeads.filter(
          (l) =>
            l.surveyBeatId === b.beatId ||
            (!l.surveyBeatId &&
              (l.campaignNote || l.locality) === b.beat),
        );
        const useFilter = !!(
          filters.fromDate ||
          filters.toDate ||
          filters.captureYear ||
          filters.stage ||
          filters.classSoughtId ||
          filters.assignedTo
        );
        const count = useFilter ? subset.length : b.count;
        const open = useFilter
          ? subset.filter((l) => l.stage === "enquiry").length
          : b.open;
        const registered = useFilter
          ? subset.filter(
              (l) => l.stage === "applied" || l.stage === "verified",
            ).length
          : b.registered;
        const admitted = useFilter
          ? subset.filter((l) => l.stage === "enrolled").length
          : b.admitted;
        const pct =
          b.target > 0
            ? Math.min(100, Math.round((count / b.target) * 100))
            : 0;
        return {
          beat: b.beat,
          target: b.target,
          captured: count,
          pct: `${pct}%`,
          open,
          registered,
          admitted,
        };
      });
      const r = exportFilterReport(
        {
          title: "Survey beat funnel",
          subtitle: `${TENANT.shortName} · Field survey`,
          filterNote: note,
          columns: [
            { key: "beat", header: "Beat", width: 1.4 },
            { key: "target", header: "Target", width: 0.8, align: "right" },
            { key: "captured", header: "Captured", width: 0.9, align: "right" },
            { key: "pct", header: "%", width: 0.6, align: "right" },
            { key: "open", header: "Open", width: 0.7, align: "right" },
            { key: "registered", header: "Reg+", width: 0.7, align: "right" },
            { key: "admitted", header: "Admitted", width: 0.8, align: "right" },
          ],
          rows,
          fileBaseName: "adm_survey_beats",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Beats: ${rows.length}` }
        : r;
    }
    case "survey_captures":
      return exportLeads(
        "Field survey captures",
        "adm_survey_captures",
        filtered.filter((l) => l.source === "field_survey"),
        state,
        masters,
        filters,
        [
          { key: "leadDate", header: "Date", width: 0.9 },
          { key: "beat", header: "Beat", width: 1.2 },
          { key: "childName", header: "Child", width: 1.2 },
          { key: "classSought", header: "Class", width: 0.8 },
          { key: "guardianName", header: "Guardian", width: 1.2 },
          { key: "mobile", header: "Mobile", width: 1 },
          { key: "locality", header: "Locality", width: 1.1 },
          { key: "stage", header: "Stage", width: 0.9 },
          { key: "assignedTo", header: "Agent", width: 1 },
          { key: "createdBy", header: "Captured by", width: 1 },
        ],
      );
    case "survey_agent_productivity": {
      const date = filters.surveyDate || todayYmd();
      const rows = surveyAgentProductivity(state, date).map((a) => ({
        agent: a.agentName,
        beat: beatNameOf(state, a.beatId),
        captures: a.captures,
        open: a.open,
        registered: a.registered,
        admitted: a.admitted,
        checkedIn: a.checkedIn ? "Yes" : "No",
      }));
      const r = exportFilterReport(
        {
          title: `Agent productivity · ${date}`,
          subtitle: `${TENANT.shortName} · Field survey`,
          filterNote: note,
          columns: [
            { key: "agent", header: "Agent", width: 1.4 },
            { key: "beat", header: "Beat", width: 1.2 },
            { key: "captures", header: "Captures", width: 0.9, align: "right" },
            { key: "open", header: "Open", width: 0.7, align: "right" },
            { key: "registered", header: "Reg+", width: 0.7, align: "right" },
            { key: "admitted", header: "Admitted", width: 0.8, align: "right" },
            { key: "checkedIn", header: "Checked in", width: 0.9 },
          ],
          rows,
          fileBaseName: "adm_survey_productivity",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Productivity ${date}: ${rows.length} agent(s)` }
        : r;
    }
    case "registration_fee_status": {
      const desk = filtered.filter(
        (l) =>
          l.stage === "applied" ||
          l.stage === "verified" ||
          l.registrationFeeAmountPaise > 0,
      );
      return exportLeads(
        "Registration fee status",
        "adm_reg_fee_status",
        desk,
        state,
        masters,
        filters,
        [
          { key: "enquiryNo", header: "Enquiry", width: 1 },
          { key: "applicationNo", header: "App no", width: 1 },
          { key: "childName", header: "Child", width: 1.2 },
          { key: "mobile", header: "Mobile", width: 1 },
          { key: "stage", header: "Stage", width: 0.9 },
          { key: "feeStatus", header: "Status", width: 0.9 },
          { key: "feeAmount", header: "Amount", width: 0.9 },
          { key: "feeCollected", header: "Collected", width: 0.9 },
          { key: "feeBalance", header: "Balance", width: 0.9 },
          { key: "registrationDate", header: "Reg date", width: 0.9 },
        ],
      );
    }
    case "unpaid_registration": {
      const unpaid = filtered.filter((l) => {
        if (l.stage === "enrolled" || l.stage === "lost") return false;
        const st = feeStatusOf(state, l);
        if (st === "paid" || st === "waived") return false;
        return (
          registrationBalancePaise(state, l) > 0 ||
          st === "pending" ||
          st === "partial" ||
          (l.registrationFeeAmountPaise > 0 && st === "none")
        );
      });
      return exportLeads(
        "Unpaid / partial registration",
        "adm_reg_unpaid",
        unpaid,
        state,
        masters,
        filters,
        [
          { key: "childName", header: "Child", width: 1.2 },
          { key: "guardianName", header: "Guardian", width: 1.2 },
          { key: "mobile", header: "Mobile", width: 1 },
          { key: "stage", header: "Stage", width: 0.9 },
          { key: "feeStatus", header: "Status", width: 0.9 },
          { key: "feeAmount", header: "Amount", width: 0.9 },
          { key: "feeBalance", header: "Balance", width: 0.9 },
          { key: "assignedTo", header: "Assignee", width: 1 },
        ],
      );
    }
    case "paid_registration": {
      const paid = filtered.filter((l) => {
        const st = feeStatusOf(state, l);
        return st === "paid" || st === "waived" || (l.registrationFeePaid && registrationBalancePaise(state, l) <= 0);
      });
      return exportLeads(
        "Paid registration",
        "adm_reg_paid",
        paid,
        state,
        masters,
        filters,
        [
          { key: "childName", header: "Child", width: 1.2 },
          { key: "mobile", header: "Mobile", width: 1 },
          { key: "stage", header: "Stage", width: 0.9 },
          { key: "feeStatus", header: "Status", width: 0.9 },
          { key: "feeAmount", header: "Amount", width: 0.9 },
          { key: "feeCollected", header: "Collected", width: 0.9 },
          { key: "registrationDate", header: "Reg date", width: 0.9 },
        ],
      );
    }
    case "registration_payments": {
      const leadIds = new Set(filtered.map((l) => l.id));
      // Also allow payments whose paid date falls in range when lead filter is loose
      let payments = state.registrationPayments || [];
      if (leadIds.size > 0 || filtered.length !== state.leads.filter((l) => l.stage !== "lost").length) {
        payments = payments.filter((p) => leadIds.has(p.leadId));
      }
      if (filters.fromDate || filters.toDate) {
        payments = payments.filter((p) => {
          const d = (p.paidAt || p.createdAt || "").slice(0, 10);
          if (filters.fromDate && d && d < filters.fromDate) return false;
          if (filters.toDate && d && d > filters.toDate) return false;
          return true;
        });
      }
      const rows = payments.map((p) => {
        const lead = state.leads.find((l) => l.id === p.leadId);
        return {
          code: p.code,
          status: p.status,
          mode: String(p.mode || ""),
          amount: inr(p.amountPaise),
          childName: p.childName || lead?.childName || "",
          mobile: p.mobile || lead?.mobile || "",
          enquiryNo: lead?.enquiryNo || "",
          createdAt: (p.createdAt || "").slice(0, 19).replace("T", " "),
          paidAt: (p.paidAt || "").slice(0, 19).replace("T", " "),
          upiRef: p.upiRef || "",
          note: p.note || "",
          by: p.createdBy || "",
        };
      });
      const r = exportFilterReport(
        {
          title: "Registration payment vouchers",
          subtitle: `${TENANT.shortName} · Admissions`,
          filterNote: note,
          columns: [
            { key: "code", header: "Code", width: 1 },
            { key: "status", header: "Status", width: 0.8 },
            { key: "mode", header: "Mode", width: 0.8 },
            { key: "amount", header: "Amount", width: 0.9 },
            { key: "childName", header: "Child", width: 1.2 },
            { key: "mobile", header: "Mobile", width: 1 },
            { key: "enquiryNo", header: "Enquiry", width: 1 },
            { key: "paidAt", header: "Paid at", width: 1.2 },
            { key: "upiRef", header: "Ref", width: 1 },
            { key: "by", header: "By", width: 1 },
            { key: "note", header: "Note", width: 1.2 },
          ],
          rows,
          fileBaseName: "adm_reg_payments",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Payments: ${rows.length}` }
        : r;
    }
    default:
      return { ok: false, error: "Unknown report" };
  }
}

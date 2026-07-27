/**
 * Trust construction reports — cost sheet, budget, allotments, CWIP.
 */

import {
  describeFilters,
  exportFilterReport,
} from "@/lib/reportExport";
import { formatInr } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import {
  listOverdueAllotments,
  listProjectCostLines,
  materialBalance,
  projectKpis,
  projectSpentPaise,
  projectTypeLabel,
  loadTrust,
  type TrustState,
} from "@/lib/trust";

export type TrustReportFormat = "excel" | "pdf";

export type TrustReportId =
  | "project_cost_sheet"
  | "budget_vs_actual"
  | "allotment_status"
  | "material_balance"
  | "labour_wages"
  | "contractor_retention"
  | "cwip_by_project";

export type TrustReportCategory = "project" | "site" | "finance";

export type TrustReportDef = {
  id: TrustReportId;
  category: TrustReportCategory;
  label: string;
  hint?: string;
};

export const TRUST_REPORT_CATEGORIES: {
  id: TrustReportCategory;
  title: string;
  headerClass: string;
}[] = [
  { id: "project", title: "Project", headerClass: "bg-[#78350f]" },
  { id: "site", title: "Site ops", headerClass: "bg-[#0f766e]" },
  { id: "finance", title: "Finance & CWIP", headerClass: "bg-[#1565c0]" },
];

export const TRUST_REPORTS: TrustReportDef[] = [
  {
    id: "project_cost_sheet",
    category: "project",
    label: "Project cost sheet",
    hint: "All cost lines for project",
  },
  {
    id: "budget_vs_actual",
    category: "project",
    label: "Budget vs actual vs committed",
  },
  {
    id: "allotment_status",
    category: "site",
    label: "Work allotment status",
  },
  {
    id: "material_balance",
    category: "site",
    label: "Material required vs issued",
  },
  {
    id: "labour_wages",
    category: "site",
    label: "Labour wage summary",
  },
  {
    id: "contractor_retention",
    category: "finance",
    label: "Contractor RA & retention",
  },
  {
    id: "cwip_by_project",
    category: "finance",
    label: "CWIP by project (spent)",
  },
];

export type TrustReportFilters = {
  projectId?: string;
  format: TrustReportFormat;
  trust?: TrustState;
};

export function runTrustReport(
  id: TrustReportId,
  filters: TrustReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  const trust = filters.trust ?? loadTrust();
  const project = filters.projectId
    ? trust.projects.find((p) => p.id === filters.projectId)
    : undefined;
  const note = describeFilters([
    project ? `Project ${project.code}` : "All projects",
  ]);

  switch (id) {
    case "project_cost_sheet": {
      const lines = filters.projectId
        ? listProjectCostLines(filters.projectId, trust)
        : trust.costLines;
      const rows = lines.map((c) => ({
        date: c.date,
        type: c.costType,
        vendor: c.vendorName,
        amount: formatInr(c.amountPaise),
        status: c.paymentStatus,
        narration: c.narration,
      }));
      const r = exportFilterReport(
        {
          title: "Project cost sheet",
          subtitle: `${TENANT.shortName} · Trust Construction`,
          filterNote: note,
          columns: [
            { key: "date", header: "Date", width: 0.9 },
            { key: "type", header: "Type", width: 0.8 },
            { key: "vendor", header: "Vendor", width: 1 },
            { key: "amount", header: "Amount", width: 0.9, align: "right" },
            { key: "status", header: "Status", width: 0.7 },
            { key: "narration", header: "Note", width: 1.2 },
          ],
          rows,
          fileBaseName: "trust_cost_sheet",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Cost sheet: ${rows.length} row(s)` }
        : r;
    }
    case "budget_vs_actual": {
      const projects = filters.projectId
        ? trust.projects.filter((p) => p.id === filters.projectId)
        : trust.projects;
      const rows = projects.map((p) => {
        const k = projectKpis(p.id, trust);
        return {
          code: p.code,
          name: p.name,
          type: projectTypeLabel(p.type),
          budget: formatInr(k.budgetPaise),
          spent: formatInr(k.spentPaise),
          committed: formatInr(k.committedPaise),
          remaining: formatInr(k.remainingPaise),
          physicalPct: `${k.physicalPct}%`,
        };
      });
      const r = exportFilterReport(
        {
          title: "Budget vs actual",
          subtitle: `${TENANT.shortName} · Trust`,
          filterNote: note,
          columns: [
            { key: "code", header: "Code", width: 0.8 },
            { key: "name", header: "Project", width: 1.2 },
            { key: "type", header: "Type", width: 0.8 },
            { key: "budget", header: "Budget", width: 0.9, align: "right" },
            { key: "spent", header: "Spent", width: 0.9, align: "right" },
            { key: "committed", header: "Committed", width: 0.9, align: "right" },
            { key: "remaining", header: "Remaining", width: 0.9, align: "right" },
            { key: "physicalPct", header: "Physical", width: 0.7 },
          ],
          rows,
          fileBaseName: "trust_budget_vs_actual",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Budget report: ${rows.length} project(s)` }
        : r;
    }
    case "allotment_status": {
      const allotments = filters.projectId
        ? trust.allotments.filter((a) => a.projectId === filters.projectId)
        : trust.allotments;
      const allotRows = allotments.map((a) => ({
        code: a.code,
        assignee: a.partyName,
        due: a.targetEnd,
        progress: `${a.progressPct}%`,
        status: a.status,
        overdue:
          listOverdueAllotments(trust).some((o) => o.id === a.id) ? "YES" : "",
      }));
      const allotExport = exportFilterReport(
        {
          title: "Work allotment status",
          subtitle: `${TENANT.shortName} · Trust`,
          filterNote: note,
          columns: [
            { key: "code", header: "Code", width: 0.8 },
            { key: "assignee", header: "Assignee", width: 1 },
            { key: "due", header: "Due", width: 0.8 },
            { key: "progress", header: "Progress", width: 0.7 },
            { key: "status", header: "Status", width: 0.8 },
            { key: "overdue", header: "Overdue", width: 0.6 },
          ],
          rows: allotRows,
          fileBaseName: "trust_allotment_status",
        },
        filters.format,
      );
      return allotExport.ok
        ? { ok: true, message: `Allotments: ${allotRows.length} row(s)` }
        : allotExport;
    }
    case "material_balance": {
      const materials = filters.projectId
        ? trust.materials.filter((m) => m.projectId === filters.projectId)
        : trust.materials;
      const matRows = materials.map((m) => ({
        name: m.name,
        unit: m.unit,
        required: m.requiredQty,
        received: m.receivedQty,
        issued: m.issuedQty,
        balance: materialBalance(m),
      }));
      const matExport = exportFilterReport(
        {
          title: "Material balance",
          subtitle: `${TENANT.shortName} · Trust`,
          filterNote: note,
          columns: [
            { key: "name", header: "Material", width: 1 },
            { key: "unit", header: "Unit", width: 0.6 },
            { key: "required", header: "Required", width: 0.7, align: "right" },
            { key: "received", header: "Received", width: 0.7, align: "right" },
            { key: "issued", header: "Issued", width: 0.7, align: "right" },
            { key: "balance", header: "Balance", width: 0.7, align: "right" },
          ],
          rows: matRows,
          fileBaseName: "trust_material_balance",
        },
        filters.format,
      );
      return matExport.ok
        ? { ok: true, message: `Materials: ${matRows.length} line(s)` }
        : matExport;
    }
    case "labour_wages": {
      const labour = filters.projectId
        ? trust.labourEntries.filter((l) => l.projectId === filters.projectId)
        : trust.labourEntries;
      const labRows = labour.map((l) => ({
        date: l.entryDate,
        type: l.labourType,
        days: l.days,
        headcount: l.headcount,
        amount: formatInr(l.amountPaise),
        paid: l.paidStatus,
      }));
      const labExport = exportFilterReport(
        {
          title: "Labour wages",
          subtitle: `${TENANT.shortName} · Trust`,
          filterNote: note,
          columns: [
            { key: "date", header: "Date", width: 0.8 },
            { key: "type", header: "Type", width: 0.9 },
            { key: "days", header: "Days", width: 0.6, align: "right" },
            { key: "headcount", header: "HC", width: 0.5, align: "right" },
            { key: "amount", header: "Amount", width: 0.9, align: "right" },
            { key: "paid", header: "Paid", width: 0.7 },
          ],
          rows: labRows,
          fileBaseName: "trust_labour_wages",
        },
        filters.format,
      );
      return labExport.ok
        ? { ok: true, message: `Labour: ${labRows.length} entry(ies)` }
        : labExport;
    }
    case "contractor_retention": {
      const bills = filters.projectId
        ? trust.raBills.filter((b) => b.projectId === filters.projectId)
        : trust.raBills;
      const billRows = bills.map((b) => ({
        billNo: b.billNo,
        date: b.billDate,
        gross: formatInr(b.amountPaise),
        retention: formatInr(b.retentionPaise),
        paid: formatInr(b.paidPaise),
        status: b.status,
      }));
      const billExport = exportFilterReport(
        {
          title: "Contractor RA & retention",
          subtitle: `${TENANT.shortName} · Trust`,
          filterNote: note,
          columns: [
            { key: "billNo", header: "RA No", width: 0.8 },
            { key: "date", header: "Date", width: 0.8 },
            { key: "gross", header: "Gross", width: 0.9, align: "right" },
            { key: "retention", header: "Retention", width: 0.9, align: "right" },
            { key: "paid", header: "Paid", width: 0.9, align: "right" },
            { key: "status", header: "Status", width: 0.7 },
          ],
          rows: billRows,
          fileBaseName: "trust_contractor_retention",
        },
        filters.format,
      );
      return billExport.ok
        ? { ok: true, message: `RA bills: ${billRows.length} row(s)` }
        : billExport;
    }
    case "cwip_by_project": {
      const cwipProjects = filters.projectId
        ? trust.projects.filter((p) => p.id === filters.projectId)
        : trust.projects;
      const cwipRows = cwipProjects.map((p) => ({
        code: p.code,
        name: p.name,
        status: p.status,
        spent: formatInr(projectSpentPaise(p.id, trust)),
        budget: formatInr(p.budgetPaise),
      }));
      const cwipExport = exportFilterReport(
        {
          title: "CWIP by project",
          subtitle: `${TENANT.shortName} · Trust`,
          filterNote: note,
          columns: [
            { key: "code", header: "Code", width: 0.8 },
            { key: "name", header: "Project", width: 1.2 },
            { key: "status", header: "Status", width: 0.8 },
            { key: "spent", header: "CWIP spent", width: 0.9, align: "right" },
            { key: "budget", header: "Budget", width: 0.9, align: "right" },
          ],
          rows: cwipRows,
          fileBaseName: "trust_cwip_by_project",
        },
        filters.format,
      );
      return cwipExport.ok
        ? { ok: true, message: `CWIP: ${cwipRows.length} project(s)` }
        : cwipExport;
    }
    default:
      return { ok: false, error: "Unknown report" };
  }
}

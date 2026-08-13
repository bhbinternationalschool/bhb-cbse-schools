/**
 * Store / books reports — stock, sales, unpaid credit, coverage, low stock.
 */

import {
  exportFilterReport,
  describeFilters,
  type ReportColumn,
} from "@/lib/reportExport";
import { formatInr, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { paidByDueKey, loadFees, type FeesState } from "@/lib/fees";
import {
  audienceLabel,
  categoryLabel,
  issuePolicyLabel,
  listLowStockItems,
  loadStore,
  salesDayBook,
  stockRegisterRows,
  storeDueKey,
  infraLevelLabel,
  type StoreState,
} from "@/lib/store";
import { TENANT } from "@/lib/types";

export type StoreReportFormat = "excel" | "pdf";

export type StoreReportId =
  | "stock_register"
  | "sales_day_book"
  | "unpaid_credit"
  | "coverage_class_sku"
  | "low_stock"
  | "inventory_allocation"
  | "asset_allocation";

export type StoreReportCategory =
  | "stock"
  | "sales"
  | "coverage"
  | "allocation";

export type StoreReportDef = {
  id: StoreReportId;
  category: StoreReportCategory;
  label: string;
  hint?: string;
};

export const STORE_REPORT_CATEGORIES: {
  id: StoreReportCategory;
  title: string;
  headerClass: string;
}[] = [
  { id: "stock", title: "Stock", headerClass: "bg-[#0f766e]" },
  { id: "sales", title: "Sales & dues", headerClass: "bg-[#1565c0]" },
  { id: "coverage", title: "Coverage", headerClass: "bg-[#ef6c00]" },
  { id: "allocation", title: "Allocation", headerClass: "bg-[#6d28d9]" },
];

export const STORE_REPORTS: StoreReportDef[] = [
  {
    id: "stock_register",
    category: "stock",
    label: "Stock register",
    hint: "Opening · purchased · issued · remaining",
  },
  {
    id: "low_stock",
    category: "stock",
    label: "Low stock / reorder",
  },
  {
    id: "sales_day_book",
    category: "sales",
    label: "Sales day book",
    hint: "Uses report date filter",
  },
  {
    id: "unpaid_credit",
    category: "sales",
    label: "Unpaid credit dues",
  },
  {
    id: "coverage_class_sku",
    category: "coverage",
    label: "Class × SKU coverage",
    hint: "Issued vs active students",
  },
  {
    id: "inventory_allocation",
    category: "allocation",
    label: "Inventory allocation register",
    hint: "Qty by item × infra level",
  },
  {
    id: "asset_allocation",
    category: "allocation",
    label: "Asset allocation register",
    hint: "Tagged assets by assignee / location",
  },
];

export type StoreReportFilters = {
  date?: string;
  classId?: string;
  skuItemId?: string;
  format: StoreReportFormat;
  store?: StoreState;
  masters?: MastersState;
  sis?: SisState;
  fees?: FeesState;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export function runStoreReport(
  id: StoreReportId,
  filters: StoreReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  const store = filters.store ?? loadStore();
  const masters = filters.masters ?? loadMasters();
  const sis = filters.sis ?? loadSis();
  const fees = filters.fees ?? loadFees();
  const date = filters.date || todayYmd();
  const note = describeFilters([
    `Date ${date}`,
    filters.classId
      ? `Class ${masters.classes.find((c) => c.id === filters.classId)?.name || filters.classId}`
      : null,
    filters.skuItemId
      ? `SKU ${store.items.find((i) => i.id === filters.skuItemId)?.sku || ""}`
      : null,
  ]);

  switch (id) {
    case "stock_register": {
      const rows = stockRegisterRows(store).map((r) => ({
        sku: r.sku,
        name: r.name,
        category: r.category,
        sizeLabel: r.sizeLabel,
        opening: r.opening,
        purchased: r.purchased,
        issued: r.issued,
        adjusted: r.adjusted,
        remaining: r.remaining,
        reorderLevel: r.reorderLevel,
        purchasePrice: formatInr(r.purchasePricePaise),
        salePrice: formatInr(r.salePricePaise),
        maxDisc: `${r.maxDiscountPct}%`,
        audience: r.audience,
        lowLabel: r.low ? "LOW" : "",
        policy: r.policy,
      }));
      const r = exportFilterReport(
        {
          title: "Store stock register",
          subtitle: `${TENANT.shortName} · Store`,
          filterNote: note,
          columns: [
            { key: "sku", header: "SKU", width: 1 },
            { key: "name", header: "Item", width: 1.4 },
            { key: "category", header: "Category", width: 0.9 },
            { key: "sizeLabel", header: "Size", width: 0.6 },
            { key: "opening", header: "Opening", width: 0.7, align: "right" },
            { key: "purchased", header: "Purchase qty", width: 0.8, align: "right" },
            { key: "issued", header: "Issued", width: 0.7, align: "right" },
            { key: "adjusted", header: "Adjust", width: 0.7, align: "right" },
            { key: "remaining", header: "On hand", width: 0.8, align: "right" },
            { key: "reorderLevel", header: "Reorder", width: 0.7, align: "right" },
            { key: "lowLabel", header: "Alert", width: 0.6 },
            { key: "purchasePrice", header: "Purchase ₹", width: 0.8 },
            { key: "salePrice", header: "Sale ₹", width: 0.8 },
            { key: "maxDisc", header: "Max disc", width: 0.7 },
            { key: "audience", header: "For", width: 0.8 },
            { key: "policy", header: "Policy", width: 1 },
          ],
          rows,
          fileBaseName: "store_stock",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Stock register: ${rows.length} SKU(s)` }
        : r;
    }
    case "low_stock": {
      const rows = listLowStockItems(store).map((i) => ({
        sku: i.sku,
        name: i.name,
        category: categoryLabel(i.categoryId, store),
        onHand: i.stockOnHand,
        reorder: i.reorderLevel,
        shortfall: Math.max(0, i.reorderLevel - i.stockOnHand),
        purchasePrice: formatInr(i.purchasePricePaise),
        salePrice: formatInr(i.salePricePaise),
        audience: audienceLabel(i.audience),
      }));
      const r = exportFilterReport(
        {
          title: "Low stock / reorder list",
          subtitle: `${TENANT.shortName} · Store`,
          filterNote: note,
          columns: [
            { key: "sku", header: "SKU", width: 1 },
            { key: "name", header: "Item", width: 1.5 },
            { key: "category", header: "Category", width: 1 },
            { key: "onHand", header: "On hand", width: 0.8, align: "right" },
            { key: "reorder", header: "Reorder at", width: 0.9, align: "right" },
            { key: "shortfall", header: "Short", width: 0.7, align: "right" },
            { key: "purchasePrice", header: "Purchase ₹", width: 0.8 },
            { key: "salePrice", header: "Sale ₹", width: 0.8 },
            { key: "audience", header: "For", width: 0.8 },
          ],
          rows,
          fileBaseName: "store_low_stock",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Low stock: ${rows.length} item(s)` }
        : r;
    }
    case "sales_day_book": {
      const book = salesDayBook(date, store);
      const studentName = (sid: string) =>
        sis.students.find((s) => s.id === sid)?.fullName || sid;
      const staffName = (sid: string) =>
        masters.staff.find((s) => s.id === sid)?.fullName || sid;
      const rows = book.map((b) => ({
        issueNo: b.issueNo,
        recipient:
          b.recipientKind === "staff"
            ? `Staff · ${staffName(b.staffId)}`
            : studentName(b.studentId),
        kind_recipient: b.recipientKind,
        mode: b.paymentMode,
        status: b.paymentStatus,
        kind: b.issueKind,
        items: b.itemCount,
        total: formatInr(b.totalPaise),
        discount: formatInr(b.discountPaise),
        by: b.issuedBy,
        note: b.note,
      }));
      const r = exportFilterReport(
        {
          title: `Store sales day book · ${date}`,
          subtitle: `${TENANT.shortName} · Store`,
          filterNote: note,
          columns: [
            { key: "issueNo", header: "Issue", width: 1.1 },
            { key: "recipient", header: "Recipient", width: 1.4 },
            { key: "kind_recipient", header: "To", width: 0.7 },
            { key: "mode", header: "Mode", width: 0.7 },
            { key: "status", header: "Status", width: 0.7 },
            { key: "kind", header: "Kind", width: 1 },
            { key: "items", header: "Qty", width: 0.5, align: "right" },
            { key: "total", header: "Total", width: 0.9 },
            { key: "discount", header: "Discount", width: 0.8 },
            { key: "by", header: "By", width: 1 },
            { key: "note", header: "Note", width: 1.2 },
          ],
          rows,
          fileBaseName: "store_sales_day",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Sales ${date}: ${rows.length} issue(s)` }
        : r;
    }
    case "unpaid_credit": {
      const paidMap = paidByDueKey(fees);
      const rows: Record<string, string | number>[] = [];
      for (const iss of store.issues) {
        if (iss.voidedAt) continue;
        if (iss.recipientKind === "staff" || !iss.studentId) continue;
        if (iss.paymentMode !== "credit" || iss.paymentStatus !== "due") continue;
        const dueKey = storeDueKey(iss.studentId, iss.id);
        const paid = paidMap.get(dueKey) ?? 0;
        const billed = Math.max(0, iss.totalPaise - (iss.returnedPaise || 0));
        const bal = Math.max(0, billed - paid);
        if (bal <= 0) continue;
        const st = sis.students.find((s) => s.id === iss.studentId);
        const cls = masters.classes.find((c) => c.id === st?.classId)?.name || "";
        rows.push({
          issueNo: iss.issueNo,
          issuedOn: iss.issuedOn,
          student: st?.fullName || iss.studentId,
          admissionNo: st?.admissionNo || "",
          className: cls,
          billed: formatInr(billed),
          paid: formatInr(paid),
          balance: formatInr(bal),
          items: iss.lines.map((l) => `${l.name}×${l.qty}`).join("; "),
        });
      }
      const r = exportFilterReport(
        {
          title: "Unpaid store credit dues",
          subtitle: `${TENANT.shortName} · Store / Fee Take`,
          filterNote: note,
          columns: [
            { key: "issueNo", header: "Issue", width: 1.1 },
            { key: "issuedOn", header: "Date", width: 0.9 },
            { key: "student", header: "Student", width: 1.3 },
            { key: "admissionNo", header: "Adm no", width: 0.9 },
            { key: "className", header: "Class", width: 0.8 },
            { key: "billed", header: "Billed", width: 0.8 },
            { key: "paid", header: "Paid", width: 0.8 },
            { key: "balance", header: "Balance", width: 0.9 },
            { key: "items", header: "Items", width: 1.5 },
          ],
          rows,
          fileBaseName: "store_unpaid",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Unpaid credit: ${rows.length} due(s)` }
        : r;
    }
    case "coverage_class_sku": {
      const item = filters.skuItemId
        ? store.items.find((i) => i.id === filters.skuItemId)
        : store.items.find((i) => i.isActive);
      if (!item) {
        return { ok: false, error: "Pick a catalog SKU for coverage" };
      }
      let students = sis.students.filter((s) => s.status !== "inactive");
      if (filters.classId) {
        students = students.filter((s) => s.classId === filters.classId);
      }
      const issuedSet = new Set<string>();
      for (const iss of store.issues) {
        if (iss.voidedAt) continue;
        if (iss.lines.some((l) => l.itemId === item.id)) {
          issuedSet.add(iss.studentId);
        }
      }
      const rows = students
        .map((s) => {
          const cls = masters.classes.find((c) => c.id === s.classId)?.name || "";
          const sec =
            masters.sections.find((x) => x.id === s.sectionId)?.name || "";
          const issued = issuedSet.has(s.id);
          return {
            admissionNo: s.admissionNo,
            name: s.fullName,
            className: cls,
            section: sec,
            status: issued ? "Issued" : "Not issued",
            sku: item.sku,
            itemName: item.name,
          };
        })
        .sort((a, b) =>
          a.status === b.status
            ? a.name.localeCompare(b.name)
            : a.status.localeCompare(b.status),
        );
      const issuedN = rows.filter((r) => r.status === "Issued").length;
      const r = exportFilterReport(
        {
          title: `Coverage · ${item.sku} · ${item.name}`,
          subtitle: `${TENANT.shortName} · Store`,
          filterNote: `${note} · ${issuePolicyLabel(item.issuePolicy)}`,
          columns: [
            { key: "admissionNo", header: "Adm no", width: 0.9 },
            { key: "name", header: "Student", width: 1.4 },
            { key: "className", header: "Class", width: 0.8 },
            { key: "section", header: "Sec", width: 0.5 },
            { key: "status", header: "Status", width: 0.9 },
            { key: "sku", header: "SKU", width: 0.9 },
          ],
          rows,
          fileBaseName: "store_coverage",
        },
        filters.format,
      );
      return r.ok
        ? {
            ok: true,
            message: `Coverage ${item.sku}: ${issuedN}/${rows.length} issued`,
          }
        : r;
    }
    case "inventory_allocation": {
      const rows = store.inventoryAllocations.map((a) => {
        const item = store.items.find((i) => i.id === a.itemId);
        return {
          sku: item?.sku || "",
          item: item?.name || a.itemId,
          category: item ? categoryLabel(item.categoryId, store) : "",
          infra: infraLevelLabel(a.infraLevelId, store),
          qty: a.qty,
          note: a.note,
          updatedAt: a.updatedAt.slice(0, 10),
        };
      });
      const r = exportFilterReport(
        {
          title: "Inventory allocation register",
          subtitle: `${TENANT.shortName} · Store`,
          filterNote: note,
          columns: [
            { key: "sku", header: "SKU", width: 1 },
            { key: "item", header: "Item", width: 1.4 },
            { key: "category", header: "Category", width: 1 },
            { key: "infra", header: "Infra level", width: 1.2 },
            { key: "qty", header: "Qty", width: 0.7, align: "right" },
            { key: "note", header: "Note", width: 1.2 },
            { key: "updatedAt", header: "Updated", width: 0.9 },
          ],
          rows,
          fileBaseName: "store_inventory_allocation",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Inventory allocation: ${rows.length} row(s)` }
        : r;
    }
    case "asset_allocation": {
      const rows = store.assetAllocations.map((a) => {
        const item = store.items.find((i) => i.id === a.itemId);
        return {
          assetTag: a.assetTag,
          sku: item?.sku || "",
          item: item?.name || a.itemId,
          assignedTo: a.assignedTo,
          infra: infraLevelLabel(a.infraLevelId, store),
          location: a.location,
          qty: a.qty,
          note: a.note,
          updatedAt: a.updatedAt.slice(0, 10),
        };
      });
      const r = exportFilterReport(
        {
          title: "Asset allocation register",
          subtitle: `${TENANT.shortName} · Store`,
          filterNote: note,
          columns: [
            { key: "assetTag", header: "Asset tag", width: 1 },
            { key: "sku", header: "SKU", width: 0.9 },
            { key: "item", header: "Item", width: 1.3 },
            { key: "assignedTo", header: "Assigned to", width: 1.2 },
            { key: "infra", header: "Infra level", width: 1 },
            { key: "location", header: "Location detail", width: 1 },
            { key: "qty", header: "Qty", width: 0.6, align: "right" },
            { key: "note", header: "Note", width: 1.1 },
            { key: "updatedAt", header: "Updated", width: 0.9 },
          ],
          rows,
          fileBaseName: "store_asset_allocation",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Asset allocation: ${rows.length} row(s)` }
        : r;
    }
    default:
      return { ok: false, error: "Unknown report" };
  }
}

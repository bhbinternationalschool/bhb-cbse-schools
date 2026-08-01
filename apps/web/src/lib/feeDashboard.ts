/**
 * Fee Take module dashboard — KPIs, trends, drill-down lists.
 */

import type {
  DashboardChartPoint,
  DashboardKpi,
  ModuleDashboardModel,
} from "@/components/dashboard/ModuleDashboard";
import { feePositionLayers } from "@/lib/dashboardChartRings";
import { computeFeeKpis } from "@/lib/feeFinance";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
  TENDER_MODES,
  type CollectionVoucher,
  type TenderMode,
} from "@/lib/fees";
import { formatInrCompact, loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function inAcademicYear(
  row: { academicYearCode?: string | null },
  academicYearCode?: string,
): boolean {
  return !academicYearCode || row.academicYearCode === academicYearCode;
}

function tenderLabel(mode: TenderMode): string {
  return TENDER_MODES.find((m) => m.value === mode)?.label ?? mode;
}

function voucherModeSummary(v: CollectionVoucher): string {
  const modes = [...new Set(v.tenders.map((t) => tenderLabel(t.mode)))];
  return modes.length ? modes.join(", ") : "—";
}

/** Session-wide collection totals by payment mode (rupees). */
export function feeCollectionModeBreakupRupees(
  vouchers: CollectionVoucher[],
): { label: string; value: number }[] {
  const map = new Map<string, number>();
  for (const v of vouchers) {
    for (const t of v.tenders) {
      const label = tenderLabel(t.mode);
      map.set(label, (map.get(label) ?? 0) + t.amountPaise);
    }
  }
  return [...map.entries()]
    .map(([label, paise]) => ({
      label,
      value: Math.round(paise / 100),
    }))
    .sort((a, b) => b.value - a.value);
}

function modeBreakupHint(
  breakup: { label: string; value: number }[],
): { label: string; value: string }[] {
  return breakup.map((b) => ({
    label: b.label,
    value: formatInr(b.value * 100),
  }));
}

function collectionTrendSeries(
  vouchers: CollectionVoucher[],
  days: string[],
): DashboardChartPoint[] {
  return days.map((d) => {
    const dayVouchers = vouchers.filter((v) => v.collectionDate === d);
    const sum = dayVouchers.reduce((s, v) => s + v.totalPaise, 0);
    return {
      label: dayLabel(d),
      date: d,
      value: Math.round(sum / 100),
      modeBreakup: feeCollectionModeBreakupRupees(dayVouchers),
    };
  });
}

export function buildFeesDashboardModel(
  academicYearCode?: string,
): ModuleDashboardModel {
  const kpi = computeFeeKpis({ academicYearCode });
  const fees = loadFees();
  const sis = loadSis();
  const masters = loadMasters();
  const ay = kpi.academicYearCode;
  const today = todayIso();

  const vouchers = fees.vouchers.filter(
    (v) => !v.voidedAt && inAcademicYear(v, ay),
  );
  const todayVouchers = vouchers.filter((v) => v.collectionDate === today);
  const todayModeBreakup = feeCollectionModeBreakupRupees(todayVouchers);

  const days7 = lastNDays(7);
  const days30 = lastNDays(30);
  const trend7 = collectionTrendSeries(vouchers, days7);
  const trend30 = collectionTrendSeries(vouchers, days30);

  const recent = [...vouchers]
    .sort((a, b) =>
      (b.collectionDate || "").localeCompare(a.collectionDate || ""),
    )
    .slice(0, 25);

  const collectedDetailRows = [...vouchers]
    .sort((a, b) =>
      (b.collectionDate || "").localeCompare(a.collectionDate || ""),
    )
    .slice(0, 250)
    .map((v) => {
      const students = [...new Set(v.lines.map((l) => l.studentName))].join(
        ", ",
      );
      return {
        id: v.id,
        receipt: v.receiptNo || v.id,
        date: v.collectionDate || "—",
        mode: voucherModeSummary(v),
        student: students || "—",
        amount: formatInr(v.totalPaise),
        voucherId: v.id,
      };
    });

  const openDetailRows: {
    id: string;
    admission: string;
    name: string;
    class: string;
    amount: string;
    sortPaise: number;
  }[] = [];
  const arrearsDetailRows: {
    id: string;
    admission: string;
    name: string;
    class: string;
    amount: string;
    sortPaise: number;
  }[] = [];

  const active = sis.students.filter(
    (s) => s.status === "active" && s.academicYearCode === ay,
  );

  for (const student of active) {
    const dues = computeStudentDues(student, masters, fees, {
      asOf: today,
      includeFuture: false,
      includePaid: false,
    });
    const open = openFeeDues(dues);
    if (!open.length) continue;
    const openSum = open.reduce((s, d) => s + d.balancePaise, 0);
    const arrSum = open
      .filter((d) => d.kind === "arrears")
      .reduce((s, d) => s + d.balancePaise, 0);
    const cls = masters.classes.find((c) => c.id === student.classId);
    const sec = masters.sections.find((s) => s.id === student.sectionId);
    const classLabel = `${cls?.name ?? "—"}${sec ? ` ${sec.name}` : ""}`;
    const row = {
      id: student.id,
      admission: student.admissionNo,
      name: student.fullName,
      class: classLabel,
      amount: formatInr(openSum),
      sortPaise: openSum,
    };
    openDetailRows.push(row);
    if (arrSum > 0) {
      arrearsDetailRows.push({
        ...row,
        amount: formatInr(arrSum),
        sortPaise: arrSum,
      });
    }
  }

  openDetailRows.sort((a, b) => b.sortPaise - a.sortPaise);
  arrearsDetailRows.sort((a, b) => b.sortPaise - a.sortPaise);

  const todayDetailRows = todayVouchers
    .sort((a, b) => (b.collectedAt || "").localeCompare(a.collectedAt || ""))
    .map((v) => {
      const students = [...new Set(v.lines.map((l) => l.studentName))].join(
        ", ",
      );
      return {
        id: v.id,
        receipt: v.receiptNo || v.id,
        time: v.collectedAt
          ? new Date(v.collectedAt).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—",
        mode: voucherModeSummary(v),
        student: students || "—",
        amount: formatInr(v.totalPaise),
        voucherId: v.id,
      };
    });

  const kpis: DashboardKpi[] = [
    {
      id: "collected",
      label: "Collected",
      value: formatInrCompact(kpi.collectedPaise),
      hint: `${kpi.voucherCount} receipts · ${kpi.collectionRatePct}% of bill`,
      tone: "green",
      tab: "receipts",
      detailTitle: "Session collections",
      detailColumns: [
        { key: "receipt", label: "Receipt" },
        { key: "date", label: "Date" },
        { key: "student", label: "Student" },
        { key: "mode", label: "Mode" },
        { key: "amount", label: "Amount", align: "right" },
      ],
      detailRows: collectedDetailRows,
    },
    {
      id: "open",
      label: "Open dues",
      value: formatInrCompact(kpi.openPaise),
      hint: `${kpi.studentsWithOpenDues} students · through current month`,
      tone: "coral",
      tab: "collect",
      detailTitle: "Students with open dues",
      detailColumns: [
        { key: "admission", label: "Adm no." },
        { key: "name", label: "Student" },
        { key: "class", label: "Class" },
        { key: "amount", label: "Open", align: "right" },
      ],
      detailRows: openDetailRows.slice(0, 200).map(
        ({ sortPaise: _s, ...row }) => row,
      ),
    },
    {
      id: "today",
      label: "Today",
      value: formatInrCompact(kpi.todayCollectedPaise),
      hint: `${todayVouchers.length} receipt${todayVouchers.length === 1 ? "" : "s"} today`,
      tone: "navy",
      tab: "collect",
      breakdown: modeBreakupHint(todayModeBreakup),
      detailTitle: `Today's collections · ${dayLabel(today)}`,
      detailColumns: [
        { key: "receipt", label: "Receipt" },
        { key: "time", label: "Time" },
        { key: "student", label: "Student" },
        { key: "mode", label: "Mode" },
        { key: "amount", label: "Amount", align: "right" },
      ],
      detailRows: todayDetailRows,
    },
    {
      id: "arrears",
      label: "Arrears",
      value: formatInrCompact(kpi.arrearsPaise),
      hint: `${arrearsDetailRows.length} students with prior dues`,
      tone: "gold",
      tab: "reports",
      detailTitle: "Arrears / prior session dues",
      detailColumns: [
        { key: "admission", label: "Adm no." },
        { key: "name", label: "Student" },
        { key: "class", label: "Class" },
        { key: "amount", label: "Arrears", align: "right" },
      ],
      detailRows: arrearsDetailRows.slice(0, 200).map(
        ({ sortPaise: _s, ...row }) => row,
      ),
    },
  ];

  const sessionModeBreakup = feeCollectionModeBreakupRupees(vouchers);

  return {
    title: "Fees",
    subtitle: `Session ${kpi.academicYearCode} · collection, dues, and arrears. Switch to pie for dual-ring fee position.`,
    kpis,
    chartTitle: "Collections — last 7 days",
    chartSeries: trend7,
    ...feePositionLayers(
      kpi.collectedPaise,
      kpi.openPaise,
      kpi.arrearsPaise,
      sessionModeBreakup,
      formatInrCompact(kpi.collectedPaise),
    ),
    chartDefaultView: "bar",
    chartRanges: [
      {
        id: "7d",
        label: "7 days",
        title: "Collections — last 7 days (₹)",
        series: trend7,
      },
      {
        id: "30d",
        label: "30 days",
        title: "Collections — last 30 days (₹)",
        series: trend30,
      },
    ],
    chartRangeDefault: "7d",
    tableTitle: "Recent receipts",
    tableColumns: [
      { key: "receipt", label: "Receipt" },
      { key: "date", label: "Date" },
      { key: "student", label: "Student" },
      { key: "mode", label: "Mode" },
      { key: "amount", label: "Amount", align: "right" },
    ],
    tableRows: recent.map((v) => {
      const students = [...new Set(v.lines.map((l) => l.studentName))].join(
        ", ",
      );
      return {
        id: v.id,
        voucherId: v.id,
        receipt: v.receiptNo || v.id,
        date: v.collectionDate || "—",
        student: students || "—",
        mode: voucherModeSummary(v),
        amount: formatInr(v.totalPaise),
      };
    }),
    quickLinks: [
      { label: "Collect", tab: "collect" },
      { label: "Receipts", tab: "receipts" },
      { label: "Cheques", tab: "cheques" },
      { label: "Defaulters", href: "/fees/defaulters" },
      { label: "Reports", tab: "reports" },
    ],
  };
}

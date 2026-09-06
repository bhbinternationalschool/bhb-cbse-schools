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

/**
 * The fee head a receipt line was collected against.
 *
 * A line's label is written at collect time and carries the installment and
 * any waiver with it — "Amenity Fees · April · −₹1,000 waived". The head is
 * the part before the first separator; keeping the rest would give the ring
 * one slice per month per waiver, which is no breakdown at all. A line with
 * no usable label falls back to its kind so it is still counted somewhere.
 */
function feeHeadOfLabel(label: string, kind: string): string {
  const head = String(label || "").split("·")[0]?.trim();
  if (head) return head;
  const byKind: Record<string, string> = {
    academic: "Academic",
    transport: "Transport",
    special: "Special fees",
    store: "Store",
    arrears: "Arrears",
  };
  return byKind[kind] ?? "Other";
}

/** Whole days between two ISO dates, floor 0. */
function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00`);
  const b = Date.parse(`${toYmd}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * Colours for the fee-head ring. Deliberately a fixed cycle rather than one
 * colour per named head: the school adds and renames heads, and a ring whose
 * colours move every time a head is added is unreadable at a glance.
 */
const HEAD_COLORS = [
  "#0f7a4c",
  "#1565c0",
  "#c5a028",
  "#6d28d9",
  "#c2410c",
  "#0f766e",
  "#9d174d",
];

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

  /**
   * Who is furthest behind, and by how long. The counter chases people, not
   * totals, so the dashboard names them: the same list the Defaulters page
   * opens, cut to the few worth a call this morning.
   */
  const defaulterRows: {
    id: string;
    rank: string;
    name: string;
    class: string;
    amount: string;
    overdue: string;
    sortPaise: number;
    daysOverdue: number;
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
    // Oldest unpaid due decides how overdue a family is. Anything dated today
    // or later is not late yet and must not age the row.
    const overdueDays = open
      .filter((d) => d.dueOn && d.dueOn < today)
      .reduce((max, d) => Math.max(max, daysBetween(d.dueOn, today)), 0);
    defaulterRows.push({
      id: student.id,
      rank: "",
      name: student.fullName,
      class: classLabel,
      amount: formatInr(openSum),
      overdue: overdueDays > 0 ? `${overdueDays} days` : "not yet due",
      sortPaise: openSum,
      daysOverdue: overdueDays,
    });
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
  // Longest overdue first, then largest — a small sum unpaid for four months
  // is a harder conversation than a big one that fell due last week.
  defaulterRows.sort(
    (a, b) => b.daysOverdue - a.daysOverdue || b.sortPaise - a.sortPaise,
  );
  const topDefaulters = defaulterRows
    .slice(0, 8)
    .map((r, i) => ({ ...r, rank: String(i + 1) }));

  /** Yesterday, for the one comparison the counter actually makes. */
  const yesterdayYmd = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const yesterdayPaise = vouchers
    .filter((v) => v.collectionDate === yesterdayYmd)
    .reduce((n, v) => n + v.totalPaise, 0);
  const todayPaise = todayVouchers.reduce((n, v) => n + v.totalPaise, 0);
  const dayOverDayHint = (() => {
    if (yesterdayPaise <= 0) {
      return todayPaise > 0 ? "nothing collected yesterday" : "no collection yet";
    }
    const pct = Math.round(
      ((todayPaise - yesterdayPaise) / yesterdayPaise) * 100,
    );
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "•";
    return `${arrow} ${Math.abs(pct)}% vs yesterday (${formatInr(yesterdayPaise)})`;
  })();

  /**
   * What the money was collected FOR — tuition, transport, exam, store —
   * rather than how it arrived. The mode split answers "which bank"; this
   * answers "which head", which is the one the trust asks about.
   */
  const headTotals = new Map<string, number>();
  for (const v of vouchers) {
    for (const line of v.lines) {
      headTotals.set(
        feeHeadOfLabel(line.label, line.kind),
        (headTotals.get(feeHeadOfLabel(line.label, line.kind)) ?? 0) +
          line.amountPaise,
      );
    }
  }
  const headEntries = [...headTotals.entries()]
    .filter(([, paise]) => paise > 0)
    .sort((a, b) => b[1] - a[1]);
  const headTotalPaise = headEntries.reduce((n, [, p]) => n + p, 0);
  // Beyond six slices a ring stops being readable; the tail is one honest
  // "Other heads" rather than a crowd of unlabelled slivers.
  const headTop = headEntries.slice(0, 6);
  const headRest = headEntries.slice(6).reduce((n, [, p]) => n + p, 0);
  const headSeries: DashboardChartPoint[] = [
    ...headTop.map(([label, paise], i) => ({
      label,
      value: Math.round(paise / 100),
      color: HEAD_COLORS[i % HEAD_COLORS.length]!,
    })),
    ...(headRest > 0
      ? [
          {
            label: "Other heads",
            value: Math.round(headRest / 100),
            color: "#5c6478",
          },
        ]
      : []),
  ];

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
      hint: `${todayVouchers.length} receipt${todayVouchers.length === 1 ? "" : "s"} · ${dayOverDayHint}`,
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
    // The fee-head ring answers "what was this money FOR", which the mode
    // split beside it cannot. Asked for on 2026-09-06 against a reference
    // dashboard that carried the same panel.
    extraCharts: headSeries.length
      ? [
          {
            title: "Fee head breakdown — session",
            series: headSeries,
            defaultView: "pie" as const,
            center: {
              value: formatInrCompact(headTotalPaise),
              label: "collected",
            },
          },
        ]
      : undefined,
    tableTitle: "Recent receipts",
    tableColumns: [
      { key: "receipt", label: "Receipt" },
      { key: "date", label: "Date" },
      { key: "time", label: "Time" },
      { key: "student", label: "Student" },
      { key: "mode", label: "Mode" },
      { key: "by", label: "Received by" },
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
        time: v.collectedAt
          ? new Date(v.collectedAt).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—",
        student: students || "—",
        mode: voucherModeSummary(v),
        by: v.cashierName || "—",
        amount: formatInr(v.totalPaise),
      };
    }),
    // Named families, longest overdue first. The counter chases people, and
    // a dashboard that only shows a total leaves it to guess who.
    extraTables: topDefaulters.length
      ? [
          {
            title: "Top defaulters — longest overdue first",
            columns: [
              { key: "rank", label: "#" },
              { key: "name", label: "Student" },
              { key: "class", label: "Class" },
              { key: "overdue", label: "Overdue" },
              { key: "amount", label: "Amount due", align: "right" as const },
            ],
            rows: topDefaulters.map(
              ({ sortPaise: _s, daysOverdue: _d, ...row }) => row,
            ),
          },
        ]
      : undefined,
    quickLinks: [
      { label: "Collect", tab: "collect" },
      { label: "Receipts", tab: "receipts" },
      { label: "Cheques", tab: "cheques" },
      { label: "Defaulters", href: "/fees/defaulters" },
      { label: "Reports", tab: "reports" },
    ],
  };
}

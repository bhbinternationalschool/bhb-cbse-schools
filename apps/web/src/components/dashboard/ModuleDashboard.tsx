"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ErpMetricCard,
  ErpMetricGrid,
  ErpToolbar,
  ErpToolbarBtn,
  type ErpMetricTone,
} from "@/components/ui/erp-roster";
import {
  BarChart3,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  LineChart,
  PieChart,
  Printer,
  Table2,
  X,
  ChevronRight,
  IndianRupee,
  Users,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";

export type DashboardTone =
  | "navy"
  | "gold"
  | "teal"
  | "rose"
  | "green"
  | "sky"
  | "coral"
  | "slate";

export type DashboardChartPoint = {
  label: string;
  value: number;
  color?: string;
  /** ISO date for tooltips */
  date?: string;
  /** Payment mode split (values in rupees) */
  modeBreakup?: { label: string; value: number }[];
};

export type DashboardTableColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

export type DashboardTableRow = {
  id: string;
  [key: string]: string | number;
};

export type DashboardKpi = {
  id: string;
  label: string;
  value: string;
  hint?: string;
  /** Shown under the KPI amount (e.g. payment mode split for Today). */
  breakdown?: { label: string; value: string }[];
  tone?: DashboardTone;
  /** Navigate to this workspace tab when clicked */
  tab?: string;
  /** Navigate to this route when clicked (school / cross-module KPIs) */
  href?: string;
  /** Rows shown in the KPI detail drawer */
  detailTitle?: string;
  detailColumns?: DashboardTableColumn[];
  detailRows?: DashboardTableRow[];
};

export type DashboardQuickLink = {
  label: string;
  tab?: string;
  href?: string;
};

export type DashboardKpiSection = {
  id: string;
  title: string;
  hint?: string;
  kpis: DashboardKpi[];
};

export type DashboardTableBlock = {
  title: string;
  columns: DashboardTableColumn[];
  rows: DashboardTableRow[];
};

export type ChartView = "bar" | "pie" | "trend";

export type DashboardChartCenter = {
  value: string;
  label: string;
};

export type DashboardChartRing = {
  id: string;
  label: string;
  series: DashboardChartPoint[];
};

export type DashboardChartBlock = {
  title: string;
  series: DashboardChartPoint[];
  rings?: DashboardChartRing[];
  center?: DashboardChartCenter;
  /** Preferred initial view (defaults to bar; use trend for time series). */
  defaultView?: ChartView;
};

export type DashboardChartRange = {
  id: string;
  label: string;
  title: string;
  series: DashboardChartPoint[];
};

export type ModuleDashboardModel = {
  title: string;
  subtitle: string;
  /** Optional eyebrow above title (e.g. "School overview") */
  heroEyebrow?: string;
  kpis: DashboardKpi[];
  /** Optional grouped KPI blocks (e.g. Students vs Staff). Falls back to `kpis`. */
  kpiSections?: DashboardKpiSection[];
  chartTitle: string;
  chartSeries: DashboardChartPoint[];
  chartRings?: DashboardChartRing[];
  chartCenter?: DashboardChartCenter;
  /** Preferred initial view for the primary chart. */
  chartDefaultView?: ChartView;
  /** Optional range toggle (e.g. 7 days / 30 days). */
  chartRanges?: DashboardChartRange[];
  chartRangeDefault?: string;
  /** Extra charts rendered beside / below the primary chart. */
  extraCharts?: DashboardChartBlock[];
  tableTitle: string;
  tableColumns: DashboardTableColumn[];
  tableRows: DashboardTableRow[];
  /** Extra tables after the primary one */
  extraTables?: DashboardTableBlock[];
  quickLinks?: DashboardQuickLink[];
};

export function dashboardToneToMetric(tone: DashboardTone): ErpMetricTone {
  const map: Record<DashboardTone, ErpMetricTone> = {
    navy: "navy",
    gold: "amber",
    teal: "sky",
    rose: "rose",
    green: "green",
    sky: "sky",
    coral: "amber",
    slate: "navy",
  };
  return map[tone] ?? "sky";
}

export function kpiIconForTone(tone: DashboardTone) {
  switch (tone) {
    case "green":
      return <TrendingUp className="h-7 w-7" />;
    case "rose":
      return <AlertTriangle className="h-7 w-7" />;
    case "gold":
    case "coral":
      return <IndianRupee className="h-7 w-7" />;
    case "teal":
    case "sky":
      return <BarChart3 className="h-7 w-7" />;
    default:
      return <Users className="h-7 w-7" />;
  }
}

const TONE_STYLES: Record<
  DashboardTone,
  { chip: string; value: string; ring: string; bar: string }
> = {
  navy: {
    chip: "bg-[rgba(32,48,80,0.1)] text-[var(--brand-deep)]",
    value: "text-[var(--brand-deep)]",
    ring: "hover:ring-[var(--brand-deep)]/30 focus-visible:ring-[var(--brand-deep)]",
    bar: "#203050",
  },
  gold: {
    chip: "bg-[rgba(197,160,40,0.18)] text-[#8a6d12]",
    value: "text-[#8a6d12]",
    ring: "hover:ring-[#c5a028]/40 focus-visible:ring-[#c5a028]",
    bar: "#c5a028",
  },
  teal: {
    chip: "bg-[rgba(15,118,110,0.12)] text-[#0f766e]",
    value: "text-[#0f766e]",
    ring: "hover:ring-[#0f766e]/30 focus-visible:ring-[#0f766e]",
    bar: "#0f766e",
  },
  rose: {
    chip: "bg-[rgba(190,24,93,0.12)] text-[#9d174d]",
    value: "text-[#9d174d]",
    ring: "hover:ring-[#9d174d]/30 focus-visible:ring-[#9d174d]",
    bar: "#9d174d",
  },
  green: {
    chip: "bg-[rgba(22,163,74,0.12)] text-[#15803d]",
    value: "text-[#15803d]",
    ring: "hover:ring-[#15803d]/30 focus-visible:ring-[#15803d]",
    bar: "#15803d",
  },
  sky: {
    chip: "bg-[rgba(2,132,199,0.12)] text-[#0369a1]",
    value: "text-[#0369a1]",
    ring: "hover:ring-[#0284c7]/30 focus-visible:ring-[#0284c7]",
    bar: "#0284c7",
  },
  coral: {
    chip: "bg-[rgba(234,88,12,0.12)] text-[#c2410c]",
    value: "text-[#c2410c]",
    ring: "hover:ring-[#ea580c]/30 focus-visible:ring-[#ea580c]",
    bar: "#ea580c",
  },
  slate: {
    chip: "bg-[rgba(71,85,105,0.12)] text-[#334155]",
    value: "text-[#334155]",
    ring: "hover:ring-[#334155]/30 focus-visible:ring-[#334155]",
    bar: "#334155",
  },
};

export const DASHBOARD_PALETTE = [
  "#203050",
  "#c5a028",
  "#0f766e",
  "#0284c7",
  "#15803d",
  "#c2410c",
  "#9d174d",
  "#64748b",
];

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (Math.abs(n) >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatRupees(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function ChartHoverTooltip({
  point,
}: {
  point: DashboardChartPoint | null;
}) {
  if (!point) return null;
  const modes = point.modeBreakup?.filter((m) => m.value > 0) ?? [];
  return (
    <div className="pointer-events-none absolute left-1/2 top-2 z-10 w-max max-w-[min(18rem,90vw)] -translate-x-1/2 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-3 py-2.5 text-left shadow-lg">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
        {point.date
          ? new Date(`${point.date}T12:00:00`).toLocaleDateString("en-IN", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })
          : point.label}
      </p>
      <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-[var(--brand-deep)]">
        {formatRupees(point.value)}
      </p>
      {modes.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-[rgba(32,48,80,0.08)] pt-2 text-xs">
          {modes.map((m) => (
            <li
              key={m.label}
              className="flex items-center justify-between gap-3 text-[var(--ink)]"
            >
              <span>{m.label}</span>
              <span className="font-semibold tabular-nums">
                {formatRupees(m.value)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-[var(--muted)]">No collections</p>
      )}
    </div>
  );
}

function withColors(series: DashboardChartPoint[]): DashboardChartPoint[] {
  return series.map((p, i) => ({
    ...p,
    color: p.color || DASHBOARD_PALETTE[i % DASHBOARD_PALETTE.length],
  }));
}

function BarChartSvg({ series }: { series: DashboardChartPoint[] }) {
  const data = withColors(series).slice(0, 31);
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hovered, setHovered] = useState<number | null>(null);
  const w = 560;
  const h = 220;
  const padL = 36;
  const padB = 48;
  const padT = 16;
  const padR = 12;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const gap = data.length > 14 ? 4 : 8;
  const barW = data.length ? (innerW - gap * (data.length - 1)) / data.length : 0;

  return (
    <div className="relative">
      <ChartHoverTooltip
        point={hovered != null ? data[hovered] ?? null : null}
      />
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Bar chart">
      <line
        x1={padL}
        y1={padT}
        x2={padL}
        y2={h - padB}
        stroke="rgba(32,48,80,0.15)"
        strokeWidth={1}
      />
      <line
        x1={padL}
        y1={h - padB}
        x2={w - padR}
        y2={h - padB}
        stroke="rgba(32,48,80,0.15)"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const bh = (d.value / max) * innerH;
        const x = padL + i * (barW + gap);
        const y = padT + innerH - bh;
        const active = hovered === i;
        return (
          <g
            key={`${d.label}-${i}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            className="cursor-pointer"
          >
            <rect
              x={x}
              y={y}
              width={Math.max(barW, 4)}
              height={Math.max(bh, 2)}
              rx={6}
              fill={d.color}
              opacity={active ? 1 : hovered == null ? 1 : 0.45}
              className="module-dash-bar"
            />
            {active && bh > 0 ? (
              <rect
                x={x - 1}
                y={y - 1}
                width={Math.max(barW, 4) + 2}
                height={Math.max(bh, 2) + 2}
                rx={7}
                fill="none"
                stroke="#c5a028"
                strokeWidth={2}
              />
            ) : null}
            {data.length <= 14 ? (
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                className="fill-[var(--brand-deep)]"
                fontSize={10}
                fontWeight={700}
              >
                {formatCompact(d.value)}
              </text>
            ) : null}
            <text
              x={x + barW / 2}
              y={h - padB + 16}
              textAnchor="middle"
              className="fill-[var(--muted)]"
              fontSize={data.length > 14 ? 9 : 10}
            >
              {d.label.length > 10 ? `${d.label.slice(0, 9)}…` : d.label}
            </text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

type RingGeom = { outerR: number; innerR: number };

const MULTI_RING_LAYOUT: RingGeom[] = [
  { outerR: 88, innerR: 58 },
  { outerR: 52, innerR: 26 },
];

const SINGLE_RING_LAYOUT: RingGeom = { outerR: 88, innerR: 52 };

type DonutSlice = DashboardChartPoint & {
  path: string;
  pct: number;
  ringIndex: number;
  sliceIndex: number;
  strokeW: number;
};

function ringGeom(ringCount: number, ringIndex: number): RingGeom {
  if (ringCount <= 1) return SINGLE_RING_LAYOUT;
  return MULTI_RING_LAYOUT[ringIndex] ?? MULTI_RING_LAYOUT[MULTI_RING_LAYOUT.length - 1]!;
}

function buildDonutSlices(
  series: DashboardChartPoint[],
  geom: RingGeom,
  ringIndex: number,
  cx = 120,
  cy = 110,
): DonutSlice[] {
  const data = withColors(series).filter((d) => d.value > 0).slice(0, 6);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const midR = (geom.outerR + geom.innerR) / 2;
  const strokeW = geom.outerR - geom.innerR;
  const gap = data.length > 1 ? 0.06 : 0;
  let angle = -Math.PI / 2;

  return data.map((d, sliceIndex) => {
    const sweep = (d.value / total) * Math.PI * 2;
    const start = angle + gap / 2;
    const end = angle + sweep - gap / 2;
    angle += sweep;
    const pct = Math.round((d.value / total) * 100);
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + midR * Math.cos(start);
    const y1 = cy + midR * Math.sin(start);
    const x2 = cx + midR * Math.cos(end);
    const y2 = cy + midR * Math.sin(end);
    const path =
      sweep >= Math.PI * 2 - 0.02
        ? `M ${cx} ${cy - midR} A ${midR} ${midR} 0 1 1 ${cx - 0.01} ${cy - midR}`
        : `M ${x1} ${y1} A ${midR} ${midR} 0 ${large} 1 ${x2} ${y2}`;
    return { ...d, path, pct, ringIndex, sliceIndex, strokeW };
  });
}

function DonutChartSvg({
  rings,
  center,
}: {
  rings: DashboardChartRing[];
  center?: DashboardChartCenter;
}) {
  const activeRings = rings.filter((r) => r.series.some((p) => p.value > 0));
  const displayRings =
    activeRings.length > 0
      ? activeRings
      : [{ id: "empty", label: "", series: [{ label: "—", value: 0 }] }];
  const ringCount = displayRings.length;
  const [hover, setHover] = useState<{
    ring: number;
    index: number;
  } | null>(null);

  const allSlices = displayRings.flatMap((ring, ringIndex) =>
    buildDonutSlices(ring.series, ringGeom(ringCount, ringIndex), ringIndex),
  );

  const outerTotal =
    displayRings[0]?.series.reduce((s, p) => s + (p.value > 0 ? p.value : 0), 0) ||
    1;
  const centerValue = center?.value ?? formatCompact(outerTotal);
  const centerLabel = center?.label ?? "total";
  const holeR =
    ringCount > 1
      ? (MULTI_RING_LAYOUT[MULTI_RING_LAYOUT.length - 1]?.innerR ?? 26) - 2
      : SINGLE_RING_LAYOUT.innerR - 2;

  function sliceOpacity(slice: DonutSlice): number {
    if (!hover) return 1;
    if (hover.ring === slice.ringIndex && hover.index === slice.sliceIndex) {
      return 1;
    }
    if (hover.ring === 0 && slice.ringIndex === 1) {
      const outerSlice = displayRings[0]?.series[hover.index];
      const linked =
        outerSlice?.modeBreakup
          ?.filter((m) => m.value > 0)
          .map((m) => m.label) ?? [];
      if (linked.length > 0) {
        return linked.includes(slice.label) ? 1 : 0.18;
      }
    }
    if (hover.ring !== slice.ringIndex) return 0.32;
    return 0.32;
  }

  const hoveredSlice =
    hover != null
      ? allSlices.find(
          (s) => s.ringIndex === hover.ring && s.sliceIndex === hover.index,
        ) ?? null
      : null;

  return (
    <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start">
      <div className="relative shrink-0">
        {hoveredSlice ? (
          <div className="pointer-events-none absolute left-1/2 top-0 z-10 w-max max-w-[min(16rem,90vw)] -translate-x-1/2 -translate-y-1 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-3 py-2 text-center shadow-lg">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              {displayRings[hoveredSlice.ringIndex]?.label || hoveredSlice.label}
            </p>
            <p className="font-display text-base font-bold text-[var(--brand-deep)]">
              {hoveredSlice.label}
            </p>
            <p className="tabular-nums text-sm font-semibold text-[var(--ink)]">
              {formatCompact(hoveredSlice.value)} · {hoveredSlice.pct}%
            </p>
          </div>
        ) : null}
        <svg
          viewBox="0 0 240 220"
          className="h-auto w-full max-w-[280px]"
          role="img"
          aria-label="Multi-ring donut chart"
        >
          {allSlices.map((s, i) => (
            <path
              key={`${s.ringIndex}-${s.label}-${i}`}
              d={s.path}
              fill="none"
              stroke={s.color}
              strokeWidth={s.strokeW}
              strokeLinecap="round"
              opacity={sliceOpacity(s)}
              className="module-dash-slice transition-opacity duration-150"
              onMouseEnter={() =>
                setHover({ ring: s.ringIndex, index: s.sliceIndex })
              }
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.label}: ${s.value} (${s.pct}%)`}</title>
            </path>
          ))}
          <circle
            cx={120}
            cy={110}
            r={holeR}
            fill="var(--brand-cream)"
            className="drop-shadow-sm"
          />
          <text
            x={120}
            y={106}
            textAnchor="middle"
            className="fill-[var(--brand-deep)]"
            fontSize={ringCount > 1 ? 15 : 18}
            fontWeight={800}
          >
            {centerValue}
          </text>
          <text
            x={120}
            y={124}
            textAnchor="middle"
            className="fill-[var(--muted)]"
            fontSize={10}
          >
            {centerLabel}
          </text>
        </svg>
      </div>
      <div className="w-full space-y-4">
        {displayRings.map((ring, ringIndex) => {
          const ringSlices = allSlices.filter((s) => s.ringIndex === ringIndex);
          if (!ringSlices.length) return null;
          return (
            <div key={ring.id}>
              {ring.label ? (
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                  {ring.label}
                </p>
              ) : null}
              <ul className="space-y-2 text-sm">
                {ringSlices.map((s, i) => (
                  <li
                    key={`${ring.id}-${s.label}-${i}`}
                    className="flex cursor-default items-center gap-2"
                    onMouseEnter={() =>
                      setHover({ ring: ringIndex, index: s.sliceIndex })
                    }
                    onMouseLeave={() => setHover(null)}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: s.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]">
                      {s.label}
                    </span>
                    <span className="tabular-nums text-[15px] font-bold text-[var(--brand-deep)]">
                      {formatCompact(s.value)}
                    </span>
                    <span className="w-10 text-right tabular-nums text-[var(--muted)]">
                      {s.pct}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PieChartSvg({ series }: { series: DashboardChartPoint[] }) {
  return (
    <DonutChartSvg rings={[{ id: "main", label: "", series }]} />
  );
}

function TrendChartSvg({ series }: { series: DashboardChartPoint[] }) {
  const data = withColors(series).slice(0, 31);
  const max = Math.max(1, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const span = Math.max(1, max - min);
  const [hovered, setHovered] = useState<number | null>(null);
  const w = 560;
  const h = 220;
  const padL = 36;
  const padB = 48;
  const padT = 20;
  const padR = 16;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const points = data.map((d, i) => {
    const x =
      data.length === 1
        ? padL + innerW / 2
        : padL + (i / (data.length - 1)) * innerW;
    const y = padT + innerH - ((d.value - min) / span) * innerH;
    return { ...d, x, y };
  });

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const area =
    points.length > 0
      ? `${line} L ${points[points.length - 1].x} ${h - padB} L ${points[0].x} ${h - padB} Z`
      : "";

  return (
    <div className="relative">
      <ChartHoverTooltip
        point={hovered != null ? data[hovered] ?? null : null}
      />
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Trend chart">
      <defs>
        <linearGradient id="moduleDashTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#203050" stopOpacity={0.28} />
          <stop offset="100%" stopColor="#203050" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <line
        x1={padL}
        y1={h - padB}
        x2={w - padR}
        y2={h - padB}
        stroke="rgba(32,48,80,0.15)"
      />
      {area ? <path d={area} fill="url(#moduleDashTrendFill)" /> : null}
      {line ? (
        <path
          d={line}
          fill="none"
          stroke="#203050"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="module-dash-trend"
        />
      ) : null}
      {points.map((p, i) => (
        <g
          key={`${p.label}-${i}`}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          className="cursor-pointer"
        >
          <circle
            cx={p.x}
            cy={p.y}
            r={hovered === i ? 7 : 5}
            fill="#c5a028"
            stroke="#203050"
            strokeWidth={2}
            opacity={hovered == null || hovered === i ? 1 : 0.45}
          />
          <text
            x={p.x}
            y={h - padB + 16}
            textAnchor="middle"
            className="fill-[var(--muted)]"
            fontSize={data.length > 14 ? 9 : 10}
          >
            {p.label.length > 8 ? `${p.label.slice(0, 7)}…` : p.label}
          </text>
        </g>
      ))}
    </svg>
    </div>
  );
}

function ChartToggle({
  value,
  onChange,
}: {
  value: ChartView;
  onChange: (v: ChartView) => void;
}) {
  const opts: { id: ChartView; label: string; icon: ReactNode }[] = [
    { id: "bar", label: "Bars", icon: <BarChart3 className="h-4 w-4" /> },
    { id: "pie", label: "Pie", icon: <PieChart className="h-4 w-4" /> },
    { id: "trend", label: "Trend", icon: <LineChart className="h-4 w-4" /> },
  ];
  return (
    <div
      className="inline-flex rounded-xl border border-[rgba(32,48,80,0.12)] bg-[rgba(248,248,240,0.9)] p-1"
      role="group"
      aria-label="Chart type"
    >
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition ${
              active
                ? "bg-[var(--brand-deep)] text-white shadow-sm"
                : "text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.08)]"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function compareDashboardRows(
  a: DashboardTableRow,
  b: DashboardTableRow,
  key: string,
  dir: "asc" | "desc",
): number {
  const av = a[key];
  const bv = b[key];
  const as = av == null ? "" : String(av);
  const bs = bv == null ? "" : String(bv);

  const parseNum = (raw: string) => {
    const n = Number(raw.replace(/[₹,\s%]/g, ""));
    return Number.isFinite(n) && /\d/.test(raw) ? n : NaN;
  };

  const an = typeof av === "number" ? av : parseNum(as);
  const bn = typeof bv === "number" ? bv : parseNum(bs);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) {
    return dir === "asc" ? an - bn : bn - an;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(as) && /^\d{4}-\d{2}-\d{2}/.test(bs)) {
    const cmp = as.localeCompare(bs);
    return dir === "asc" ? cmp : -cmp;
  }

  const cmp = as.localeCompare(bs, undefined, { sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

function DashboardTable({
  title,
  columns,
  rows,
  empty = "No records yet.",
  onRowClick,
  sortable = false,
}: {
  title: string;
  columns: DashboardTableColumn[];
  rows: DashboardTableRow[];
  empty?: string;
  onRowClick?: (row: DashboardTableRow) => void;
  /** Click column headers to sort (KPI detail lists). */
  sortable?: boolean;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function onSortColumn(key: string) {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const displayRows = useMemo(() => {
    if (!sortable || !sortKey) return rows;
    return [...rows].sort((a, b) =>
      compareDashboardRows(a, b, sortKey, sortDir),
    );
  }, [rows, sortKey, sortDir, sortable]);

  return (
    <section className="module-dash-panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-4 py-3 sm:px-5">
        <Table2 className="h-5 w-5 text-[#2563eb]" aria-hidden />
        <h3 className="text-base font-semibold text-[#2563eb]">
          {title}
        </h3>
        <span className="ml-auto rounded-full bg-white/80 px-3 py-1 text-sm font-bold tabular-nums text-[var(--brand-deep)]">
          {rows.length}
        </span>
      </div>
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[28rem] border-collapse text-left">
          <thead className="sticky top-0 z-[1] bg-[#f0efe6]">
            <tr>
              {columns.map((c) => {
                const active = sortKey === c.key;
                const SortIcon = !sortable
                  ? null
                  : !active
                    ? ArrowUpDown
                    : sortDir === "asc"
                      ? ArrowUp
                      : ArrowDown;
                return (
                  <th
                    key={c.key}
                    className={`px-4 py-3 text-[12px] font-bold uppercase tracking-[0.06em] text-[var(--muted)] ${
                      c.align === "right" ? "text-right" : ""
                    }`}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSortColumn(c.key)}
                        className={`inline-flex items-center gap-1 transition hover:text-[var(--brand-deep)] ${
                          c.align === "right" ? "ml-auto" : ""
                        } ${active ? "text-[var(--brand-deep)]" : ""}`}
                        aria-label={`Sort by ${c.label}`}
                      >
                        <span>{c.label}</span>
                        {SortIcon ? (
                          <SortIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                        ) : null}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-base text-[var(--muted)]"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              displayRows.map((row, idx) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={`border-t border-[rgba(32,48,80,0.06)] transition hover:bg-[rgba(197,160,40,0.08)] ${
                    idx % 2 === 0 ? "bg-white" : "bg-[rgba(248,248,240,0.65)]"
                  } ${onRowClick ? "cursor-pointer" : ""}`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-3.5 text-[16px] text-[var(--ink)] ${
                        c.align === "right"
                          ? "text-right font-semibold tabular-nums"
                          : "font-medium"
                      }`}
                    >
                      {row[c.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KpiDetailDrawer({
  kpi,
  onClose,
  onOpenTab,
  onOpenHref,
}: {
  kpi: DashboardKpi;
  onClose: () => void;
  onOpenTab?: (tab: string) => void;
  onOpenHref?: (href: string) => void;
}) {
  const titleId = useId();
  const printRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    const node = printRef.current;
    if (!node) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(`
      <!DOCTYPE html><html><head><title>${kpi.detailTitle || kpi.label}</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 24px; color: #203050; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        .meta { color: #64748b; margin-bottom: 16px; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
        th { background: #f8fafc; }
        td.num { text-align: right; font-variant-numeric: tabular-nums; }
      </style></head><body>
      ${node.innerHTML}
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(32,48,80,0.45)] p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="module-dash-drawer max-h-[88vh] w-full max-w-2xl overflow-auto rounded-2xl bg-[var(--brand-cream)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start gap-3 border-b border-[rgba(32,48,80,0.1)] bg-[var(--brand-cream)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              KPI detail
            </p>
            <h2
              id={titleId}
              className="font-display text-2xl font-bold text-[var(--brand-deep)] sm:text-3xl"
            >
              {kpi.detailTitle || kpi.label}
            </h2>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[var(--brand-deep)] sm:text-3xl">
              {kpi.value}
            </p>
            {kpi.hint ? (
              <p className="mt-1 text-base text-[var(--muted)]">{kpi.hint}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(32,48,80,0.15)] text-[var(--brand-deep)] hover:bg-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 sm:p-5">
          {kpi.detailColumns && kpi.detailRows ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-end gap-2 print:hidden">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[rgba(32,48,80,0.15)] bg-white px-3.5 text-sm font-semibold text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
                >
                  <Printer className="h-4 w-4" />
                  Print list
                </button>
              </div>
              <div ref={printRef}>
                <h3 className="hidden print:block text-lg font-bold">
                  {kpi.detailTitle || kpi.label}
                </h3>
                <p className="hidden print:block meta text-sm text-gray-500">
                  {kpi.value}
                  {kpi.hint ? ` · ${kpi.hint}` : ""}
                </p>
                <DashboardTable
                  key={kpi.id}
                  title="Breakdown"
                  columns={kpi.detailColumns}
                  rows={kpi.detailRows}
                  sortable
                />
                <p className="mt-2 text-xs text-[var(--muted)] print:hidden">
                  Click a column header to sort the list.
                </p>
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-white/70 px-4 py-8 text-center text-base text-[var(--muted)]">
              Open the related workspace tab for full records.
            </p>
          )}
          {kpi.tab && onOpenTab ? (
            <button
              type="button"
              onClick={() => {
                onOpenTab(kpi.tab!);
                onClose();
              }}
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-deep)] px-4 text-base font-bold text-white hover:bg-[var(--brand-mid)]"
            >
              Open {kpi.label}
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : kpi.href && onOpenHref ? (
            <button
              type="button"
              onClick={() => {
                onOpenHref(kpi.href!);
                onClose();
              }}
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-deep)] px-4 text-base font-bold text-white hover:bg-[var(--brand-mid)]"
            >
              Open {kpi.label}
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ChartPanel({
  title,
  series,
  rings,
  center,
  defaultView = "bar",
  ranges,
  defaultRangeId,
}: {
  title: string;
  series: DashboardChartPoint[];
  rings?: DashboardChartRing[];
  center?: DashboardChartCenter;
  defaultView?: ChartView;
  ranges?: DashboardChartRange[];
  defaultRangeId?: string;
}) {
  const [chartView, setChartView] = useState<ChartView>(defaultView);
  const [rangeId, setRangeId] = useState(
    defaultRangeId || ranges?.[0]?.id || "default",
  );
  const activeRange =
    ranges?.find((r) => r.id === rangeId) ?? ranges?.[0] ?? null;
  const panelTitle = activeRange?.title ?? title;
  const data = (activeRange?.series ?? series).length
    ? activeRange?.series ?? series
    : [{ label: "—", value: 0 }];
  const pieRings =
    rings && rings.length > 0
      ? rings
      : [{ id: "main", label: "", series: data }];
  const hasMultiRing = Boolean(rings && rings.length > 1);
  return (
    <section className="module-dash-panel p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-[#2563eb] sm:text-base">
          {panelTitle}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {ranges && ranges.length > 1 ? (
            <div
              className="inline-flex rounded-xl border border-[rgba(32,48,80,0.12)] bg-[rgba(248,248,240,0.9)] p-1"
              role="group"
              aria-label="Chart range"
            >
              {ranges.map((r) => {
                const active = rangeId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRangeId(r.id)}
                    aria-pressed={active}
                    className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition ${
                      active
                        ? "bg-[var(--brand-deep)] text-white shadow-sm"
                        : "text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.08)]"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <ChartToggle value={chartView} onChange={setChartView} />
        </div>
      </div>
      <div className="min-h-[220px] rounded-xl bg-[rgba(248,248,240,0.65)] p-2 sm:p-3">
        {chartView === "bar" ? <BarChartSvg series={data} /> : null}
        {chartView === "pie" ? (
          <DonutChartSvg rings={pieRings} center={center} />
        ) : null}
        {chartView === "trend" ? <TrendChartSvg series={data} /> : null}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        {hasMultiRing
          ? "Hover an outer segment to highlight linked payment modes on the inner ring."
          : "Hover a bar or point for payment mode break-up."}
      </p>
    </section>
  );
}

export function ModuleDashboardView({
  model,
  onNavigateTab,
  onTableRowClick,
  variant = "module",
}: {
  model: ModuleDashboardModel;
  onNavigateTab?: (tab: string) => void;
  onTableRowClick?: (row: DashboardTableRow) => void;
  variant?: "module" | "school";
}) {
  const router = useRouter();
  const [activeKpi, setActiveKpi] = useState<DashboardKpi | null>(null);
  const primarySeries = useMemo(
    () =>
      model.chartSeries.length ? model.chartSeries : [{ label: "—", value: 0 }],
    [model.chartSeries],
  );
  const hasExtraCharts = !!(model.extraCharts && model.extraCharts.length > 0);

  function onKpiClick(kpi: DashboardKpi) {
    if (kpi.detailRows?.length || kpi.detailColumns) {
      setActiveKpi(kpi);
      return;
    }
    if (kpi.href) {
      if (typeof window !== "undefined") {
        window.location.href = kpi.href;
      } else {
        router.push(kpi.href);
      }
      return;
    }
    if (kpi.tab && onNavigateTab) {
      onNavigateTab(kpi.tab);
      return;
    }
    setActiveKpi(kpi);
  }

  const heroEyebrow =
    model.heroEyebrow ||
    (variant === "school" ? "School overview" : "Module dashboard");

  return (
    <div className="module-dash mt-4 space-y-5 sm:space-y-6">
      <header className="module-dash-hero rounded-2xl px-5 py-6 sm:px-7 sm:py-8">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--brand-gold)]">
          {heroEyebrow}
        </p>
        <h2 className="mt-1 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
          {model.title}
        </h2>
        <p className="mt-2 max-w-3xl text-base text-white/85 sm:text-lg">
          {model.subtitle}
        </p>
      </header>

      <section aria-label="Key performance indicators" className="space-y-5">
        {(model.kpiSections && model.kpiSections.length > 0
          ? model.kpiSections
          : [
              {
                id: "main",
                title: "",
                kpis: model.kpis,
              },
            ]
        ).map((section) => (
          <div key={section.id}>
            {section.title ? (
              <div className="mb-3">
                <h3 className="font-display text-xl font-bold text-[var(--brand-deep)] sm:text-2xl">
                  {section.title}
                </h3>
                {section.hint ? (
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {section.hint}
                  </p>
                ) : null}
              </div>
            ) : null}
            <ErpMetricGrid>
              {section.kpis.map((kpi) => {
                const tone = kpi.tone || "navy";
                const footer = (
                  <>
                    {kpi.breakdown && kpi.breakdown.length > 0 ? (
                      <ul className="mt-2 space-y-0.5 border-t border-[rgba(32,48,80,0.08)] pt-2">
                        {kpi.breakdown.map((b) => (
                          <li
                            key={b.label}
                            className="flex items-center justify-between gap-2 text-xs text-[var(--ink)]"
                          >
                            <span className="text-muted-foreground">{b.label}</span>
                            <span className="font-semibold tabular-nums">
                              {b.value}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {kpi.hint ? (
                      <p className="mt-2 text-xs leading-snug text-muted-foreground">
                        {kpi.hint}
                      </p>
                    ) : null}
                  </>
                );
                return (
                  <ErpMetricCard
                    key={kpi.id}
                    title={kpi.label}
                    value={kpi.value}
                    tone={dashboardToneToMetric(tone)}
                    icon={kpiIconForTone(tone)}
                    onClick={() => onKpiClick(kpi)}
                    footer={footer}
                    className="module-dash-kpi"
                  />
                );
              })}
            </ErpMetricGrid>
          </div>
        ))}
      </section>

      <div
        className={
          hasExtraCharts ? "grid gap-5 lg:grid-cols-2" : undefined
        }
      >
        <ChartPanel
          title={model.chartTitle}
          series={primarySeries}
          rings={model.chartRings}
          center={model.chartCenter}
          defaultView={model.chartDefaultView || "bar"}
          ranges={model.chartRanges}
          defaultRangeId={model.chartRangeDefault}
        />
        {hasExtraCharts
          ? model.extraCharts!.map((c) => (
              <ChartPanel
                key={c.title}
                title={c.title}
                series={c.series.length ? c.series : [{ label: "—", value: 0 }]}
                rings={c.rings}
                center={c.center}
                defaultView={c.defaultView || "trend"}
              />
            ))
          : null}
      </div>

      {model.extraTables && model.extraTables.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <DashboardTable
            title={model.tableTitle}
            columns={model.tableColumns}
            rows={model.tableRows}
            onRowClick={onTableRowClick}
          />
          {model.extraTables.map((t) => (
            <DashboardTable
              key={t.title}
              title={t.title}
              columns={t.columns}
              rows={t.rows}
              onRowClick={onTableRowClick}
            />
          ))}
        </div>
      ) : (
        <DashboardTable
          title={model.tableTitle}
          columns={model.tableColumns}
          rows={model.tableRows}
          onRowClick={onTableRowClick}
        />
      )}

      {model.quickLinks && model.quickLinks.length > 0 ? (
        <section className="module-dash-panel p-4 sm:p-5">
          <h3 className="text-base font-semibold text-[#2563eb]">Jump in</h3>
          <ErpToolbar className="mt-3 justify-start">
            {model.quickLinks.map((link) =>
              link.href ? (
                <ErpToolbarBtn
                  key={link.label}
                  icon={<ChevronRight className="h-4 w-4" />}
                  label={link.label}
                  href={link.href}
                />
              ) : (
                <ErpToolbarBtn
                  key={link.label}
                  icon={<ChevronRight className="h-4 w-4" />}
                  label={link.label}
                  onClick={() =>
                    link.tab && onNavigateTab ? onNavigateTab(link.tab) : undefined
                  }
                />
              ),
            )}
          </ErpToolbar>
        </section>
      ) : null}

      {activeKpi ? (
        <KpiDetailDrawer
          kpi={activeKpi}
          onClose={() => setActiveKpi(null)}
          onOpenTab={onNavigateTab}
          onOpenHref={(href) => router.push(href)}
        />
      ) : null}
    </div>
  );
}

"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui/empty-state";

// Passed straight through as SVG `fill`/`stroke` — modern browsers resolve
// CSS custom properties there fine on screen, so both themes render with no
// JS-side theme plumbing. (Print flows, e.g. fee receipts, don't go through
// these charts — that's the one place var() in fill has bitten this repo
// before; see erp-charts.tsx's literal ERP_CHART_COLORS.)
export const ERP_CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

export type ErpChartRow = {
  key: string;
  label: string;
  value: number;
  color?: string;
};

// isAnimationActive={false} on every primitive below, deliberately: Recharts'
// enter animation is driven by requestAnimationFrame, and a backgrounded or
// throttled tab (e.g. mounting a dashboard in a background tab) can leave a
// chart frozen on its zero-value first frame — an empty-looking bar chart or
// a sliver-thin pie that never resolves. Static charts sidestep that failure
// mode entirely; dashboards refresh on real data changes, not on animation.

function colorFor(row: ErpChartRow, i: number, palette: string[]): string {
  return row.color || palette[i % palette.length]!;
}

function ErpChartTooltip({
  active,
  payload,
  valueFormatter,
}: {
  active?: boolean;
  payload?: { payload: ErpChartRow }[];
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left shadow-[var(--shadow-3)]">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
        {row.label}
      </p>
      <p className="mt-0.5 font-display text-base font-bold tabular-nums text-[var(--brand-deep)]">
        {valueFormatter ? valueFormatter(row.value) : row.value}
      </p>
    </div>
  );
}

/** Empty-state fallback shared by every chart primitive below. */
function ChartEmpty({ label = "No data yet" }: { label?: string }) {
  return <EmptyState title={label} className="border-none bg-transparent py-8 shadow-none" />;
}

export function ErpBar({
  rows,
  color = "var(--chart-1)",
  height = 220,
  valueFormatter,
  emptyLabel = "No data yet",
}: {
  rows: ErpChartRow[];
  color?: string;
  height?: number;
  valueFormatter?: (value: number) => string;
  emptyLabel?: string;
}) {
  if (rows.length === 0 || rows.every((r) => r.value === 0)) {
    return <ChartEmpty label={emptyLabel} />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          interval={0}
          angle={rows.length > 6 ? -28 : 0}
          textAnchor={rows.length > 6 ? "end" : "middle"}
          height={rows.length > 6 ? 46 : 24}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          cursor={{ fill: "var(--surface-sunken)" }}
          content={<ErpChartTooltip valueFormatter={valueFormatter} />}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.key} fill={row.color || color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ErpDonut({
  rows,
  colors = ERP_CHART_COLORS,
  height = 220,
  innerRadius = "58%",
  outerRadius = "88%",
  centerLabel,
  centerValue,
  emptyLabel = "No data yet",
}: {
  rows: ErpChartRow[];
  colors?: string[];
  height?: number;
  innerRadius?: number | string;
  outerRadius?: number | string;
  centerLabel?: string;
  centerValue?: string;
  emptyLabel?: string;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total === 0) {
    return <ChartEmpty label={emptyLabel} />;
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="label"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={rows.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {rows.map((row, i) => (
                <Cell key={row.key} fill={colorFor(row, i, colors)} />
              ))}
            </Pie>
            <Tooltip
              content={(props: {
                active?: boolean;
                payload?: readonly { payload?: unknown }[];
              }) => {
                const { active, payload } = props;
                if (!active || !payload?.length) return null;
                const row = payload[0]!.payload as ErpChartRow;
                const pct = Math.round((row.value / total) * 100);
                return (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-center shadow-[var(--shadow-3)]">
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                      {row.label}
                    </p>
                    <p className="tabular-nums text-sm font-semibold text-[var(--ink)]">
                      {row.value} · {pct}%
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {centerValue || centerLabel ? (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
            aria-hidden
          >
            {centerValue ? (
              <span className="font-display text-lg font-extrabold text-[var(--brand-deep)]">
                {centerValue}
              </span>
            ) : null}
            {centerLabel ? (
              <span className="text-[10px] text-[var(--muted)]">{centerLabel}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <ul className="min-w-[7rem] space-y-1.5 text-sm">
        {rows.map((row, i) => (
          <li key={row.key} className="flex items-center gap-2 text-[var(--ink)]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: colorFor(row, i, colors) }}
            />
            <span>
              {row.label}{" "}
              <span className="tabular-nums text-[var(--muted)]">
                ({row.value})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ErpArea({
  rows,
  color = "var(--chart-1)",
  height = 220,
  valueFormatter,
  emptyLabel = "No data yet",
}: {
  rows: ErpChartRow[];
  color?: string;
  height?: number;
  valueFormatter?: (value: number) => string;
  emptyLabel?: string;
}) {
  const gradientId = useId();
  if (rows.length === 0) {
    return <ChartEmpty label={emptyLabel} />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--muted)" }}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          content={<ErpChartTooltip valueFormatter={valueFormatter} />}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
          dot={{ r: 3, fill: color, strokeWidth: 0 }}
          activeDot={{ r: 6, fill: "var(--brand-gold)", stroke: color, strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ErpSparkline({
  rows,
  color = "var(--chart-1)",
  height = 36,
  width = 96,
}: {
  rows: ErpChartRow[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (rows.length < 2) return null;
  return (
    <LineChart width={width} height={height} data={rows}>
      <Line
        type="monotone"
        dataKey="value"
        stroke={color}
        strokeWidth={2}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}

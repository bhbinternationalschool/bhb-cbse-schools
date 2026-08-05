"use client";

export type ErpChartRow = { key: string; label: string; count: number };

export const ERP_CHART_COLORS = [
  "#2563eb",
  "#ef4444",
  "#f97316",
  "#16a34a",
  "#8b5cf6",
  "#0891b2",
  "#e11d48",
  "#ca8a04",
];

export function ErpBarChart({
  rows,
  yLabel,
  xLabel,
  barColor,
  emptyLabel = "No data yet",
}: {
  rows: ErpChartRow[];
  yLabel: string;
  xLabel: string;
  barColor: string;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const niceMax = Math.ceil(max / 2) * 2 || 2;
  const w = 420;
  const h = 220;
  const padL = 42;
  const padR = 12;
  const padT = 12;
  const padB = 58;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const gap = 8;
  const barW =
    rows.length > 0 ? Math.max(10, (plotW - gap * rows.length) / rows.length) : 20;

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mx-auto h-auto w-full min-w-[280px] max-w-full"
        role="img"
        aria-label={`${xLabel} bar chart`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * (1 - t);
          const val = Math.round(niceMax * t);
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-[#64748b]"
                fontSize={10}
              >
                {val}
              </text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const bh = (r.count / niceMax) * plotH;
          const x = padL + gap / 2 + i * (barW + gap);
          const y = padT + plotH - bh;
          return (
            <g key={r.key}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(bh, 1)}
                fill={barColor}
                rx={3}
              />
              <text
                x={x + barW / 2}
                y={h - 28}
                textAnchor="middle"
                className="fill-[#475569]"
                fontSize={9}
                transform={`rotate(-28 ${x + barW / 2} ${h - 28})`}
              >
                {r.label.length > 12 ? `${r.label.slice(0, 11)}…` : r.label}
              </text>
              {r.count > 0 ? (
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  textAnchor="middle"
                  className="fill-[#334155]"
                  fontSize={10}
                  fontWeight={600}
                >
                  {r.count}
                </text>
              ) : null}
            </g>
          );
        })}
        <text
          x={16}
          y={h / 2}
          textAnchor="middle"
          className="fill-[#64748b]"
          fontSize={10}
          transform={`rotate(-90 16 ${h / 2})`}
        >
          {yLabel}
        </text>
        <text
          x={padL + plotW / 2}
          y={h - 6}
          textAnchor="middle"
          className="fill-[#64748b]"
          fontSize={10}
        >
          {xLabel}
        </text>
      </svg>
    </div>
  );
}

export function ErpPieChart({
  rows,
  colors = ERP_CHART_COLORS,
  emptyLabel = "No data yet",
}: {
  rows: ErpChartRow[];
  colors?: string[];
  emptyLabel?: string;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 68;
  let angle = -Math.PI / 2;

  const slices = rows.map((row, i) => {
    const frac = row.count / total;
    const start = angle;
    const sweep = frac * Math.PI * 2;
    angle += sweep;
    const end = angle;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const mid = start + sweep / 2;
    const lx = cx + r * 0.62 * Math.cos(mid);
    const ly = cy + r * 0.62 * Math.sin(mid);
    const path =
      frac >= 0.999
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return {
      ...row,
      path,
      color: colors[i % colors.length]!,
      pct: Math.round(frac * 1000) / 10,
      lx,
      ly,
      showLabel: frac >= 0.08,
    };
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-44 w-44"
        role="img"
        aria-label="Pie chart"
      >
        {slices.map((s) => (
          <g key={s.key}>
            <path d={s.path} fill={s.color} />
            {s.showLabel ? (
              <text
                x={s.lx}
                y={s.ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={11}
                fontWeight={700}
              >
                {s.pct}%
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <ul className="min-w-[7rem] space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[#334155]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: s.color }}
            />
            <span>
              {s.label}{" "}
              <span className="tabular-nums text-muted-foreground">
                ({s.count})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

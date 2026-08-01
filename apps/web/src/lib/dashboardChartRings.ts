/**
 * Helpers for dual-ring (concentric donut) dashboard charts.
 */

import type {
  DashboardChartBlock,
  DashboardChartCenter,
  DashboardChartPoint,
  DashboardChartRing,
  ChartView,
} from "@/components/dashboard/ModuleDashboard";

export type DualRingFields = {
  chartSeries: DashboardChartPoint[];
  chartRings: DashboardChartRing[];
  chartCenter: DashboardChartCenter;
  chartDefaultView?: ChartView;
};

export type DualRingLayers = {
  chartRings: DashboardChartRing[];
  chartCenter: DashboardChartCenter;
};

export function chartPt(
  label: string,
  value: number,
  color?: string,
  modeBreakup?: { label: string; value: number }[],
): DashboardChartPoint {
  return { label, value, color, modeBreakup };
}

export function nonZero(points: DashboardChartPoint[]): DashboardChartPoint[] {
  return points.filter((p) => p.value > 0);
}

export function withFallback(
  points: DashboardChartPoint[],
  emptyLabel = "—",
): DashboardChartPoint[] {
  const nz = nonZero(points);
  return nz.length ? nz : [{ label: emptyLabel, value: 0 }];
}

/** Keep top segments; roll the rest into one slice. */
export function topChartPoints(
  points: DashboardChartPoint[],
  limit = 6,
  otherLabel = "Other",
): DashboardChartPoint[] {
  const nz = nonZero(points);
  if (nz.length <= limit) return nz;
  const head = nz.slice(0, limit - 1);
  const rest = nz.slice(limit - 1).reduce((s, p) => s + p.value, 0);
  return [...head, { label: otherLabel, value: rest }];
}

export function dualRingLayers(
  outerLabel: string,
  outer: DashboardChartPoint[],
  innerLabel: string,
  inner: DashboardChartPoint[],
  centerValue: string,
  centerLabel: string,
): DualRingLayers {
  const outerSeries = withFallback(outer);
  const innerSeries = withFallback(inner);
  return {
    chartRings: [
      { id: "outer", label: outerLabel, series: outerSeries },
      { id: "inner", label: innerLabel, series: innerSeries },
    ],
    chartCenter: { value: centerValue, label: centerLabel },
  };
}

export function dualRing(
  outerLabel: string,
  outer: DashboardChartPoint[],
  innerLabel: string,
  inner: DashboardChartPoint[],
  centerValue: string,
  centerLabel: string,
  defaultView: ChartView = "pie",
): DualRingLayers & { chartDefaultView?: ChartView } {
  return {
    ...dualRingLayers(
      outerLabel,
      outer,
      innerLabel,
      inner,
      centerValue,
      centerLabel,
    ),
    chartDefaultView: defaultView,
  };
}

export function dualRingBlock(
  title: string,
  outerLabel: string,
  outer: DashboardChartPoint[],
  innerLabel: string,
  inner: DashboardChartPoint[],
  centerValue: string,
  centerLabel: string,
  defaultView: ChartView = "pie",
): DashboardChartBlock {
  const layers = dualRingLayers(
    outerLabel,
    outer,
    innerLabel,
    inner,
    centerValue,
    centerLabel,
  );
  return {
    title,
    series: layers.chartRings[0]!.series,
    rings: layers.chartRings,
    center: layers.chartCenter,
    defaultView,
  };
}

export function feePositionLayers(
  collectedPaise: number,
  openPaise: number,
  arrearsPaise: number,
  modeBreakup: { label: string; value: number }[],
  centerValue: string,
): DualRingLayers {
  return dualRingLayers(
    "Fee position",
    [
      chartPt("Collected", Math.round(collectedPaise / 100), "#15803d", modeBreakup),
      chartPt("Open dues", Math.round(openPaise / 100), "#c2410c"),
      chartPt("Arrears", Math.round(arrearsPaise / 100), "#c5a028"),
    ],
    "Collection modes",
    modeBreakup.map((m) => chartPt(m.label, m.value)),
    centerValue,
    "collected",
  );
}

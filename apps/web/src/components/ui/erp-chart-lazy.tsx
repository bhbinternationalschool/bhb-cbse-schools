"use client";

import dynamic from "next/dynamic";
import { SkeletonChart } from "@/components/ui/skeleton";

// Dashboards must import charts from here, never from erp-chart.tsx directly
// — that keeps Recharts in an async chunk so form/list routes that never
// render a chart don't pay for it in their first-load JS.
const loading = () => <SkeletonChart />;

export const ErpBar = dynamic(
  () => import("@/components/ui/erp-chart").then((m) => m.ErpBar),
  { ssr: false, loading },
);

export const ErpDonut = dynamic(
  () => import("@/components/ui/erp-chart").then((m) => m.ErpDonut),
  { ssr: false, loading },
);

export const ErpArea = dynamic(
  () => import("@/components/ui/erp-chart").then((m) => m.ErpArea),
  { ssr: false, loading },
);

export const ErpSparkline = dynamic(
  () => import("@/components/ui/erp-chart").then((m) => m.ErpSparkline),
  { ssr: false, loading: () => <div className="h-9 w-24" /> },
);

export type { ErpChartRow } from "@/components/ui/erp-chart";
export { ERP_CHART_COLORS } from "@/components/ui/erp-chart";

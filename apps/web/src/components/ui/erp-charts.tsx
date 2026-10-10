"use client";

/**
 * @deprecated Superseded by erp-chart-lazy.tsx (Recharts-based, dark-mode
 * aware). No remaining call sites as of Phase 1 of the visual upgrade
 * (docs/plans/woolly-riding-quail.md) — kept as a re-export through Phase 2,
 * then deleted.
 */
export {
  ErpBar as ErpBarChart,
  ErpDonut as ErpPieChart,
  ERP_CHART_COLORS,
  type ErpChartRow,
} from "@/components/ui/erp-chart-lazy";

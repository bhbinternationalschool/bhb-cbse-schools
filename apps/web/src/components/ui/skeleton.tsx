import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-[var(--border)]",
        className
      )}
      {...props}
    />
  )
}

/** KPI-card-shaped placeholder — mirrors the ModuleDashboard KPI tile grid. */
function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="erp-surface-sm space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-12" />
        </div>
      ))}
    </div>
  )
}

/** Table-shaped placeholder — header bar + N row bars. */
function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="erp-data-table-wrap">
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  )
}

/** Default module-page placeholder: heading + KPI row + table. */
function SkeletonModulePage() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <SkeletonKpiRow />
      <SkeletonTable />
    </div>
  )
}

/** Chart-shaped placeholder — reserves the plot area while Recharts' async chunk loads. */
function SkeletonChart({ height = 220 }: { height?: number }) {
  return (
    <div
      className="flex items-end gap-2 rounded-xl bg-[var(--surface-sunken)] p-4"
      style={{ height }}
      role="status"
      aria-label="Loading chart"
    >
      {[40, 65, 45, 80, 55, 70, 50].map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-t-md rounded-b-none" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonKpiRow, SkeletonTable, SkeletonModulePage, SkeletonChart }

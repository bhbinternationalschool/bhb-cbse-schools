"use client";

/**
 * Admissions → Village market grid.
 *
 * One card per village inside the radius: the published Census 2011 baseline
 * beside this year's projection, the estimated 0-6 pool as a bar, and the
 * leads our field agents have actually registered there as a share of that
 * pool. The office reads this to decide where the next camp, banner or bus
 * route goes.
 *
 * Two rules the UI holds to:
 *  · Projected numbers are always labelled as estimates, never as counts.
 *  · A village we cannot size shows "—", never "0%". Unmeasured and empty
 *    are different answers and sending a bus on the wrong one is expensive.
 */

import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Baby,
  Compass,
  MapPin,
  MessageCircle,
  RefreshCw,
  Download,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { VillageAliasPanel } from "@/components/admissions/VillageAliasPanel";
import { erpBtn, erpBtnOutline, erpField } from "@/components/ui/erp-ui";
import {
  type BlockMarketRow,
  type CityWardDirectoryResult,
  type CityWardDirectoryWard,
  DEFAULT_ORIGIN,
  DEFAULT_RADIUS_M,
  buildMetaCustomAudienceCsv,
  buildVillageTargetingCsv,
  countUniquePhones,
  formatIndianNumber,
  formatPct,
  opportunityScore,
  type PenetrationBand,
  type VillageGridQuery,
  type VillageGridSort,
  type VillageGridState,
  type VillageMarketRow,
  type VillageQueryMode,
  type SettlementFilter,
  type VillageContactsResult,
  type VillagesNearbyResult,
} from "@/lib/villageMarket";

const RADIUS_OPTIONS = [
  { value: 5000, label: "5 km" },
  { value: 10000, label: "10 km" },
  { value: 15000, label: "15 km" },
  { value: 25000, label: "25 km" },
];

/** Minimum projected 0-6 pool — "is this village big enough to bother with". */
const POOL_OPTIONS = [
  { value: 0, label: "Any size" },
  { value: 50, label: "50+ children" },
  { value: 100, label: "100+ children" },
  { value: 250, label: "250+ children" },
  { value: 500, label: "500+ children" },
];

const TYPE_OPTIONS: { value: SettlementFilter; label: string }[] = [
  { value: "all", label: "All settlements" },
  { value: "village", label: "Villages only" },
  { value: "town", label: "Census towns only" },
  { value: "ward", label: "City wards only" },
];

/** Client-side view filter — depends on leads, which only the server knows. */
const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  { value: "untouched", label: "No leads yet" },
  { value: "low", label: "Low reach (<2%)" },
  { value: "worked", label: "Already working (2%+)" },
] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

/** Cards shown per page — 1,292 settlements is not a screen. */
const PAGE_SIZE = 24;

const SORT_OPTIONS: { value: VillageGridSort; label: string }[] = [
  { value: "opportunity", label: "Biggest opportunity" },
  { value: "distance", label: "Nearest first" },
  { value: "pool", label: "Largest child pool" },
  { value: "penetration", label: "Weakest penetration" },
];

const BAND_STYLE: Record<PenetrationBand, { chip: string; bar: string; label: string }> = {
  unknown: {
    chip: "border-[var(--border)] bg-[var(--muted-surface)] text-[var(--muted)]",
    bar: "bg-[var(--muted)]",
    label: "Not sized",
  },
  untouched: {
    chip: "border-[var(--danger)]/25 bg-[var(--danger-soft)] text-[var(--danger)]",
    bar: "bg-[var(--danger)]",
    label: "No leads yet",
  },
  low: {
    chip: "border-[var(--warning)]/25 bg-[var(--warning-soft)] text-[var(--warning)]",
    bar: "bg-[var(--warning)]",
    label: "Low reach",
  },
  medium: {
    chip: "border-[var(--info)]/25 bg-[var(--info-soft)] text-[var(--info)]",
    bar: "bg-[var(--info)]",
    label: "Building",
  },
  high: {
    chip: "border-[var(--success)]/25 bg-[var(--success-soft)] text-[var(--success)]",
    bar: "bg-[var(--success)]",
    label: "Strong reach",
  },
};

/* ─── Error boundary ───────────────────────────────────────── */

/**
 * A render-time crash in one card must not blank the whole admissions
 * workspace. Data errors are handled in state; this catches the rest.
 */
class GridErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { message: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : "Unexpected error" };
  }

  componentDidCatch(error: unknown) {
    console.error("[VillageDemographicsGrid] render failed:", error);
  }

  render() {
    if (this.state.message) {
      return (
        <div className="erp-surface space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--danger)]">
            <AlertTriangle className="size-4" aria-hidden />
            Village market view could not be drawn
          </p>
          <p className="text-xs text-[var(--muted)]">{this.state.message}</p>
          <button
            type="button"
            className={erpBtnOutline}
            onClick={() => this.setState({ message: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─── Small presentational pieces ──────────────────────────── */

function MetricPair({
  label,
  baseline,
  projected,
  baselineYear,
  targetYear,
}: {
  label: string;
  baseline: number;
  projected: number;
  baselineYear: number;
  targetYear: number;
}) {
  const delta = baseline > 0 ? Math.round(((projected - baseline) / baseline) * 100) : null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2.5 py-2">
      <p className="text-micro font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-sm tabular-nums text-[var(--muted)]">
          {formatIndianNumber(baseline)}
        </span>
        <span className="text-micro text-[var(--muted)]">{baselineYear}</span>
        <span aria-hidden className="text-[var(--muted)]">
          →
        </span>
        <span className="text-base font-semibold tabular-nums text-[var(--brand-deep)]">
          {formatIndianNumber(projected)}
        </span>
        <span className="text-micro text-[var(--muted)]">{targetYear} est.</span>
      </div>
      {delta !== null ? (
        <p className="text-micro text-[var(--muted)]">
          {delta >= 0 ? "+" : ""}
          {delta}% projected
        </p>
      ) : null}
    </div>
  );
}

function ChildPoolBar({
  pool,
  leads,
  band,
}: {
  pool: number;
  leads: number;
  band: PenetrationBand;
}) {
  // The bar shows the SHARE OF THE POOL WE HAVE REACHED, floored at a
  // hairline so "we have some leads" never renders as an empty bar.
  const covered = pool > 0 ? Math.min(100, (leads / pool) * 100) : 0;
  const width = leads > 0 && covered < 1.5 ? 1.5 : covered;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-micro text-[var(--muted)]">
        <span className="inline-flex items-center gap-1">
          <Baby className="size-3" aria-hidden />
          Est. school-age pool (0-6)
        </span>
        <span className="tabular-nums">
          {formatIndianNumber(leads)} / {formatIndianNumber(pool)}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--muted-surface)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={pool}
        aria-valuenow={leads}
        aria-label={`Registered leads against the estimated 0 to 6 child pool: ${leads} of about ${pool}`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${BAND_STYLE[band].bar}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function VillageCard({ row }: { row: VillageMarketRow }) {
  const style = BAND_STYLE[row.penetrationBand];
  const census = row.census;

  return (
    <article className="erp-surface-sm flex flex-col gap-3">
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--brand-deep)]">
              {census?.villageName || row.osmName}
            </h3>
            <p className="truncate text-micro text-[var(--muted)]">
              {census?.blockName
                ? census.settlementType === "ward"
                  ? census.blockName
                  : `Block ${census.blockName}`
                : "Block unknown"}
              {census?.districtName ? ` · ${census.districtName}` : ""}
              {` · ${row.placeType}`}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-micro font-semibold ${style.chip}`}
          >
            {style.label}
          </span>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-micro text-[var(--muted)]">
          {row.lat !== null && row.lon !== null ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {row.lat.toFixed(4)}, {row.lon.toFixed(4)}
            </span>
          ) : (
            // Census PCA carries no coordinates. Saying "not mapped" is
            // honest; showing 0.0000, 0.0000 would put the village off Africa.
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              Not mapped
            </span>
          )}
          {row.distanceKm !== null ? (
            <span className="inline-flex items-center gap-1">
              <Compass className="size-3" aria-hidden />
              {row.distanceKm.toFixed(1)} km from school
            </span>
          ) : null}
          {census?.censusCode ? <span>PCA {census.censusCode}</span> : null}
        </p>
      </header>

      {census ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <MetricPair
              label="Total population"
              baseline={census.baseline.popTotal}
              projected={census.projected.popTotal}
              baselineYear={census.baseline.year}
              targetYear={census.projected.targetYear}
            />
            <MetricPair
              label="Children 0-6"
              baseline={census.baseline.child06Total}
              projected={census.projected.child06Total}
              baselineYear={census.baseline.year}
              targetYear={census.projected.targetYear}
            />
          </div>

          <ChildPoolBar
            pool={census.projected.child06Total}
            leads={row.leads.total}
            band={row.penetrationBand}
          />

          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2 ${style.chip}`}
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
              <Target className="size-3.5" aria-hidden />
              {row.leadAttribution === "ambiguous"
                ? "Leads not attributable"
                : `${formatIndianNumber(row.leads.total)} registered lead${row.leads.total === 1 ? "" : "s"}`}
            </span>
            <span className="text-xs font-semibold tabular-nums">
              {formatPct(row.penetrationPct)} penetration
            </span>
          </div>

          {row.leadAttribution === "ambiguous" ? (
            <p className="text-micro text-[var(--warning)]">
              Another village in this list has the same name, so leads matched by
              name cannot be split between them. Counted against the larger one
              rather than against both.
            </p>
          ) : null}

          {row.travel || row.scores ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-micro">
              {row.travel && row.travel.distanceKm !== null ? (
                <span className="inline-flex items-center gap-1 text-[var(--muted)]">
                  <Compass className="size-3" aria-hidden />
                  {row.travel.minutes !== null
                    ? `${row.travel.minutes} min drive`
                    : `${row.travel.distanceKm.toFixed(1)} km`}
                  {/* A straight line reads optimistically around Varanasi, so
                      it is never allowed to look like a road route. */}
                  {row.travel.source === "haversine" ? (
                    <span className="text-[var(--warning)]"> (straight line)</span>
                  ) : null}
                </span>
              ) : (
                <span className="text-[var(--muted)]">Travel time not resolved</span>
              )}
              {row.scores && row.scores.hot + row.scores.warm > 0 ? (
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--brand-deep)]">
                  {row.scores.hot > 0 ? `${row.scores.hot} hot` : ""}
                  {row.scores.hot > 0 && row.scores.warm > 0 ? " · " : ""}
                  {row.scores.warm > 0 ? `${row.scores.warm} warm` : ""}
                </span>
              ) : null}
            </div>
          ) : null}

          <dl className="grid grid-cols-3 gap-2 text-micro">
            <div>
              <dt className="text-[var(--muted)]">Enrolled</dt>
              <dd className="font-semibold tabular-nums text-[var(--brand-deep)]">
                {formatIndianNumber(row.leads.enrolled)}
                <span className="ml-1 font-normal text-[var(--muted)]">
                  ({formatPct(row.enrolledPenetrationPct)})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Open in funnel</dt>
              <dd className="font-semibold tabular-nums text-[var(--brand-deep)]">
                {formatIndianNumber(row.leads.open)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">One intake year</dt>
              <dd className="font-semibold tabular-nums text-[var(--brand-deep)]">
                ≈ {formatIndianNumber(census.projected.annualBirthCohort)}
              </dd>
            </div>
          </dl>

          <p className="text-micro text-[var(--muted)]">
            Estimate = {census.baseline.year} census × {census.projected.growthMultiplier}
            , then {Math.round(census.projected.childRatio * 100)}% for ages 0-6.
            {census.matchScore < 1 ? ` Name matched at ${Math.round(census.matchScore * 100)}%.` : ""}
          </p>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-sunken)] px-2.5 py-3">
          <p className="text-xs font-medium text-[var(--brand-deep)]">
            {row.censusMatch === "census_unavailable"
              ? "Census table unreachable"
              : "No census record matched this name"}
          </p>
          <p className="mt-0.5 text-micro text-[var(--muted)]">
            Population and penetration are unknown for this village — not zero.
            {row.censusMatch === "no_census_match"
              ? " Seed its PCA row, or add it under the census spelling, to size it."
              : ""}
          </p>
          <p className="mt-1.5 text-micro text-[var(--muted)]">
            Registered leads here:{" "}
            <span className="font-semibold text-[var(--brand-deep)]">
              {formatIndianNumber(row.leads.total)}
            </span>
          </p>
        </div>
      )}
    </article>
  );
}

/**
 * The drill-down index: one row per CD block. The office picks a block before
 * it picks a village, and 1,292 settlement cards is not something anyone can
 * plan from. Clicking a row filters the cards below to that block.
 */
function BlockMarketTable({
  rows,
  selected,
  onSelect,
}: {
  rows: BlockMarketRow[];
  selected: string[];
  onSelect: (block: string) => void;
}) {
  if (!rows.length) return null;
  const ranked = [...rows].sort(
    (a, b) => (a.penetrationPct ?? 0) - (b.penetrationPct ?? 0),
  );
  const maxPool = Math.max(...rows.map((r) => r.projectedChildPop), 1);

  return (
    <div className="erp-surface space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Blocks &amp; city — weakest coverage first
        </h3>
        {selected.length ? (
          <button
            type="button"
            className="text-micro font-semibold text-[var(--info)] underline"
            onClick={() => onSelect("")}
          >
            Clear block filter
          </button>
        ) : null}
      </div>
      <ul className="space-y-1">
        {ranked.map((b) => {
          const active = selected.includes(b.blockName);
          return (
            <li key={b.blockName}>
              <button
                type="button"
                onClick={() => onSelect(b.blockName)}
                aria-pressed={active}
                className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  active
                    ? "border-[var(--brand-deep)] bg-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--surface-sunken)] hover:border-[var(--brand-mid)]"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm font-semibold text-[var(--brand-deep)]">
                    {b.blockName}
                    {b.wards > 0 ? (
                      <span className="ml-1.5 rounded-full border border-[var(--info)]/25 bg-[var(--info-soft)] px-1.5 py-px text-micro font-semibold text-[var(--info)]">
                        City
                      </span>
                    ) : null}
                  </span>
                  <span className="text-micro text-[var(--muted)]">
                    {b.wards > 0
                      ? `${formatIndianNumber(b.wards)} wards`
                      : `${formatIndianNumber(b.settlements)} settlements${
                          b.towns > 0 ? ` (${b.towns} town${b.towns === 1 ? "" : "s"})` : ""
                        }`}
                    {" · "}
                    {formatIndianNumber(b.projectedChildPop)} children 0-6 est.
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-[var(--brand-deep)]">
                    {formatIndianNumber(b.leads)} leads · {formatPct(b.penetrationPct)}
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted-surface)]"
                  role="img"
                  aria-label={`${b.blockName}: ${b.projectedChildPop} estimated children, ${b.leads} leads`}
                >
                  <div
                    className="h-full rounded-full bg-[var(--brand-mid)]"
                    style={{ width: `${(b.projectedChildPop / maxPool) * 100}%` }}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-micro text-[var(--muted)]">
        Bar length is the size of the block&rsquo;s estimated 0-6 pool. Click blocks
        to filter the settlements below — clicking again deselects.
      </p>
    </div>
  );
}

/**
 * The real block filter: a checkbox dropdown over every block on file,
 * grouped into rural CD blocks and urban bodies (whose settlements are city
 * wards). Multi-select, because a camp is often planned for two adjacent
 * blocks at once.
 */
function BlockFilterDropdown({
  available,
  blockMarket,
  selected,
  disabled,
  onChange,
}: {
  available: string[];
  blockMarket: BlockMarketRow[];
  selected: string[];
  disabled: boolean;
  onChange: (blocks: string[]) => void;
}) {
  const cityBlocks = useMemo(
    () => new Set(blockMarket.filter((b) => b.wards > 0).map((b) => b.blockName)),
    [blockMarket],
  );
  const groups = useMemo(
    () => [
      { label: "Rural blocks", names: available.filter((b) => !cityBlocks.has(b)) },
      { label: "Varanasi city & towns", names: available.filter((b) => cityBlocks.has(b)) },
    ],
    [available, cityBlocks],
  );

  const toggle = (name: string) => {
    onChange(
      selected.includes(name)
        ? selected.filter((b) => b !== name)
        : [...selected, name],
    );
  };

  const summary =
    selected.length === 0
      ? "All blocks"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} blocks`;

  return (
    <details className="relative text-micro text-[var(--muted)]">
      <summary
        className={`${erpField} flex cursor-pointer select-none list-none items-center justify-between gap-2 ${
          disabled ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <span className="truncate font-medium text-[var(--brand-deep)]">{summary}</span>
        <span aria-hidden>▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-lg">
        <button
          type="button"
          className="mb-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-1 text-left text-micro font-semibold text-[var(--brand-deep)] hover:border-[var(--brand-mid)]"
          onClick={() => onChange([])}
        >
          All blocks{selected.length ? " (clear selection)" : ""}
        </button>
        {groups.map((g) =>
          g.names.length ? (
            <div key={g.label} className="mt-1">
              <p className="px-1 py-0.5 text-micro font-semibold uppercase tracking-wide text-[var(--muted)]">
                {g.label}
              </p>
              {g.names.map((name) => (
                <label
                  key={name}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--surface-sunken)]"
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--brand-mid)]"
                    checked={selected.includes(name)}
                    onChange={() => toggle(name)}
                  />
                  <span className="text-xs text-[var(--brand-deep)]">{name}</span>
                </label>
              ))}
            </div>
          ) : null,
        )}
      </div>
    </details>
  );
}

/**
 * The official 2022 Nagar Nigam ward directory: every ward with the
 * mohallas/colonies its gazetted extent names. This answers "which ward is
 * Sigra in?" for planning — it is a reference list, NOT the census ward
 * cards: the 2022 wards have no official crosswalk to the census-2011 wards
 * that carry the child-pool figures, so the two are never joined.
 */
function CityWardDirectoryPanel() {
  const [wards, setWards] = useState<CityWardDirectoryWard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admissions/city-wards", { cache: "no-store" });
        const body = (await res.json()) as CityWardDirectoryResult;
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setError("error" in body && body.error ? body.error : `Failed (${res.status})`);
          return;
        }
        setWards(body.wards);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!wards) return [];
    if (!q) return wards;
    return wards.filter(
      (w) =>
        String(w.wardNo) === q ||
        w.wardName.toLowerCase().includes(q) ||
        w.wardNameHi.includes(query.trim()) ||
        w.localities.some((l) => l.toLowerCase().includes(q)),
    );
  }, [wards, q, query]);

  return (
    <details className="erp-surface-sm" open={false}>
      <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-deep)]">
        Varanasi City ward directory — mohallas &amp; colonies (2022 delimitation)
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-micro text-[var(--muted)]">
          The Nagar Nigam&rsquo;s 100 current wards and the localities their
          gazette extents name — use it to read where a lead&rsquo;s mohalla
          falls. These are the 2022 wards; the population cards above are the
          census-2011 wards, and there is no official mapping between the two.
          Ramnagar, Gangapur, the Cantonment and Maruadih are separate bodies
          outside this list.
        </p>
        <input
          type="search"
          className={erpField}
          placeholder="search a ward, mohalla or colony — e.g. Sigra, Khojwa, Lanka"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {error ? (
          <p className="text-micro text-[var(--danger)]">{error}</p>
        ) : !wards ? (
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : filtered.length ? (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {filtered.map((w) => (
              <li
                key={w.wardNo}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2.5 py-1.5"
              >
                <p className="text-xs font-semibold text-[var(--brand-deep)]">
                  Ward {w.wardNo} · {w.wardName}
                  {w.wardNameHi ? (
                    <span className="ml-1.5 font-normal text-[var(--muted)]">
                      {w.wardNameHi}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-micro text-[var(--muted)]">
                  {w.localities.length ? w.localities.join(", ") : "—"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-micro text-[var(--warning)]">
            No ward or locality matches &ldquo;{query.trim()}&rdquo;. The
            spelling queue can still map it by hand.
          </p>
        )}
        {wards && q ? (
          <p className="text-micro text-[var(--muted)]">
            {filtered.length} of {wards.length} wards match.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="erp-surface-sm">
      <p className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-wide text-[var(--muted)]">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--brand-deep)]">
        {value}
      </p>
      {hint ? <p className="text-micro text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading village market data">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="erp-surface-sm space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-14" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="erp-surface-sm space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <p className="sr-only">Fetching villages and census figures…</p>
    </div>
  );
}

/* ─── Container ────────────────────────────────────────────── */

/**
 * Hand the browser a file.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari
 * aborts the download if the URL dies before it has read the blob.
 */
function downloadCsv(filename: string, csv: string) {
  // A BOM so Excel opens UTF-8 correctly. Meta's uploader tolerates it; a
  // reviewer opening the planning sheet in Excel does not tolerate its absence.
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** What a campaign preview returns, before anything is sent. */
type CampaignPreview = {
  campaignId: string;
  previewOnly: boolean;
  audience: number;
  templateName: string;
  counts: {
    freeform: number;
    template: number;
    skippedOptedOut: number;
    skippedNoMobile: number;
    sent: number;
    failed: number;
  };
  recipients: { leadId: string; childName: string; villageName: string; route: string; reason: string; draft?: string }[];
  warnings: string[];
};

/** Everything the server needs; changing any of these refetches. */
type ServerFilters = {
  mode: VillageQueryMode;
  radiusM: number;
  blocks: string[];
  search: string;
  settlementType: SettlementFilter;
  minChildPool: number;
};

export type VillageDemographicsGridProps = {
  /** School coordinates; defaults to Ayar, Varanasi. */
  lat?: number;
  lon?: number;
  radiusM?: number;
  /** Scopes the lead counts to one session; "" counts every year. */
  academicYearCode?: string;
  /** Confirming a spelling rewrites every figure here, so it needs edit rights. */
  canEdit?: boolean;
};

function VillageDemographicsGridInner({
  lat = DEFAULT_ORIGIN.lat,
  lon = DEFAULT_ORIGIN.lon,
  radiusM = DEFAULT_RADIUS_M,
  academicYearCode = "",
  canEdit = false,
}: VillageDemographicsGridProps) {
  const [radius, setRadius] = useState(radiusM);
  // Block mode is the default because OpenStreetMap's rural coverage around
  // the school is a few nodes while the census has the whole market. Radius
  // mode stays one click away for the villages OSM does map.
  const [mode, setMode] = useState<VillageQueryMode>("block");
  const [blocks, setBlocks] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [settlementType, setSettlementType] = useState<SettlementFilter>("all");
  const [minChildPool, setMinChildPool] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<VillageGridSort>("opportunity");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<VillageGridState>({ status: "idle" });
  // Guards against a slow first response overwriting a faster second one.
  const requestSeq = useRef(0);

  const load = useCallback(
    async (next: ServerFilters) => {
      const seq = ++requestSeq.current;
      const query: VillageGridQuery = {
        mode: next.mode,
        lat,
        lon,
        radiusM: next.radiusM,
        blocks: next.blocks,
        search: next.search,
        settlementType: next.settlementType,
        minChildPool: next.minChildPool,
        academicYearCode,
      };
      setState({ status: "loading", query });

      const params = new URLSearchParams({
        mode: next.mode,
        lat: String(lat),
        lon: String(lon),
        radius: String(next.radiusM),
        settlementType: next.settlementType,
      });
      if (next.blocks.length) params.set("blocks", next.blocks.join(","));
      if (next.search) params.set("search", next.search);
      if (next.minChildPool > 0) params.set("minChildPool", String(next.minChildPool));
      if (academicYearCode) params.set("academicYearCode", academicYearCode);

      try {
        const res = await fetch(`/api/admissions/villages-nearby?${params}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as VillagesNearbyResult;
        if (seq !== requestSeq.current) return;

        if (!res.ok || !body.ok) {
          const message =
            "error" in body && body.error
              ? body.error
              : `Request failed (${res.status})`;
          console.warn("[VillageDemographicsGrid] load failed:", message);
          setState({
            status: "error",
            query,
            message,
            retryable: ("retryable" in body && body.retryable) || res.status >= 500,
          });
          return;
        }
        setState({ status: "ready", query, data: body });
      } catch (e) {
        if (seq !== requestSeq.current) return;
        const message = e instanceof Error ? e.message : "Network error";
        console.error("[VillageDemographicsGrid] network failure:", message);
        setState({
          status: "error",
          query,
          message: `Could not reach the server (${message}).`,
          retryable: true,
        });
      }
    },
    [lat, lon, academicYearCode],
  );

  /** One place that fires a fetch, so every control is a single request. */
  const reload = useCallback(
    (over: Partial<ServerFilters> = {}) => {
      setPage(1);
      void load({ radiusM: radius, mode, blocks, search, settlementType, minChildPool, ...over });
    },
    [load, radius, mode, blocks, search, settlementType, minChildPool],
  );

  useEffect(() => {
    void load({ radiusM: radius, mode, blocks, search, settlementType, minChildPool });
    // Control changes call reload() directly so a click is one fetch, not two.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Typing a village name should not fire a request per keystroke.
  const searchDebounce = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    },
    [],
  );

  const data = state.status === "ready" ? state.data : null;

  // Options for the village/ward dropdown — the settlements the server
  // returned for the current block selection. Numeric compare so Ward 2
  // sorts before Ward 10.
  const villageNames = useMemo(() => {
    if (!data) return [] as string[];
    const names = new Set<string>();
    for (const v of data.villages) names.add(v.census?.villageName || v.osmName);
    return [...names].sort((a, b) => a.localeCompare(b, "en-IN", { numeric: true }));
  }, [data]);

  const sorted = useMemo(() => {
    if (!data) return [];
    // In radius mode the server ignores the name filter (it filters census
    // rows, and radius rows come from OpenStreetMap), so the search applies
    // here instead — otherwise typing a name would visibly do nothing.
    const q = search.trim().toLowerCase();
    const named =
      data.mode === "radius" && q
        ? data.villages.filter((v) =>
            (v.census?.villageName || v.osmName).toLowerCase().includes(q),
          )
        : data.villages;
    // Status depends on leads, which only the server can compute, so this one
    // filter is applied here rather than in SQL.
    const rows = named.filter((v) => {
      if (status === "all") return true;
      if (v.penetrationPct === null) return false;
      if (status === "untouched") return v.leads.total === 0;
      if (status === "low") return v.penetrationPct > 0 && v.penetrationPct < 2;
      return v.penetrationPct >= 2;
    });
    switch (sort) {
      case "distance":
        // Unmapped villages sink to the bottom rather than pretending to be
        // at distance 0, which would put them first.
        return rows.sort((a, b) => {
          if (a.distanceKm === null && b.distanceKm === null) return 0;
          if (a.distanceKm === null) return 1;
          if (b.distanceKm === null) return -1;
          return a.distanceKm - b.distanceKm;
        });
      case "pool":
        return rows.sort(
          (a, b) =>
            (b.census?.projected.child06Total ?? -1) -
            (a.census?.projected.child06Total ?? -1),
        );
      case "penetration":
        // Unsized villages sink to the bottom — they are not "0% reached".
        return rows.sort((a, b) => {
          if (a.penetrationPct === null && b.penetrationPct === null) return 0;
          if (a.penetrationPct === null) return 1;
          if (b.penetrationPct === null) return -1;
          return a.penetrationPct - b.penetrationPct;
        });
      default:
        return rows.sort((a, b) => opportunityScore(b) - opportunityScore(a));
    }
  }, [data, sort, status, search]);

  const [exporting, setExporting] = useState<"targeting" | "audience" | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [working, setWorking] = useState<"travel" | "rescore" | "campaign" | null>(null);
  const [campaign, setCampaign] = useState<CampaignPreview | null>(null);

  useEffect(() => {
    const t = exportNote ? window.setTimeout(() => setExportNote(null), 6000) : null;
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [exportNote]);

  /**
   * Fetch contacts and hand over a file.
   *
   * Contacts are deliberately not in the dashboard payload — they are pulled
   * only here, on an explicit press, and the server audits the pull.
   */
  const runExport = useCallback(
    async (kind: "targeting" | "audience") => {
      if (exporting) return;
      setExporting(kind);
      setExportNote(null);
      const params = new URLSearchParams({ settlementType, onlyWithContacts: "true" });
      if (blocks.length) params.set("blocks", blocks.join(","));
      if (minChildPool > 0) params.set("minChildPool", String(minChildPool));
      if (academicYearCode) params.set("academicYearCode", academicYearCode);

      try {
        const res = await fetch(`/api/admissions/village-contacts?${params}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as VillageContactsResult;
        if (!res.ok || !body.ok) {
          const message =
            "error" in body && body.error ? body.error : `Export failed (${res.status})`;
          console.warn("[VillageDemographicsGrid] export failed:", message);
          setExportNote(message);
          return;
        }
        if (!body.rows.length) {
          setExportNote(
            "No settlement in this selection has a contactable parent number yet.",
          );
          return;
        }

        const scope = blocks.length ? blocks.join("-").replace(/\s+/g, "") : "all-blocks";
        if (kind === "audience") {
          const unique = countUniquePhones(body.rows);
          downloadCsv(
            `meta-custom-audience-${scope}-${stamp()}.csv`,
            buildMetaCustomAudienceCsv(body.rows),
          );
          setExportNote(
            `${formatIndianNumber(unique)} number${unique === 1 ? "" : "s"} exported for a Meta Customer List audience.`,
          );
        } else {
          downloadCsv(
            `village-targeting-${scope}-${stamp()}.csv`,
            buildVillageTargetingCsv(body.rows),
          );
          setExportNote(
            `${formatIndianNumber(body.totals.settlements)} settlements, ${formatIndianNumber(body.totals.contacts)} numbers.` +
              (body.totals.withCoordinates < body.totals.settlements
                ? ` Coordinates are blank for ${formatIndianNumber(body.totals.settlements - body.totals.withCoordinates)} of them — the census carries no lat/long.`
                : ""),
          );
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Network error";
        console.error("[VillageDemographicsGrid] export failed:", message);
        setExportNote(`Could not reach the server (${message}).`);
      } finally {
        setExporting(null);
      }
    },
    [exporting, settlementType, blocks, minChildPool, academicYearCode],
  );

  /** POST one intelligence action and report what it did. */
  const runAction = useCallback(
    async (kind: "travel" | "rescore" | "campaign", body: Record<string, unknown>) => {
      if (working) return null;
      setWorking(kind);
      setExportNote(null);
      try {
        const res = await fetch("/api/admissions/lead-intelligence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setExportNote(data.error || `Failed (${res.status})`);
          return null;
        }
        return data;
      } catch (e) {
        setExportNote(e instanceof Error ? e.message : "Network error");
        return null;
      } finally {
        setWorking(null);
      }
    },
    [working],
  );

  const busy = state.status === "loading";

  // The settlement cards render only once the office narrows down — 400
  // unfiltered cards read as noise, and the block table above already answers
  // "where overall". Radius mode is its own selection (a handful of mapped
  // places), so it always shows.
  const hasSelection =
    mode === "radius" ||
    blocks.length > 0 ||
    search.trim() !== "" ||
    settlementType !== "all" ||
    minChildPool > 0 ||
    status !== "all";
  const visible = sorted.slice(0, page * PAGE_SIZE);
  const hasMore = sorted.length > visible.length;

  return (
    <section className="space-y-4">
      <header className="erp-surface space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="erp-section-title">Village market &amp; penetration</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Villages within the radius of the school, sized from Census 2011 and
              matched against the leads our field agents registered. Projected
              figures are estimates, not counts.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-micro text-[var(--muted)]">
              <span className="sr-only">Village source</span>
              <select
                className={erpField}
                value={mode}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value as VillageQueryMode;
                  setMode(next);
                  reload({ mode: next });
                }}
              >
                <option value="block">By block (census)</option>
                <option value="radius">Near school (by distance)</option>
              </select>
            </label>

            {mode === "block" ? null : (
              <label className="text-micro text-[var(--muted)]">
                <span className="sr-only">Search radius</span>
                <select
                  className={erpField}
                  value={radius}
                  disabled={busy}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setRadius(next);
                    reload({ radiusM: next });
                  }}
                >
                  {RADIUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-micro text-[var(--muted)]">
              <span className="sr-only">Sort villages</span>
              <select
                className={erpField}
                value={sort}
                onChange={(e) => setSort(e.target.value as VillageGridSort)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={erpBtnOutline}
              disabled={busy}
              onClick={() => reload()}
            >
              <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
              {busy ? "Loading" : "Refresh"}
            </button>

            {canEdit ? (
              <>
                <button
                  type="button"
                  className={erpBtnOutline}
                  disabled={!!exporting}
                  onClick={() => void runExport("targeting")}
                  title="One row per village with its whole contact list in a single cell. A planning sheet — not a Meta upload."
                >
                  <Download className="size-3.5" aria-hidden />
                  {exporting === "targeting" ? "Preparing…" : "Export Meta Ads Targeting CSV"}
                </button>
                <button
                  type="button"
                  className={erpBtnOutline}
                  disabled={!!exporting}
                  onClick={() => void runExport("audience")}
                  title="One number per row in Meta's own column format — this is the file Ads Manager ingests as a Customer List."
                >
                  <Download className="size-3.5" aria-hidden />
                  {exporting === "audience" ? "Preparing…" : "Export Meta Customer List"}
                </button>

                {mode === "block" && blocks.length ? (
                  <button
                    type="button"
                    className={erpBtnOutline}
                    disabled={!!working}
                    onClick={async () => {
                      const r = await runAction("travel", {
                        action: "resolveTravel",
                        blocks,
                      });
                      if (r) {
                        setExportNote(
                          `Travel: ${r.routed} routed, ${r.fellBackToStraightLine} straight-line, ` +
                            `${r.failed} unplaceable, ${r.alreadyCached} already cached` +
                            (r.more ? " — press again for the rest." : "."),
                        );
                        reload();
                      }
                    }}
                    title="Geocodes each village then asks Google Distance Matrix for the drive to campus. Costs API quota; results are cached forever."
                  >
                    <Compass className="size-3.5" aria-hidden />
                    {working === "travel" ? "Resolving…" : `Resolve travel times (${blocks[0]})`}
                  </button>
                ) : null}

                <button
                  type="button"
                  className={erpBtnOutline}
                  disabled={!!working}
                  onClick={async () => {
                    const r = await runAction("rescore", { action: "rescore" });
                    if (r) {
                      const by = r.byStatus as Record<string, number>;
                      setExportNote(
                        `Re-scored ${r.scored} leads — ${by.hot} hot, ${by.warm} warm, ${by.cold} cold, ${by.enrolled} enrolled.`,
                      );
                      reload();
                    }
                  }}
                >
                  <TrendingUp className="size-3.5" aria-hidden />
                  {working === "rescore" ? "Scoring…" : "Re-score leads"}
                </button>

                <button
                  type="button"
                  className={erpBtnOutline}
                  disabled={!!working}
                  onClick={async () => {
                    // Preview first, always. Nothing is sent by this press.
                    const r = await runAction("campaign", {
                      action: "followUpCampaign",
                      blocks,
                      language: "hi",
                      confirm: false,
                    });
                    if (r) setCampaign(r as unknown as CampaignPreview);
                  }}
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                  {working === "campaign" ? "Preparing…" : "Trigger AI WhatsApp Follow-up"}
                </button>
              </>
            ) : null}
          </div>
        </div>
        <p className="text-micro text-[var(--muted)]">
          {mode === "block"
            ? `Census villages · ${blocks.length ? blocks.join(", ") : "all blocks"}`
            : `Origin ${lat.toFixed(4)}, ${lon.toFixed(4)} · radius ${(radius / 1000).toFixed(0)} km`}
          {data && data.mode === "radius" && data.source.overpassEndpoint
            ? ` · OpenStreetMap data ${data.source.cached ? "cached" : "fetched"} ${new Date(data.source.fetchedAt).toLocaleString("en-IN")}`
            : ""}
        </p>

        {exportNote ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--accent)] px-3 py-1.5 text-xs text-[var(--brand-deep)]">
            {exportNote}
          </p>
        ) : null}

        {campaign ? (
          <div className="space-y-2 rounded-xl border border-[var(--brand-mid)] bg-[var(--surface-sunken)] px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold text-[var(--brand-deep)]">
                {campaign.previewOnly
                  ? "WhatsApp follow-up — nothing sent yet"
                  : "WhatsApp follow-up — sent"}
              </h4>
              <button
                type="button"
                className="text-micro font-semibold text-[var(--info)] underline"
                onClick={() => setCampaign(null)}
              >
                Close
              </button>
            </div>

            {campaign.previewOnly ? (
              <>
                <p className="text-xs text-[var(--muted)]">
                  {formatIndianNumber(campaign.audience)} lead
                  {campaign.audience === 1 ? "" : "s"} in scope ·{" "}
                  <strong>{campaign.counts.freeform}</strong> can get a personal AI
                  message (they wrote to us in the last 24 hours) ·{" "}
                  <strong>{campaign.counts.template}</strong> can only get the
                  approved template{campaign.templateName ? ` "${campaign.templateName}"` : ""} ·{" "}
                  {campaign.counts.skippedOptedOut + campaign.counts.skippedNoMobile} skipped.
                </p>
                <p className="text-micro text-[var(--muted)]">
                  Meta only allows free-form text within 24 hours of the family
                  writing to us. Everyone else must receive a template whose wording
                  Meta approved — an AI cannot write that message.
                </p>

                {campaign.recipients.some((r) => r.draft) ? (
                  <details className="text-micro">
                    <summary className="cursor-pointer font-semibold text-[var(--brand-deep)]">
                      Read the AI drafts before sending
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {campaign.recipients
                        .filter((r) => r.draft)
                        .slice(0, 8)
                        .map((r) => (
                          <li
                            key={r.leadId}
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5"
                          >
                            <span className="font-semibold text-[var(--brand-deep)]">
                              {r.childName}
                              {r.villageName ? ` · ${r.villageName}` : ""}
                            </span>
                            <p className="mt-0.5 whitespace-pre-wrap text-[var(--muted)]">
                              {r.draft}
                            </p>
                          </li>
                        ))}
                    </ul>
                  </details>
                ) : null}

                {campaign.warnings.map((w) => (
                  <p
                    key={w}
                    className="flex items-start gap-1.5 text-micro text-[var(--warning)]"
                  >
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                    {w}
                  </p>
                ))}

                <button
                  type="button"
                  className={erpBtn}
                  disabled={
                    !!working ||
                    campaign.counts.freeform + campaign.counts.template === 0
                  }
                  onClick={async () => {
                    const r = await runAction("campaign", {
                      action: "followUpCampaign",
                      blocks,
                      language: "hi",
                      confirm: true,
                    });
                    if (r) {
                      setCampaign(r as unknown as CampaignPreview);
                      reload();
                    }
                  }}
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                  {working === "campaign"
                    ? "Sending…"
                    : `Send to ${campaign.counts.freeform + campaign.counts.template} famil${
                        campaign.counts.freeform + campaign.counts.template === 1 ? "y" : "ies"
                      }`}
                </button>
              </>
            ) : (
              <p className="text-xs text-[var(--brand-deep)]">
                {formatIndianNumber(campaign.counts.sent)} sent,{" "}
                {formatIndianNumber(campaign.counts.failed)} failed. Each send is
                logged as a touchpoint, so the lead scores will reflect it on the
                next re-score.
              </p>
            )}
          </div>
        ) : null}

        {canEdit ? (
          <p className="text-micro text-[var(--muted)]">
            Exports follow the filters above and include only settlements with a
            contactable number. They carry parents&rsquo; phone numbers, so every
            download is recorded in the audit log against your name — and the
            families must already have been told their number may be used this
            way before it goes to an ad platform.
          </p>
        ) : null}
      </header>

      {state.status === "error" ? (
        <div className="erp-surface space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--danger)]">
            <AlertTriangle className="size-4" aria-hidden />
            Could not load the village market view
          </p>
          <p className="text-xs text-[var(--muted)]">{state.message}</p>
          {state.retryable ? (
            <button type="button" className={erpBtnOutline} onClick={() => reload()}>
              <RefreshCw className="size-3.5" aria-hidden />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {busy ? <LoadingGrid /> : null}

      {data ? (
        <>
          {data.warnings.length ? (
            <ul className="space-y-1 rounded-xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-3 py-2">
              {data.warnings.map((w) => (
                <li
                  key={w}
                  className="flex items-start gap-2 text-xs text-[var(--warning)]"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="erp-surface-sm space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[11rem]">
                <p className="text-micro text-[var(--muted)]">
                  {mode === "radius" ? "Block (in range)" : "Block / city"}
                </p>
                <BlockFilterDropdown
                  available={data.blocks.available}
                  blockMarket={data.blockMarket}
                  selected={blocks}
                  disabled={busy}
                  onChange={(next) => {
                    setBlocks(next);
                    reload({ blocks: next });
                  }}
                />
              </div>
              <label className="min-w-[10rem] text-micro text-[var(--muted)]">
                Village / ward
                <select
                  className={erpField}
                  disabled={busy}
                  value={villageNames.includes(search) ? search : ""}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSearch(next);
                    if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
                    reload({ search: next });
                  }}
                >
                  <option value="">
                    {blocks.length ? "All in selected blocks" : "All settlements"}
                  </option>
                  {villageNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-[10rem] flex-1 text-micro text-[var(--muted)]">
                Search by name
                <input
                  type="search"
                  className={erpField}
                  placeholder="e.g. Ayar, Puari, Ward 12"
                  value={search}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSearch(next);
                    if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
                    searchDebounce.current = window.setTimeout(
                      () => reload({ search: next.trim() }),
                      350,
                    );
                  }}
                />
              </label>
              <>
                  <label className="text-micro text-[var(--muted)]">
                    Type
                    <select
                      className={erpField}
                      value={settlementType}
                      disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value as SettlementFilter;
                        setSettlementType(next);
                        reload({ settlementType: next });
                      }}
                    >
                      {TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-micro text-[var(--muted)]">
                    Minimum size
                    <select
                      className={erpField}
                      value={minChildPool}
                      disabled={busy}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setMinChildPool(next);
                        reload({ minChildPool: next });
                      }}
                    >
                      {POOL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              <label className="text-micro text-[var(--muted)]">
                Coverage
                <select
                  className={erpField}
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as StatusFilter);
                    setPage(1);
                  }}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {hasSelection ? (
              <p className="text-micro text-[var(--muted)]">
                Showing <strong>{formatIndianNumber(visible.length)}</strong> of{" "}
                {formatIndianNumber(sorted.length)}
                {data.counts.truncated
                  ? ` shown, ${formatIndianNumber(data.counts.matchingFilter)} match the filter`
                  : ""}
                {blocks.length ? ` · block ${blocks.join(", ")}` : " · all blocks"}
                {mode === "radius" ? ` · within ${(radius / 1000).toFixed(0)} km` : ""}
                {mode === "radius" ? (
                  <span className="ml-1 text-[var(--muted)]">
                    — city wards carry no coordinates, so Varanasi City shows
                    under &ldquo;By block&rdquo;, not by distance.
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="text-micro text-[var(--muted)]">
                Pick a block, a village/ward, or type a name — the settlement
                cards stay hidden until you narrow down.
              </p>
            )}
          </div>

          {data.mode === "block" ? (
            <BlockMarketTable
              rows={data.blockMarket}
              selected={blocks}
              onSelect={(b) => {
                const next = !b
                  ? []
                  : blocks.includes(b)
                    ? blocks.filter((x) => x !== b)
                    : [...blocks, b];
                setBlocks(next);
                reload({ blocks: next });
              }}
            />
          ) : null}

          {data.mode === "block" ? <CityWardDirectoryPanel /> : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile
              icon={<MapPin className="size-3" aria-hidden />}
              label="Villages found"
              value={formatIndianNumber(data.counts.placesFound)}
              hint={`${data.counts.censusMatched} sized · ${data.counts.censusUnmatched} unsized`}
            />
            <SummaryTile
              icon={<Users className="size-3" aria-hidden />}
              label={`Est. 0-6 pool ${data.assumptions.targetYear}`}
              value={formatIndianNumber(data.totals.projectedChildPool)}
              hint="Across sized villages only"
            />
            <SummaryTile
              icon={<Target className="size-3" aria-hidden />}
              label="Registered leads"
              value={formatIndianNumber(data.totals.leads)}
              hint={`${formatIndianNumber(data.totals.enrolled)} enrolled`}
            />
            <SummaryTile
              icon={<TrendingUp className="size-3" aria-hidden />}
              label="Overall penetration"
              value={formatPct(data.totals.penetrationPct)}
              hint={
                data.leadCoverage && data.leadCoverage.unmatchedLeads > 0
                  ? "At least this — unplaced leads not counted"
                  : "Leads ÷ estimated child pool"
              }
            />
          </div>

          {data.leadCoverage && data.leadCoverage.unmatchedLeads > 0 ? (
            <details className="erp-surface-sm">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-deep)]">
                {formatIndianNumber(data.leadCoverage.unmatchedLeads)} of{" "}
                {formatIndianNumber(data.leadCoverage.totalLeads)} leads sit on a
                village the census cannot size — penetration below is understated
              </summary>
              <p className="mt-2 text-micro text-[var(--muted)]">
                These leads are real; only the village spelling is unrecognised, so
                they are counted in no card below. Correcting the locality on the
                lead is the fix — matching them automatically would risk crediting
                them to the wrong village.
                {data.leadCoverage.blankLocality > 0
                  ? ` ${formatIndianNumber(data.leadCoverage.blankLocality)} lead${data.leadCoverage.blankLocality === 1 ? " has" : "s have"} no locality at all.`
                  : ""}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {data.leadCoverage.topUnmatched.map((u) => (
                  <li
                    key={u.locality}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-0.5 text-micro text-[var(--muted)]"
                  >
                    {u.locality}
                    <span className="ml-1 font-semibold text-[var(--brand-deep)]">
                      {u.leads}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <VillageAliasPanel
                  academicYearCode={academicYearCode}
                  canEdit={canEdit}
                  onChanged={() => reload()}
                />
              </div>
            </details>
          ) : null}

          {!hasSelection ? null : sorted.length ? (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                {visible.map((row) => (
                  <VillageCard key={row.key} row={row} />
                ))}
              </div>
              {hasMore ? (
                <button
                  type="button"
                  className={`${erpBtnOutline} w-full`}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Show {Math.min(PAGE_SIZE, sorted.length - visible.length)} more
                  {` (${formatIndianNumber(sorted.length - visible.length)} left)`}
                </button>
              ) : null}
            </>
          ) : (
            <div className="erp-surface text-center">
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                {mode === "block"
                  ? "No census villages on file for this selection"
                  : `No settlements found inside ${(radius / 1000).toFixed(0)} km`}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {mode === "block"
                  ? "Load the Census PCA rows with scripts/seed-census.ts, then pick a block."
                  : "Widen the radius, clear the name/type/size filters, or check the school coordinates."}
              </p>
            </div>
          )}

          {data.leadCoverage && data.leadCoverage.unmatchedLeads === 0 ? (
            <VillageAliasPanel
              academicYearCode={academicYearCode}
              canEdit={canEdit}
              onChanged={() => reload()}
            />
          ) : null}

          <p className="text-micro text-[var(--muted)]">{data.assumptions.note}</p>
        </>
      ) : null}
    </section>
  );
}

export function VillageDemographicsGrid(props: VillageDemographicsGridProps) {
  return (
    <GridErrorBoundary>
      <VillageDemographicsGridInner {...props} />
    </GridErrorBoundary>
  );
}

export default VillageDemographicsGrid;

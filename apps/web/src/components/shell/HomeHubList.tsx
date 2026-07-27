"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { listSessionYearOptions, loadMasters, defaultMasters } from "@/lib/masters";
import { canAccessHref, loadRbac, defaultRbacState } from "@/lib/rbac";
import { markModuleRegistryClientReady } from "@/lib/moduleRegistry";
import {
  HUB_GROUPS,
  QUICK_HREFS,
  TONE,
  type HubDef,
} from "@/lib/erpNav";
import {
  useDemoSession,
  useSessionReadOnly,
} from "@/components/shell/SessionContext";
import { TENANT } from "@/lib/types";
function HubTile({ hub, index }: { hub: HubDef; index: number }) {
  const Icon = hub.icon;
  const tone = TONE[hub.tone];
  return (
    <Link
      href={hub.href}
      className="home-hub-tile group relative flex min-h-[9.5rem] flex-col overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-[rgba(197,160,40,0.45)] hover:shadow-[0_12px_28px_rgba(32,48,80,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-gold)]"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <span
        className={`absolute inset-x-0 top-0 h-1 opacity-90 ${tone.bar}`}
        aria-hidden
      />
      <span
        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tone.icon}`}
        aria-hidden
      >
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <span className="mt-3 font-display text-base font-semibold tracking-tight text-[var(--brand-deep)]">
        {hub.title}
      </span>
      <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {hub.blurb}
      </span>
      <span className="mt-2 flex-1 text-[13px] leading-snug text-[var(--muted)]">
        {hub.detail}
      </span>
      <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--brand-deep)] opacity-70 transition group-hover:opacity-100">
        Open
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export function HomeHubList() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [hubTick, setHubTick] = useState(0);

  useEffect(() => {
    markModuleRegistryClientReady();
    setHubTick((n) => n + 1);
    function onRegistry() {
      setHubTick((n) => n + 1);
    }
    window.addEventListener("bhb-module-registry", onRegistry);
    return () => window.removeEventListener("bhb-module-registry", onRegistry);
  }, []);

  // localStorage-backed — resolve only after mount so SSR and first client
  // render match (hubTick is 0 until the mount effect runs)
  const ay = useMemo(
    () =>
      hubTick > 0
        ? listSessionYearOptions().find(
            (y) => y.code === session.academicYearCode,
          )
        : undefined,
    [session.academicYearCode, hubTick],
  );

  const groups = useMemo(() => {
    // hubTick === 0: SSR + first client paint — defaults only (no localStorage)
    const masters = hubTick > 0 ? loadMasters() : defaultMasters();
    const rbac = hubTick > 0 ? loadRbac() : defaultRbacState();
    return HUB_GROUPS.map((g) => ({
      ...g,
      hubs: g.hubs.filter((h) =>
        canAccessHref(session, masters, h.href, rbac),
      ),
    })).filter((g) => g.hubs.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hubTick after mount
  }, [session, hubTick]);

  const quick = useMemo(() => {
    const flat = groups.flatMap((g) => g.hubs);
    const preferred = QUICK_HREFS.map((href) =>
      flat.find((h) => h.href === href),
    ).filter(Boolean) as HubDef[];
    if (preferred.length >= 3) return preferred.slice(0, 4);
    return flat.slice(0, 4);
  }, [groups]);

  let tileIndex = 0;

  return (
    <div className="home-hub space-y-10 pb-4">
      <section className="home-hub-hero relative overflow-hidden rounded-[1.75rem] border border-[rgba(32,48,80,0.1)] bg-[var(--brand-deep)] px-5 py-8 text-white sm:px-8 sm:py-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 100% 0%, rgba(197,160,40,0.45), transparent 55%), radial-gradient(ellipse 50% 80% at 0% 100%, rgba(56,72,112,0.9), transparent 50%)",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
          aria-hidden
        />

        <div className="relative max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--brand-gold-soft)]">
            School operations hub
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {TENANT.nameDisplay}
          </h1>
          <p className="mt-2 text-base text-white/75 sm:text-lg">
            Welcome, {session.fullName}
            <span className="text-white/45"> · </span>
            {session.roleCode}
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65">
            {TENANT.tagline}. Modules are grouped by how work flows through the
            school — set up once, admit families, teach, collect, and close the
            books.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] font-medium text-white/90">
              Session {ay?.label ?? session.academicYearCode}
              {readOnly || ay?.status === "closed" ? " · read-only" : ""}
            </span>
            <span className="rounded-full border border-[rgba(197,160,40,0.35)] bg-[rgba(197,160,40,0.15)] px-3 py-1 text-[12px] font-medium text-[var(--brand-gold-soft)]">
              {groups.reduce((n, g) => n + g.hubs.length, 0)} modules for you
            </span>
          </div>
        </div>

        {quick.length > 0 ? (
          <div className="relative mt-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
              Jump in
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {quick.map((h) => {
                const Icon = h.icon;
                return (
                  <Link
                    key={h.href}
                    href={h.href}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white backdrop-blur-sm transition hover:border-[var(--brand-gold)]/50 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-gold)]"
                  >
                    <Icon className="h-4 w-4 text-[var(--brand-gold-soft)]" />
                    {h.title}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <div className="space-y-12">
        {groups.map((group) => {
          const gTone = TONE[group.tone];
          return (
            <section key={group.id} className="home-hub-group scroll-mt-24">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${gTone.bar}`}
                      aria-hidden
                    />
                    <h2 className="font-display text-xl font-semibold tracking-tight text-[var(--brand-deep)] sm:text-2xl">
                      {group.label}
                    </h2>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${gTone.chip}`}
                    >
                      {group.hubs.length}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
                    {group.purpose}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.hubs.map((hub) => {
                  const i = tileIndex++;
                  return <HubTile key={hub.href} hub={hub} index={i} />;
                })}
              </div>
            </section>
          );
        })}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
          No modules are available for this role. Ask an admin to update
          permissions.
        </p>
      ) : null}
    </div>
  );
}

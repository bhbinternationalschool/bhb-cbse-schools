"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ToggleLeft } from "lucide-react";
import {
  REGISTRY_GROUPS,
  REGISTRY_MODULES,
  isModuleEnabled,
  loadModuleRegistry,
  setAllModulesEnabled,
  setModuleEnabled,
  type RegistryModuleId,
} from "@/lib/moduleRegistry";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

export function ModulesWorkspace() {
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadModuleRegistry();
    setTick((n) => n + 1);
    void (async () => {
      const { ensureModuleRegistryHydrated } = await import(
        "@/lib/moduleRegistryPersistence"
      );
      await ensureModuleRegistryHydrated();
      loadModuleRegistry();
      setTick((n) => n + 1);
    })();
  }, []);

  const grouped = useMemo(() => {
    void tick;
    return REGISTRY_GROUPS.map((g) => ({
      ...g,
      modules: REGISTRY_MODULES.filter((m) => m.group === g.id),
    })).filter((g) => g.modules.length > 0);
  }, [tick]);

  const counts = useMemo(() => {
    void tick;
    const toggleable = REGISTRY_MODULES.filter((m) => !m.alwaysOn);
    const on = toggleable.filter((m) => isModuleEnabled(m.id)).length;
    return { on, total: toggleable.length };
  }, [tick]);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2500);
  }

  function toggle(id: RegistryModuleId, enabled: boolean) {
    setModuleEnabled(id, enabled);
    setTick((n) => n + 1);
    const def = REGISTRY_MODULES.find((m) => m.id === id);
    flash(`${def?.label ?? id} ${enabled ? "enabled" : "disabled"}`);
  }

  function bulk(enabled: boolean) {
    setAllModulesEnabled(enabled);
    setTick((n) => n + 1);
    flash(enabled ? "All modules enabled" : "All optional modules disabled");
  }

  return (
    <ErpWorkspaceShell
      className="mx-auto max-w-3xl"
      title="Modules"
      subtitle="Enable or disable every school module. Disabled modules hide from Home and universal search. Home and Modules stay on so you can always come back here."
      icon={<ToggleLeft className="size-6" aria-hidden />}
      notice={notice}
      toolbar={
        <>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {counts.on} of {counts.total} toggleable modules on
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => bulk(true)}>
              Enable all
            </button>
            <button
              type="button"
              className={btnOutline}
              onClick={() => bulk(false)}
            >
              Disable all
            </button>
          </div>
        </>
      }
    >
      <ModuleDashboardHost moduleId="modules" refreshKey={tick} />

      <div className="space-y-8" key={tick}>
        {grouped.map((g) => (
          <section key={g.id}>
            <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
              {g.label}
            </h2>
            <ul className="mt-3 space-y-3">
              {g.modules.map((m) => {
                const on = isModuleEnabled(m.id);
                return (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--brand-deep)]">
                        {m.label}
                        {m.alwaysOn ? (
                          <span className="ml-2 rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                            Always on
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-[var(--muted)]">{m.blurb}</p>
                      <p className="mt-1 text-[11px] text-[var(--muted)]">
                        Status:{" "}
                        <span
                          className={
                            on
                              ? "font-semibold text-[#0f7a4c]"
                              : "font-semibold text-[var(--warning)]"
                          }
                        >
                          {on ? "ON" : "OFF"}
                        </span>
                        {!on && m.defaultEnabled === false
                          ? " · default off"
                          : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {on ? (
                        <>
                          <Link href={m.href} className={btnOutline}>
                            Open
                          </Link>
                          {!m.alwaysOn ? (
                            <button
                              type="button"
                              className={btnOutline}
                              onClick={() => toggle(m.id, false)}
                            >
                              Disable
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <button
                          type="button"
                          className={btn}
                          onClick={() => toggle(m.id, true)}
                        >
                          Enable
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </ErpWorkspaceShell>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadMasters } from "@/lib/masters";
import {
  loadWaTemplates,
  moduleLabel,
  type WaTemplateCategory,
  type WaTemplateModule,
} from "@/lib/waTemplates";
import { ensureWaTemplatesHydrated } from "@/lib/waTemplatesPersistence";
import { ensureMastersHydrated } from "@/lib/mastersPersistence";
import type { WaAudienceSpec, StaffStreamFilter } from "@/lib/waAudienceSpec";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import { WaStudentPicker } from "@/components/comms/WaStudentPicker";

type Summary = {
  audienceLabel?: string;
  wholeSchool?: boolean;
  recipientCount?: number;
  skippedOptOut?: number;
  skippedNotOnWhatsApp?: number;
  skippedNoNumber?: number;
  sample?: string[];
  sent?: number;
  failed?: number;
  deferred?: number;
  skippedNoTemplate?: number;
  error?: string;
  mode?: string;
};

type Who = "staff" | "parents" | "fee_stage" | "students";

const FEE_STAGES = ["S1", "S2", "S3", "S4"];

export function WaSendToAudiencePanel({ readOnly }: { readOnly: boolean }) {
  const [who, setWho] = useState<Who>("parents");
  const [stream, setStream] = useState<StaffStreamFilter>("teaching");
  const [departmentId, setDepartmentId] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [languageUnset, setLanguageUnset] = useState(false);
  const [stages, setStages] = useState<string[]>(["S2", "S3", "S4"]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [familyKey, setFamilyKey] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState<WaTemplateModule | "all">(
    "all",
  );
  const [vars, setVars] = useState<Record<string, string>>({});

  const [checked, setChecked] = useState<Summary | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        ensureMastersHydrated().catch(() => false),
        ensureWaTemplatesHydrated().catch(() => false),
      ]);
      setReady(true);
    })();
  }, []);

  const masters = useMemo(
    () => (ready ? loadMasters() : null),
    [ready],
  );

  /**
   * Only families with BOTH languages approved are offered. Sending to a
   * mixed-language audience with only English approved would silently drop
   * every Hindi-preferring family, which is exactly what
   * resolveTemplateForSend refuses to do one family at a time.
   */
  const families = useMemo(() => {
    if (!ready) return [];
    const all = loadWaTemplates().templates;
    const byFamily = new Map<
      string,
      {
        key: string;
        name: string;
        module: WaTemplateModule;
        category: WaTemplateCategory;
        langs: Set<string>;
        vars: string[];
      }
    >();
    for (const t of all) {
      if (t.status !== "approved" || t.paused) continue;
      const cur =
        byFamily.get(t.familyKey) ??
        {
          key: t.familyKey,
          name: t.name,
          module: t.module,
          category: t.category,
          langs: new Set<string>(),
          vars: t.variables,
        };
      cur.langs.add(t.language);
      byFamily.set(t.familyKey, cur);
    }
    return [...byFamily.values()]
      .filter((f) => f.langs.has("en") && f.langs.has("hi"))
      .sort(
        (a, b) =>
          a.module.localeCompare(b.module) || a.name.localeCompare(b.name),
      );
  }, [ready]);

  /**
   * Narrowing the template list.
   *
   * Every approved family in one flat list was fine at six templates and is
   * not at forty: the office scrolls past bus notices to find a fee
   * reminder. Two controls, because they answer different questions —
   * "which part of the school is this about" (module) and "I know roughly
   * what it is called" (search) — and the select itself is grouped by
   * module so even an unfiltered list is scannable.
   */
  const modulesPresent = useMemo(() => {
    const seen = new Map<WaTemplateModule, number>();
    for (const f of families) seen.set(f.module, (seen.get(f.module) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) =>
      moduleLabel(a[0]).localeCompare(moduleLabel(b[0])),
    );
  }, [families]);

  const visibleFamilies = useMemo(() => {
    const needle = templateQuery.trim().toLowerCase();
    return families.filter((f) => {
      if (moduleFilter !== "all" && f.module !== moduleFilter) return false;
      if (!needle) return true;
      return (
        f.name.toLowerCase().includes(needle) ||
        f.key.toLowerCase().includes(needle) ||
        moduleLabel(f.module).toLowerCase().includes(needle)
      );
    });
  }, [families, moduleFilter, templateQuery]);

  const grouped = useMemo(() => {
    const out = new Map<WaTemplateModule, typeof visibleFamilies>();
    for (const f of visibleFamilies) {
      const list = out.get(f.module);
      if (list) list.push(f);
      else out.set(f.module, [f]);
    }
    return [...out.entries()];
  }, [visibleFamilies]);

  const selected = families.find((f) => f.key === familyKey) || null;

  // A filter that hides the chosen template would leave the panel showing
  // "Choose a template…" over a filled-in variable form. Clear the choice
  // rather than leave that contradiction on screen.
  useEffect(() => {
    if (!familyKey) return;
    if (!visibleFamilies.some((f) => f.key === familyKey)) setFamilyKey("");
  }, [visibleFamilies, familyKey]);

  const spec = useMemo((): WaAudienceSpec => {
    if (who === "staff") {
      return {
        kind: "staff",
        stream,
        departmentIds: departmentId ? [departmentId] : [],
      };
    }
    if (who === "fee_stage") return { kind: "fee_stage", stages };
    if (who === "students") return { kind: "students", studentIds };
    return { kind: "parents", classIds, languageUnset };
  }, [who, stream, departmentId, stages, classIds, languageUnset, studentIds]);

  // Any change to the audience or the message invalidates the count the
  // office approved — otherwise "Send" could fire against a spec nobody
  // has actually looked at.
  useEffect(() => {
    setChecked(null);
    setResult(null);
  }, [spec, familyKey]);

  const post = useCallback(
    async (dryRun: boolean, confirmCount?: number) => {
      const res = await fetch("/api/wa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: spec,
          templateFamilyKey: familyKey,
          variables: vars,
          dryRun,
          confirmCount,
        }),
      });
      return { res, json: (await res.json()) as Summary & { error?: string } };
    },
    [spec, familyKey, vars],
  );

  async function check() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { res, json } = await post(true);
      if (!res.ok) {
        setError(json.error || "Could not work out the audience");
        return;
      }
      setChecked(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not work out the audience");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!checked?.recipientCount) return;
    const line = `Send "${selected?.name || familyKey}" to ${checked.recipientCount} recipient(s)?\n\n${checked.audienceLabel}\n\n${(checked.sample || []).slice(0, 5).join("\n")}${
      (checked.sample || []).length < (checked.recipientCount || 0)
        ? `\n…and ${(checked.recipientCount || 0) - (checked.sample || []).length} more`
        : ""
    }`;
    const extra = checked.wholeSchool
      ? "\n\nTHIS GOES TO EVERYONE. There is no undo once WhatsApp has it."
      : "\n\nThere is no undo once WhatsApp has it.";
    if (typeof window !== "undefined" && !window.confirm(line + extra)) return;

    setBusy(true);
    setError(null);
    try {
      const { res, json } = await post(false, checked.recipientCount);
      if (!res.ok) {
        setError(json.error || "The send failed");
        // A 409 means the audience moved — make them check again.
        if (res.status === 409) setChecked(null);
        return;
      }
      setResult(json);
      setChecked(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The send failed");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Send an approved template
        </h3>
        <p className="mt-1 max-w-2xl text-[12px] text-[var(--muted)]">
          Pick who it goes to, pick the message, check the count, then send.
          Every family is written to in their own language, and opted-out
          numbers and numbers not on WhatsApp are left out automatically.
        </p>
      </div>

      {/* ── Who ── */}
      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-[11px] font-semibold text-[var(--muted)]">
          1 · Who
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["parents", "Parents"],
              ["staff", "Staff"],
              ["fee_stage", "Fee defaulters"],
              ["students", "Pick students"],
            ] as [Who, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setWho(id)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
                who === id
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {who === "staff" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Which staff
              <select
                className={`${field} mt-1`}
                value={stream}
                onChange={(e) =>
                  setStream(e.target.value as StaffStreamFilter)
                }
              >
                <option value="teaching">Teaching staff</option>
                <option value="non_teaching">Non-teaching staff</option>
                <option value="all">All staff</option>
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Department (optional)
              <select
                className={`${field} mt-1`}
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">Any department</option>
                {(masters?.departments ?? [])
                  .filter((d) => d.isActive)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ) : null}

        {who === "parents" ? (
          <div className="space-y-2">
            <p className="text-[11px] text-[var(--muted)]">
              Pick classes, or leave all unpicked for the whole school.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(masters?.classes ?? [])
                .filter((c) => c.isActive)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setClassIds((p) => toggle(p, c.id))}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                      classIds.includes(c.id)
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
            </div>
            <label className="flex items-center gap-2 text-[11px] text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={languageUnset}
                onChange={(e) => setLanguageUnset(e.target.checked)}
              />
              Only families who have not told us their language
            </label>
          </div>
        ) : null}

        {who === "students" ? (
          <WaStudentPicker selected={studentIds} onChange={setStudentIds} />
        ) : null}

        {who === "fee_stage" ? (
          <div className="flex flex-wrap gap-1.5">
            {FEE_STAGES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStages((p) => toggle(p, s))}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                  stages.includes(s)
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── What ── */}
      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-[11px] font-semibold text-[var(--muted)]">
          2 · Message
        </p>
        {families.length > 6 ? (
          <>
            <input
              className={field}
              placeholder="Find a template — name or module…"
              value={templateQuery}
              onChange={(e) => setTemplateQuery(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  moduleFilter === "all"
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
                }`}
                onClick={() => setModuleFilter("all")}
              >
                All ({families.length})
              </button>
              {modulesPresent.map(([m, n]) => (
                <button
                  key={m}
                  type="button"
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                    moduleFilter === m
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
                  }`}
                  onClick={() => setModuleFilter(m)}
                >
                  {moduleLabel(m)} ({n})
                </button>
              ))}
            </div>
          </>
        ) : null}
        <select
          className={field}
          value={familyKey}
          onChange={(e) => setFamilyKey(e.target.value)}
        >
          <option value="">
            {visibleFamilies.length === families.length
              ? "Choose an approved template…"
              : `Choose one of ${visibleFamilies.length}…`}
          </option>
          {grouped.map(([m, list]) => (
            <optgroup key={m} label={moduleLabel(m)}>
              {list.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {ready && families.length > 0 && visibleFamilies.length === 0 ? (
          <p className="text-[11px] text-[var(--muted)]">
            No approved template matches that. Clear the search or pick{" "}
            <strong>All</strong>.
          </p>
        ) : null}
        {selected ? (
          <p className="text-[11px] text-[var(--muted)]">
            {moduleLabel(selected.module)} ·{" "}
            {selected.category === "MARKETING" ? (
              <>
                <strong>Marketing</strong> template — the dearest category.
                Utility is roughly a seventh of the price where the message
                is a notice rather than a promotion.
              </>
            ) : selected.category === "AUTHENTICATION" ? (
              <>Authentication template</>
            ) : (
              <>Utility template — the cheap category</>
            )}
          </p>
        ) : null}
        {ready && families.length === 0 ? (
          <p className="text-[11px] text-amber-800">
            No template is approved in both English and Hindi yet. Both are
            needed so every family gets the language they chose — finish one
            in Masters → WhatsApp templates.
          </p>
        ) : null}
        {selected?.vars.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {selected.vars.map((k) => (
              <label
                key={k}
                className="block text-[11px] font-semibold text-[var(--muted)]"
              >
                {k}
                <input
                  className={`${field} mt-1`}
                  placeholder={
                    ["guardianName", "childName", "classLabel", "schoolName"].includes(k)
                      ? "filled per family"
                      : ""
                  }
                  value={vars[k] || ""}
                  onChange={(e) =>
                    setVars((p) => ({ ...p, [k]: e.target.value }))
                  }
                />
              </label>
            ))}
            <p className="text-[10px] text-[var(--muted)] sm:col-span-2">
              guardianName, childName, classLabel and schoolName are filled
              per family — leave them blank.
            </p>
          </div>
        ) : null}
      </div>

      {/* ── Check, then send ── */}
      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-[11px] font-semibold text-[var(--muted)]">
          3 · Check the audience, then send
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnOutline}
            disabled={
              busy ||
              !familyKey ||
              (who === "students" && studentIds.length === 0)
            }
            onClick={() => void check()}
          >
            {busy && !checked ? "Checking…" : "Check audience"}
          </button>
          <button
            type="button"
            className={btn}
            disabled={readOnly || busy || !checked?.recipientCount}
            onClick={() => void send()}
          >
            {checked?.recipientCount
              ? `Send to ${checked.recipientCount}`
              : "Send"}
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-[12px] text-rose-900">
            {error}
          </div>
        ) : null}

        {checked ? (
          <div
            className={`space-y-1 rounded-lg border p-2 text-[12px] ${
              checked.wholeSchool
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
            }`}
          >
            <p className="font-semibold">
              {checked.audienceLabel} — {checked.recipientCount} recipient
              {checked.recipientCount === 1 ? "" : "s"}
              {checked.wholeSchool ? " · this is everyone" : ""}
            </p>
            {checked.sample?.length ? (
              <p className="text-[11px] opacity-90">
                {checked.sample.join(" · ")}
                {(checked.recipientCount || 0) > checked.sample.length
                  ? ` …+${(checked.recipientCount || 0) - checked.sample.length}`
                  : ""}
              </p>
            ) : null}
            <p className="text-[11px] opacity-80">
              Left out: {checked.skippedOptOut || 0} opted out ·{" "}
              {checked.skippedNotOnWhatsApp || 0} not on WhatsApp ·{" "}
              {checked.skippedNoNumber || 0} with no number
            </p>
          </div>
        ) : null}

        {result ? (
          <div
            className={`rounded-lg border p-2 text-[12px] ${
              result.failed
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-emerald-300 bg-emerald-50 text-emerald-900"
            }`}
          >
            Sent {result.sent || 0}
            {result.failed ? ` · ${result.failed} failed` : ""}
            {result.deferred
              ? ` · ${result.deferred} held for quiet hours`
              : ""}
            {result.skippedNoTemplate
              ? ` · ${result.skippedNoTemplate} had no template in their language`
              : ""}
            {result.error ? ` — ${result.error}` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}

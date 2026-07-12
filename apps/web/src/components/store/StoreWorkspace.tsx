"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatInr, searchFeeStudents, type StudentSearchHit } from "@/lib/fees";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  categoryLabel,
  createStoreIssue,
  listActiveStoreItems,
  loadStore,
  voidStoreIssue,
  type StoreIssue,
  type StoreItem,
} from "@/lib/store";
import { StudentTypeBadge } from "@/components/students/StudentAvatar";
import { StudentHitsFilterExport } from "@/components/reports/StudentHitsFilterExport";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  HoldStatusBanner,
  PrincipalHoldOverrideDialog,
} from "@/components/fees/PrincipalHoldOverrideDialog";
import { checkHold, type HoldCheck } from "@/lib/holds";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type CartRow = {
  itemId: string;
  qty: string;
  sizeLabel: string;
};

export function StoreWorkspace() {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [issues, setIssues] = useState<StoreIssue[]>([]);
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [selected, setSelected] = useState<StudentSearchHit | null>(null);
  const [issuedOn, setIssuedOn] = useState(todayIso);
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<CartRow[]>([]);
  const [pickItemId, setPickItemId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [holdCheck, setHoldCheck] = useState<HoldCheck | null>(null);
  const [holdDialog, setHoldDialog] = useState(false);

  function refreshHolds(studentId?: string) {
    if (!studentId) {
      setHoldCheck(null);
      return;
    }
    setHoldCheck(checkHold(studentId, "HOLD_STORE_CREDIT"));
  }

  function refresh() {
    const m = loadMasters();
    const s = loadSis();
    const store = loadStore();
    setMasters(m);
    setSis(s);
    setItems(listActiveStoreItems(store));
    setIssues(
      store.issues
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    setTick((t) => t + 1);
  }

  useEffect(() => {
    refresh();
  }, []);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter((s) => s.classId === classId && s.isActive);
  }, [masters, classId]);

  useEffect(() => {
    if (!sectionId) return;
    if (!sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      searchFeeStudents(query, sis, masters, undefined, {
        classId,
        sectionId,
      }),
    );
  }, [query, classId, sectionId, sis, masters, tick]);

  useEffect(() => {
    refreshHolds(selected?.student.id);
  }, [selected?.student.id, tick]);

  const cartTotal = useMemo(() => {
    let sum = 0;
    for (const row of cart) {
      const item = items.find((i) => i.id === row.itemId);
      if (!item) continue;
      const qty = Math.max(1, Math.floor(Number(row.qty) || 1));
      sum += item.unitPricePaise * qty;
    }
    return sum;
  }, [cart, items]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function addToCart() {
    if (!pickItemId) return;
    setCart((prev) => {
      const existing = prev.find((r) => r.itemId === pickItemId);
      if (existing) {
        return prev.map((r) =>
          r.itemId === pickItemId
            ? {
                ...r,
                qty: String(Math.max(1, Math.floor(Number(r.qty) || 1) + 1)),
              }
            : r,
        );
      }
      const item = items.find((i) => i.id === pickItemId);
      return [
        ...prev,
        {
          itemId: pickItemId,
          qty: "1",
          sizeLabel: item?.sizeLabel ?? "",
        },
      ];
    });
    setPickItemId("");
  }

  function onIssue() {
    if (!selected) {
      setError("Pick a student first");
      return;
    }
    if (cart.length === 0) {
      setError("Add at least one catalog item");
      return;
    }
    const hold = checkHold(selected.student.id, "HOLD_STORE_CREDIT");
    setHoldCheck(hold);
    if (!hold.allowed) {
      setHoldDialog(true);
      setError(hold.message);
      return;
    }
    const result = createStoreIssue({
      studentId: selected.student.id,
      householdId: selected.student.householdId,
      issuedOn,
      academicYearCode: selected.student.academicYearCode || DEFAULT_AY,
      note,
      lines: cart.map((r) => ({
        itemId: r.itemId,
        qty: Math.max(1, Math.floor(Number(r.qty) || 1)),
        sizeLabel: r.sizeLabel,
      })),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCart([]);
    setNote("");
    refresh();
    flash(
      `Issued ${result.issue.issueNo} · ${formatInr(result.issue.totalPaise)} due on Fee Take`,
    );
  }

  const catalogByCat = useMemo(() => {
    const map = new Map<string, StoreItem[]>();
    for (const item of items) {
      const key = categoryLabel(item.category);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
            Store / books
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Issue books & uniforms on credit — unpaid issues appear on Fee Take
            and Manual book for the same household receipt.
          </p>
        </div>
        <Link
          href="/fees"
          className="btn-accent rounded-lg px-3 py-1.5 text-sm font-semibold"
        >
          Open Fee Take
        </Link>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Issue to student
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Cashier: {session.fullName}
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,0.7fr)]">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Find student
                </span>
                <input
                  className="field"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(null);
                  }}
                  placeholder="Name, admission no, or mobile…"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Class
                </span>
                <select
                  className="field !py-1.5"
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setSectionId("");
                    setSelected(null);
                  }}
                >
                  <option value="">All classes</option>
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Section
                </span>
                <select
                  className="field !py-1.5"
                  value={sectionId}
                  disabled={!classId}
                  onChange={(e) => {
                    setSectionId(e.target.value);
                    setSelected(null);
                  }}
                >
                  <option value="">
                    {classId ? "All sections" : "Pick class first"}
                  </option>
                  {sectionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-2 flex justify-end">
              <StudentHitsFilterExport
                title="Store · student search"
                hits={hits}
                query={query}
                classLabel={classOptions.find((c) => c.id === classId)?.name}
                sectionLabel={sectionOptions.find((s) => s.id === sectionId)?.name}
                onMessage={(msg) => {
                  setNotice(msg);
                  window.setTimeout(() => setNotice(null), 2200);
                }}
              />
            </div>

            {!selected && (query.trim() || classId || sectionId) ? (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {hits.length === 0 ? (
                  <li className="rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-3 text-sm text-[var(--muted)]">
                    No students match.
                  </li>
                ) : (
                  hits.slice(0, 12).map((h) => (
                  <li key={h.student.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border border-[rgba(32,48,80,0.12)] px-3 py-2 text-left hover:border-[rgba(197,160,40,0.45)] hover:bg-[rgba(197,160,40,0.08)]"
                      onClick={() => {
                        setSelected(h);
                        setQuery(h.student.fullName);
                      }}
                    >
                      <div className="text-sm font-semibold text-[var(--brand-deep)]">
                        <StudentTypeBadge type={h.student.studentType} />
                        {h.student.fullName}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {h.classLabel} · fee open {formatInr(h.balancePaise)}
                      </div>
                    </button>
                  </li>
                  ))
                )}
              </ul>
            ) : null}

            {selected ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2">
                  <div className="text-sm text-[var(--brand-deep)]">
                    <span className="font-semibold">
                      {selected.student.fullName}
                    </span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      · {selected.student.admissionNo} · {selected.classLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="text-xs font-semibold text-[var(--brand-mid)]"
                    onClick={() => {
                      setSelected(null);
                      setQuery("");
                    }}
                  >
                    Change
                  </button>
                </div>
                <HoldStatusBanner
                  check={holdCheck}
                  onOverride={() => setHoldDialog(true)}
                />
              </div>
            ) : null}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Issue date
                </span>
                <input
                  className="field !py-1.5"
                  type="date"
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Note (optional)
                </span>
                <input
                  className="field !py-1.5"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. New session book set"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1 text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Add item
                </span>
                <select
                  className="field !py-1.5"
                  value={pickItemId}
                  onChange={(e) => setPickItemId(e.target.value)}
                >
                  <option value="">Select from catalog…</option>
                  {catalogByCat.map(([cat, list]) => (
                    <optgroup key={cat} label={cat}>
                      {list.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.sku} · {i.name}
                          {i.sizeLabel ? ` (${i.sizeLabel})` : ""} ·{" "}
                          {formatInr(i.unitPricePaise)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]"
                onClick={addToCart}
              >
                Add
              </button>
            </div>

            {cart.length > 0 ? (
              <ul className="mt-3 divide-y divide-[rgba(32,48,80,0.08)] rounded-lg border border-[rgba(32,48,80,0.12)]">
                {cart.map((row) => {
                  const item = items.find((i) => i.id === row.itemId);
                  if (!item) return null;
                  const qty = Math.max(1, Math.floor(Number(row.qty) || 1));
                  return (
                    <li
                      key={row.itemId}
                      className="flex flex-wrap items-center gap-2 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[var(--brand-deep)]">
                          {item.name}
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {item.sku} · {formatInr(item.unitPricePaise)} each
                        </div>
                      </div>
                      <input
                        className="field !w-16 !py-1 !text-center"
                        type="number"
                        min={1}
                        value={row.qty}
                        onChange={(e) =>
                          setCart((prev) =>
                            prev.map((r) =>
                              r.itemId === row.itemId
                                ? { ...r, qty: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                      <input
                        className="field !w-20 !py-1"
                        value={row.sizeLabel}
                        onChange={(e) =>
                          setCart((prev) =>
                            prev.map((r) =>
                              r.itemId === row.itemId
                                ? { ...r, sizeLabel: e.target.value }
                                : r,
                            ),
                          )
                        }
                        placeholder="Size"
                      />
                      <span className="w-20 text-right text-sm font-bold text-[var(--brand-deep)]">
                        {formatInr(item.unitPricePaise * qty)}
                      </span>
                      <button
                        type="button"
                        className="text-xs font-semibold text-[#dc2626]"
                        onClick={() =>
                          setCart((prev) =>
                            prev.filter((r) => r.itemId !== row.itemId),
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Cart is empty — add books or uniform items above.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] text-[var(--muted)]">Issue total</div>
                <div className="text-xl font-extrabold text-[var(--brand-deep)]">
                  {formatInr(cartTotal)}
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                disabled={!selected || cart.length === 0}
                onClick={onIssue}
              >
                Issue on credit
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Catalog
            </h2>
            <ul className="mt-2 max-h-56 divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto text-sm">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--brand-deep)]">
                      {i.name}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {categoryLabel(i.category)} · {i.sku}
                      {i.sizeLabel ? ` · ${i.sizeLabel}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 font-bold tabular-nums">
                    {formatInr(i.unitPricePaise)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Recent issues
            </h2>
            {issues.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">
                No issues yet — create one on the left.
              </p>
            ) : (
              <ul className="mt-2 max-h-80 divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto">
                {issues.slice(0, 20).map((iss) => {
                  const st = sis?.students.find((s) => s.id === iss.studentId);
                  const voided = !!iss.voidedAt;
                  return (
                    <li
                      key={iss.id}
                      className={`py-2 ${voided ? "opacity-55" : ""}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[var(--brand-deep)]">
                            {iss.issueNo}
                            {voided ? (
                              <span className="ml-1.5 text-[10px] uppercase text-[#dc2626]">
                                Void
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-[var(--muted)]">
                            {st?.fullName ?? iss.studentId} · {iss.issuedOn}
                          </div>
                          <ul className="mt-1 text-[10px] text-[var(--muted)]">
                            {iss.lines.map((l, idx) => (
                              <li key={idx}>
                                {l.name}
                                {l.sizeLabel ? ` ${l.sizeLabel}` : ""} ×{l.qty}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-[var(--brand-deep)]">
                            {formatInr(iss.totalPaise)}
                          </div>
                          {!voided ? (
                            <button
                              type="button"
                              className="mt-1 text-[11px] font-semibold text-[#dc2626]"
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    "Void this issue? It will be removed from Fee Take dues.",
                                  )
                                ) {
                                  return;
                                }
                                voidStoreIssue(iss.id);
                                refresh();
                                flash(`Voided ${iss.issueNo}`);
                              }}
                            >
                              Void
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {holdDialog &&
      selected &&
      holdCheck &&
      !holdCheck.allowed ? (
        <PrincipalHoldOverrideDialog
          studentId={selected.student.id}
          studentName={selected.student.fullName}
          holdCode="HOLD_STORE_CREDIT"
          block={holdCheck}
          overriddenBy={session.fullName}
          onClose={() => setHoldDialog(false)}
          onGranted={() => {
            setHoldDialog(false);
            refreshHolds(selected.student.id);
            flash("Store credit hold unlocked — you can issue now");
          }}
        />
      ) : null}
    </div>
  );
}

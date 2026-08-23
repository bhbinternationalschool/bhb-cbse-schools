"use client";

/**
 * Transport ↔ SIS → pick a student's village, then pin where they board.
 *
 * The village comes from SIS when we already know it, so arranging transport
 * for a child does not start by asking a question the office has already
 * answered. Where it is a guess — the address scanner matched 143 of 198
 * households by reading the address text — the screen says so, because a
 * scanned match is not the family's own answer and should not look like one.
 *
 * The map opens ON THE VILLAGE rather than on the school or on a blank
 * country view: the operator's job is to move a pin a few hundred metres to
 * the corner where the bus actually waits, not to find Varanasi first.
 *
 * The pinned point is saved against the student, so next year, or when the
 * route changes, the boarding place is already known.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, MapPin, Save } from "lucide-react";
import { erpBtn, erpBtnOutline, erpField } from "@/components/ui/erp-ui";
import { StopMapPicker, type PickedPoint } from "@/components/transport/StopMapPicker";

export type DirectoryVillage = {
  villageId: string;
  villageName: string;
  blockName: string;
  settlementType: "village" | "town";
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  students: number;
};

type Loaded = {
  householdId: string;
  village: {
    villageId: string | null;
    villageName: string;
    blockName: string;
    source: string;
    confidence: string;
  } | null;
  point: {
    latitude: number;
    longitude: number;
    pointName: string;
    note: string;
    setBy: string;
    setAt: string;
  } | null;
};

export function StudentVillageStopPicker({
  studentId,
  studentLabel,
  canEdit,
  onSaved,
}: {
  studentId: string;
  studentLabel?: string;
  canEdit: boolean;
  onSaved?: () => void;
}) {
  const [directory, setDirectory] = useState<DirectoryVillage[] | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [block, setBlock] = useState("");
  const [villageId, setVillageId] = useState("");
  const [pointName, setPointName] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ── load ─────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dirRes, oneRes] = await Promise.all([
        fetch("/api/sis/student-village?directory=1", { cache: "no-store" }),
        fetch(`/api/sis/student-village?studentId=${encodeURIComponent(studentId)}`, {
          cache: "no-store",
        }),
      ]);
      const dir = (await dirRes.json()) as { ok?: boolean; villages?: DirectoryVillage[]; error?: string };
      const one = (await oneRes.json()) as ({ ok?: boolean; error?: string } & Loaded);

      if (!dirRes.ok || !dir.ok) {
        setError(dir.error || "Could not load the village list");
        return;
      }
      setDirectory(dir.villages ?? []);

      if (!oneRes.ok || !one.ok) {
        setError(one.error || "Could not load this student");
        return;
      }
      setLoaded(one);
      // Prefill from SIS — the whole point is not to re-ask.
      if (one.village?.villageId) {
        setVillageId(one.village.villageId);
        setBlock(one.village.blockName || "");
      }
      if (one.point) {
        setPin({ lat: one.point.latitude, lng: one.point.longitude });
        setPointName(one.point.pointName || "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = notice ? window.setTimeout(() => setNotice(null), 4000) : null;
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [notice]);

  /* ── derived ──────────────────────────────────────────────── */

  const blocks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of directory ?? []) {
      if (!v.blockName) continue;
      counts.set(v.blockName, (counts.get(v.blockName) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [directory]);

  /**
   * Villages of the chosen block only.
   *
   * Block first, deliberately. The district has 1,292 settlements and a flat
   * list of them is not something anyone scrolls — narrowing to a block
   * leaves 106-214, which is a list a person can actually read.
   */
  const villagesInBlock = useMemo(() => {
    if (!directory || !block) return [];
    return directory
      .filter((v) => v.blockName === block)
      .sort((a, b) => a.villageName.localeCompare(b.villageName));
  }, [directory, block]);

  const chosen = useMemo(
    () => (directory ?? []).find((v) => v.villageId === villageId) ?? null,
    [directory, villageId],
  );

  /** Where the map should open: the pin if set, else the village centroid. */
  const mapStart = useMemo(() => {
    if (pin) return pin;
    if (chosen?.latitude != null && chosen?.longitude != null) {
      return { lat: chosen.latitude, lng: chosen.longitude };
    }
    return null;
  }, [pin, chosen]);

  const scanned = loaded?.village?.source === "address_scan";

  /* ── save ─────────────────────────────────────────────────── */

  const save = useCallback(
    async (extra: Partial<{ lat: number; lng: number }> = {}) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { studentId };
        if (villageId) body.villageId = villageId;
        const lat = extra.lat ?? pin?.lat;
        const lng = extra.lng ?? pin?.lng;
        if (lat !== undefined && lng !== undefined) {
          body.lat = lat;
          body.lng = lng;
          body.pointName = pointName;
        }
        const res = await fetch("/api/sis/student-village", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setError(data.error || `Save failed (${res.status})`);
          return;
        }
        setNotice("Saved");
        await load();
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        setBusy(false);
      }
    },
    [busy, studentId, villageId, pin, pointName, load, onSaved],
  );

  /* ── render ───────────────────────────────────────────────── */

  if (mapOpen) {
    return (
      <StopMapPicker
        initial={mapStart}
        stopName={pointName || chosen?.villageName || studentLabel || "Boarding point"}
        onCancel={() => setMapOpen(false)}
        onPick={(p: PickedPoint) => {
          setPin({ lat: p.lat, lng: p.lng });
          // Google's reverse-geocoded label is a starting suggestion only.
          // Rural boarding points are landmarks — "the neem tree" — so the
          // name stays editable rather than being fixed to an address.
          if (!pointName && p.address) setPointName(p.address.split(",")[0]?.trim() ?? "");
          setMapOpen(false);
          void save({ lat: p.lat, lng: p.lng });
        }}
      />
    );
  }

  return (
    <div className="erp-surface-sm space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--brand-deep)]">
          Village &amp; boarding point
          {studentLabel ? (
            <span className="ml-1 font-normal text-[var(--muted)]">· {studentLabel}</span>
          ) : null}
        </h4>
        {loaded?.point ? (
          <span className="inline-flex items-center gap-1 text-micro text-[var(--success)]">
            <Check className="size-3" aria-hidden />
            pinned {loaded.point.setBy ? `by ${loaded.point.setBy}` : ""}
          </span>
        ) : null}
      </div>

      {loaded && !loaded.village ? (
        <p className="rounded-lg border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-2.5 py-1.5 text-micro text-[var(--danger)]">
          No village on file for this family — their address does not name one
          we recognise. Pick the block, then the village, and it is recorded for
          every sibling too.
        </p>
      ) : null}

      {scanned ? (
        <p className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-2.5 py-1.5 text-micro text-[var(--warning)]">
          This village was read off the household address, not confirmed by
          anyone. Check it before relying on it — saving here marks it confirmed.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[9rem] flex-1 text-micro text-[var(--muted)]">
          Block
          <select
            className={erpField}
            value={block}
            disabled={!canEdit || !directory}
            onChange={(e) => {
              setBlock(e.target.value);
              setVillageId("");
            }}
          >
            <option value="">
              {directory ? "Choose a block…" : "Loading…"}
            </option>
            {blocks.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name} ({b.count})
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-[12rem] flex-[2] text-micro text-[var(--muted)]">
          Village
          <select
            className={erpField}
            value={villageId}
            disabled={!canEdit || !directory || !block}
            onChange={(e) => {
              setVillageId(e.target.value);
              // A new village invalidates a pin dropped in the old one.
              setPin(null);
            }}
          >
            <option value="">
              {!directory
                ? "Loading…"
                : !block
                  ? "Choose a block first"
                  : `Choose a village… (${villagesInBlock.length})`}
            </option>
            {villagesInBlock.map((v) => (
              <option key={v.villageId} value={v.villageId}>
                {v.villageName}
                {v.settlementType === "town" ? " (town)" : ""}
                {v.durationMinutes !== null ? ` — ${v.durationMinutes} min` : ""}
                {v.students > 0 ? ` · ${v.students} enrolled` : ""}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={erpBtnOutline}
          disabled={!canEdit || !chosen}
          title={
            chosen
              ? mapStart
                ? "Open the map on this village and drop the pin where the bus waits"
                : "This village has no coordinates on file, so the map cannot centre on it"
              : "Choose a village first"
          }
          onClick={() => setMapOpen(true)}
        >
          <MapPin className="size-3.5" aria-hidden />
          {pin ? "Move pin" : "Pin stop on map"}
        </button>
      </div>

      {chosen && !mapStart ? (
        <p className="text-micro text-[var(--warning)]">
          {chosen.villageName} has no coordinates on file, so the map cannot open
          centred on it. Pick a neighbouring village, or pin from the route screen.
        </p>
      ) : null}

      <label className="block text-micro text-[var(--muted)]">
        What the family calls this spot
        <input
          className={erpField}
          placeholder="e.g. neem tree crossing, Yadav ki dukan"
          value={pointName}
          disabled={!canEdit}
          onChange={(e) => setPointName(e.target.value)}
        />
      </label>

      {pin ? (
        <p className="text-micro text-[var(--muted)]">
          Pinned at {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
          {chosen?.durationMinutes !== null && chosen?.durationMinutes !== undefined
            ? ` · village is ${chosen.durationMinutes} min from campus`
            : ""}
        </p>
      ) : (
        <p className="text-micro text-[var(--muted)]">
          No boarding point pinned yet. The village centroid is the middle of the
          village, not where a bus can stop.
        </p>
      )}

      {error ? (
        <p className="flex items-start gap-1.5 text-micro text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-micro text-[var(--success)]">{notice}</p> : null}

      {canEdit ? (
        <button
          type="button"
          className={erpBtn}
          disabled={busy || !villageId}
          onClick={() => void save()}
        >
          <Save className="size-3.5" aria-hidden />
          {busy ? "Saving…" : "Save village & point"}
        </button>
      ) : null}
    </div>
  );
}

export default StudentVillageStopPicker;

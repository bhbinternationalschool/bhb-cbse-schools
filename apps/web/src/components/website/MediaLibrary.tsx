"use client";

/**
 * The Website desk's media library — Phase 2.
 *
 * Three rules are enforced here rather than left to the person uploading:
 *
 *   1. An image cannot reach a page without a description. Alt text is what
 *      a blind visitor hears and what a search engine reads, and it is the
 *      one accessibility duty that cannot be retrofitted by a stylesheet.
 *      The file name does not count as one — see `altProblem`.
 *
 *   2. The same photograph is not stored twice. Files are fingerprinted
 *      before upload, so re-uploading last year's prize-day photo reuses
 *      the row instead of paying to store it again.
 *
 *   3. Consent is recorded on every file. The director chose blanket
 *      consent through the admission terms, so a pupil photograph defaults
 *      to "covered" — but a family that objects can be honoured in one
 *      click, and that objection blocks the picture everywhere it appears.
 */

import { AlertTriangle, ImageOff, Trash2, Upload } from "lucide-react";
import { loadSis } from "@/lib/sis";
import {
  mediaConsentForHousehold,
  normalizePhotoConsent,
  photoConsentLabel,
} from "@/lib/photoConsent";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErpTableShell } from "@/components/ui/erp-roster";
import { readAll } from "@/lib/data/client/query";
import { writeRecords } from "@/lib/data/client/mutate";
import { uploadMedia } from "@/lib/mediaUpload";
import { getSessionActor } from "@/lib/sessionActor";
import {
  CONSENT_STATUSES,
  altProblem,
  consentLabel,
  describeBytes,
  mediaReadyForPage,
  mediaToRow,
  newSiteId,
  rowToMedia,
  sha256Hex,
  type ConsentStatus,
  type SiteMedia,
} from "@/lib/website";

/** Pixel dimensions, so a block can reserve space and avoid a layout jump. */
async function imageSize(file: File): Promise<{ w: number; h: number }> {
  if (!file.type.startsWith("image/")) return { w: 0, h: 0 };
  try {
    const bitmap = await createImageBitmap(file);
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { w: 0, h: 0 };
  }
}

export function MediaLibrary({
  onError,
  onNotice,
}: {
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [items, setItems] = useState<SiteMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draftAlt, setDraftAlt] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await readAll<Record<string, unknown>>("site.media", {
      maxPages: 5,
    });
    if (!res.ok) {
      onError(
        res.code === "auth"
          ? "Your role does not include the Website module."
          : `Could not load the media library: ${res.error}`,
      );
      setItems([]);
      setLoading(false);
      return;
    }
    setItems(res.rows.map(rowToMedia).filter((m) => !m.deletedAt));
    setLoading(false);
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const needingAlt = useMemo(
    () =>
      items.filter(
        (m) => m.mime.startsWith("image/") && altProblem(m.alt) !== null,
      ).length,
    [items],
  );

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    onError(null);
    onNotice(null);

    const actor = getSessionActor();
    let added = 0;
    let reused = 0;
    const failures: string[] = [];

    // Read the current hashes once; a file uploaded in this same batch is
    // caught too, which is the common case when someone selects a folder.
    const seen = new Map(
      items.filter((m) => m.contentHash).map((m) => [m.contentHash, m]),
    );

    for (const file of Array.from(files)) {
      setBusy(`Reading ${file.name}…`);
      const hash = await sha256Hex(file);

      const dup = seen.get(hash);
      if (dup) {
        reused += 1;
        continue;
      }

      setBusy(`Uploading ${file.name}…`);
      const size = await imageSize(file);
      const up = await uploadMedia({
        file,
        visibility: "public",
        pathPrefix: "site",
      });
      if (!up.ok) {
        failures.push(`${file.name}: ${up.error}`);
        continue;
      }

      const id = newSiteId("md");
      const res = await writeRecords("site.media", [
        {
          op: "upsert",
          id,
          base: null,
          row: mediaToRow({
            bucket: "site-media",
            storagePath: up.path,
            url: up.url,
            mime: file.type || "application/octet-stream",
            bytes: up.bytes,
            width: size.w,
            height: size.h,
            alt: "",
            // Silence is not consent. The school asks each family with a
            // separate, optional tick on the registration form, so a freshly
            // uploaded picture starts as PENDING and cannot be published
            // until someone says whose it is (and that family said yes) or
            // marks it as having nobody in it. The old default was `granted`
            // on the strength of a blanket term — which is the thing that
            // changed. See lib/photoConsent.ts.
            consentStatus: "pending",
            contentHash: hash,
            originalFilename: file.name,
            uploadedBy: actor?.fullName || "",
          }),
        },
      ]);
      if (!res.ok) {
        failures.push(`${file.name}: ${res.message}`);
        continue;
      }
      // Keep the batch honest about what it has already stored.
      seen.set(hash, { contentHash: hash } as SiteMedia);
      added += 1;
    }

    setBusy(null);
    if (fileInput.current) fileInput.current.value = "";

    const parts: string[] = [];
    if (added) parts.push(`${added} file${added === 1 ? "" : "s"} added`);
    if (reused)
      parts.push(`${reused} already in the library and not stored again`);
    if (parts.length)
      onNotice(`${parts.join("; ")}. Add a description to each new picture.`);
    if (failures.length) onError(failures.join(" · "));

    await load();
  }

  async function saveAlt(item: SiteMedia) {
    const next = (draftAlt[item.id] ?? item.alt).trim();
    if (next === item.alt) return;
    const problem = altProblem(next, item.originalFilename);
    if (problem) {
      onError(problem);
      return;
    }
    setBusy(item.id);
    const res = await writeRecords("site.media", [
      {
        op: "upsert",
        id: item.id,
        base: item.updatedAt,
        row: mediaToRow({ alt: next }),
      },
    ]);
    setBusy(null);
    if (!res.ok) {
      onError(`The description was not saved: ${res.message}`);
      return;
    }
    onError(null);
    await load();
  }

  /**
   * Attach the picture to a family, and take the consent from THEIR answer.
   *
   * The status is derived, not chosen, so the office cannot mark a picture
   * publishable for a family that declined — the point of asking is lost the
   * moment someone can overrule it here. Clearing the family leaves the
   * status alone: a picture with nobody in it is marked "not required" on its
   * own, and is not a family question at all.
   */
  /**
   * The families, for the picker. Read from SIS because that is where the
   * answer lives once a child is enrolled; the registration form writes it
   * onto the admission household and enrolment carries it across.
   */
  const [households, setHouseholds] = useState<
    { id: string; code: string; guardianName: string; photoConsent?: string }[]
  >([]);
  useEffect(() => {
    try {
      const sis = loadSis();
      setHouseholds(
        (sis.households ?? []).map((h) => ({
          id: h.id,
          code: h.code,
          guardianName: h.guardianName,
          photoConsent: h.photoConsent,
        })),
      );
    } catch {
      // No SIS in this browser yet: the picker is empty and consent stays a
      // manual decision, which is the safe direction to fail in.
      setHouseholds([]);
    }
  }, []);

  async function setHousehold(item: SiteMedia, householdId: string) {
    const family = households.find((h) => h.id === householdId);
    setBusy(item.id);
    const res = await writeRecords("site.media", [
      {
        op: "upsert",
        id: item.id,
        base: item.updatedAt,
        row: mediaToRow({
          consentHouseholdId: householdId,
          ...(family
            ? {
                consentStatus: mediaConsentForHousehold(
                  normalizePhotoConsent(family.photoConsent),
                ),
              }
            : {}),
        }),
      },
    ]);
    setBusy(null);
    if (!res.ok) {
      onError(`The family was not recorded: ${res.message}`);
      return;
    }
    await load();
  }

  async function setConsent(item: SiteMedia, status: ConsentStatus) {
    setBusy(item.id);
    const res = await writeRecords("site.media", [
      {
        op: "upsert",
        id: item.id,
        base: item.updatedAt,
        row: mediaToRow({ consentStatus: status }),
      },
    ]);
    setBusy(null);
    if (!res.ok) {
      onError(`Consent was not changed: ${res.message}`);
      return;
    }
    if (status === "withdrawn") {
      onNotice(
        "Marked as objected to. It will not appear on any public page, including ones it is already placed on.",
      );
    }
    await load();
  }

  async function remove(item: SiteMedia) {
    if (
      !window.confirm(
        `Remove this file from the library?\n\nAny page still using it will lose the picture. The file is kept on file and can be restored.`,
      )
    ) {
      return;
    }
    setBusy(item.id);
    const res = await writeRecords("site.media", [
      { op: "delete", id: item.id, base: item.updatedAt },
    ]);
    setBusy(null);
    if (!res.ok) {
      onError(`The file was not removed: ${res.message}`);
      return;
    }
    onNotice("Removed from the library.");
    await load();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-1)]">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Add pictures and files
        </h2>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Photographs, the prospectus, a form to download. Large photographs are
          made smaller automatically. The same file uploaded twice is only
          stored once.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            Choose files
          </button>
          {busy && (
            <span className="text-[11px] text-[var(--muted)]">{busy}</span>
          )}
        </div>
      </section>

      {needingAlt > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-[rgba(197,160,40,0.4)] bg-[rgba(197,160,40,0.08)] px-3 py-2.5 text-[11px] text-[var(--brand-deep)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning,#8a6d1f)]" />
          <span>
            <strong>
              {needingAlt} picture{needingAlt === 1 ? "" : "s"}
            </strong>{" "}
            {needingAlt === 1 ? "has" : "have"} no description yet, so{" "}
            {needingAlt === 1 ? "it" : "they"} cannot be placed on a page. A
            description is what a blind visitor hears.
          </span>
        </div>
      )}

      <ErpTableShell>
        {loading ? (
          <div className="px-4 py-10 text-center text-xs text-[var(--muted)]">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <ImageOff className="mx-auto h-7 w-7 text-[var(--muted)]" />
            <p className="mt-2 text-sm font-semibold text-[var(--brand-deep)]">
              Nothing in the library yet
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[11px] text-[var(--muted)]">
              The school crest, the building, a class photograph and the
              prospectus are the four the pages will ask for first.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map((item) => {
              const ready = mediaReadyForPage(item);
              const isImage = item.mime.startsWith("image/");
              const alt = draftAlt[item.id] ?? item.alt;
              return (
                <li key={item.id} className="flex flex-wrap gap-3 p-3">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)]">
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.url}
                        alt={item.alt || "Not yet described"}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] uppercase text-[var(--muted)]">
                        {(item.storagePath.split(".").pop() || "file").slice(
                          0,
                          4,
                        )}
                      </div>
                    )}
                  </div>

                  <div className="min-w-[16rem] flex-1 space-y-2">
                    {isImage && (
                      <label className="block text-[11px] text-[var(--muted)]">
                        Description
                        <input
                          className="mt-0.5 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-sm text-[var(--brand-deep)]"
                          value={alt}
                          placeholder="Class VI pupils planting saplings on the school field"
                          onChange={(e) =>
                            setDraftAlt((d) => ({
                              ...d,
                              [item.id]: e.target.value,
                            }))
                          }
                          onBlur={() => void saveAlt(item)}
                        />
                      </label>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Whose child is this? Choosing the family sets the
                          consent from what THEY said on the registration
                          form, rather than from what the office assumes.
                          Until this session nothing ever wrote
                          consent_household_id, so the column existed and the
                          family's answer had no reader. */}
                      <label className="text-[11px] text-[var(--muted)]">
                        Family
                        <select
                          className="ml-1.5 max-w-[13rem] rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px] text-[var(--brand-deep)]"
                          value={item.consentHouseholdId}
                          onChange={(e) => void setHousehold(item, e.target.value)}
                        >
                          <option value="">
                            {item.consentStatus === "not_required"
                              ? "Nobody in this picture"
                              : "Say whose child this is…"}
                          </option>
                          {households.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.guardianName || h.code} —{" "}
                              {photoConsentLabel(normalizePhotoConsent(h.photoConsent))}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-[var(--muted)]">
                        Consent
                        <select
                          className="ml-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px] text-[var(--brand-deep)]"
                          value={item.consentStatus}
                          onChange={(e) =>
                            void setConsent(
                              item,
                              e.target.value as ConsentStatus,
                            )
                          }
                        >
                          {CONSENT_STATUSES.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <span className="text-[10px] text-[var(--muted)]">
                        {item.originalFilename || describeBytes(item.bytes)}
                        {item.originalFilename ? ` · ${describeBytes(item.bytes)}` : ""}
                        {item.width ? ` · ${item.width}×${item.height}` : ""}
                        {item.uploadedBy ? ` · ${item.uploadedBy}` : ""}
                      </span>
                    </div>

                    {!ready.ready && (
                      <p className="text-[11px] font-medium text-[var(--danger,#a13a2c)]">
                        Not usable on a page — {ready.reason}
                      </p>
                    )}
                    {ready.ready && item.consentStatus === "granted" && (
                      <p className="text-[10px] text-[var(--muted)]">
                        {consentLabel(item.consentStatus)}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => void remove(item)}
                    title="Remove from the library"
                    className="h-8 shrink-0 rounded-lg border border-[var(--border)] px-2 text-[var(--muted)] hover:text-[var(--danger,#a13a2c)] disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ErpTableShell>
    </div>
  );
}

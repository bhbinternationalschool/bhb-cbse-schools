"use client";

import { useMemo } from "react";
import { listSessionYearOptions, type MastersState, type SessionYearOption } from "@/lib/masters";
import { useMasters } from "@/lib/data/client/hooks";

/**
 * The school's academic years for the header (data-layer 2.3a): from the
 * masters view (useMasters — both the full and the teaching answer carry
 * them), not from the tab's page copy and its 'bhb-masters-updated' event.
 * Empty until the view answers (the selector then shows the session's own
 * year — never an invented one). `dataUpdatedAt` moves with every answer:
 * the shell re-checks the session's year against the server's then.
 */
export function useAcademicYears(opts: { enabled?: boolean } = {}): {
  years: SessionYearOption[];
  dataUpdatedAt: number;
} {
  const q = useMasters(opts);
  const academicYears = q.data?.masters.academicYears;
  const years = useMemo(
    () => (academicYears ? listSessionYearOptions({ academicYears } as MastersState) : []),
    [academicYears],
  );
  return { years, dataUpdatedAt: q.dataUpdatedAt };
}

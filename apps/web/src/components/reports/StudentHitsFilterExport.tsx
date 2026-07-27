"use client";

import { formatInr, type StudentSearchHit } from "@/lib/fees";
import { describeFilters } from "@/lib/reportExport";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { TENANT } from "@/lib/types";
import { useDemoSessionOptional } from "@/components/shell/SessionContext";

/** PDF/Excel of the current student search hits (shared across Fee-like screens). */
export function StudentHitsFilterExport({
  title,
  hits,
  query,
  classLabel,
  sectionLabel,
  academicYearCode,
  onMessage,
}: {
  title: string;
  hits: StudentSearchHit[];
  query: string;
  classLabel?: string;
  sectionLabel?: string;
  academicYearCode?: string;
  onMessage?: (msg: string) => void;
}) {
  const session = useDemoSessionOptional();
  const ay =
    academicYearCode ||
    session?.academicYearCode ||
    hits[0]?.student.academicYearCode ||
    "";
  return (
    <FilterExportButtons
      title={title}
      subtitle={`${TENANT.shortName}${ay ? ` · ${ay}` : ""}`}
      filterNote={describeFilters([
        classLabel ? `Class ${classLabel}` : "",
        sectionLabel ? `Sec ${sectionLabel}` : "",
        query.trim() ? `Search “${query.trim()}”` : "",
      ])}
      fileBaseName={title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}
      columns={[
        { key: "admissionNo", header: "Adm no", width: 1.1 },
        { key: "fullName", header: "Name", width: 1.6 },
        { key: "classLabel", header: "Class", width: 0.9 },
        { key: "type", header: "Type", width: 0.8 },
        { key: "mobile", header: "Mobile", width: 1 },
        { key: "balance", header: "Open bal.", width: 1, align: "right" },
      ]}
      rows={hits.map((h) => ({
        admissionNo: h.student.admissionNo,
        fullName: h.student.fullName,
        classLabel: h.classLabel,
        type: h.student.studentType,
        mobile: h.household?.mobile ?? "",
        balance: formatInr(h.balancePaise),
      }))}
      onMessage={onMessage}
    />
  );
}

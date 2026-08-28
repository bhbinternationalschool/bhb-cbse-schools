"use client";

import {
  certificateKindLabel,
  dateToWords,
  formatCertDate,
  genderLabel,
  type CertificateIssue,
  type TcDetails,
} from "@/lib/certificates";
import { amountInWordsPaise, formatInr } from "@/lib/fees";
import {
  schoolAddressLine,
  schoolCityLine,
  schoolPrintName,
  schoolShortName,
  schoolStatutoryLine,
  schoolTagline,
} from "@/lib/schoolIdentity";
import { TENANT } from "@/lib/types";

export function printCertificate(issueId: string) {
  const sheet = document.getElementById(`certificate-${issueId}`);
  if (!sheet) {
    window.print();
    return;
  }
  document.body.classList.add("printing-certificate");
  sheet.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-certificate");
    sheet.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

export function CertificateSheet({ issue }: { issue: CertificateIssue }) {
  const voided = !!issue.voidedAt;
  const title = certificateKindLabel(issue.kind);
  const isTc = issue.kind === "tc";

  return (
    <div
      id={`certificate-${issue.id}`}
      className="certificate-sheet relative overflow-hidden rounded-xl border border-[rgba(32,48,80,0.18)] bg-white"
      data-voided={voided ? "true" : "false"}
    >
      <div className="certificate-watermark pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="select-none text-5xl font-bold uppercase tracking-[0.2em] text-[rgba(32,48,80,0.06)] sm:text-6xl">
          {voided ? "VOID" : schoolShortName()}
        </span>
      </div>

      <div
        className={`certificate-inner relative ${
          isTc ? "px-4 py-5 sm:px-6 sm:py-6" : "px-5 py-6 sm:px-8 sm:py-8"
        }`}
      >
        {isTc ? (
          <TcSheet issue={issue} voided={voided} />
        ) : (
          <>
            <header className="border-b-2 border-[var(--brand-gold)] pb-3 text-center">
              <p className="font-brand-name text-sm tracking-[0.12em] text-[var(--brand-deep)] sm:text-base">
                {schoolPrintName()}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                {schoolCityLine()}
              </p>
              <p className="font-tagline mt-1 text-sm">{schoolTagline()}</p>
            </header>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="rounded bg-[var(--brand-deep)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
                {title}
                {voided ? " · void" : ""}
              </div>
              <div className="text-right text-xs">
                <div>
                  <span className="text-[var(--muted)]">Certificate No. </span>
                  <span className="font-bold text-[var(--brand-deep)]">
                    {issue.certNo}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--muted)]">Date </span>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {formatCertDate(issue.issuedOn)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-4 text-sm leading-relaxed text-[var(--brand-deep)]">
              {issue.customBody ? (
                <CustomCertificateBody issue={issue} />
              ) : issue.kind === "bonafide" ? (
                <BonafideBody issue={issue} />
              ) : issue.kind === "character" ? (
                <CharacterBody issue={issue} />
              ) : issue.kind === "fees_paid" ? (
                <FeesPaidBody issue={issue} />
              ) : (
                <FeeClearanceBody issue={issue} />
              )}
            </div>

            <div className="mt-10 grid grid-cols-2 gap-6 text-xs">
              <div>
                <div className="h-10 border-b border-[rgba(32,48,80,0.25)]" />
                <p className="mt-1 text-[var(--muted)]">Class teacher</p>
                {issue.classTeacherName ? (
                  <p className="font-semibold text-[var(--brand-deep)]">
                    {issue.classTeacherName}
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <div className="ml-auto h-10 w-40 border-b border-[rgba(32,48,80,0.25)]" />
                <p className="mt-1 text-[var(--muted)]">
                  Principal / authorised
                </p>
                <p className="text-[10px] text-[var(--muted)]">
                  Issued by {issue.issuedBy}
                </p>
              </div>
            </div>
          </>
        )}

        {issue.overrideDues ? (
          <p className="mt-4 text-[10px] text-[#b45309] print-hide">
            Issued with dues override — open balance was{" "}
            {formatInr(issue.openBalancePaise)} at issue.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TcSheet({
  issue,
  voided,
}: {
  issue: CertificateIssue;
  voided: boolean;
}) {
  const tc = issue.tc;
  const rows = tcRows(issue, tc);

  return (
    <>
      <header className="border-b-2 border-[var(--brand-deep)] pb-3 text-center">
        <p className="font-brand-name text-[13px] tracking-[0.1em] text-[var(--brand-deep)] sm:text-base">
          {schoolPrintName()}
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">
          {schoolAddressLine() || schoolCityLine()}
        </p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
          Affiliated to the Central Board of Secondary Education
        </p>
        {schoolStatutoryLine() ? (
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            {schoolStatutoryLine()} · Status: {TENANT.schoolStatus}
          </p>
        ) : null}
        <p className="mt-2 text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand-deep)]">
          Transfer Certificate
          {voided ? " (VOID)" : ""}
        </p>
        <p className="mt-0.5 text-[9px] text-[var(--muted)]">
          Format as per CBSE Examination Bye-laws — Annexure-I
        </p>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-b border-[rgba(32,48,80,0.15)] pb-2 text-[11px] text-[var(--brand-deep)] sm:grid-cols-3">
        <div>
          <span className="text-[var(--muted)]">Book No. </span>
          <strong>{tc?.bookNo || "1"}</strong>
        </div>
        <div>
          <span className="text-[var(--muted)]">Certificate No. </span>
          <strong>{issue.certNo}</strong>
        </div>
        <div>
          <span className="text-[var(--muted)]">Admission No. </span>
          <strong>{issue.admissionNo || "—"}</strong>
        </div>
        <div>
          <span className="text-[var(--muted)]">PEN (UDISE+) </span>
          <strong className="font-mono tracking-wide">
            {issue.pen || "—"}
          </strong>
        </div>
        <div>
          <span className="text-[var(--muted)]">APAAR ID </span>
          <strong className="font-mono tracking-wide">
            {issue.apaarId || "—"}
          </strong>
        </div>
        <div>
          <span className="text-[var(--muted)]">Session </span>
          <strong>{issue.academicYearCode}</strong>
        </div>
      </div>

      <ol className="mt-3 space-y-0 text-[11px] leading-snug text-[var(--brand-deep)] sm:text-xs">
        {rows.map((row) => (
          <li
            key={row.n}
            className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-1 border-b border-dotted border-[rgba(32,48,80,0.12)] py-1.5"
          >
            <span className="font-semibold text-[var(--muted)]">{row.n}.</span>
            <div>
              <span className="text-[var(--muted)]">{row.label}</span>
              {row.sub ? (
                <div className="mt-0.5 font-semibold">{row.sub}</div>
              ) : (
                <span className="font-semibold"> {row.value || "—"}</span>
              )}
              {row.extra ? (
                <div className="mt-0.5 text-[10px] text-[var(--brand-deep)]">
                  {row.extra}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 grid grid-cols-3 gap-3 text-[10px] text-[var(--brand-deep)]">
        <div>
          <div className="h-12 border-b border-[rgba(32,48,80,0.3)]" />
          <p className="mt-1 font-semibold">Signature of Class Teacher</p>
          {issue.classTeacherName ? (
            <p className="text-[var(--muted)]">{issue.classTeacherName}</p>
          ) : null}
        </div>
        <div>
          <div className="h-12 border-b border-[rgba(32,48,80,0.3)]" />
          <p className="mt-1 font-semibold">Checked by</p>
          <p className="text-[var(--muted)]">
            {(tc?.checkedByName || "—") +
              (tc?.checkedByDesignation
                ? `, ${tc.checkedByDesignation}`
                : "")}
          </p>
        </div>
        <div>
          <div className="h-12 border-b border-[rgba(32,48,80,0.3)]" />
          <p className="mt-1 font-semibold">Signature of Principal</p>
          <p className="text-[var(--muted)]">
            with date &amp; school seal
          </p>
          <p className="text-[9px] text-[var(--muted)]">
            Issued by {issue.issuedBy}
          </p>
        </div>
      </div>

      <p className="mt-4 text-[9px] leading-relaxed text-[var(--muted)]">
        Note: Transfer Certificate should be issued only under the signatures of
        the regular Principal / Vice-Principal. For migration from a
        non-CBSE school, TC must be countersigned by an officer not below the
        rank of District Inspector of Schools / Deputy Director of Education /
        Education Officer of the State / UT concerned. Counter-signature is not
        required for transfer between CBSE-affiliated schools (verify affiliation
        on cbse.gov.in).
      </p>
    </>
  );
}

function tcRows(
  issue: CertificateIssue,
  tc: TcDetails | null,
): { n: number; label: string; value?: string; sub?: string; extra?: string }[] {
  const dobFigures = issue.dob ? formatCertDate(issue.dob) : "—";
  const dobWords = issue.dob ? dateToWords(issue.dob) : "—";
  const lastFig = tc?.lastClassFigures || issue.lastClassStudied || issue.classLabel;
  const lastWords = tc?.lastClassWords || "—";
  const promoFig = tc?.promotedToFigures || issue.promotedTo || "—";
  const promoWords = tc?.promotedToWords || "—";
  const qualified = tc?.qualifiedForPromotion || "Yes";

  return [
    { n: 1, label: "Name of Pupil", value: issue.studentName.toUpperCase() },
    { n: 2, label: "Mother's Name", value: issue.motherName || "—" },
    {
      n: 3,
      label: "Father's / Guardian's Name",
      value: issue.fatherName || "—",
    },
    {
      n: 4,
      label: "Date of birth (in Christian Era) according to Admission Register",
      sub: `(in figures) ${dobFigures}`,
      extra: `(in words) ${dobWords}`,
    },
    {
      n: 5,
      label: "Nationality",
      value: tc?.nationality || "Indian",
    },
    {
      n: 6,
      label: "Whether the candidate belongs to SC / ST / OBC",
      value: tc?.category || "No",
    },
    {
      n: 7,
      label: "Date of first admission in the School with class",
      value: `${formatCertDate(issue.admissionDate)}${
        tc?.admissionClass ? ` · Class ${tc.admissionClass}` : ""
      }`,
    },
    {
      n: 8,
      label: "Class in which the pupil last studied",
      sub: `(in figures) ${lastFig}`,
      extra: `(in words) ${lastWords}`,
    },
    {
      n: 9,
      label: "School / Board Annual examination last taken with result",
      value: tc?.annualExamResult || "—",
    },
    {
      n: 10,
      label: "Whether failed, if so once / twice in the same class",
      value: tc?.failedOnceTwice || "No",
    },
    {
      n: 11,
      label: "Subjects Studied",
      value: tc?.subjectsStudied || "—",
    },
    {
      n: 12,
      label: "Whether qualified for promotion to the higher class",
      sub: `${qualified}${
        qualified.toLowerCase().startsWith("y") && promoFig !== "—"
          ? ` — If so, to which class (in fig.) ${promoFig}`
          : ""
      }`,
      extra:
        qualified.toLowerCase().startsWith("y") && promoWords !== "—"
          ? `(in words) ${promoWords}`
          : undefined,
    },
    {
      n: 13,
      label: "Month up to which the pupil has paid school dues",
      value: tc?.duesPaidUpto || "—",
    },
    {
      n: 14,
      label: "Any fee concession availed of. If so, the nature of such concession",
      value: tc?.feeConcession || "No",
    },
    {
      n: 15,
      label: "Total No. of working days in the academic session",
      value: tc?.workingDays || "—",
    },
    {
      n: 16,
      label: "Total No. of working days present",
      value: tc?.daysPresent || "—",
    },
    {
      n: 17,
      label: "Whether NCC Cadet / Boy Scout / Girl Guide (details may be given)",
      value: tc?.nccScoutGuide || "No",
    },
    {
      n: 18,
      label:
        "Games played or extra-curricular activities in which the pupil usually took part (mention achievement level therein)",
      value: tc?.gamesActivities || "—",
    },
    {
      n: 19,
      label: "General conduct",
      value: issue.conduct || "Good",
    },
    {
      n: 20,
      label: "Date of application for certificate",
      value: formatCertDate(tc?.applicationDate || issue.leavingDate),
    },
    {
      n: 21,
      label: "Date of issue of certificate",
      value: formatCertDate(issue.issuedOn),
    },
    {
      n: 22,
      label: "Reasons for leaving the school",
      value: issue.reasonForLeaving || "—",
    },
    {
      n: 23,
      label: "Any other remarks",
      value:
        [
          issue.remarks,
          issue.gender ? `Gender: ${genderLabel(issue.gender)}` : "",
          issue.rollNo ? `Roll No.: ${issue.rollNo}` : "",
          issue.pen ? `PEN: ${issue.pen}` : "",
          issue.apaarId ? `APAAR ID: ${issue.apaarId}` : "",
          issue.leavingDate
            ? `Name struck off rolls on: ${formatCertDate(issue.leavingDate)}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ") || "—",
    },
  ];
}

function StudentIntro({ issue }: { issue: CertificateIssue }) {
  return (
    <>
      <p>
        This is to certify that{" "}
        <strong className="uppercase">{issue.studentName}</strong>
        {issue.fatherName ? (
          <>
            , {issue.gender === "F" ? "D/o" : "S/o"}{" "}
            <strong>{issue.fatherName}</strong>
          </>
        ) : null}
        , Admission No. <strong>{issue.admissionNo || "—"}</strong>
        {issue.dob ? (
          <>
            , Date of birth <strong>{formatCertDate(issue.dob)}</strong>
          </>
        ) : null}
        {issue.gender ? <> ({genderLabel(issue.gender)})</> : null}.
      </p>
      {(issue.pen || issue.apaarId) && (
        <p className="text-[12px]">
          {issue.pen ? (
            <>
              PEN (UDISE+): <strong className="font-mono">{issue.pen}</strong>
            </>
          ) : null}
          {issue.pen && issue.apaarId ? " · " : null}
          {issue.apaarId ? (
            <>
              APAAR ID:{" "}
              <strong className="font-mono">{issue.apaarId}</strong>
            </>
          ) : null}
        </p>
      )}
    </>
  );
}

function CustomCertificateBody({ issue }: { issue: CertificateIssue }) {
  return (
    <div className="space-y-3">
      {issue.customTitle ? (
        <p className="text-center text-sm font-bold">{issue.customTitle}</p>
      ) : null}
      <div className="whitespace-pre-wrap text-sm leading-relaxed">
        {issue.customBody}
      </div>
    </div>
  );
}

function BonafideBody({ issue }: { issue: CertificateIssue }) {
  return (
    <>
      <StudentIntro issue={issue} />
      <p>
        is a bona fide student of this school, studying in class{" "}
        <strong>{issue.classLabel}</strong>
        {issue.rollNo ? (
          <>
            {" "}
            (Roll no. <strong>{issue.rollNo}</strong>)
          </>
        ) : null}{" "}
        for the academic session <strong>{issue.academicYearCode}</strong>.
      </p>
      <p>
        This certificate is issued for the purpose of{" "}
        {issue.remarks || "official use"} on request of the parent / guardian.
      </p>
    </>
  );
}

function CharacterBody({ issue }: { issue: CertificateIssue }) {
  return (
    <>
      <StudentIntro issue={issue} />
      <p>
        is / was a student of this school in class{" "}
        <strong>{issue.classLabel}</strong> during session{" "}
        <strong>{issue.academicYearCode}</strong>.
      </p>
      <p>
        As per school records, the character and conduct of the student have
        been found to be <strong>{issue.conduct || "Good"}</strong>.
      </p>
      {issue.remarks ? <p>Remarks: {issue.remarks}</p> : null}
    </>
  );
}

function FeeClearanceBody({ issue }: { issue: CertificateIssue }) {
  return (
    <>
      <StudentIntro issue={issue} />
      <p>
        studying in class <strong>{issue.classLabel}</strong> (session{" "}
        <strong>{issue.academicYearCode}</strong>) has{" "}
        <strong>no outstanding fee dues</strong> payable to the school as on{" "}
        <strong>{formatCertDate(issue.issuedOn)}</strong>, as per the fee
        ledger.
      </p>
      <p>
        This fee clearance / no-dues certificate is issued for{" "}
        {issue.remarks || "official purposes"}.
      </p>
    </>
  );
}

function FeesPaidBody({ issue }: { issue: CertificateIssue }) {
  const fp = issue.feesPaid;
  if (!fp) {
    return <p>Fee payment details unavailable.</p>;
  }

  const breakups = [
    { label: "Academic / tuition", paise: fp.academicPaise },
    { label: "Transport", paise: fp.transportPaise },
    { label: "Store / books", paise: fp.storePaise },
    { label: "Special fees", paise: fp.specialPaise },
    { label: "Other", paise: fp.otherPaise },
  ].filter((b) => b.paise > 0);

  return (
    <>
      <StudentIntro issue={issue} />
      <p>
        This is to certify that the following school fees have been{" "}
        <strong>received</strong> by {TENANT.name} for the above student
        {fp.includeSiblings ? " (including household siblings where paid)" : ""}{" "}
        for the period{" "}
        <strong>
          {formatCertDate(fp.periodFrom)} to {formatCertDate(fp.periodTo)}
        </strong>{" "}
        (academic session {issue.academicYearCode}).
      </p>
      <p>
        Purpose: <strong>{fp.claimFor || "Parent reimbursement"}</strong>
        {issue.fatherName || issue.motherName ? (
          <>
            {" "}
            · Parent / guardian:{" "}
            <strong>
              {[issue.fatherName, issue.motherName].filter(Boolean).join(" / ")}
            </strong>
          </>
        ) : null}
        .
      </p>

      <div className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-3">
        <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
          Total fees paid
        </p>
        <p className="text-2xl font-extrabold tabular-nums text-[var(--brand-deep)]">
          {formatInr(fp.totalPaidPaise)}
        </p>
        <p className="mt-1 text-[11px] capitalize text-[var(--muted)]">
          ({amountInWordsPaise(fp.totalPaidPaise)})
        </p>
      </div>

      {breakups.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-semibold text-[var(--muted)]">
            Category break-up
          </p>
          <ul className="space-y-1 text-[12px]">
            {breakups.map((b) => (
              <li
                key={b.label}
                className="flex justify-between gap-3 border-b border-dotted border-[rgba(32,48,80,0.12)] py-1"
              >
                <span>{b.label}</span>
                <span className="font-semibold tabular-nums">
                  {formatInr(b.paise)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-[11px] font-semibold text-[var(--muted)]">
          Receipts ({fp.receipts.length})
        </p>
        <table className="w-full border-collapse text-[10px] sm:text-[11px]">
          <thead>
            <tr className="border-b border-[rgba(32,48,80,0.2)] text-left text-[var(--muted)]">
              <th className="py-1 pr-2 font-medium">Date</th>
              <th className="py-1 pr-2 font-medium">Receipt</th>
              <th className="py-1 pr-2 font-medium">Mode</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {fp.receipts.map((r) => (
              <tr
                key={`${r.receiptNo}-${r.collectionDate}`}
                className="border-b border-dotted border-[rgba(32,48,80,0.1)] align-top"
              >
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {formatCertDate(r.collectionDate)}
                </td>
                <td className="py-1.5 pr-2">
                  <div className="font-semibold">{r.receiptNo}</div>
                  {r.lineSummary ? (
                    <div className="text-[9px] text-[var(--muted)]">
                      {r.lineSummary}
                    </div>
                  ) : null}
                </td>
                <td className="py-1.5 pr-2">{r.modes || "—"}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {formatInr(r.amountPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[var(--muted)]">
        This certificate is issued for {fp.claimFor || "reimbursement"} purposes
        on the request of the parent / guardian. It is not a no-dues certificate.
        {issue.remarks ? ` Remarks: ${issue.remarks}` : ""}
      </p>
    </>
  );
}

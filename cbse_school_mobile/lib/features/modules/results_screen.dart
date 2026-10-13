import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "module_shell.dart";

/// One child's released exam results — a term picker, the subject table as
/// the school's report card shows it, and the class teacher's remarks.
///
/// Only exams the school switched on under Exams → Results → "Show to
/// parents" arrive here; anything the printed card does not show (a total,
/// a rank, a remark) is simply absent from the data and left off.
class ResultsScreen extends StatelessWidget {
  const ResultsScreen({super.key, required this.api, required this.child});

  final ApiClient api;
  final ParentChild child;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<ParentResults>(
      guideId: "results-parent",
      title: context.l10n.resultsTitle,
      subtitle: child.fullName,
      load: api.fetchParentResults,
      emptyIcon: Icons.workspace_premium_outlined,
      emptyText: context.l10n.resultsNotPublished,
      isEmpty: (r) => r.termsFor(child.id).isEmpty,
      builder: (context, results, _) =>
          _ResultsBody(terms: results.termsFor(child.id)),
    );
  }
}

class _ResultsBody extends StatefulWidget {
  const _ResultsBody({required this.terms});

  final List<ParentTermResult> terms;

  @override
  State<_ResultsBody> createState() => _ResultsBodyState();
}

class _ResultsBodyState extends State<_ResultsBody> {
  String? _termId;

  @override
  Widget build(BuildContext context) {
    final terms = widget.terms;
    // The newest released exam first, until the parent picks another.
    final term = terms.firstWhere(
      (t) => t.termId == _termId,
      orElse: () => terms.last,
    );
    final l = context.l10n;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final t in terms)
              ChoiceChip(
                label: Text(t.termLabel),
                selected: t.termId == term.termId,
                onSelected: (_) {
                  Haptics.tap();
                  setState(() => _termId = t.termId);
                },
              ),
          ],
        ),
        const SizedBox(height: 14),
        if (!term.isReady)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    term.status == "held"
                        ? Icons.lock_outline
                        : Icons.hourglass_empty_outlined,
                    color: AppColors.muted,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(switch (term.status) {
                      "held" => l.resultsHeld,
                      "unavailable" => l.resultsUnavailable,
                      _ => l.resultsNoMarks,
                    }, style: AppText.bodyMediumInk),
                  ),
                ],
              ),
            ),
          )
        else
          _CardView(card: term.card!),
        const SizedBox(height: 16),
        Text(l.resultsPrintHint, style: AppText.bodySmallMuted),
      ],
    );
  }
}

class _CardView extends StatelessWidget {
  const _CardView({required this.card});

  final ParentReportCard card;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final lang = Localizations.localeOf(context).languageCode;
    final facts = <(String, String)>[
      if (card.percent != null)
        (l.resultsPercentage, "${resultNumber(card.percent)}%"),
      if (card.overallGrade != null)
        (l.resultsOverallGrade, card.overallGrade!),
      if (card.rank != null)
        (
          l.resultsRank,
          card.classSize == null
              ? "${card.rank}"
              : l.resultsRankOf("${card.rank}", "${card.classSize}"),
        ),
      if (card.classAverage != null)
        (l.resultsClassAverage, "${resultNumber(card.classAverage)}%"),
      if (card.result != null) (l.resultsResult, card.result!),
      if (card.hasAttendance)
        (
          l.resultsAttendance,
          "${card.presentDays}/${card.workingDays}"
              "${card.attendancePercent == null ? "" : " (${resultNumber(card.attendancePercent)}%)"}",
        ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (card.absent)
          _Banner(
            text: card.absentReason.isEmpty
                ? l.resultsAbsentAll
                : "${l.resultsAbsentAll} — ${card.absentReason}",
          )
        else if (card.absentSubjects.isNotEmpty)
          _Banner(text: l.resultsAbsentFor(card.absentSubjects.join(", "))),
        if (card.aggregateMode == "hy" || card.aggregateMode == "final")
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(l.resultsAggregateNote, style: AppText.bodySmallMuted),
          ),
        Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Column(
              children: [
                _Row(
                  subject: l.resultsSubject,
                  marks: card.gradesOnly ? null : l.resultsMarks,
                  grade: card.descriptors
                      ? l.resultsAssessment
                      : l.resultsGrade,
                  header: true,
                ),
                for (final s in card.subjects)
                  _Row(
                    subject: s.name,
                    detail: [
                      if (s.parts.isNotEmpty)
                        s.parts
                            .map(
                              (p) =>
                                  "${p.label} ${resultNumber(p.obtained)}/${resultNumber(p.maxMarks)}",
                            )
                            .join(" · "),
                      if (s.gradedParts.isNotEmpty)
                        s.gradedParts
                            .map((g) => "${g.label}: ${g.grade ?? "—"}")
                            .join(" · "),
                      if (s.remark.isNotEmpty) s.remark,
                    ].join("\n"),
                    marks: card.gradesOnly ? null : s.marksText,
                    grade: card.descriptors && s.gradeLabel.isNotEmpty
                        ? s.gradeLabel
                        : s.grade,
                  ),
                if (card.hasTotals)
                  _Row(
                    subject: l.resultsTotal,
                    marks:
                        "${resultNumber(card.totalObtained)}/${resultNumber(card.totalMax)}",
                    grade: card.overallGrade ?? "",
                    header: true,
                  ),
              ],
            ),
          ),
        ),
        if (facts.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final f in facts)
                Chip(
                  label: Text(
                    "${f.$1}: ${f.$2}",
                    style: AppText.labelMediumInk,
                  ),
                ),
            ],
          ),
        ],
        if (card.coScholastic.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text(l.resultsCoScholastic, style: AppText.titleSmallInk),
          const SizedBox(height: 6),
          for (final c in card.coScholastic)
            Text(
              "${c.label}: ${c.rating ?? "—"}${c.rating == null ? "" : " — ${c.ratingLabel}"}",
              style: AppText.bodyMediumInk,
            ),
        ],
        if (card.hasRemark) ...[
          const SizedBox(height: 14),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l.resultsTeacherRemarks,
                    style: AppText.labelMediumMuted,
                  ),
                  const SizedBox(height: 6),
                  Text(card.remarkFor(lang), style: AppText.bodyLargeInk),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(text, style: AppText.bodyMediumInk),
    ),
  );
}

class _Row extends StatelessWidget {
  const _Row({
    required this.subject,
    required this.marks,
    required this.grade,
    this.detail = "",
    this.header = false,
  });

  final String subject;
  final String detail;

  /// null = the card shows no marks column.
  final String? marks;
  final String grade;
  final bool header;

  @override
  Widget build(BuildContext context) {
    final style = header ? AppText.labelLargeInk : AppText.bodyMediumInk;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(subject, style: style),
                if (detail.isNotEmpty)
                  Text(detail, style: AppText.labelSmallMuted),
              ],
            ),
          ),
          if (marks != null)
            SizedBox(
              width: 76,
              child: Text(marks!, style: style, textAlign: TextAlign.right),
            ),
          SizedBox(
            width: 84,
            child: Text(grade, style: style, textAlign: TextAlign.right),
          ),
        ],
      ),
    );
  }
}

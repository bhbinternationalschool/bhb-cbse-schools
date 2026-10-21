import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "../../core/i18n/locale_controller.dart";
import "admission_sheets.dart";

/// The counsellor's call list. Overdue first, because that is the order the
/// day gets worked through: call, say what happened, set the next date.
class AdmissionLeadsScreen extends StatefulWidget {
  const AdmissionLeadsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<AdmissionLeadsScreen> createState() => _AdmissionLeadsScreenState();
}

class _AdmissionLeadsScreenState extends State<AdmissionLeadsScreen> {
  String _filter = "due";
  String _query = "";
  final _q = TextEditingController();

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<AdmissionLeadList>(
      guideId: "admission-leads",
      key: ValueKey("$_filter|$_query"),
      title: "Admission leads",
      subtitle: switch (_filter) {
        "overdue" => "Overdue",
        "mine" => "Assigned to me",
        "all" => "All open",
        _ => "Due today and overdue",
      },
      load: () => widget.api.fetchAdmissionLeads(filter: _filter, q: _query),
      emptyIcon: Icons.how_to_reg_outlined,
      emptyText: context.l10n.nothingToCallRightNow,
      isEmpty: (l) => l.leads.isEmpty,
      // A walk-in can be added from an empty list too — the button is not
      // part of the list for exactly that reason.
      floatingActionButton: (context, _, reload) =>
          FloatingActionButton.extended(
            heroTag: "add-walk-in-lead",
            onPressed: () async {
              Haptics.tap();
              if (await showWalkInLeadSheet(context, widget.api)) {
                await reload();
              }
            },
            icon: const Icon(Icons.person_add_alt_1_outlined),
            label: Text(context.l10n.admAddWalkInLead),
          ),
      builder: (context, list, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _q,
            textInputAction: TextInputAction.search,
            onSubmitted: (v) => setState(() => _query = v.trim()),
            decoration: InputDecoration(
              isDense: true,
              hintText: context.l10n.searchChildParentOrMobile,
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        _q.clear();
                        setState(() => _query = "");
                      },
                    ),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              for (final (k, label) in [
                ("due", "Due (${list.overdue + list.dueToday})"),
                ("overdue", "Overdue (${list.overdue})"),
                ("mine", "Mine"),
                ("all", "All open"),
              ])
                ChoiceChip(
                  label: Text(label),
                  selected: _filter == k,
                  onSelected: (_) => setState(() => _filter = k),
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (final l in list.leads)
            _LeadCard(api: widget.api, lead: l, reload: reload),
          // Room for the floating button over the last card.
          const SizedBox(height: 72),
        ],
      ),
    );
  }
}

class _LeadCard extends StatelessWidget {
  const _LeadCard({
    required this.api,
    required this.lead,
    required this.reload,
  });

  final ApiClient api;
  final AdmissionLeadRow lead;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final digits = lead.mobile.replaceAll(RegExp(r"\D"), "");
    final wa = (lead.whatsapp.isEmpty ? lead.mobile : lead.whatsapp).replaceAll(
      RegExp(r"\D"),
      "",
    );
    final tone = switch (lead.bucket) {
      "overdue" => ModuleTone.coral,
      "today" => ModuleTone.amber,
      "later" => ModuleTone.teal,
      _ => ModuleTone.gray,
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    lead.childName,
                    style: AppText.bodyLargeInk.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: tone.background,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    switch (lead.bucket) {
                      "overdue" => "Overdue",
                      "today" => "Today",
                      "later" =>
                        lead.nextFollowUpAt.isEmpty
                            ? "Later"
                            : formatDateLabel(lead.nextFollowUpAt),
                      _ => "No date",
                    },
                    style: AppText.labelMedium.copyWith(color: tone.foreground),
                  ),
                ),
              ],
            ),
            Text(
              "${lead.guardianName}${digits.isEmpty ? "" : " · $digits"}",
              style: AppText.bodySmallInk,
            ),
            Text(
              [
                if (lead.classSought.isNotEmpty) lead.classSought,
                if (lead.locality.isNotEmpty) lead.locality,
                lead.stageLabel,
                if (lead.enquiryNo.isNotEmpty) lead.enquiryNo,
              ].join(" · "),
              style: AppText.labelMediumMuted,
            ),
            if (lead.lastOutcome.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  "Last: ${lead.lastChannel} — ${lead.lastOutcome}${lead.lastNote.isEmpty ? "" : " · ${lead.lastNote}"}",
                  style: AppText.labelMediumMuted,
                ),
              ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (digits.length >= 10)
                  IconButton(
                    tooltip: context.l10n.call,
                    onPressed: () {
                      Haptics.tap();
                      launchUrl(Uri.parse("tel:$digits"));
                    },
                    icon: const Icon(
                      Icons.call_outlined,
                      color: AppColors.primary,
                    ),
                  ),
                if (wa.length >= 10)
                  IconButton(
                    tooltip: context.l10n.whatsapp,
                    // Opens the composer: the drafted text to check and edit,
                    // and Send. Nothing goes out on this tap.
                    onPressed: () => showLeadComposer(
                      context,
                      api,
                      leadId: lead.id,
                      guardianName: lead.guardianName,
                    ),
                    icon: const Icon(
                      Icons.chat_outlined,
                      color: AppColors.success,
                    ),
                  ),
                FilledButton.tonal(
                  onPressed: () => _log(context),
                  child: Text(context.l10n.logCall, style: AppText.bodySmall),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _log(BuildContext context) async {
    final saved = await showLeadFollowupSheet(
      context,
      api,
      leadId: lead.id,
      guardianName: lead.guardianName,
      childName: lead.childName,
    );
    if (saved) await reload();
  }
}

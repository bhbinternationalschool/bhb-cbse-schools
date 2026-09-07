import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

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
      emptyText: "Nothing to call right now.",
      isEmpty: (l) => l.leads.isEmpty,
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
              hintText: "Search child, parent or mobile",
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
    final text = Uri.encodeComponent(
      "Namaste ${lead.guardianName}, this is from the school admissions office about ${lead.childName}"
      "${lead.classSought.isEmpty ? "" : " for ${lead.classSought}"}. "
      "May we help you with the admission?",
    );

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
                    tooltip: "Call",
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
                    tooltip: "WhatsApp",
                    onPressed: () => launchUrl(
                      Uri.parse("https://wa.me/91$wa?text=$text"),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(
                      Icons.chat_outlined,
                      color: AppColors.success,
                    ),
                  ),
                FilledButton.tonal(
                  onPressed: () => _log(context),
                  child: const Text("Log call", style: AppText.bodySmall),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _log(BuildContext context) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _LeadFollowupSheet(api: api, lead: lead),
    );
    if (saved == true) await reload();
  }
}

class _LeadFollowupSheet extends StatefulWidget {
  const _LeadFollowupSheet({required this.api, required this.lead});

  final ApiClient api;
  final AdmissionLeadRow lead;

  @override
  State<_LeadFollowupSheet> createState() => _LeadFollowupSheetState();
}

class _LeadFollowupSheetState extends State<_LeadFollowupSheet> {
  String _channel = "call";
  String _outcome = "connected";
  DateTime _next = DateTime.now().add(const Duration(days: 3));
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  String _iso(DateTime d) => d.toIso8601String().substring(0, 10);

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await widget.api.logLeadFollowup(
        leadId: widget.lead.id,
        channel: _channel,
        outcome: _outcome,
        note: _note.text.trim(),
        nextFollowUpAt: _iso(_next),
      );
      Haptics.success();
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        16,
        20,
        MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              "Call with ${widget.lead.guardianName}",
              style: AppText.titleMediumInk,
            ),
            Text(
              "about ${widget.lead.childName}",
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              children: [
                for (final (v, l) in const [
                  ("call", "Called"),
                  ("whatsapp", "WhatsApp"),
                  ("visit", "Visited"),
                ])
                  ChoiceChip(
                    label: Text(l, style: AppText.bodySmall),
                    selected: _channel == v,
                    onSelected: (_) => setState(() => _channel = v),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final (v, l) in const [
                  ("connected", "Spoke"),
                  ("no_answer", "No answer"),
                  ("busy", "Busy"),
                  ("visit_scheduled", "Visit fixed"),
                  ("not_interested", "Not interested"),
                  ("wrong_number", "Wrong number"),
                  ("admitted", "Admitted"),
                ])
                  ChoiceChip(
                    label: Text(l, style: AppText.bodySmall),
                    selected: _outcome == v,
                    onSelected: (_) => setState(() => _outcome = v),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () async {
                final d = await showDatePicker(
                  context: context,
                  initialDate: _next,
                  firstDate: DateTime.now(),
                  lastDate: DateTime.now().add(const Duration(days: 365)),
                );
                if (d != null) setState(() => _next = d);
              },
              icon: const Icon(Icons.event_outlined, size: 16),
              label: Text("Call again on ${formatDateLabel(_iso(_next))}"),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _note,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: "What was said"),
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: Text(_busy ? "Saving…" : "Save"),
            ),
          ],
        ),
      ),
    );
  }
}

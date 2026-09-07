import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "../../core/i18n/locale_controller.dart";
import "../modules/dictate_field.dart";

/// The office's queue of transport requests from parents — the same rows
/// the web desk's Transport → Requests tab shows. Owner, admin, principal
/// and the transport in-charge see it; the server refuses anyone else.
class TransportRequestsScreen extends StatefulWidget {
  const TransportRequestsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<TransportRequestsScreen> createState() =>
      _TransportRequestsScreenState();
}

class _TransportRequestsScreenState extends State<TransportRequestsScreen> {
  String _filter = "active";

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<TransportRequestInfo>>(
      key: ValueKey(_filter),
      title: "Transport requests",
      subtitle: switch (_filter) {
        "assigned" => "Assigned",
        "declined" => "Declined",
        _ => "New & contacted",
      },
      load: () => widget.api.fetchTransportRequests(status: _filter),
      emptyIcon: Icons.directions_bus_outlined,
      emptyText: context.l10n.nothingHereAParentSRequest,
      isEmpty: (list) => list.isEmpty,
      builder: (context, list, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 8,
            children: [
              for (final (k, label) in const [
                ("active", "New & contacted"),
                ("assigned", "Assigned"),
                ("declined", "Declined"),
              ])
                ChoiceChip(
                  label: Text(label),
                  selected: _filter == k,
                  onSelected: (_) => setState(() => _filter = k),
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (final r in list)
            _RequestCard(api: widget.api, r: r, reload: reload),
        ],
      ),
    );
  }
}

class _RequestCard extends StatelessWidget {
  const _RequestCard({
    required this.api,
    required this.r,
    required this.reload,
  });

  final ApiClient api;
  final TransportRequestInfo r;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final (chip, tone) = switch (r.status) {
      "contacted" => ("Contacted", ModuleTone.blue),
      "assigned" => ("Assigned", ModuleTone.green),
      "declined" => ("Declined", ModuleTone.coral),
      _ => ("New", ModuleTone.amber),
    };
    final digits = r.contactMobile.replaceAll(RegExp(r"\D"), "");
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    "${r.studentName} · ${r.classLabel}",
                    style: AppText.bodyLargeInk.copyWith(
                      fontWeight: FontWeight.w600,
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
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    chip,
                    style: AppText.labelSmall.copyWith(
                      color: tone.foreground,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              "${formatDateLabel(r.createdAt.split("T").first)} · ${r.contactName}",
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 8),
            Text(
              "Pickup: ${[r.pickupAddress, r.locality, r.landmark].where((x) => x.isNotEmpty).join(", ")}"
              "${r.preferredStop.isNotEmpty ? "\nPrefers stop: ${r.preferredStop}" : ""}"
              "${r.note.isNotEmpty ? "\n“${r.note}”" : ""}",
              style: AppText.bodyMediumInk.copyWith(height: 1.4),
            ),
            if (r.handlingNote.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  "Office: ${r.handlingNote} — ${r.handledBy}",
                  style: AppText.bodySmallMuted,
                ),
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                if (digits.length >= 10) ...[
                  OutlinedButton.icon(
                    onPressed: () => launchUrl(Uri.parse("tel:$digits")),
                    icon: const Icon(Icons.call, size: 16),
                    label: Text(context.l10n.call),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => launchUrl(
                      Uri.parse(
                        "https://wa.me/${digits.length == 10 ? "91$digits" : digits}",
                      ),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.chat_outlined, size: 16),
                    label: Text(context.l10n.whatsapp),
                  ),
                ],
                if (r.isActive) ...[
                  if (r.status == "open")
                    FilledButton.tonal(
                      onPressed: () => _move(context, "contacted"),
                      child: Text(context.l10n.contacted),
                    ),
                  FilledButton(
                    onPressed: () => _move(context, "assigned"),
                    child: Text(context.l10n.assigned),
                  ),
                  TextButton(
                    onPressed: () => _move(context, "declined"),
                    child: Text(context.l10n.decline),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _move(BuildContext context, String status) async {
    final note = TextEditingController();
    final go = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(switch (status) {
          "contacted" => "Mark as contacted",
          "assigned" => "Mark as assigned",
          _ => "Decline this request",
        }),
        content: DictateField(
          label: context.l10n.noteForTheFamilyTheyWill,
          controller: note,
          maxLines: 2,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(context.l10n.save),
          ),
        ],
      ),
    );
    if (go != true) return;
    try {
      await api.updateTransportRequest(
        id: r.id,
        status: status,
        note: note.text.trim(),
      );
      Haptics.success();
      await reload();
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }
}

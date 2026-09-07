import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "fee_counter_screen.dart";

/// Families with money outstanding — biggest first, with the guardian one tap
/// away on a call or WhatsApp, and a place to record what they promised.
///
/// A class teacher sees their own sections; the office and leadership see the
/// school. The server decides that, not this screen.
class FeeDefaultersScreen extends StatefulWidget {
  const FeeDefaultersScreen({
    super.key,
    required this.api,
    this.canCollect = false,
  });

  final ApiClient api;

  /// Shows a "Collect" shortcut on each child when the person may take money.
  final bool canCollect;

  @override
  State<FeeDefaultersScreen> createState() => _FeeDefaultersScreenState();
}

class _FeeDefaultersScreenState extends State<FeeDefaultersScreen> {
  final _q = TextEditingController();
  String _query = "";
  int _min = 0;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<FeeDefaulterList>(
      key: ValueKey("$_query|$_min"),
      title: "Fee defaulters",
      load: () => widget.api.fetchFeeDefaulters(q: _query, minRupees: _min),
      emptyIcon: Icons.verified_outlined,
      emptyText: _query.isEmpty
          ? "Nothing outstanding in your classes."
          : "No family matched that search.",
      isEmpty: (l) => l.households.isEmpty,
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
              for (final (v, label) in const [
                (0, "All"),
                (5000, "₹5,000+"),
                (20000, "₹20,000+"),
              ])
                ChoiceChip(
                  label: Text(label),
                  selected: _min == v,
                  onSelected: (_) => setState(() => _min = v),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            "${list.householdCount} families · ${list.totalOpenLabel} outstanding",
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 6),
          for (final h in list.households)
            _HouseholdCard(
              api: widget.api,
              h: h,
              canCollect: widget.canCollect,
              reload: reload,
            ),
        ],
      ),
    );
  }
}

class _HouseholdCard extends StatelessWidget {
  const _HouseholdCard({
    required this.api,
    required this.h,
    required this.canCollect,
    required this.reload,
  });

  final ApiClient api;
  final FeeDefaulterHousehold h;
  final bool canCollect;
  final Future<void> Function() reload;

  String get _digits => h.mobile.replaceAll(RegExp(r"\D"), "");

  String _waText() {
    final names = h.children.map((c) => c.fullName).join(", ");
    return Uri.encodeComponent(
      "Namaste ${h.guardianName}, this is from the school office regarding the fees for $names. "
      "${h.openLabel} is outstanding. Please let us know when you can pay. Thank you.",
    );
  }

  @override
  Widget build(BuildContext context) {
    final promised = h.children.firstWhere(
      (c) => c.promisedOn.isNotEmpty,
      orElse: () => h.children.first,
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        h.guardianName,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        _digits.isEmpty ? "No mobile on record" : _digits,
                        style: TextStyle(
                          fontSize: 12,
                          color: _digits.isEmpty
                              ? AppColors.danger
                              : AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      h.openLabel,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.danger,
                      ),
                    ),
                    if (h.overdueDays > 0)
                      Text(
                        "${h.overdueDays} days overdue",
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 6),
            for (final c in h.children)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        "${c.fullName} · ${c.classLabel} — ${c.openLabel}",
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                    if (canCollect)
                      TextButton(
                        onPressed: () => Navigator.of(context)
                            .push(
                              MaterialPageRoute(
                                builder: (_) => CounterScreen(
                                  api: api,
                                  student: FeeStudentHit.fromJson({
                                    "id": c.studentId,
                                    "fullName": c.fullName,
                                    "classLabel": c.classLabel,
                                    "guardianName": h.guardianName,
                                    "mobile": h.mobile,
                                  }),
                                ),
                              ),
                            )
                            .then((_) => reload()),
                        child: const Text(
                          "Collect",
                          style: TextStyle(fontSize: 12),
                        ),
                      ),
                  ],
                ),
              ),
            if (promised.promisedOn.isNotEmpty)
              Container(
                margin: const EdgeInsets.only(top: 4),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: ModuleTone.amber.background,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  "Promised ${formatDateLabel(promised.promisedOn)}${promised.promiseNote.isEmpty ? "" : " · ${promised.promiseNote}"}",
                  style: TextStyle(
                    fontSize: 11.5,
                    color: ModuleTone.amber.foreground,
                  ),
                ),
              ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (_digits.length >= 10) ...[
                  IconButton(
                    tooltip: "Call",
                    onPressed: () => launchUrl(Uri.parse("tel:$_digits")),
                    icon: const Icon(
                      Icons.call_outlined,
                      color: AppColors.primary,
                    ),
                  ),
                  IconButton(
                    tooltip: "WhatsApp",
                    onPressed: () => launchUrl(
                      Uri.parse("https://wa.me/91$_digits?text=${_waText()}"),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(
                      Icons.chat_outlined,
                      color: AppColors.success,
                    ),
                  ),
                ],
                TextButton(
                  onPressed: () => _logFollowup(context),
                  child: const Text(
                    "Log call",
                    style: TextStyle(fontSize: 12.5),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _logFollowup(BuildContext context) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _FollowupSheet(api: api, household: h),
    );
    if (saved == true) await reload();
  }
}

class _FollowupSheet extends StatefulWidget {
  const _FollowupSheet({required this.api, required this.household});

  final ApiClient api;
  final FeeDefaulterHousehold household;

  @override
  State<_FollowupSheet> createState() => _FollowupSheetState();
}

class _FollowupSheetState extends State<_FollowupSheet> {
  late String _studentId = widget.household.children.first.studentId;
  String _channel = "call";
  String _outcome = "promised";
  DateTime _promised = DateTime.now().add(const Duration(days: 3));
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
      await widget.api.logFeeFollowup(
        studentId: _studentId,
        channel: _channel,
        outcome: _outcome,
        note: _note.text.trim(),
        promisedOn: _outcome == "promised" ? _iso(_promised) : "",
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
              "What did ${widget.household.guardianName} say?",
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 10),
            if (widget.household.children.length > 1)
              DropdownButtonFormField<String>(
                initialValue: _studentId,
                decoration: const InputDecoration(
                  labelText: "About",
                  isDense: true,
                ),
                items: [
                  for (final c in widget.household.children)
                    DropdownMenuItem(
                      value: c.studentId,
                      child: Text(c.fullName),
                    ),
                ],
                onChanged: (v) => setState(() => _studentId = v ?? _studentId),
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: [
                for (final (v, l) in const [
                  ("call", "Called"),
                  ("whatsapp", "WhatsApp"),
                  ("visit", "Visited"),
                ])
                  ChoiceChip(
                    label: Text(l, style: const TextStyle(fontSize: 12)),
                    selected: _channel == v,
                    onSelected: (_) => setState(() => _channel = v),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              children: [
                for (final (v, l) in const [
                  ("promised", "Promised to pay"),
                  ("no_answer", "No answer"),
                  ("refused", "Refused"),
                  ("paid", "Already paid"),
                  ("wrong_number", "Wrong number"),
                ])
                  ChoiceChip(
                    label: Text(l, style: const TextStyle(fontSize: 12)),
                    selected: _outcome == v,
                    onSelected: (_) => setState(() => _outcome = v),
                  ),
              ],
            ),
            if (_outcome == "promised")
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: OutlinedButton.icon(
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: _promised,
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 120)),
                    );
                    if (d != null) setState(() => _promised = d);
                  },
                  icon: const Icon(Icons.event_outlined, size: 16),
                  label: Text(
                    "Will pay by ${formatDateLabel(_iso(_promised))}",
                  ),
                ),
              ),
            const SizedBox(height: 8),
            TextField(
              controller: _note,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: "Note (optional)"),
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

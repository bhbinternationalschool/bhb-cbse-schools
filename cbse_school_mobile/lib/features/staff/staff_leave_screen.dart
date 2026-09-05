import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// The staff member's own leave: this year's balances and their requests,
/// with a form to apply. A request goes to the principal (unless HR has
/// auto-approve on); the applicant can withdraw it while it is pending.
class StaffLeaveScreen extends StatelessWidget {
  const StaffLeaveScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<StaffLeaveInfo>(
      title: "My leave",
      load: api.fetchMyLeave,
      emptyIcon: Icons.event_outlined,
      // Balances always exist, so the shell never shows its empty state.
      isEmpty: (_) => false,
      floatingActionButton: (context, info, reload) =>
          FloatingActionButton.extended(
            onPressed: () => _openForm(context, info, reload),
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            icon: const Icon(Icons.add),
            label: const Text("Apply for leave"),
          ),
      builder: (context, info, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          const Text(
            "Balance this year",
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final b in info.balances)
                Container(
                  width: (MediaQuery.sizeOf(context).width - 40) / 2,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: b.paid
                        ? ModuleTone.teal.background
                        : ModuleTone.gray.background,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "${b.typeName} (${b.typeCode})",
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        b.unlimited
                            ? "No cap"
                            : "${_n(b.remaining)} left of ${_n(b.allotted)}",
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: b.paid
                              ? ModuleTone.teal.foreground
                              : ModuleTone.gray.foreground,
                        ),
                      ),
                      if (!b.paid)
                        const Text(
                          "Unpaid",
                          style: TextStyle(
                            fontSize: 11,
                            color: AppColors.muted,
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 18),
          const Text(
            "My requests",
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 8),
          if (info.requests.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(14),
                child: Text(
                  "No leave applied yet this year.",
                  style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                ),
              ),
            ),
          for (final r in info.requests)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            r.fromDate == r.toDate
                                ? "${formatDateLabel(r.fromDate)}${r.halfDay ? " · half day" : ""}"
                                : "${formatDateLabel(r.fromDate)} – ${formatDateLabel(r.toDate)}",
                            style: const TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                        LeaveStatusChip(status: r.status, label: r.statusLabel),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      "${r.typeName} · ${_n(r.days)} day${r.days == 1 ? "" : "s"}",
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      r.reason,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.ink,
                        height: 1.4,
                      ),
                    ),
                    if (r.decisionNote.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        "${r.decidedBy.isEmpty ? "School" : r.decidedBy}: ${r.decisionNote}",
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                          height: 1.4,
                        ),
                      ),
                    ],
                    if (r.isPending)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () => _withdraw(context, r, reload),
                          child: const Text("Withdraw"),
                        ),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _withdraw(
    BuildContext context,
    StaffLeaveRequest r,
    Future<void> Function() reload,
  ) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Withdraw this request?"),
        content: Text(
          "${r.typeName} from ${formatDateLabel(r.fromDate)} will be removed.",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text("Keep"),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text("Withdraw"),
          ),
        ],
      ),
    );
    if (sure != true || !context.mounted) return;
    try {
      await api.withdrawStaffLeave(r.id);
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

  Future<void> _openForm(
    BuildContext context,
    StaffLeaveInfo info,
    Future<void> Function() reload,
  ) async {
    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _ApplyLeaveSheet(api: api, balances: info.balances),
    );
    if (applied == true) await reload();
  }
}

String _n(double v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);

class LeaveStatusChip extends StatelessWidget {
  const LeaveStatusChip({super.key, required this.status, this.label});

  final String status;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final tone = switch (status) {
      "approved" => ModuleTone.green,
      "rejected" => ModuleTone.coral,
      "cancelled" => ModuleTone.gray,
      _ => ModuleTone.amber,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label ?? status,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: tone.foreground,
        ),
      ),
    );
  }
}

class _ApplyLeaveSheet extends StatefulWidget {
  const _ApplyLeaveSheet({required this.api, required this.balances});

  final ApiClient api;
  final List<LeaveBalanceInfo> balances;

  @override
  State<_ApplyLeaveSheet> createState() => _ApplyLeaveSheetState();
}

class _ApplyLeaveSheetState extends State<_ApplyLeaveSheet> {
  late String _type = widget.balances.isEmpty
      ? "CL"
      : widget.balances.first.typeCode;
  DateTime _from = DateTime.now();
  DateTime? _to;
  bool _halfDay = false;
  final _reason = TextEditingController();
  bool _busy = false;
  String? _error;

  String _iso(DateTime d) => d.toIso8601String().substring(0, 10);

  Future<void> _pick({required bool from}) async {
    final base = from ? _from : (_to ?? _from);
    final d = await showDatePicker(
      context: context,
      initialDate: base,
      firstDate: DateTime.now().subtract(const Duration(days: 30)),
      lastDate: DateTime.now().add(const Duration(days: 180)),
    );
    if (d == null) return;
    setState(() {
      if (from) {
        _from = d;
        if (_to != null && _to!.isBefore(d)) _to = null;
      } else {
        _to = d;
      }
    });
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await widget.api.applyStaffLeave(
        typeCode: _type,
        fromDate: _iso(_from),
        toDate: _iso(_halfDay ? _from : (_to ?? _from)),
        halfDay: _halfDay,
        reason: _reason.text.trim(),
      );
      Haptics.success();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            r.status == "approved"
                ? "Leave approved."
                : "Sent to the principal for approval.",
          ),
        ),
      );
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = "Could not reach the school server.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bal = widget.balances.where((b) => b.typeCode == _type).firstOrNull;
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
            const Text(
              "Apply for leave",
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                for (final b in widget.balances)
                  ChoiceChip(
                    label: Text(b.typeCode),
                    selected: _type == b.typeCode,
                    onSelected: (_) => setState(() => _type = b.typeCode),
                  ),
              ],
            ),
            if (bal != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  "${bal.typeName}${bal.unlimited ? "" : " · ${_n(bal.remaining)} day${bal.remaining == 1 ? "" : "s"} left"}${bal.maxDaysPerRequest > 0 ? " · max ${_n(bal.maxDaysPerRequest)} per application" : ""}${bal.paid ? "" : " · unpaid"}",
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pick(from: true),
                    icon: const Icon(Icons.calendar_today_outlined, size: 16),
                    label: Text(formatDateLabel(_iso(_from))),
                  ),
                ),
                if (!_halfDay) ...[
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 6),
                    child: Text("to"),
                  ),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _pick(from: false),
                      icon: const Icon(Icons.calendar_today_outlined, size: 16),
                      label: Text(
                        _to == null ? "Same day" : formatDateLabel(_iso(_to!)),
                      ),
                    ),
                  ),
                ],
              ],
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text("Half day", style: TextStyle(fontSize: 13)),
              value: _halfDay,
              onChanged: (v) => setState(() => _halfDay = v),
            ),
            TextField(
              controller: _reason,
              minLines: 2,
              maxLines: 4,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: "Reason",
                hintText: "Short and clear — the principal reads this",
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  style: const TextStyle(
                    color: AppColors.danger,
                    fontSize: 12.5,
                  ),
                ),
              ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? "Sending…" : "Submit"),
            ),
          ],
        ),
      ),
    );
  }
}

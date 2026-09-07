import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "module_shell.dart";
import "../../core/i18n/locale_controller.dart";
import "../modules/dictate_field.dart";

/// One child's leave requests, and a form to make a new one.
///
/// A request lands as "pending" on the office desk; the class teacher or
/// principal decides it there and, once approved, it is written into the
/// attendance register. The parent can withdraw a request only while it is
/// still pending — after that the office owns it.
class LeaveScreen extends StatelessWidget {
  const LeaveScreen({super.key, required this.api, required this.child});

  final ApiClient api;
  final ParentChild child;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<LeaveList>(
      title: "Leave",
      subtitle: child.fullName,
      load: () => api.fetchLeaveList(studentId: child.id),
      emptyIcon: Icons.event_busy_outlined,
      emptyText: context.l10n.leaveEmptyHint(child.fullName.split(" ").first),
      isEmpty: (list) => list.requests.isEmpty,
      floatingActionButton: (context, list, reload) =>
          FloatingActionButton.extended(
            onPressed: () => _openForm(context, list.leaveTypes, reload),
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            icon: const Icon(Icons.add),
            label: Text(context.l10n.requestLeave),
          ),
      builder: (context, list, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          for (final r in list.requests)
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
                                ? formatDateLabel(r.fromDate)
                                : "${formatDateLabel(r.fromDate)} – ${formatDateLabel(r.toDate)}",
                            style: AppText.bodyMediumInk.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        _StatusChip(status: r.status),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      "${r.leaveTypeLabel} · ${r.days} day${r.days == 1 ? "" : "s"}",
                      style: AppText.bodySmallMuted,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      r.reason,
                      style: AppText.bodySmallInk.copyWith(height: 1.4),
                    ),
                    if (r.decisionNote.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        "School: ${r.decisionNote}",
                        style: AppText.bodySmallMuted.copyWith(height: 1.4),
                      ),
                    ],
                    if (r.isPending)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () => _cancel(context, r, reload),
                          child: Text(context.l10n.withdrawRequest),
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

  Future<void> _cancel(
    BuildContext context,
    LeaveRequestInfo r,
    Future<void> Function() reload,
  ) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.l10n.withdrawThisRequest),
        content: Text(
          context.l10n.withdrawLeaveBody(formatDateLabel(r.fromDate)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.l10n.keep),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(context.l10n.withdraw),
          ),
        ],
      ),
    );
    if (sure != true) return;
    try {
      await api.cancelLeave(r.id);
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
    List<LeaveTypeInfo> types,
    Future<void> Function() reload,
  ) async {
    final submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _LeaveForm(api: api, child: child, types: types),
    );
    if (submitted == true) {
      Haptics.success();
      await reload();
    }
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, tone) = switch (status) {
      "approved" => ("Approved", ModuleTone.green),
      "rejected" => ("Not approved", ModuleTone.coral),
      "cancelled" => ("Withdrawn", ModuleTone.gray),
      _ => ("Pending", ModuleTone.amber),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: AppText.labelSmall.copyWith(
          color: tone.foreground,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _LeaveForm extends StatefulWidget {
  const _LeaveForm({
    required this.api,
    required this.child,
    required this.types,
  });

  final ApiClient api;
  final ParentChild child;
  final List<LeaveTypeInfo> types;

  @override
  State<_LeaveForm> createState() => _LeaveFormState();
}

class _LeaveFormState extends State<_LeaveForm> {
  late LeaveTypeInfo _type = widget.types.first;
  DateTime _from = DateTime.now();
  DateTime _to = DateTime.now();
  final _reason = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  String _iso(DateTime d) =>
      "${d.year}-${d.month.toString().padLeft(2, "0")}-${d.day.toString().padLeft(2, "0")}";

  Future<void> _pick(bool from) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: from ? _from : (_to.isBefore(_from) ? _from : _to),
      firstDate: DateTime(now.year, now.month - 1, 1),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (picked == null) return;
    setState(() {
      if (from) {
        _from = picked;
        if (_to.isBefore(_from)) _to = _from;
      } else {
        _to = picked;
      }
    });
  }

  Future<void> _submit() async {
    if (_busy) return;
    final reason = _reason.text.trim();
    if (reason.isEmpty) {
      Haptics.warning();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.l10n.pleaseGiveAReason)));
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.api.requestLeave(
        studentId: widget.child.id,
        fromDate: _iso(_from),
        toDate: _iso(_type.isHalfDay ? _from : _to),
        leaveType: _type.code,
        reason: reason,
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.couldNotReachTheSchoolServer)),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + inset),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              "Leave for ${widget.child.fullName}",
              style: AppText.titleMediumInk,
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<LeaveTypeInfo>(
              initialValue: _type,
              decoration: InputDecoration(labelText: context.l10n.typeOfLeave),
              items: [
                for (final t in widget.types)
                  DropdownMenuItem(value: t, child: Text(t.label)),
              ],
              onChanged: (t) {
                if (t != null) setState(() => _type = t);
              },
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _DateField(
                    label: _type.isHalfDay ? "Date" : "From",
                    value: formatDateLabel(_iso(_from)),
                    onTap: () => _pick(true),
                  ),
                ),
                if (!_type.isHalfDay) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: _DateField(
                      label: "To",
                      value: formatDateLabel(_iso(_to)),
                      onTap: () => _pick(false),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 12),
            DictateField(
              label: context.l10n.reason,
              controller: _reason,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
              hint: context.l10n.eGFeverDoctorAdvisedRest,
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _busy ? null : _submit,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
              ),
              child: Text(_busy ? "Sending…" : "Send request"),
            ),
          ],
        ),
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: const Icon(Icons.calendar_today_outlined, size: 18),
        ),
        child: Text(value, style: AppText.bodyLargeInk),
      ),
    );
  }
}

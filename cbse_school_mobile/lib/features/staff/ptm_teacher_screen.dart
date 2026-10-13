import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "../../core/i18n/locale_controller.dart";
import "../modules/dictate_field.dart";
import "ptm_slots_screen.dart";

/// The teacher's PTM day: their slots, who has booked each, and a one-tap
/// record of the meeting (met + note, or no-show). Parents see the note in
/// their own app; the exams desk pulls it into the report-card brief.
///
/// Since 13 Oct 2026 a teacher also lays out their own slots here: add them
/// to a PTM the office opened (PtmAddSlotsScreen), and change or cancel one
/// nobody has booked. A booked slot is the family's — the office moves them.
class PtmTeacherScreen extends StatelessWidget {
  const PtmTeacherScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<PtmTeacherEvent>>(
      guideId: "ptm-teacher",
      title: "PTM",
      subtitle: "My slots and bookings",
      load: api.fetchTeacherPtm,
      emptyIcon: Icons.groups_outlined,
      emptyText: context.l10n.noPtmSlotsAreYoursRight,
      isEmpty: (e) => e.isEmpty,
      builder: (context, events, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final e in events) ...[
            Text(
              "${e.name} · ${formatDateLabel(e.date)}${e.modeLabel.isNotEmpty ? " · ${e.modeLabel}" : ""}",
              style: AppText.bodyLargeInk.copyWith(fontWeight: FontWeight.w700),
            ),
            if (e.note.isNotEmpty) Text(e.note, style: AppText.bodySmallMuted),
            if (e.canAddSlots)
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  onPressed: () async {
                    final added = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(
                        builder: (_) => PtmAddSlotsScreen(api: api, event: e),
                      ),
                    );
                    if (added == true) await reload();
                  },
                  icon: const Icon(Icons.add),
                  label: const Text("Add my slots · समय जोड़ें"),
                ),
              ),
            if (e.slots.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Text(
                  "You have no slots in this PTM yet.",
                  style: AppText.bodySmallMuted,
                ),
              ),
            const SizedBox(height: 6),
            for (final s in e.slots)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              // Slot times are HH:MM — formatTimeLabel reads
                              // only full timestamps and printed blanks here.
                              "${hhmmLabel(s.startAt)} – ${hhmmLabel(s.endAt)}"
                              "${s.roomOrLink.isNotEmpty ? " · ${s.roomOrLink}" : ""}"
                              "${s.isMine ? "" : " · ${s.teacherName}"}",
                              style: AppText.bodyMediumInk.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          if (s.isMine && !_held(s)) ...[
                            IconButton(
                              tooltip: "Change slot",
                              visualDensity: VisualDensity.compact,
                              onPressed: () =>
                                  _editSlot(context, api, s, reload),
                              icon: const Icon(Icons.edit_outlined, size: 20),
                            ),
                            IconButton(
                              tooltip: "Cancel slot",
                              visualDensity: VisualDensity.compact,
                              onPressed: () =>
                                  _cancelSlot(context, api, s, reload),
                              icon: const Icon(
                                Icons.delete_outline,
                                size: 20,
                                color: AppColors.danger,
                              ),
                            ),
                          ],
                        ],
                      ),
                      Text(
                        s.bookings.isEmpty
                            ? "Not booked · ${s.capacity} place${s.capacity == 1 ? "" : "s"}"
                            : "${s.bookings.length} of ${s.capacity} booked",
                        style: AppText.labelMediumMuted,
                      ),
                      for (final b in s.bookings)
                        _Booking(api: api, b: b, reload: reload),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

/// A family holds this slot (booked, or already met) — the server refuses
/// to change or cancel it from the phone, so the screen offers neither.
bool _held(PtmTeacherSlot s) =>
    s.bookings.any((b) => b.status == "booked" || b.status == "completed");

void _snack(BuildContext context, String msg) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
}

Future<void> _cancelSlot(
  BuildContext context,
  ApiClient api,
  PtmTeacherSlot s,
  Future<void> Function() reload,
) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text("Cancel this slot? · यह समय हटाएँ?"),
      content: Text(
        "${hhmmLabel(s.startAt)} – ${hhmmLabel(s.endAt)}. Nobody has booked it; parents will no longer see it.",
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text("Keep"),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
          onPressed: () => Navigator.pop(context, true),
          child: const Text("Cancel slot"),
        ),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;
  try {
    await api.deletePtmSlot(s.id);
    Haptics.success();
    await reload();
  } on ApiException catch (e) {
    if (context.mounted) _snack(context, e.message);
  }
}

Future<void> _editSlot(
  BuildContext context,
  ApiClient api,
  PtmTeacherSlot s,
  Future<void> Function() reload,
) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _EditSlotSheet(api: api, slot: s),
  );
  if (saved == true) {
    Haptics.success();
    await reload();
  }
}

class _EditSlotSheet extends StatefulWidget {
  const _EditSlotSheet({required this.api, required this.slot});

  final ApiClient api;
  final PtmTeacherSlot slot;

  @override
  State<_EditSlotSheet> createState() => _EditSlotSheetState();
}

class _EditSlotSheetState extends State<_EditSlotSheet> {
  static const _lengths = [5, 10, 15, 20, 30, 45, 60];
  late String _start = widget.slot.startAt;
  late int _length = () {
    final m = ptmSlotMinutes(widget.slot.startAt, widget.slot.endAt);
    return m >= 5 ? m : 15;
  }();
  late int _capacity = widget.slot.capacity < 1 ? 1 : widget.slot.capacity;
  late final _room = TextEditingController(text: widget.slot.roomOrLink);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _room.dispose();
    super.dispose();
  }

  Future<void> _pickStart() async {
    final parts = _start.split(":");
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(
        hour: int.tryParse(parts.first) ?? 9,
        minute: parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0,
      ),
    );
    if (t == null || !mounted) return;
    setState(() {
      _start =
          "${t.hour.toString().padLeft(2, "0")}:${t.minute.toString().padLeft(2, "0")}";
      _error = null;
    });
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.updatePtmSlot(
        slotId: widget.slot.id,
        startAt: _start,
        durationMinutes: _length,
        capacity: _capacity,
        roomOrLink: _room.text.trim(),
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lengths = {..._lengths, _length}.toList()..sort();
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
            Text("Change slot · समय बदलें", style: AppText.titleMediumInk),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _busy ? null : _pickStart,
              icon: const Icon(Icons.schedule),
              label: Text("Starts ${hhmmLabel(_start)}"),
            ),
            const SizedBox(height: 10),
            Text("Slot length", style: AppText.labelMediumMuted),
            Wrap(
              spacing: 6,
              children: [
                for (final m in lengths)
                  ChoiceChip(
                    label: Text("$m min"),
                    selected: _length == m,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() => _length = m),
                  ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: Text(
                    "Families per slot",
                    style: AppText.labelMediumMuted,
                  ),
                ),
                IconButton(
                  onPressed: _busy || _capacity <= 1
                      ? null
                      : () => setState(() => _capacity--),
                  icon: const Icon(Icons.remove_circle_outline),
                ),
                Text("$_capacity", style: AppText.bodyMediumInk),
                IconButton(
                  onPressed: _busy || _capacity >= 20
                      ? null
                      : () => setState(() => _capacity++),
                  icon: const Icon(Icons.add_circle_outline),
                ),
              ],
            ),
            TextField(
              controller: _room,
              enabled: !_busy,
              maxLength: 300,
              decoration: const InputDecoration(
                labelText: "Room or meeting link (optional)",
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  style: AppText.bodySmall.copyWith(color: AppColors.danger),
                ),
              ),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: Text(_busy ? "Saving…" : "Save · सहेजें"),
            ),
          ],
        ),
      ),
    );
  }
}

class _Booking extends StatelessWidget {
  const _Booking({required this.api, required this.b, required this.reload});

  final ApiClient api;
  final PtmTeacherBooking b;
  final Future<void> Function() reload;

  Future<void> _met(BuildContext context) async {
    final strengths = TextEditingController();
    final areas = TextEditingController();
    final followUp = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => Padding(
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
                "Met ${b.parentName.isEmpty ? "the parent" : b.parentName} · ${b.studentName}",
                style: AppText.titleMediumInk,
              ),
              const SizedBox(height: 4),
              Text(
                context.l10n.aShortNoteForTheParent,
                style: AppText.bodySmallMuted,
              ),
              const SizedBox(height: 12),
              DictateField(
                label: context.l10n.doingWell,
                controller: strengths,
                maxLines: 2,
                textCapitalization: TextCapitalization.sentences,
              ),
              const SizedBox(height: 8),
              DictateField(
                label: context.l10n.needsAttention,
                controller: areas,
                maxLines: 2,
                textCapitalization: TextCapitalization.sentences,
              ),
              const SizedBox(height: 8),
              DictateField(
                label: context.l10n.agreedFollowUp,
                controller: followUp,
                maxLines: 2,
                textCapitalization: TextCapitalization.sentences,
              ),
              const SizedBox(height: 14),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: Text(context.l10n.save),
              ),
            ],
          ),
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await api.updatePtmBooking(
        bookingId: b.id,
        status: "completed",
        feedback: {
          "strengths": strengths.text.trim(),
          "areas": areas.text.trim(),
          "followUp": followUp.text.trim(),
        },
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

  Future<void> _noShow(BuildContext context) async {
    try {
      await api.updatePtmBooking(bookingId: b.id, status: "no_show");
      Haptics.tap();
      await reload();
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final digits = b.mobile.replaceAll(RegExp(r"\D"), "");
    final fb = b.feedback;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  "${b.studentName}${b.classLabel.isNotEmpty ? " · ${b.classLabel}" : ""}",
                  style: AppText.bodyMediumInk.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (b.status == "completed")
                const Icon(
                  Icons.check_circle,
                  size: 18,
                  color: AppColors.success,
                )
              else if (b.status == "no_show")
                const Icon(
                  Icons.person_off_outlined,
                  size: 18,
                  color: AppColors.danger,
                ),
            ],
          ),
          Text(
            "${b.parentName.isEmpty ? "Parent" : b.parentName}${digits.length >= 10 ? " · $digits" : ""}",
            style: AppText.bodySmallMuted,
          ),
          if (fb != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                [
                  if ((fb["strengths"] as String?)?.isNotEmpty == true)
                    "Well: ${fb["strengths"]}",
                  if ((fb["areas"] as String?)?.isNotEmpty == true)
                    "Attention: ${fb["areas"]}",
                  if ((fb["followUp"] as String?)?.isNotEmpty == true)
                    "Follow-up: ${fb["followUp"]}",
                ].join("\n"),
                style: AppText.bodySmallInk.copyWith(height: 1.4),
              ),
            ),
          Wrap(
            spacing: 4,
            alignment: WrapAlignment.end,
            children: [
              if (digits.length >= 10)
                IconButton(
                  tooltip: context.l10n.call,
                  onPressed: () => launchUrl(Uri.parse("tel:$digits")),
                  icon: const Icon(
                    Icons.call_outlined,
                    size: 20,
                    color: AppColors.primary,
                  ),
                ),
              if (b.status == "booked") ...[
                TextButton(
                  onPressed: () => _noShow(context),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.danger,
                  ),
                  child: Text(context.l10n.didNotCome),
                ),
                FilledButton.tonal(
                  onPressed: () => _met(context),
                  child: Text(context.l10n.metAddNote),
                ),
              ] else if (b.status == "completed" && fb == null)
                TextButton(
                  onPressed: () => _met(context),
                  child: Text(context.l10n.addNote),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

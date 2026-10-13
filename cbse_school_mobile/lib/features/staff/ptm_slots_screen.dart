import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// Add my own slots to a PTM the office opened (/api/v1/staff/ptm/slots).
///
/// The event — its day and which classes it is for — is the office's; a
/// teacher only lays out their own sitting: from, until, slot length and a
/// break between meetings. The server stamps the slot with the signed-in
/// teacher and refuses one that overlaps a slot they already have, so this
/// screen only previews; it never decides.
class PtmAddSlotsScreen extends StatefulWidget {
  const PtmAddSlotsScreen({super.key, required this.api, required this.event});

  final ApiClient api;
  final PtmTeacherEvent event;

  @override
  State<PtmAddSlotsScreen> createState() => _PtmAddSlotsScreenState();
}

class _PtmAddSlotsScreenState extends State<PtmAddSlotsScreen> {
  static const _lengths = [5, 10, 15, 20, 30, 45, 60];
  static const _breaks = [0, 5, 10, 15];

  TimeOfDay _from = const TimeOfDay(hour: 9, minute: 0);
  TimeOfDay _until = const TimeOfDay(hour: 12, minute: 0);
  int _length = 15;
  int _break = 0;
  int _capacity = 1;
  final _room = TextEditingController();
  final Set<String> _skipped = {};
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _room.dispose();
    super.dispose();
  }

  static String _hhmm(TimeOfDay t) =>
      "${t.hour.toString().padLeft(2, "0")}:${t.minute.toString().padLeft(2, "0")}";

  List<String> get _starts => ptmSlotStarts(
    from: _hhmm(_from),
    until: _hhmm(_until),
    slotMinutes: _length,
    breakMinutes: _break,
  );

  /// Times I already hold in this event, shown so the clash is visible
  /// before the server refuses it.
  bool _clashesWithMine(String start) {
    // Minutes since midnight ("00:00" itself reads as 0, which is right).
    final a = ptmSlotMinutes("00:00", start);
    final b = a + _length;
    for (final m in widget.event.slots.where((x) => x.isMine)) {
      final ms = ptmSlotMinutes("00:00", m.startAt);
      final me = ms + ptmSlotMinutes(m.startAt, m.endAt);
      if (a < me && ms < b) return true;
    }
    return false;
  }

  Future<void> _pick(bool from) async {
    final t = await showTimePicker(
      context: context,
      initialTime: from ? _from : _until,
    );
    if (t == null || !mounted) return;
    setState(() {
      from ? _from = t : _until = t;
      _skipped.clear();
      _error = null;
    });
  }

  Future<void> _save() async {
    final starts = _starts.where((s) => !_skipped.contains(s)).toList();
    if (starts.isEmpty) return;
    if (starts.length > 40) {
      setState(
        () => _error = "At most 40 slots at a time — shorten the sitting.",
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final n = await widget.api.createPtmSlots(
        eventId: widget.event.id,
        starts: starts,
        durationMinutes: _length,
        capacity: _capacity,
        roomOrLink: _room.text.trim(),
      );
      Haptics.success();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Added $n slot${n == 1 ? "" : "s"}")),
      );
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.event;
    final starts = _starts;
    final chosen = starts.where((s) => !_skipped.contains(s)).toList();
    final multiDay = e.endDate.isNotEmpty && e.endDate != e.date;
    return Scaffold(
      appBar: AppBar(
        title: const Text("Add PTM slots"),
        actions: const [
          ScreenGuideButton(guideId: "ptm-slots", screenLabel: "PTM slots"),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          Text(e.name, style: AppText.titleMediumInk),
          Text(
            multiDay
                ? "${formatDateLabel(e.date)} – ${formatDateLabel(e.endDate)}"
                : formatDateLabel(e.date),
            style: AppText.bodySmallMuted,
          ),
          if (multiDay)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                "The office set this PTM over several days; a slot is a time, not a day — parents see the times for the PTM as a whole.",
                style: AppText.labelMediumMuted,
              ),
            ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : () => _pick(true),
                  icon: const Icon(Icons.schedule),
                  label: Text("From ${hhmmLabel(_hhmm(_from))}"),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : () => _pick(false),
                  icon: const Icon(Icons.schedule_outlined),
                  label: Text("Until ${hhmmLabel(_hhmm(_until))}"),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text("Slot length · हर मुलाक़ात", style: AppText.labelMediumMuted),
          Wrap(
            spacing: 6,
            children: [
              for (final m in _lengths)
                ChoiceChip(
                  label: Text("$m min"),
                  selected: _length == m,
                  onSelected: _busy
                      ? null
                      : (_) => setState(() {
                          _length = m;
                          _skipped.clear();
                          _error = null;
                        }),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            "Break between · बीच में विराम",
            style: AppText.labelMediumMuted,
          ),
          Wrap(
            spacing: 6,
            children: [
              for (final m in _breaks)
                ChoiceChip(
                  label: Text(m == 0 ? "None" : "$m min"),
                  selected: _break == m,
                  onSelected: _busy
                      ? null
                      : (_) => setState(() {
                          _break = m;
                          _skipped.clear();
                          _error = null;
                        }),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  "Families per slot · एक समय में परिवार",
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
          const SizedBox(height: 8),
          Text(
            starts.isEmpty
                ? "No slot fits between these times."
                : "${chosen.length} slot${chosen.length == 1 ? "" : "s"} — tap a time to leave it out",
            style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final s in starts)
                FilterChip(
                  label: Text(
                    "${hhmmLabel(s)}${_clashesWithMine(s) ? " · clash" : ""}",
                  ),
                  selected: !_skipped.contains(s),
                  onSelected: _busy
                      ? null
                      : (on) => setState(() {
                          on ? _skipped.remove(s) : _skipped.add(s);
                          _error = null;
                        }),
                ),
            ],
          ),
          if (starts.any(_clashesWithMine))
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                "Times marked “clash” overlap a slot you already have — leave them out or the save is refused.",
                style: AppText.bodySmall.copyWith(color: AppColors.danger),
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _error!,
                style: AppText.bodySmall.copyWith(color: AppColors.danger),
              ),
            ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _busy || chosen.isEmpty ? null : _save,
            icon: _busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.add),
            label: Text(
              "Add ${chosen.length} slot${chosen.length == 1 ? "" : "s"} · समय जोड़ें",
            ),
          ),
        ],
      ),
    );
  }
}

import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// A teacher's online classes: what is on this week, Start / End / who
/// joined, and a schedule sheet that fills the time from the bell.
class OnlineClassesTeacherScreen extends StatefulWidget {
  const OnlineClassesTeacherScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<OnlineClassesTeacherScreen> createState() => _OnlineClassesTeacherScreenState();
}

class _OnlineClassesTeacherScreenState extends State<OnlineClassesTeacherScreen> {
  String _range = "week";

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  Future<void> _act(StaffOnlineClass c, String action, Future<void> Function() reload) async {
    try {
      final next = await widget.api.onlineClassAction(c.id, action);
      Haptics.success();
      if (action == "start" && next.joinUrl.isNotEmpty) await _open(next.joinUrl);
      await reload();
    } on ApiException catch (e) {
      Haptics.warning();
      _snack(e.message);
    }
  }

  Future<void> _confirmThen(String title, String body, Future<void> Function() go) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title, style: AppText.titleMedium),
        content: Text(body, style: AppText.bodyMedium),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text("Back")),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text("Yes")),
        ],
      ),
    );
    if (ok == true) await go();
  }

  Future<void> _schedule(StaffOnlineClassListing listing, Future<void> Function() reload) async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _ScheduleSheet(api: widget.api, listing: listing),
    );
    if (created == true) await reload();
  }

  Future<void> _attendance(StaffOnlineClass c) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _AttendanceSheet(api: widget.api, c: c),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<StaffOnlineClassListing>(
      title: "Online classes",
      subtitle: switch (_range) {
        "today" => "Today",
        "past" => "Earlier",
        "upcoming" => "Coming up",
        _ => "This week",
      },
      load: () => widget.api.fetchStaffOnlineClasses(range: _range),
      emptyIcon: Icons.videocam_outlined,
      emptyText: "Nothing scheduled in this window.",
      isEmpty: (d) => d.sessions.isEmpty && !d.canSchedule,
      floatingActionButton: (context, data, reload) => data.canSchedule
          ? FloatingActionButton.extended(
              onPressed: () => _schedule(data, reload),
              icon: const Icon(Icons.add),
              label: const Text("Schedule"),
            )
          : const SizedBox.shrink(),
      builder: (context, data, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        children: [
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: "today", label: Text("Today")),
              ButtonSegment(value: "week", label: Text("Week")),
              ButtonSegment(value: "upcoming", label: Text("Later")),
              ButtonSegment(value: "past", label: Text("Past")),
            ],
            selected: {_range},
            showSelectedIcon: false,
            onSelectionChanged: (s) {
              setState(() => _range = s.first);
              reload();
            },
          ),
          const SizedBox(height: 12),
          if (!data.google.connected && data.google.oauthConfigured)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                "To create Google Meet rooms from here, connect Google once from the ERP desk (Online classes → Connect Google). Until then, paste a link when scheduling.",
                style: AppText.labelMediumMuted,
              ),
            ),
          if (data.sessions.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 32),
              child: Center(child: Text("Nothing scheduled in this window.", style: AppText.bodyMedium)),
            ),
          for (final c in data.sessions) ...[
            _TeacherClassCard(
              c: c,
              today: data.today,
              onOpen: c.joinUrl.isEmpty ? null : () => _open(c.joinUrl),
              onStart: c.status == "scheduled" ? () => _act(c, "start", reload) : null,
              onEnd: c.status == "live"
                  ? () => _confirmThen("End this class?", "Parents can no longer join from the app.", () => _act(c, "end", reload))
                  : null,
              onCancel: c.status == "scheduled"
                  ? () => _confirmThen("Cancel this class?", "${c.sectionLabel} · ${c.date} ${c.startTime}. Parents will see it as cancelled.", () => _act(c, "cancel", reload))
                  : null,
              onAttendance: () => _attendance(c),
            ),
            const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}

String _fmt12(String t) {
  final parts = t.split(":");
  if (parts.length != 2) return t;
  final h = int.tryParse(parts[0]) ?? 0;
  final ap = h >= 12 ? "PM" : "AM";
  final hh = h % 12 == 0 ? 12 : h % 12;
  return "$hh:${parts[1]} $ap";
}

String _dayLabel(String date, String today) {
  if (date == today) return "Today";
  final d = DateTime.tryParse(date);
  final t = DateTime.tryParse(today);
  if (d != null && t != null && d.difference(t).inDays == 1) return "Tomorrow";
  return formatDateLabel(date);
}

class _TeacherClassCard extends StatelessWidget {
  const _TeacherClassCard({
    required this.c,
    required this.today,
    required this.onOpen,
    required this.onStart,
    required this.onEnd,
    required this.onCancel,
    required this.onAttendance,
  });

  final StaffOnlineClass c;
  final String today;
  final VoidCallback? onOpen;
  final VoidCallback? onStart;
  final VoidCallback? onEnd;
  final VoidCallback? onCancel;
  final VoidCallback onAttendance;

  @override
  Widget build(BuildContext context) {
    final chip = switch (c.phase) {
      "live" => ("LIVE", AppColors.success),
      "joinable" => ("Starting", AppColors.success),
      "cancelled" => ("Cancelled", AppColors.warning),
      "over" => ("Over", AppColors.muted),
      _ => (_dayLabel(c.date, today), AppColors.ink),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text("${c.sectionLabel} · ${c.heading}", style: AppText.titleMedium),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: chip.$2.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    chip.$1,
                    style: AppText.labelMediumMuted.copyWith(color: chip.$2, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              "${_dayLabel(c.date, today)} · ${_fmt12(c.startTime)} – ${_fmt12(c.endTime)}"
              "${c.periodNo != null ? " · P${c.periodNo}" : ""}"
              " · ${c.provider == "google_meet" ? "Google Meet" : "Link"}",
              style: AppText.bodyMedium,
            ),
            const SizedBox(height: 4),
            Text(
              "${c.joinedCount} joined"
              "${c.announcedAt.isEmpty && c.status == "scheduled" ? " · not announced" : ""}"
              "${c.teacherName.isEmpty ? "" : " · ${c.teacherName}"}",
              style: AppText.labelMediumMuted,
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                if (onStart != null)
                  FilledButton.icon(
                    onPressed: onStart,
                    icon: const Icon(Icons.play_arrow_rounded),
                    label: const Text("Start"),
                  )
                else if (onOpen != null && c.status != "cancelled")
                  OutlinedButton.icon(
                    onPressed: onOpen,
                    icon: const Icon(Icons.open_in_new),
                    label: const Text("Open room"),
                  ),
                if (onEnd != null)
                  OutlinedButton.icon(
                    onPressed: onEnd,
                    icon: const Icon(Icons.stop_rounded),
                    label: const Text("End"),
                  ),
                OutlinedButton.icon(
                  onPressed: onAttendance,
                  icon: const Icon(Icons.people_outline),
                  label: const Text("Who joined"),
                ),
                if (onCancel != null)
                  TextButton(
                    onPressed: onCancel,
                    child: Text("Cancel", style: TextStyle(color: AppColors.warning)),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- schedule

class _ScheduleSheet extends StatefulWidget {
  const _ScheduleSheet({required this.api, required this.listing});

  final ApiClient api;
  final StaffOnlineClassListing listing;

  @override
  State<_ScheduleSheet> createState() => _ScheduleSheetState();
}

class _ScheduleSheetState extends State<_ScheduleSheet> {
  late String _sectionKey;
  String _subjectId = "";
  late DateTime _date;
  int? _periodNo;
  TimeOfDay? _start;
  TimeOfDay? _end;
  String _provider = "link";
  final _link = TextEditingController();
  final _title = TextEditingController();
  final _note = TextEditingController();
  bool _announce = true;
  bool _busy = false;
  String? _error;

  bool get _meetPossible => widget.listing.google.connected && widget.listing.google.canMeet;

  @override
  void initState() {
    super.initState();
    final l = widget.listing;
    _sectionKey = l.sections.isEmpty ? "" : l.sections.first.key;
    _date = DateTime.tryParse(l.today) ?? DateTime.now();
    _provider = _meetPossible ? "google_meet" : "link";
  }

  @override
  void dispose() {
    _link.dispose();
    _title.dispose();
    _note.dispose();
    super.dispose();
  }

  static TimeOfDay? _parse(String t) {
    final p = t.split(":");
    if (p.length != 2) return null;
    final h = int.tryParse(p[0]);
    final m = int.tryParse(p[1]);
    if (h == null || m == null) return null;
    return TimeOfDay(hour: h, minute: m);
  }

  static String _hhmm(TimeOfDay t) =>
      "${t.hour.toString().padLeft(2, "0")}:${t.minute.toString().padLeft(2, "0")}";

  Future<void> _pickTime(bool start) async {
    final initial = start ? (_start ?? const TimeOfDay(hour: 10, minute: 0)) : (_end ?? _start ?? const TimeOfDay(hour: 10, minute: 40));
    final t = await showTimePicker(context: context, initialTime: initial);
    if (t == null) return;
    setState(() {
      if (start) {
        _start = t;
        _periodNo = null;
        if (_end == null || (_end!.hour * 60 + _end!.minute) <= (t.hour * 60 + t.minute)) {
          final m = t.hour * 60 + t.minute + 40;
          _end = TimeOfDay(hour: (m ~/ 60) % 24, minute: m % 60);
        }
      } else {
        _end = t;
        _periodNo = null;
      }
    });
  }

  Future<void> _submit() async {
    final parts = _sectionKey.split("|");
    if (parts.length != 2 || _start == null || _end == null) {
      setState(() => _error = "Pick the section and the time.");
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final provider = _meetPossible ? _provider : "link";
      await widget.api.scheduleOnlineClass(
        classId: parts[0],
        sectionId: parts[1],
        subjectId: _subjectId,
        date: "${_date.year}-${_date.month.toString().padLeft(2, "0")}-${_date.day.toString().padLeft(2, "0")}",
        startTime: _hhmm(_start!),
        endTime: _hhmm(_end!),
        periodNo: _periodNo,
        provider: provider,
        joinUrl: _link.text.trim(),
        title: _title.text.trim(),
        note: _note.text.trim(),
        announce: _announce,
      );
      Haptics.success();
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      setState(() {
        _error = e.message;
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = widget.listing;
    final inset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + inset),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text("Schedule an online class", style: AppText.titleMedium),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _sectionKey.isEmpty ? null : _sectionKey,
              decoration: const InputDecoration(labelText: "Class & section"),
              items: [
                for (final s in l.sections) DropdownMenuItem(value: s.key, child: Text(s.label)),
              ],
              onChanged: (v) => setState(() => _sectionKey = v ?? ""),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _subjectId.isEmpty ? null : _subjectId,
              decoration: const InputDecoration(labelText: "Subject"),
              items: [
                for (final s in l.subjects) DropdownMenuItem(value: s.id, child: Text(s.name)),
              ],
              onChanged: (v) => setState(() => _subjectId = v ?? ""),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      final d = await showDatePicker(
                        context: context,
                        initialDate: _date,
                        firstDate: DateTime.now().subtract(const Duration(days: 1)),
                        lastDate: DateTime.now().add(const Duration(days: 90)),
                      );
                      if (d != null) setState(() => _date = d);
                    },
                    icon: const Icon(Icons.calendar_today_outlined, size: 18),
                    label: Text("${_date.day}/${_date.month}/${_date.year}"),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<int>(
                    initialValue: _periodNo,
                    decoration: const InputDecoration(labelText: "Bell period"),
                    items: [
                      const DropdownMenuItem<int>(value: null, child: Text("Custom")),
                      for (final b in l.bell)
                        DropdownMenuItem(value: b.no, child: Text("${b.label} ${_fmt12(b.startTime)}")),
                    ],
                    onChanged: (v) {
                      final b = l.bell.where((x) => x.no == v).firstOrNull;
                      setState(() {
                        _periodNo = v;
                        if (b != null) {
                          _start = _parse(b.startTime);
                          _end = _parse(b.endTime);
                        }
                      });
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _pickTime(true),
                    child: Text(_start == null ? "Start time" : "Starts ${_fmt12(_hhmm(_start!))}"),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _pickTime(false),
                    child: Text(_end == null ? "End time" : "Ends ${_fmt12(_hhmm(_end!))}"),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (_meetPossible)
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: "google_meet", label: Text("Google Meet")),
                  ButtonSegment(value: "link", label: Text("Paste a link")),
                ],
                selected: {_provider},
                showSelectedIcon: false,
                onSelectionChanged: (s) => setState(() => _provider = s.first),
              ),
            if (!_meetPossible || _provider == "link") ...[
              const SizedBox(height: 10),
              TextField(
                controller: _link,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: "Meeting link",
                  hintText: "meet.google.com/abc-defg-hij",
                ),
              ),
            ],
            const SizedBox(height: 10),
            TextField(
              controller: _title,
              decoration: const InputDecoration(labelText: "Title (optional)"),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _note,
              decoration: const InputDecoration(labelText: "Note to parents (optional)"),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _announce,
              onChanged: (v) => setState(() => _announce = v),
              title: Text("Notify the section's parents now", style: AppText.bodyMedium),
            ),
            if (_error != null) ...[
              Text(_error!, style: TextStyle(color: AppColors.warning)),
              const SizedBox(height: 8),
            ],
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? "Scheduling…" : "Schedule"),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- attendance

class _AttendanceSheet extends StatefulWidget {
  const _AttendanceSheet({required this.api, required this.c});

  final ApiClient api;
  final StaffOnlineClass c;

  @override
  State<_AttendanceSheet> createState() => _AttendanceSheetState();
}

class _AttendanceSheetState extends State<_AttendanceSheet> {
  OnlineClassAttendance? _data;
  String? _error;
  String? _note;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await widget.api.fetchOnlineClassAttendance(widget.c.id);
      if (mounted) setState(() => _data = d);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _sync() async {
    setState(() {
      _busy = true;
      _note = null;
    });
    try {
      final n = await widget.api.syncOnlineClassAttendance(widget.c.id);
      if (mounted) setState(() => _note = n);
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      builder: (context, controller) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("Who joined · ${widget.c.sectionLabel}", style: AppText.titleMedium),
            const SizedBox(height: 4),
            Text(
              d == null ? "${widget.c.date} ${_fmt12(widget.c.startTime)}" : "${d.joined} of ${d.total} joined",
              style: AppText.bodyMedium,
            ),
            if (d != null && d.canSync)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _busy ? null : _sync,
                  icon: const Icon(Icons.sync, size: 18),
                  label: Text(_busy ? "Reading Meet…" : "Sync from Meet"),
                ),
              ),
            if (_note != null) Text(_note!, style: AppText.labelMediumMuted),
            if (_error != null) Text(_error!, style: TextStyle(color: AppColors.warning)),
            const SizedBox(height: 8),
            Expanded(
              child: d == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView.separated(
                      controller: controller,
                      itemCount: d.rows.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, i) {
                        final r = d.rows[i];
                        return ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: SizedBox(
                            width: 28,
                            child: Text(r.rollNo, style: AppText.labelMediumMuted, textAlign: TextAlign.right),
                          ),
                          title: Text(r.fullName, style: AppText.bodyMedium),
                          trailing: r.joined
                              ? Text(
                                  "Joined${r.minutes > 0 ? " · ${r.minutes} min" : ""}",
                                  style: AppText.labelMediumMuted.copyWith(color: AppColors.success),
                                )
                              : Text("—", style: AppText.labelMediumMuted),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

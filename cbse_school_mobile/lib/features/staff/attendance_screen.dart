import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

const _statuses = [
  ("P", "Present", AppColors.success),
  ("A", "Absent", AppColors.danger),
  ("L", "Late", AppColors.warning),
];

class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({
    super.key,
    required this.api,
    required this.classId,
    required this.sectionId,
    required this.date,
    required this.title,
  });

  final ApiClient api;
  final String classId;
  final String sectionId;
  final String date;
  final String title;

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  AttendanceRoster? _roster;
  String? _error;
  bool _saving = false;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final roster = await widget.api.fetchAttendanceRoster(
        classId: widget.classId,
        sectionId: widget.sectionId,
        date: widget.date,
      );
      // Unmarked students default to Present — the common case; the teacher
      // only taps the exceptions.
      for (final s in roster.students) {
        s.status ??= "P";
      }
      if (mounted) setState(() => _roster = roster);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    }
  }

  Future<void> _submit() async {
    final roster = _roster;
    if (roster == null || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.api.markAttendance(
        classId: widget.classId,
        sectionId: widget.sectionId,
        date: widget.date,
        statusByStudent: {
          for (final s in roster.students) s.id: s.status ?? "P",
        },
      );
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saved = true;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Attendance saved")),
      );
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = "Could not save. Check the connection and try again.";
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final roster = _roster;
    final presentCount =
        roster?.students.where((s) => s.status == "P").length ?? 0;
    final absentCount =
        roster?.students.where((s) => s.status == "A").length ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Attendance · ${widget.title}",
              style: const TextStyle(fontSize: 16),
            ),
            Text(
              widget.date,
              style: const TextStyle(fontSize: 11, color: Color(0xFFB8C0D4)),
            ),
          ],
        ),
      ),
      body: roster == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator(color: AppColors.primary)
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: _load,
                            child: const Text("Retry"),
                          ),
                        ],
                      ),
                    ),
            )
          : roster.students.isEmpty
              ? const Center(
                  child: Text(
                    "No active students in this section.",
                    style: TextStyle(color: AppColors.muted),
                  ),
                )
              : Column(
                  children: [
                    if (roster.attendanceMarked && !_saved)
                      Container(
                        width: double.infinity,
                        color: const Color(0xFFF5EDD4),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        child: const Text(
                          "Already marked today — saving again will update the register.",
                          style: TextStyle(
                            fontSize: 11.5,
                            color: Color(0xFF854F0B),
                          ),
                        ),
                      ),
                    Expanded(
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                        itemCount: roster.students.length,
                        separatorBuilder: (_, i) => const SizedBox(height: 8),
                        itemBuilder: (context, i) {
                          final s = roster.students[i];
                          return Card(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 8,
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          s.fullName,
                                          style: const TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600,
                                            color: AppColors.ink,
                                          ),
                                        ),
                                        if (s.rollNo.isNotEmpty)
                                          Text(
                                            "Roll ${s.rollNo}",
                                            style: const TextStyle(
                                              fontSize: 11,
                                              color: AppColors.muted,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                  for (final (code, _, color) in _statuses)
                                    Padding(
                                      padding: const EdgeInsets.only(left: 6),
                                      child: InkWell(
                                        borderRadius: BorderRadius.circular(10),
                                        onTap: () =>
                                            setState(() => s.status = code),
                                        child: Container(
                                          width: 34,
                                          height: 34,
                                          decoration: BoxDecoration(
                                            color: s.status == code
                                                ? color
                                                : color.withValues(alpha: 0.1),
                                            borderRadius:
                                                BorderRadius.circular(10),
                                          ),
                                          child: Center(
                                            child: Text(
                                              code,
                                              style: TextStyle(
                                                fontSize: 13,
                                                fontWeight: FontWeight.w700,
                                                color: s.status == code
                                                    ? Colors.white
                                                    : color,
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    SafeArea(
                      top: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (_error != null)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Text(
                                  _error!,
                                  style: const TextStyle(
                                    color: AppColors.danger,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            FilledButton(
                              onPressed: _saving ? null : _submit,
                              child: _saving
                                  ? const SizedBox(
                                      height: 20,
                                      width: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : Text(
                                      "Save · $presentCount present, $absentCount absent",
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
}

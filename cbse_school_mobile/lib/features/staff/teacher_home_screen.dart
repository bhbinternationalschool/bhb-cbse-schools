import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/chat_inbox_screen.dart";
import "../modules/homework_screen.dart";
import "../modules/module_shell.dart";
import "../modules/notices_screen.dart";
import "../modules/syllabus_scan_screen.dart";
import "presence_screen.dart";
import "../modules/teaching_screen.dart";
import "attendance_screen.dart";
import "section_picker.dart";
import "self_attendance_screen.dart";
import "students_screen.dart";

String _greeting() {
  final h = DateTime.now().hour;
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

class _StaffModule {
  const _StaffModule(this.label, this.icon, this.tone);

  final String label;
  final IconData icon;
  final ModuleTone tone;
}

const _staffModules = [
  _StaffModule("Attendance", Icons.fact_check_outlined, ModuleTone.teal),
  _StaffModule("Period log", Icons.bookmark_added_outlined, ModuleTone.green),
  _StaffModule("Scan syllabus", Icons.document_scanner_outlined, ModuleTone.blue),
  _StaffModule("Homework", Icons.menu_book_outlined, ModuleTone.purple),
  _StaffModule("Marks", Icons.grading_outlined, ModuleTone.amber),
  _StaffModule("My leave", Icons.event_outlined, ModuleTone.coral),
  _StaffModule("Timetable", Icons.calendar_view_week_outlined, ModuleTone.blue),
  _StaffModule("Notices", Icons.campaign_outlined, ModuleTone.pink),
  _StaffModule("Students", Icons.school_outlined, ModuleTone.green),
  _StaffModule("Payslips", Icons.receipt_long_outlined, ModuleTone.gray),
];

class TeacherHomeScreen extends StatefulWidget {
  const TeacherHomeScreen({
    super.key,
    required this.api,
    required this.onLogout,
    this.openRoute,
  });

  final ApiClient api;
  final VoidCallback onLogout;

  /// Deep link from a notification tap ("/chat?studentId=…", "/notices",
  /// "/homework"). Opened once the staff summary has loaded.
  final String? openRoute;

  @override
  State<TeacherHomeScreen> createState() => _TeacherHomeScreenState();
}

class _TeacherHomeScreenState extends State<TeacherHomeScreen> {
  final int _tab = 0;
  StaffSummary? _summary;
  String? _error;
  String? _pendingRoute;

  @override
  void initState() {
    super.initState();
    _pendingRoute = widget.openRoute;
    _load();
  }

  @override
  void didUpdateWidget(covariant TeacherHomeScreen old) {
    super.didUpdateWidget(old);
    if (widget.openRoute != null && widget.openRoute != old.openRoute) {
      _pendingRoute = widget.openRoute;
      if (_summary != null) _consumePendingRoute();
    }
  }

  void _consumePendingRoute() {
    final raw = _pendingRoute;
    _pendingRoute = null;
    if (raw == null || _summary == null) return;
    final uri = Uri.tryParse(raw);
    if (uri == null) return;
    switch (uri.path) {
      case "/chat":
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ChatInboxScreen(api: widget.api)),
        );
      case "/notices":
        _openModule("Notices");
      case "/homework":
        _openModule("Homework");
      case "/attendance":
        _openModule("Attendance");
    }
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final summary = await widget.api.fetchStaffSummary();
      if (mounted) setState(() => _summary = summary);
      if (_pendingRoute != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _consumePendingRoute();
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    }
  }

  Future<void> _signOut() async {
    await widget.api.signOut();
    if (mounted) widget.onLogout();
  }

  /// Resolve a target section: the class-teacher link when present and
  /// [preferOwnSection], else the class/section picker sheet.
  Future<(String, String, String)?> _pickSection({
    bool preferOwnSection = false,
  }) async {
    final summary = _summary;
    if (summary == null) return null;
    final ct = summary.classTeacherOf;
    if (preferOwnSection && ct != null) {
      return (ct.classId, ct.sectionId, "${ct.className} ${ct.sectionName}");
    }
    return showModalBottomSheet<(String, String, String)>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => SectionPicker(classes: summary.classes),
    );
  }

  Future<void> _openAttendance({
    String? classId,
    String? sectionId,
    String? label,
  }) async {
    final summary = _summary;
    if (summary == null) return;

    var target = classId != null && sectionId != null
        ? (classId, sectionId, label ?? "")
        : await _pickSection();
    if (target == null) return;

    if (!mounted) return;
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AttendanceScreen(
          api: widget.api,
          classId: target.$1,
          sectionId: target.$2,
          date: summary.date,
          title: target.$3,
        ),
      ),
    );
    if (changed == true) _load();
  }

  Future<void> _openModule(String label) async {
    final summary = _summary;
    if (summary == null) return;
    switch (label) {
      case "Attendance":
        await _openAttendance();
      case "Period log":
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => TeachingScreen(api: widget.api)),
        );
      case "Scan syllabus":
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => SyllabusScanScreen(api: widget.api),
          ),
        );
      case "Homework":
        final target = await _pickSection();
        if (target == null || !mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => HomeworkScreen(
              api: widget.api,
              subtitle: target.$3,
              classId: target.$1,
              sectionId: target.$2,
              canPost: true,
            ),
          ),
        );
      case "Students":
        final target = await _pickSection();
        if (target == null || !mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => StudentsScreen(
              api: widget.api,
              classId: target.$1,
              sectionId: target.$2,
              date: summary.date,
              title: target.$3,
            ),
          ),
        );
      case "Notices":
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => NoticesScreen(api: widget.api)),
        );
      case "Marks":
        showComingSoon(
          context,
          "Marks entry",
          "Opens once the exam desk publishes mark sheets for this term.",
        );
      case "My leave":
        showComingSoon(
          context,
          "Leave",
          "Leave requests go live once HR configures leave types in the ERP.",
        );
      case "Timetable":
        showComingSoon(
          context,
          "Timetable",
          "Your period schedule appears here once the school publishes the timetable.",
        );
      case "Payslips":
        showComingSoon(
          context,
          "Payslips",
          "Payslips appear here after the first payroll run in the ERP.",
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final summary = _summary;

    if (summary == null) {
      return Scaffold(
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator(color: AppColors.primary)
              : Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.cloud_off_outlined,
                          size: 40, color: AppColors.muted),
                      const SizedBox(height: 12),
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      FilledButton(onPressed: _load, child: const Text("Retry")),
                      TextButton(
                        onPressed: _signOut,
                        child: const Text("Sign out"),
                      ),
                    ],
                  ),
                ),
        ),
      );
    }

    final ct = summary.classTeacherOf;

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.primary,
        child: ListView(
          padding: EdgeInsets.zero,
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            Container(
              decoration: const BoxDecoration(
                color: AppColors.primary,
                borderRadius:
                    BorderRadius.vertical(bottom: Radius.circular(28)),
              ),
              padding: EdgeInsets.fromLTRB(
                20,
                MediaQuery.paddingOf(context).top + 18,
                12,
                40,
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: AppColors.accentSoft,
                    child: Text(
                      summary.fullName.isEmpty
                          ? "S"
                          : summary.fullName
                              .split(" ")
                              .where((p) => p.isNotEmpty)
                              .take(2)
                              .map((p) => p[0].toUpperCase())
                              .join(),
                      style: const TextStyle(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _greeting(),
                          style: const TextStyle(
                            color: AppColors.accentSoft,
                            fontSize: 12,
                          ),
                        ),
                        Text(
                          summary.fullName,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          ct == null
                              ? "Staff"
                              : "Class teacher · ${ct.className} ${ct.sectionName}",
                          style: const TextStyle(
                            color: Color(0xFFB8C0D4),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: "Sign out",
                    onPressed: _signOut,
                    icon: const Icon(Icons.logout, color: Colors.white),
                  ),
                ],
              ),
            ),
            Transform.translate(
              offset: const Offset(0, -20),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _AttendanceBanner(
                  info: ct,
                  onTap: () => _openAttendance(
                    classId: ct?.classId,
                    sectionId: ct?.sectionId,
                    label:
                        ct == null ? null : "${ct.className} ${ct.sectionName}",
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Card(
                    margin: const EdgeInsets.only(bottom: 16),
                    child: ListTile(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) =>
                              SelfAttendanceScreen(api: widget.api),
                        ),
                      ),
                      leading: Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: ModuleTone.teal.background,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          Icons.where_to_vote_outlined,
                          color: ModuleTone.teal.foreground,
                          size: 22,
                        ),
                      ),
                      title: const Text(
                        "My attendance",
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      subtitle: const Text(
                        "GPS punch in / out from campus",
                        style:
                            TextStyle(fontSize: 11.5, color: AppColors.muted),
                      ),
                      trailing: const Icon(Icons.chevron_right,
                          color: AppColors.muted),
                    ),
                  ),
                  Card(
                    margin: const EdgeInsets.only(bottom: 16),
                    child: ListTile(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => PresenceScreen(api: widget.api),
                        ),
                      ),
                      leading: Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: ModuleTone.green.background,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          Icons.my_location,
                          color: ModuleTone.green.foreground,
                          size: 22,
                        ),
                      ),
                      title: const Text(
                        "School presence",
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      subtitle: const Text(
                        "Share location during school hours (works with app closed)",
                        style:
                            TextStyle(fontSize: 11.5, color: AppColors.muted),
                      ),
                      trailing: const Icon(Icons.chevron_right,
                          color: AppColors.muted),
                    ),
                  ),
                  const Text(
                    "Today's periods",
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (summary.periodsToday.isEmpty)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(14),
                        child: Text(
                          "No timetable published for today yet.",
                          style: TextStyle(
                            fontSize: 12.5,
                            color: AppColors.muted,
                          ),
                        ),
                      ),
                    )
                  else
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 4,
                        ),
                        child: Column(
                          children: [
                            for (final p in summary.periodsToday)
                              Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 8),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        "${p.periodNo} · ${p.subjectName.isEmpty ? "Period" : p.subjectName} — ${p.className} ${p.sectionName}",
                                        style: const TextStyle(
                                          fontSize: 12.5,
                                          color: AppColors.ink,
                                        ),
                                      ),
                                    ),
                                    Text(
                                      p.startTime,
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: AppColors.muted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 16),
                  const Text(
                    "Modules",
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 10),
                  GridView.count(
                    crossAxisCount: 4,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 8,
                    childAspectRatio: 0.82,
                    children: [
                      for (final m in _staffModules)
                        InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: () => _openModule(m.label),
                          child: Column(
                            children: [
                              Container(
                                width: 52,
                                height: 52,
                                decoration: BoxDecoration(
                                  color: m.tone.background,
                                  borderRadius: BorderRadius.circular(16),
                                ),
                                child: Icon(
                                  m.icon,
                                  color: m.tone.foreground,
                                  size: 26,
                                ),
                              ),
                              const SizedBox(height: 5),
                              Text(
                                m.label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: AppColors.ink,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) {
          switch (i) {
            case 1:
              _openModule("Students");
            case 2:
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => ChatInboxScreen(api: widget.api)),
              );
            case 3:
              showModalBottomSheet<void>(
                context: context,
                backgroundColor: Colors.white,
                shape: const RoundedRectangleBorder(
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                ),
                builder: (sheet) => SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 20, 24, 16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          summary.fullName,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: AppColors.ink,
                          ),
                        ),
                        const SizedBox(height: 16),
                        OutlinedButton.icon(
                          onPressed: () {
                            Navigator.pop(sheet);
                            _signOut();
                          },
                          icon: const Icon(Icons.logout, size: 18),
                          label: const Text("Sign out"),
                        ),
                      ],
                    ),
                  ),
                ),
              );
          }
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: "Home"),
          NavigationDestination(
            icon: Icon(Icons.fact_check_outlined),
            label: "Classes",
          ),
          NavigationDestination(
            icon: Icon(Icons.chat_bubble_outline),
            label: "Messages",
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            label: "Profile",
          ),
        ],
      ),
    );
  }
}

class _AttendanceBanner extends StatelessWidget {
  const _AttendanceBanner({required this.info, required this.onTap});

  final ClassTeacherInfo? info;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final marked = info?.attendanceMarked ?? false;
    final color = marked ? AppColors.primaryMid : AppColors.success;
    final title = info == null
        ? "Mark attendance"
        : marked
            ? "Attendance marked · ${info!.className} ${info!.sectionName}"
            : "Mark today's attendance";
    final subtitle = info == null
        ? "Choose a class and section"
        : marked
            ? "${info!.markedCount} students recorded — tap to review"
            : "${info!.className} ${info!.sectionName} · ${info!.studentCount} students · not marked yet";
    return Material(
      color: color,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          child: Row(
            children: [
              Icon(
                marked ? Icons.task_alt : Icons.fact_check_outlined,
                color: Colors.white,
                size: 24,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: Color(0xFFE8ECE4),
                        fontSize: 11.5,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Colors.white),
            ],
          ),
        ),
      ),
    );
  }
}

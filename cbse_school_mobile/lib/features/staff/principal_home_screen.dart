import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/homework_screen.dart";
import "../modules/module_shell.dart";
import "../modules/notices_screen.dart";
import "../modules/bus_routes_screen.dart";
import "transport_requests_screen.dart";
import "attendance_screen.dart";
import "broadcast_screen.dart";
import "principal_lists.dart";
import "section_picker.dart";
import "presence_screen.dart";
import "self_attendance_screen.dart";
import "students_screen.dart";

String _greeting() {
  final h = DateTime.now().hour;
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/// School-wide live snapshot for principal / owner / director roles —
/// fees, attendance, staff, admissions and alerts from
/// /api/v1/principal/snapshot (all real aggregates, refreshed on pull).
class PrincipalHomeScreen extends StatefulWidget {
  const PrincipalHomeScreen({
    super.key,
    required this.api,
    required this.onLogout,
  });

  final ApiClient api;
  final VoidCallback onLogout;

  @override
  State<PrincipalHomeScreen> createState() => _PrincipalHomeScreenState();
}

class _PrincipalHomeScreenState extends State<PrincipalHomeScreen> {
  PrincipalSnapshot? _snap;
  StaffSummary? _staff;
  String? _name;
  String? _error;

  void _push(Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  /// Class/section picker over the school-wide class list (from
  /// /api/v1/staff/summary, which lists every active class for any staff).
  Future<(String, String, String)?> _pickSection() async {
    var staff = _staff;
    if (staff == null) {
      try {
        staff = await widget.api.fetchStaffSummary();
        if (mounted) setState(() => _staff = staff);
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Could not load the class list.")),
          );
        }
        return null;
      }
    }
    if (!mounted) return null;
    final classes = staff.classes;
    return showModalBottomSheet<(String, String, String)>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => SectionPicker(classes: classes),
    );
  }

  Future<void> _markAttendance() async {
    final target = await _pickSection();
    if (target == null || !mounted) return;
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AttendanceScreen(
          api: widget.api,
          classId: target.$1,
          sectionId: target.$2,
          date: _snap?.attendanceDate.isNotEmpty == true
              ? _snap!.attendanceDate
              : DateTime.now().toIso8601String().substring(0, 10),
          title: target.$3,
        ),
      ),
    );
    if (changed == true) _load();
  }

  Future<void> _postHomework() async {
    final target = await _pickSection();
    if (target == null || !mounted) return;
    _push(
      HomeworkScreen(
        api: widget.api,
        subtitle: target.$3,
        classId: target.$1,
        sectionId: target.$2,
        canPost: true,
      ),
    );
  }

  Future<void> _openStudents() async {
    final target = await _pickSection();
    if (target == null || !mounted) return;
    _push(
      StudentsScreen(
        api: widget.api,
        classId: target.$1,
        sectionId: target.$2,
        date: _snap?.attendanceDate ?? "",
        title: target.$3,
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final name = await widget.api.guardianName();
      final snap = await widget.api.fetchPrincipalSnapshot();
      if (!mounted) return;
      setState(() {
        _snap = snap;
        _name = name;
      });
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

  @override
  Widget build(BuildContext context) {
    final snap = _snap;
    if (snap == null) {
      return Scaffold(
        body: Center(
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

    final attTotal =
        snap.studentPresent + snap.studentAbsent + snap.studentLeave;

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
                borderRadius: BorderRadius.vertical(
                  bottom: Radius.circular(28),
                ),
              ),
              padding: EdgeInsets.fromLTRB(
                20,
                MediaQuery.paddingOf(context).top + 18,
                12,
                24,
              ),
              child: Row(
                children: [
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
                          _name ?? "Principal",
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          "School snapshot · ${snap.academicYearCode}",
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
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionTitle("Fees"),
                  Row(
                    children: [
                      _Stat(
                        label: "Collected today",
                        value: formatInrPaise(snap.todayCollectionPaise),
                        color: AppColors.success,
                      ),
                      const SizedBox(width: 8),
                      _Stat(
                        label: "This month",
                        value: formatInrPaise(snap.mtdCollectionPaise),
                        color: AppColors.primary,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _Stat(
                        label: "Open dues",
                        value: formatInrPaise(snap.openDuesPaise),
                        color: AppColors.warning,
                        onTap: () => _push(DefaultersScreen(api: widget.api)),
                      ),
                      const SizedBox(width: 8),
                      _Stat(
                        label: "Students with dues",
                        value: "${snap.defaulterHouseholds}",
                        color: AppColors.danger,
                        onTap: () => _push(DefaultersScreen(api: widget.api)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  _SectionTitle(
                    "Student attendance · ${snap.attendanceDate.isEmpty ? "today" : formatDateLabel(snap.attendanceDate)}",
                  ),
                  if (attTotal == 0)
                    Card(
                      child: ListTile(
                        dense: true,
                        title: const Text(
                          "No sections marked yet today.",
                          style: TextStyle(
                            fontSize: 12.5,
                            color: AppColors.muted,
                          ),
                        ),
                        subtitle: const Text("Tap to see registers by section"),
                        trailing: const Icon(Icons.chevron_right, size: 18),
                        onTap: () => _push(RegistersScreen(api: widget.api)),
                      ),
                    )
                  else ...[
                    Row(
                      children: [
                        _Stat(
                          label: "Present",
                          value: "${snap.studentPresent}",
                          color: AppColors.success,
                          onTap: () => _push(RegistersScreen(api: widget.api)),
                        ),
                        const SizedBox(width: 8),
                        _Stat(
                          label: "Absent",
                          value: "${snap.studentAbsent}",
                          color: AppColors.danger,
                          onTap: () => _push(RegistersScreen(api: widget.api)),
                        ),
                        const SizedBox(width: 8),
                        _Stat(
                          label: "Marked",
                          value: "${snap.studentMarkedPct}%",
                          color: AppColors.primary,
                          onTap: () => _push(RegistersScreen(api: widget.api)),
                        ),
                      ],
                    ),
                    if (snap.registersPending > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: _AlertRow(
                          icon: Icons.pending_actions,
                          text:
                              "${snap.registersPending} section registers not marked yet",
                          onTap: () => _push(RegistersScreen(api: widget.api)),
                        ),
                      ),
                  ],
                  const SizedBox(height: 18),
                  const _SectionTitle("Staff"),
                  Row(
                    children: [
                      _Stat(
                        label: "Active staff",
                        value: "${snap.staffActive}",
                        color: AppColors.primary,
                        onTap: () =>
                            _push(StaffAttendanceTodayScreen(api: widget.api)),
                      ),
                      const SizedBox(width: 8),
                      _Stat(
                        label: "Present today",
                        value: "${snap.staffPresent}",
                        color: AppColors.success,
                        onTap: () =>
                            _push(StaffAttendanceTodayScreen(api: widget.api)),
                      ),
                      const SizedBox(width: 8),
                      _Stat(
                        label: "Absent",
                        value: "${snap.staffAbsent}",
                        color: AppColors.danger,
                        onTap: () =>
                            _push(StaffAttendanceTodayScreen(api: widget.api)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  const _SectionTitle("Admissions"),
                  Row(
                    children: [
                      _Stat(
                        label: "Pipeline leads",
                        value: "${snap.admissionsPipeline}",
                        color: AppColors.primary,
                      ),
                      const SizedBox(width: 8),
                      _Stat(
                        label: "Enrolled",
                        value: "${snap.admissionsEnrolled}",
                        color: AppColors.success,
                      ),
                      const SizedBox(width: 8),
                      _Stat(
                        label: "Follow-ups due",
                        value: "${snap.followUpsDue}",
                        color: AppColors.warning,
                        onTap: () => _push(FollowUpsScreen(api: widget.api)),
                      ),
                    ],
                  ),
                  if (snap.vaultExpiring30d > 0 || snap.lowStockSkus > 0) ...[
                    const SizedBox(height: 18),
                    const _SectionTitle("Alerts"),
                    if (snap.vaultExpiring30d > 0)
                      _AlertRow(
                        icon: Icons.folder_special_outlined,
                        text:
                            "${snap.vaultExpiring30d} documents expiring within 30 days",
                      ),
                    if (snap.lowStockSkus > 0)
                      _AlertRow(
                        icon: Icons.inventory_2_outlined,
                        text: "${snap.lowStockSkus} store items low on stock",
                      ),
                  ],
                  const SizedBox(height: 18),
                  const _SectionTitle("Actions"),
                  const SizedBox(height: 6),
                  GridView.count(
                    crossAxisCount: 3,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 8,
                    crossAxisSpacing: 8,
                    childAspectRatio: 1.05,
                    children: [
                      _Action(
                        icon: Icons.directions_bus_outlined,
                        label: "Transport requests",
                        tone: ModuleTone.pink,
                        onTap: () =>
                            _push(TransportRequestsScreen(api: widget.api)),
                      ),
                      _Action(
                        icon: Icons.campaign_outlined,
                        label: "Broadcast",
                        tone: ModuleTone.coral,
                        onTap: () => _push(BroadcastScreen(api: widget.api)),
                      ),
                      _Action(
                        icon: Icons.fact_check_outlined,
                        label: "Mark attendance",
                        tone: ModuleTone.teal,
                        onTap: _markAttendance,
                      ),
                      _Action(
                        icon: Icons.menu_book_outlined,
                        label: "Post homework",
                        tone: ModuleTone.blue,
                        onTap: _postHomework,
                      ),
                      _Action(
                        icon: Icons.groups_outlined,
                        label: "Students",
                        tone: ModuleTone.blue,
                        onTap: _openStudents,
                      ),
                      _Action(
                        icon: Icons.currency_rupee,
                        label: "Fee defaulters",
                        tone: ModuleTone.coral,
                        onTap: () => _push(DefaultersScreen(api: widget.api)),
                      ),
                      _Action(
                        icon: Icons.badge_outlined,
                        label: "Staff today",
                        tone: ModuleTone.teal,
                        onTap: () =>
                            _push(StaffAttendanceTodayScreen(api: widget.api)),
                      ),
                      _Action(
                        icon: Icons.person_add_alt_outlined,
                        label: "Admissions",
                        tone: ModuleTone.blue,
                        onTap: () => _push(FollowUpsScreen(api: widget.api)),
                      ),
                      _Action(
                        icon: Icons.newspaper_outlined,
                        label: "Notices",
                        tone: ModuleTone.coral,
                        onTap: () => _push(NoticesScreen(api: widget.api)),
                      ),
                      _Action(
                        icon: Icons.directions_bus_outlined,
                        label: "Transport",
                        tone: ModuleTone.blue,
                        onTap: () => _push(BusRoutesScreen(api: widget.api)),
                      ),
                      _Action(
                        icon: Icons.where_to_vote_outlined,
                        label: "My GPS punch",
                        tone: ModuleTone.teal,
                        onTap: () =>
                            _push(SelfAttendanceScreen(api: widget.api)),
                      ),
                      _Action(
                        icon: Icons.my_location,
                        label: "School presence",
                        tone: ModuleTone.green,
                        onTap: () => _push(PresenceScreen(api: widget.api)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    "Figures update live from the school ERP. Pull down to refresh.",
                    style: TextStyle(fontSize: 11, color: AppColors.muted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({
    required this.label,
    required this.value,
    required this.color,
    this.onTap,
  });

  final String label;
  final String value;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    value,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: color,
                    ),
                  ),
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        label,
                        style: const TextStyle(
                          fontSize: 10.5,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                    if (onTap != null)
                      const Icon(
                        Icons.chevron_right,
                        size: 14,
                        color: AppColors.muted,
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({
    required this.icon,
    required this.label,
    required this.tone,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final ModuleTone tone;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: tone.background,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: tone.foreground, size: 22),
              ),
              const SizedBox(height: 8),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 2,
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AlertRow extends StatelessWidget {
  const _AlertRow({required this.icon, required this.text, this.onTap});

  final IconData icon;
  final String text;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFFF5EDD4),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Icon(icon, size: 18, color: const Color(0xFF854F0B)),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  text,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: Color(0xFF854F0B),
                  ),
                ),
              ),
              if (onTap != null)
                const Icon(
                  Icons.chevron_right,
                  size: 16,
                  color: Color(0xFF854F0B),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

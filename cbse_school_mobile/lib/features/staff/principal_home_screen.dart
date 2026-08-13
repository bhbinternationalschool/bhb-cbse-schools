import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";
import "../modules/notices_screen.dart";
import "self_attendance_screen.dart";

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
  String? _name;
  String? _error;

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
                borderRadius:
                    BorderRadius.vertical(bottom: Radius.circular(28)),
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
                      ),
                      const SizedBox(width: 8),
                      _Stat(
                        label: "Defaulter families",
                        value: "${snap.defaulterHouseholds}",
                        color: AppColors.danger,
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  _SectionTitle(
                    "Student attendance · ${snap.attendanceDate.isEmpty ? "today" : formatDateLabel(snap.attendanceDate)}",
                  ),
                  if (attTotal == 0)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(14),
                        child: Text(
                          "No sections marked yet today.",
                          style: TextStyle(
                            fontSize: 12.5,
                            color: AppColors.muted,
                          ),
                        ),
                      ),
                    )
                  else ...[
                    Row(
                      children: [
                        _Stat(
                          label: "Present",
                          value: "${snap.studentPresent}",
                          color: AppColors.success,
                        ),
                        const SizedBox(width: 8),
                        _Stat(
                          label: "Absent",
                          value: "${snap.studentAbsent}",
                          color: AppColors.danger,
                        ),
                        const SizedBox(width: 8),
                        _Stat(
                          label: "Marked",
                          value: "${snap.studentMarkedPct}%",
                          color: AppColors.primary,
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
                      ),
                      const SizedBox(width: 8),
                      _Stat(
                        label: "Present today",
                        value: "${snap.staffPresent}",
                        color: AppColors.success,
                      ),
                      const SizedBox(width: 8),
                      _Stat(
                        label: "Absent",
                        value: "${snap.staffAbsent}",
                        color: AppColors.danger,
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
                  const _SectionTitle("Quick actions"),
                  const SizedBox(height: 6),
                  Card(
                    child: Column(
                      children: [
                        ListTile(
                          dense: true,
                          leading: Icon(
                            Icons.campaign_outlined,
                            color: ModuleTone.coral.foreground,
                          ),
                          title: const Text("Notices & news"),
                          trailing: const Icon(Icons.chevron_right, size: 18),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => NoticesScreen(api: widget.api),
                            ),
                          ),
                        ),
                        ListTile(
                          dense: true,
                          leading: Icon(
                            Icons.where_to_vote_outlined,
                            color: ModuleTone.teal.foreground,
                          ),
                          title: const Text("My attendance (GPS punch)"),
                          trailing: const Icon(Icons.chevron_right, size: 18),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  SelfAttendanceScreen(api: widget.api),
                            ),
                          ),
                        ),
                      ],
                    ),
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
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
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
              Text(
                label,
                style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AlertRow extends StatelessWidget {
  const _AlertRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFFF5EDD4),
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
          ],
        ),
      ),
    );
  }
}

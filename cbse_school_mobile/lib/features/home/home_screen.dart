import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/config/app_config.dart";
import "../../core/theme/app_theme.dart";
import "../modules/attendance_history_screen.dart";
import "../modules/chat_thread_screen.dart";
import "../modules/fees_screen.dart";
import "../modules/homework_screen.dart";
import "../modules/module_shell.dart";
import "../modules/notices_screen.dart";
import "../modules/ptm_screen.dart";
import "../modules/transport_screen.dart";
import "student_id_screen.dart";

class _Module {
  const _Module(this.label, this.icon, this.tone);

  final String label;
  final IconData icon;
  final ModuleTone tone;
}

const _modules = [
  _Module("Fees", Icons.payments_outlined, ModuleTone.blue),
  _Module("Attendance", Icons.fact_check_outlined, ModuleTone.teal),
  _Module("Homework", Icons.menu_book_outlined, ModuleTone.purple),
  _Module("Notices", Icons.campaign_outlined, ModuleTone.coral),
  _Module("Transport", Icons.directions_bus_outlined, ModuleTone.pink),
  _Module("Exams", Icons.workspace_premium_outlined, ModuleTone.amber),
  _Module("Library", Icons.local_library_outlined, ModuleTone.green),
  _Module("PTM", Icons.groups_outlined, ModuleTone.gray),
];

String _greeting() {
  final h = DateTime.now().hour;
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.config,
    required this.api,
    required this.onLogout,
    this.openRoute,
  });

  final AppConfig config;
  final ApiClient api;
  final VoidCallback onLogout;

  /// Deep link from a notification tap, e.g. "/homework",
  /// "/chat?studentId=…", "/attendance?studentId=…". Opened once the
  /// summary has loaded (we need the child record to open a module).
  final String? openRoute;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final int _tab = 0;
  int _childIndex = 0;
  ParentSummary? _summary;
  String? _error;
  String? _pendingRoute;

  @override
  void initState() {
    super.initState();
    _pendingRoute = widget.openRoute;
    _load();
  }

  @override
  void didUpdateWidget(covariant HomeScreen old) {
    super.didUpdateWidget(old);
    if (widget.openRoute != null && widget.openRoute != old.openRoute) {
      _pendingRoute = widget.openRoute;
      if (_summary != null) _consumePendingRoute();
    }
  }

  /// Turn a notification deep link into the same navigation a tap on the
  /// module grid would do. Unknown routes just land on Home.
  void _consumePendingRoute() {
    final raw = _pendingRoute;
    _pendingRoute = null;
    final summary = _summary;
    if (raw == null || summary == null || summary.children.isEmpty) return;
    final uri = Uri.tryParse(raw);
    if (uri == null) return;
    final studentId = uri.queryParameters["studentId"];
    var child = summary.children[_childIndex];
    if (studentId != null) {
      final idx = summary.children.indexWhere((c) => c.id == studentId);
      if (idx >= 0) {
        child = summary.children[idx];
        setState(() => _childIndex = idx);
      }
    }
    switch (uri.path) {
      case "/homework":
        _openModule("Homework", child);
      case "/attendance":
        _openModule("Attendance", child);
      case "/fees":
        _openModule("Fees", child);
      case "/notices":
        _openModule("Notices", child);
      case "/ptm":
        _openModule("PTM", child);
      case "/transport":
        _openModule("Transport", child);
      case "/chat":
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => ChatThreadScreen(
              api: widget.api,
              studentId: child.id,
              studentName: child.fullName,
            ),
          ),
        );
    }
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final summary = await widget.api.fetchParentSummary();
      if (!mounted) return;
      setState(() {
        _summary = summary;
        if (_childIndex >= summary.children.length) _childIndex = 0;
      });
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

  void _openModule(String label, ParentChild child) {
    final api = widget.api;
    Widget? screen;
    switch (label) {
      case "Fees":
        screen = FeesScreen(api: api, child: child);
      case "Attendance":
        screen = AttendanceHistoryScreen(api: api, child: child);
      case "Homework":
        screen = HomeworkScreen(
          api: api,
          subtitle: child.fullName,
          studentId: child.id,
        );
      case "Notices":
        screen = NoticesScreen(api: api);
      case "PTM":
        screen = PtmScreen(api: api, child: child);
      case "Transport":
        screen = TransportScreen(api: api);
      case "Exams":
        showComingSoon(
          context,
          "Exams",
          "Date sheets and report cards appear here once the school publishes them.",
        );
      case "Library":
        showComingSoon(
          context,
          "Library",
          "Issued books and due dates appear here once the library goes digital.",
        );
    }
    if (screen != null) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen!));
    }
  }

  void _showProfile(ParentSummary summary, ParentChild child) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                summary.guardianName,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              for (final c in summary.children)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    "${c.fullName} — ${c.classLabel}\nAdmission no. ${c.admissionNo}",
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.muted,
                      height: 1.4,
                    ),
                  ),
                ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(context);
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

  Future<void> _pickChild() async {
    final summary = _summary;
    if (summary == null || summary.children.length < 2) return;
    final picked = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _ChildPicker(
        children: summary.children,
        totalLabel: summary.totalOpenBalanceLabel,
        selected: _childIndex,
      ),
    );
    if (picked != null && picked != _childIndex && mounted) {
      setState(() => _childIndex = picked);
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

    if (summary.children.isEmpty) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.school_outlined,
                    size: 40, color: AppColors.muted),
                const SizedBox(height: 12),
                const Text(
                  "No active students found for this account. Contact the school office.",
                  textAlign: TextAlign.center,
                ),
                TextButton(onPressed: _signOut, child: const Text("Sign out")),
              ],
            ),
          ),
        ),
      );
    }

    final child = summary.children[_childIndex];

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.primary,
        child: ListView(
          padding: EdgeInsets.zero,
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            _Header(
              child: child,
              childCount: summary.children.length,
              onSwitchChild: _pickChild,
              onLogout: _signOut,
            ),
            Transform.translate(
              offset: const Offset(0, -26),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _StatsRow(child: child),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionTitle("Quick access"),
                  const SizedBox(height: 10),
                  _ModuleGrid(onTap: (label) => _openModule(label, child)),
                  const SizedBox(height: 12),
                  Card(
                    child: ListTile(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => StudentIdScreen(
                            child: child,
                            guardianName: summary.guardianName,
                          ),
                        ),
                      ),
                      leading: Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: ModuleTone.blue.background,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          Icons.qr_code_2,
                          color: ModuleTone.blue.foreground,
                          size: 22,
                        ),
                      ),
                      title: Text(
                        "Admission no. ${child.admissionNo}",
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      subtitle: Text(
                        "Guardian: ${summary.guardianName} · tap for ID QR",
                        style: const TextStyle(
                          fontSize: 11.5,
                          color: AppColors.muted,
                        ),
                      ),
                      trailing: const Icon(
                        Icons.chevron_right,
                        color: AppColors.muted,
                      ),
                    ),
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
          // Home stays the root; other tabs push their screen and snap back.
          switch (i) {
            case 1:
              _openModule("Fees", child);
            case 2:
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => ChatThreadScreen(
                    api: widget.api,
                    studentId: child.id,
                    studentName: child.fullName,
                  ),
                ),
              );
            case 3:
              _showProfile(summary, child);
          }
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: "Home"),
          NavigationDestination(
            icon: Icon(Icons.payments_outlined),
            label: "Fees",
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

class _Header extends StatelessWidget {
  const _Header({
    required this.child,
    required this.childCount,
    required this.onSwitchChild,
    required this.onLogout,
  });

  final ParentChild child;
  final int childCount;
  final VoidCallback onSwitchChild;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    final hasSiblings = childCount > 1;
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
      ),
      padding: EdgeInsets.fromLTRB(
        20,
        MediaQuery.paddingOf(context).top + 18,
        12,
        46,
      ),
      child: Row(
        children: [
          Expanded(
            child: InkWell(
              onTap: hasSiblings ? onSwitchChild : null,
              borderRadius: BorderRadius.circular(16),
              child: Row(
                children: [
                  _ChildAvatar(child: child, radius: 24),
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
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Flexible(
                              child: Text(
                                child.fullName,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 17,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            if (hasSiblings) ...[
                              const SizedBox(width: 4),
                              const Icon(
                                Icons.unfold_more,
                                color: AppColors.accentSoft,
                                size: 18,
                              ),
                            ],
                          ],
                        ),
                        Text(
                          child.classLabel,
                          style: const TextStyle(
                            color: Color(0xFFB8C0D4),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          IconButton(
            onPressed: () {},
            icon: const Icon(Icons.notifications_none, color: Colors.white),
          ),
          IconButton(
            tooltip: "Sign out",
            onPressed: onLogout,
            icon: const Icon(Icons.logout, color: Colors.white),
          ),
        ],
      ),
    );
  }
}

class _ChildAvatar extends StatelessWidget {
  const _ChildAvatar({required this.child, required this.radius});

  final ParentChild child;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final photo = child.photoUrl;
    if (photo != null && photo.startsWith("http")) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: AppColors.accentSoft,
        backgroundImage: NetworkImage(photo),
      );
    }
    return CircleAvatar(
      radius: radius,
      backgroundColor: AppColors.accentSoft,
      child: Text(
        child.initials,
        style: const TextStyle(
          color: AppColors.primary,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _ChildPicker extends StatelessWidget {
  const _ChildPicker({
    required this.children,
    required this.totalLabel,
    required this.selected,
  });

  final List<ParentChild> children;
  final String totalLabel;
  final int selected;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Your children",
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 12),
            for (var i = 0; i < children.length; i++) ...[
              _ChildTile(
                child: children[i],
                active: i == selected,
                onTap: () => Navigator.pop(context, i),
              ),
              const SizedBox(height: 8),
            ],
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: ModuleTone.amber.background,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text(
                "Total fees due for all children: $totalLabel",
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: ModuleTone.amber.foreground,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChildTile extends StatelessWidget {
  const _ChildTile({
    required this.child,
    required this.active,
    required this.onTap,
  });

  final ParentChild child;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: active ? const Color(0xFFF5EDD4) : AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: active
                ? AppColors.accent
                : AppColors.ink.withValues(alpha: 0.1),
            width: active ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            _ChildAvatar(child: child, radius: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    child.fullName,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                  Text(
                    "${child.classLabel} · due ${child.openBalanceLabel}",
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
            if (active)
              const Icon(Icons.check_circle, color: AppColors.accent, size: 22),
          ],
        ),
      ),
    );
  }
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.child});

  final ParentChild child;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            label: "Fees due",
            value: child.openBalanceLabel,
            color: child.openBalancePaise > 0
                ? AppColors.warning
                : AppColors.success,
          ),
        ),
        const SizedBox(width: 8),
        const Expanded(
          child: _StatCard(
            label: "Attendance",
            value: "—",
            color: AppColors.muted,
          ),
        ),
        const SizedBox(width: 8),
        const Expanded(
          child: _StatCard(
            label: "Homework",
            value: "—",
            color: AppColors.muted,
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(fontSize: 11, color: AppColors.muted),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                color: color,
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
    return Text(
      text,
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: AppColors.ink,
      ),
    );
  }
}

class _ModuleGrid extends StatelessWidget {
  const _ModuleGrid({required this.onTap});

  final void Function(String label) onTap;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 4,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 8,
      childAspectRatio: 0.82,
      children: [
        for (final m in _modules)
          InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => onTap(m.label),
            child: Column(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: m.tone.background,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Icon(m.icon, color: m.tone.foreground, size: 26),
                ),
                const SizedBox(height: 5),
                Text(
                  m.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11, color: AppColors.ink),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

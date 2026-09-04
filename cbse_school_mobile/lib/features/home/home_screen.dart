import "package:flutter/material.dart";
import "package:flutter_svg/flutter_svg.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/config/app_config.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../../core/ui/motion.dart";
import "../../core/ui/spacing.dart";
import "../modules/attendance_history_screen.dart";
import "../modules/chat_thread_screen.dart";
import "../modules/complaints_screen.dart";
import "../modules/ebook_shelf_screen.dart";
import "../modules/fees_screen.dart";
import "../modules/homework_screen.dart";
import "../modules/leave_screen.dart";
import "../modules/module_shell.dart";
import "../modules/notices_screen.dart";
import "../modules/ptm_screen.dart";
import "../modules/receipts_screen.dart";
import "../modules/teachers_screen.dart";
import "../modules/transport_screen.dart";
import "../modules/tutor_screen.dart";
import "../profile/profile_screen.dart";
import "home_stats.dart";
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
  _Module("Tutor", Icons.school_outlined, ModuleTone.amber),
  _Module("Notices", Icons.campaign_outlined, ModuleTone.coral),
  _Module("Transport", Icons.directions_bus_outlined, ModuleTone.pink),
  _Module("Exams", Icons.workspace_premium_outlined, ModuleTone.amber),
  _Module("Library", Icons.local_library_outlined, ModuleTone.green),
  _Module("PTM", Icons.groups_outlined, ModuleTone.gray),
  _Module("Leave", Icons.event_busy_outlined, ModuleTone.purple),
  _Module("Complaints", Icons.support_agent_outlined, ModuleTone.pink),
  _Module("Receipts", Icons.receipt_long_outlined, ModuleTone.blue),
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

  /// Attendance and homework per child, loaded after the summary. A missing
  /// entry (still loading, or the call failed) shows as a dash.
  final _attendance = <String, AttendanceHistory>{};
  final _homework = <String, HomeworkFeed>{};

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
      case "/leave":
        _openModule("Leave", child);
      case "/complaints":
        _openModule("Complaints", child);
      case "/profile":
        _openProfile();
      case "/receipts":
        _openModule("Receipts", child);
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
      _loadStats(summary);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    }
  }

  /// The two home tiles come from the same calls the Attendance and Homework
  /// screens make, so home and module never disagree. Failures are left as
  /// a dash rather than surfaced — the modules will show the real error.
  Future<void> _loadStats(ParentSummary summary) async {
    await Future.wait([
      for (final child in summary.children) ...[
        widget.api
            .fetchAttendanceHistory(child.id)
            .then((h) {
              if (mounted) setState(() => _attendance[child.id] = h);
            })
            .catchError((_) {}),
        widget.api
            .fetchHomeworkFeed(studentId: child.id)
            .then((f) {
              if (mounted) setState(() => _homework[child.id] = f);
            })
            .catchError((_) {}),
      ],
    ]);
  }

  Future<void> _signOut() async {
    await widget.api.signOut();
    if (mounted) widget.onLogout();
  }

  /// Hands off to WhatsApp with the greeting the school's bot answers. The
  /// bot recognises the parent by the number they message from, which is
  /// why the card says to use the registered mobile.
  Future<void> _openWhatsApp(SchoolWhatsApp contact) async {
    final uri = Uri.tryParse(contact.chatUrl);
    final ok =
        uri != null &&
        await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            "Could not open WhatsApp. The school's number is ${contact.display}.",
          ),
        ),
      );
    }
  }

  void _openModule(String label, ParentChild child) {
    final api = widget.api;
    Widget? screen;
    switch (label) {
      case "Fees":
        screen = FeesScreen(api: api, child: child);
      case "Attendance":
        screen = AttendanceHistoryScreen(api: api, child: child);
      case "Tutor":
        screen = TutorScreen(api: api, context: TutorContext(child: child));
      case "Homework":
        screen = HomeworkScreen(
          api: api,
          subtitle: child.fullName,
          studentId: child.id,
          child: child,
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
        screen = EbookShelfScreen(api: api);
      case "Leave":
        screen = LeaveScreen(api: api, child: child);
      case "Receipts":
        screen = ReceiptsScreen(api: api);
      case "Complaints":
        screen = ComplaintsScreen(
          api: api,
          children: _summary?.children ?? [child],
          defaultChild: child,
        );
    }
    if (screen != null) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen!));
    }
  }

  void _openProfile() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ProfileScreen(api: widget.api, onSignOut: _signOut),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // The three top-level states (spinner, error, dashboard) dissolve into
    // one another instead of swapping; the dashboard's sections then rise
    // in one after another on first paint.
    return AppCrossfade(
      child: KeyedSubtree(
        key: ValueKey(
          _summary == null ? (_error == null ? "loading" : "error") : "home",
        ),
        child: _buildState(context),
      ),
    );
  }

  Widget _buildState(BuildContext context) {
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
                      const Icon(
                        Icons.cloud_off_outlined,
                        size: 40,
                        color: AppColors.muted,
                      ),
                      const SizedBox(height: 12),
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
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

    if (summary.children.isEmpty) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.school_outlined,
                  size: 40,
                  color: AppColors.muted,
                ),
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
        edgeOffset: 80,
        child: ListView(
          padding: EdgeInsets.zero,
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            _Header(
              child: child,
              siblings: summary.children,
              selectedIndex: _childIndex,
              onSelectChild: (i) {
                if (i == _childIndex) return;
                Haptics.tap();
                setState(() => _childIndex = i);
              },
              onNotices: () => _openModule("Notices", child),
              onLogout: _signOut,
            ),
            Transform.translate(
              offset: const Offset(0, -34),
              child: Padding(
                padding: Insets.gutter,
                // Switching child crossfades the numbers rather than
                // flashing new ones into the same boxes.
                child: EntranceReveal(
                  index: 0,
                  child: AppCrossfade(
                    duration: AppMotion.fast,
                    child: _StatsRow(
                      key: ValueKey(child.id),
                      child: child,
                      attendance: _attendance[child.id],
                      homework: _homework[child.id],
                      onOpen: (label) => _openModule(label, child),
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: Insets.pageBelowHeader,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  EntranceReveal(
                    index: 1,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const _SectionTitle("Quick access"),
                        const SizedBox(height: Space.md),
                        _ModuleGrid(
                          onTap: (label) {
                            Haptics.tap();
                            _openModule(label, child);
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: Space.xl),
                  EntranceReveal(
                    index: 2,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const _SectionTitle("School"),
                        const SizedBox(height: Space.md),
                        if (summary.schoolWhatsApp != null) ...[
                          _WhatsAppCard(
                            contact: summary.schoolWhatsApp!,
                            onOpen: () =>
                                _openWhatsApp(summary.schoolWhatsApp!),
                          ),
                          const SizedBox(height: 10),
                        ],
                        _ActionCard(
                          tone: ModuleTone.green,
                          icon: Icons.forum_outlined,
                          title: "Message a teacher · 8 AM – 8 PM",
                          subtitle:
                              "Class and subject teachers, in app or on WhatsApp through the school",
                          onTap: () {
                            Haptics.tap();
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) =>
                                    TeachersScreen(api: widget.api, child: child),
                              ),
                            );
                          },
                        ),
                        const SizedBox(height: 10),
                        _ActionCard(
                          tone: ModuleTone.blue,
                          icon: Icons.qr_code_2,
                          title: "Student ID · ${child.admissionNo}",
                          subtitle:
                              "Guardian ${summary.guardianName} · tap for the ID QR",
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => StudentIdScreen(
                                child: child,
                                guardianName: summary.guardianName,
                              ),
                            ),
                          ),
                        ),
                      ],
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
          if (i != _tab) Haptics.tap();
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
              _openProfile();
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
    required this.siblings,
    required this.selectedIndex,
    required this.onSelectChild,
    required this.onNotices,
    required this.onLogout,
  });

  final ParentChild child;
  final List<ParentChild> siblings;
  final int selectedIndex;
  final ValueChanged<int> onSelectChild;
  final VoidCallback onNotices;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primary, AppColors.primaryMid],
        ),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
      ),
      child: Stack(
        children: [
          // A soft crest of light in the corner — decoration, nothing more.
          Positioned(
            right: -40,
            top: -30,
            child: Container(
              width: 180,
              height: 180,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withValues(alpha: 0.06),
              ),
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(20, top + 14, 14, 52),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _greeting(),
                        style: const TextStyle(
                          color: AppColors.accentSoft,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ),
                    _RoundAction(
                      icon: Icons.notifications_none_rounded,
                      tooltip: "Notices",
                      onTap: onNotices,
                    ),
                    const SizedBox(width: 8),
                    _RoundAction(
                      icon: Icons.logout_rounded,
                      tooltip: "Sign out",
                      onTap: onLogout,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(2.5),
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.accentSoft,
                      ),
                      child: _ChildAvatar(child: child, radius: 27),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            child.fullName,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                              letterSpacing: -0.2,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            child.classLabel,
                            style: const TextStyle(
                              color: Color(0xFFC3CBDD),
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                if (siblings.length > 1) ...[
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 36,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: siblings.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (context, i) => _ChildChip(
                        child: siblings[i],
                        selected: i == selectedIndex,
                        onTap: () => onSelectChild(i),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A translucent round button on the header.
class _RoundAction extends StatelessWidget {
  const _RoundAction({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.white.withValues(alpha: 0.12),
        shape: const CircleBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: 40,
            height: 40,
            child: Icon(icon, color: Colors.white, size: 21),
          ),
        ),
      ),
    );
  }
}

/// One child in the sibling switcher — a pill that reads as "who am I
/// looking at", gold when chosen.
class _ChildChip extends StatelessWidget {
  const _ChildChip({
    required this.child,
    required this.selected,
    required this.onTap,
  });

  final ParentChild child;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final first = child.fullName.split(" ").first;
    // Selection slides the gold fill from chip to chip instead of snapping.
    return AnimatedContainer(
      duration: AppMotion.fast,
      curve: AppMotion.enter,
      decoration: BoxDecoration(
        color: selected
            ? AppColors.accentSoft
            : Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(18),
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(6, 4, 14, 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedContainer(
                  duration: AppMotion.fast,
                  width: 26,
                  height: 26,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: selected ? AppColors.primary : Colors.white24,
                  ),
                  child: AnimatedDefaultTextStyle(
                    duration: AppMotion.fast,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: selected ? AppColors.accentSoft : Colors.white,
                    ),
                    child: Text(child.initials),
                  ),
                ),
                const SizedBox(width: 8),
                AnimatedDefaultTextStyle(
                  duration: AppMotion.fast,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: selected ? AppColors.primary : Colors.white,
                  ),
                  child: Text(
                    "$first · ${child.classLabel.split(' · ').first}",
                  ),
                ),
              ],
            ),
          ),
        ),
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

class _StatsRow extends StatelessWidget {
  const _StatsRow({
    super.key,
    required this.child,
    required this.attendance,
    required this.homework,
    required this.onOpen,
  });

  final ParentChild child;
  final AttendanceHistory? attendance;
  final HomeworkFeed? homework;
  final void Function(String module) onOpen;

  @override
  Widget build(BuildContext context) {
    final attendanceValue = attendanceTileValue(attendance);
    final homeworkValue = homeworkTileValue(homework, DateTime.now());
    final feesClear = child.openBalancePaise <= 0;
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            icon: Icons.payments_outlined,
            tone: feesClear ? ModuleTone.green : ModuleTone.amber,
            label: "Fees due",
            value: child.openBalanceLabel,
            valueColor: feesClear ? AppColors.success : AppColors.warning,
            onTap: () => onOpen("Fees"),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            icon: Icons.fact_check_outlined,
            tone: ModuleTone.teal,
            label: "Attendance",
            value: attendanceValue,
            valueColor: attendanceValue == "—"
                ? AppColors.muted
                : AppColors.ink,
            onTap: () => onOpen("Attendance"),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _StatCard(
            icon: Icons.menu_book_outlined,
            tone: ModuleTone.purple,
            label: "Homework",
            value: homeworkValue,
            valueColor: homeworkValue == "—" ? AppColors.muted : AppColors.ink,
            onTap: () => onOpen("Homework"),
          ),
        ),
      ],
    );
  }
}

/// Soft, lifted surface used by the stat cards and the module tiles.
BoxDecoration _liftedSurface({double radius = 18}) => BoxDecoration(
  color: Colors.white,
  borderRadius: BorderRadius.circular(radius),
  boxShadow: [
    BoxShadow(
      color: AppColors.primary.withValues(alpha: 0.08),
      blurRadius: 18,
      offset: const Offset(0, 8),
    ),
  ],
);

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.tone,
    required this.label,
    required this.value,
    required this.valueColor,
    required this.onTap,
  });

  final IconData icon;
  final ModuleTone tone;
  final String label;
  final String value;
  final Color valueColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: _liftedSurface(),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 10, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: tone.background,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 17, color: tone.foreground),
                ),
                const SizedBox(height: 10),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    value,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: valueColor,
                      letterSpacing: -0.3,
                    ),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
              ],
            ),
          ),
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
        fontSize: 15,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
        letterSpacing: -0.2,
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
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 0.86,
      children: [
        for (final m in _modules)
          Container(
            decoration: _liftedSurface(radius: 16),
            clipBehavior: Clip.antiAlias,
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => onTap(m.label),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(4, 12, 4, 8),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          color: m.tone.background,
                          borderRadius: BorderRadius.circular(13),
                        ),
                        child: Icon(m.icon, color: m.tone.foreground, size: 22),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        m.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// A row card with a tonal icon — the ID card and the like.
class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.tone,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final ModuleTone tone;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: _liftedSurface(),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: ListTile(
          onTap: onTap,
          leading: Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: tone.background,
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(icon, color: tone.foreground, size: 22),
          ),
          title: Text(
            title,
            style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
          ),
          subtitle: Text(
            subtitle,
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
          trailing: const Icon(Icons.chevron_right, color: AppColors.muted),
        ),
      ),
    );
  }
}

class _WhatsAppCard extends StatelessWidget {
  const _WhatsAppCard({required this.contact, required this.onOpen});

  final SchoolWhatsApp contact;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: _liftedSurface(),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: ListTile(
          onTap: onOpen,
          leading: Container(
            width: 40,
            height: 40,
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              // WhatsApp's own brand green, so the card reads as WhatsApp at
              // a glance; the glyph is the official mark in white.
              color: const Color(0xFF25D366),
              borderRadius: BorderRadius.circular(12),
            ),
            child: SvgPicture.asset("assets/icons/whatsapp.svg"),
          ),
          title: const Text(
            "Chat with the school on WhatsApp",
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
          subtitle: Text(
            "${contact.display} · dues, receipts, pay by UPI, or ask for a "
            "person. Message from the mobile registered with the school.",
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
          trailing: const Icon(
            Icons.open_in_new,
            color: AppColors.muted,
            size: 18,
          ),
        ),
      ),
    );
  }
}

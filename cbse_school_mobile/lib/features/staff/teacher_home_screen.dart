import "package:flutter/material.dart";

import "class_gallery_screen.dart";
import "../../core/popups/app_popups.dart";
import "../../core/ui/running_strip.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/api/api_client.dart";
import "../../core/ui/stale_banner.dart";
import "../../core/theme/app_theme.dart";
import "../modules/chat_inbox_screen.dart";
import "../modules/school_chat_screen.dart";
import "../modules/homework_screen.dart";
import "../modules/notice_detail_screen.dart";
import "../modules/notices_screen.dart";
import "../modules/bus_routes_screen.dart";
import "../modules/syllabus_scan_screen.dart";
import "../modules/teaching_screen.dart";
import "attendance_screen.dart";
import "broadcast_screen.dart";
import "class_message_screen.dart";
import "bus_register_screen.dart";
import "leave_approvals_screen.dart";
import "principal_lists.dart";
import "staff_roster_screen.dart";
import "transport_requests_screen.dart";
import "vehicle_logbook_screen.dart";
import "visitor_gate_screen.dart";
import "admission_leads_screen.dart";
import "command_bar.dart";
import "documents_screen.dart";
import "fee_counter_screen.dart";
import "fee_defaulters_screen.dart";
import "my_collections_screen.dart";
import "survey_day_screen.dart";
import "teacher_ai_tools_screen.dart";
import "marks_screen.dart";
import "payslips_screen.dart";
import "ptm_teacher_screen.dart";
import "my_subjects_screen.dart";
import "home_groups.dart";
import "my_attendance_calendar_screen.dart";
import "my_advances_screen.dart";
import "my_profile_screen.dart";
import "my_class_screen.dart";
import "month_register_screen.dart";
import "section_picker.dart";
import "self_attendance_screen.dart";
import "staff_complaints_screen.dart";
import "staff_leave_screen.dart";
import "student_leave_queue_screen.dart";
import "students_screen.dart";
import "timetable_screen.dart";
import "online_classes_teacher_screen.dart";
import "waiting_card.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/push/notification_bell.dart";

String _greeting() {
  final h = DateTime.now().hour;
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

class _StaffModule {
  const _StaffModule(this.label, this.icon, this.tone, this.feature);

  final String label;
  final IconData icon;
  final ModuleTone tone;

  /// Mobile feature id from the ERP (Masters → Roles → Mobile app). The tile
  /// only appears when the server says this person has it.
  final String feature;
}

const _staffModules = [
  _StaffModule(
    "Attendance",
    Icons.fact_check_outlined,
    ModuleTone.teal,
    "attendance_mark",
  ),
  _StaffModule(
    "Month register",
    Icons.calendar_view_month_outlined,
    ModuleTone.teal,
    "attendance_mark",
  ),
  _StaffModule(
    "Period log",
    Icons.bookmark_added_outlined,
    ModuleTone.green,
    "period_log",
  ),
  _StaffModule(
    "Homework",
    Icons.menu_book_outlined,
    ModuleTone.purple,
    "homework_post",
  ),
  _StaffModule(
    "Marks",
    Icons.grading_outlined,
    ModuleTone.amber,
    "marks_entry",
  ),
  _StaffModule(
    "Timetable",
    Icons.calendar_view_week_outlined,
    ModuleTone.blue,
    "timetable_view",
  ),
  _StaffModule(
    "Online classes",
    Icons.videocam_outlined,
    ModuleTone.blue,
    "online_class_host",
  ),
  _StaffModule(
    "Students",
    Icons.school_outlined,
    ModuleTone.green,
    "students_view",
  ),
  // The class teacher's own children: call the family, fill the UDISE+
  // class sheet. Same grant as the roster; the server refuses anyone who is
  // not a class teacher (or the office) with its own words.
  _StaffModule(
    "My class",
    Icons.diversity_3_outlined,
    ModuleTone.purple,
    "students_view",
  ),
  _StaffModule(
    "Leave requests",
    Icons.event_busy_outlined,
    ModuleTone.blue,
    "student_leave_decide",
  ),
  _StaffModule(
    "Complaints",
    Icons.report_problem_outlined,
    ModuleTone.coral,
    "complaints_handle",
  ),
  _StaffModule("PTM", Icons.groups_outlined, ModuleTone.purple, "ptm_meet"),
  // My own sections' families (not the principal's school-wide Broadcast).
  _StaffModule(
    "Message my classes",
    Icons.forum_outlined,
    ModuleTone.coral,
    "class_broadcast",
  ),
  _StaffModule(
    "Class gallery",
    Icons.photo_library_outlined,
    ModuleTone.pink,
    "class_gallery",
  ),
  _StaffModule(
    "My subjects",
    Icons.library_books_outlined,
    ModuleTone.blue,
    "subject_requests",
  ),
  _StaffModule(
    "Documents",
    Icons.folder_open_outlined,
    ModuleTone.teal,
    "documents_verify",
  ),
  _StaffModule(
    "Collect fees",
    Icons.point_of_sale_outlined,
    ModuleTone.green,
    "fee_take",
  ),
  _StaffModule(
    "Defaulters",
    Icons.currency_rupee,
    ModuleTone.coral,
    "fee_defaulters",
  ),
  _StaffModule(
    "My collections",
    Icons.account_balance_wallet_outlined,
    ModuleTone.teal,
    "fee_collections",
  ),
  _StaffModule(
    "Admission leads",
    Icons.how_to_reg_outlined,
    ModuleTone.blue,
    "admission_leads",
  ),
  _StaffModule(
    "Field survey",
    Icons.map_outlined,
    ModuleTone.amber,
    "field_survey",
  ),
  _StaffModule(
    "Scan syllabus",
    Icons.document_scanner_outlined,
    ModuleTone.blue,
    "syllabus_scan",
  ),
  // The web ERP's teacher AI helpers (answer-sheet marks, question paper,
  // worksheet, lesson plan, PTM brief); the server grants it to anyone with
  // marks entry, the period log or PTM meetings.
  _StaffModule(
    "AI tools",
    Icons.auto_awesome_outlined,
    ModuleTone.amber,
    "teacher_ai_tools",
  ),
  // Office and leadership grants a teacher may also hold (a co-ordinator,
  // the gate duty, the transport in-charge). They had no tile here, so a
  // grant made in Masters → Roles never reached a teacher's phone.
  _StaffModule(
    "Broadcast",
    Icons.campaign_outlined,
    ModuleTone.coral,
    "broadcast",
  ),
  _StaffModule(
    "Staff leave",
    Icons.event_busy_outlined,
    ModuleTone.amber,
    "staff_leave_approve",
  ),
  _StaffModule(
    "Staff today",
    Icons.badge_outlined,
    ModuleTone.teal,
    "school_snapshot",
  ),
  _StaffModule(
    "Staff contacts",
    Icons.contact_phone_outlined,
    ModuleTone.green,
    "staff_roster",
  ),
  _StaffModule(
    "Visitor gate",
    Icons.meeting_room_outlined,
    ModuleTone.purple,
    "visitor_gate",
  ),
  // Gate passes live on the visitor-gate screen; this tile is for someone
  // who may release children but does not keep the visitor register.
  _StaffModule(
    "Gate passes",
    Icons.directions_walk_outlined,
    ModuleTone.purple,
    "gate_pass_release",
  ),
  _StaffModule(
    "Transport",
    Icons.directions_bus_outlined,
    ModuleTone.blue,
    "route_manifest",
  ),
  // The transport in-charge's crew tools — the same register and log book
  // the drivers fill, every bus for whoever the server lets see the fleet.
  _StaffModule(
    "Bus register",
    Icons.fact_check_outlined,
    ModuleTone.blue,
    "route_manifest",
  ),
  _StaffModule(
    "Log book",
    Icons.local_gas_station_outlined,
    ModuleTone.amber,
    "route_manifest",
  ),
  _StaffModule(
    "Transport requests",
    Icons.alt_route_outlined,
    ModuleTone.pink,
    "transport_requests",
  ),
  _StaffModule("Notices", Icons.campaign_outlined, ModuleTone.pink, "notices"),
  _StaffModule("My leave", Icons.event_outlined, ModuleTone.coral, "my_leave"),
  _StaffModule(
    "Payslips",
    Icons.receipt_long_outlined,
    ModuleTone.gray,
    "my_payslips",
  ),
  // Everyone's own records — not grants, so always shown.
  _StaffModule(
    "My advances",
    Icons.account_balance_wallet_outlined,
    ModuleTone.amber,
    "my_advances",
  ),
  _StaffModule(
    "My attendance",
    Icons.calendar_month_outlined,
    ModuleTone.teal,
    "my_attendance",
  ),
  _StaffModule(
    "My profile",
    Icons.badge_outlined,
    ModuleTone.teal,
    "my_profile",
  ),
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

  /// Set when the server could not be reached and the home is showing the
  /// copy saved at this time (data-layer 4.4) — the banner says so.
  DateTime? _staleSince;
  final _clock = RefreshClock();
  bool _featuresFresh = false;
  late final _resume = ResumeWatcher(_onResume);
  String? _pendingRoute;
  int _refresh = 0;
  StaffFeatureSet _features = const StaffFeatureSet.empty();

  @override
  void initState() {
    super.initState();
    // The school's pop-up for staff, if any — once per app open (core/popups).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) AppPopups.maybeShow(context, widget.api);
    });
    _pendingRoute = widget.openRoute;
    _resume.attach();
    _load(first: true);
  }

  @override
  void dispose() {
    _resume.detach();
    super.dispose();
  }

  /// Back in front after 2 minutes or more: re-read the summary and tiles,
  /// so a Masters change (classes, features) shows without a restart.
  void _onResume() {
    if (mounted && _clock.isStale) _load();
  }

  /// Pull-to-refresh also re-reads the waiting counts.
  Future<void> _pullRefresh() async {
    setState(() => _refresh += 1);
    await _load();
  }

  @override
  void didUpdateWidget(covariant TeacherHomeScreen old) {
    super.didUpdateWidget(old);
    if (widget.openRoute != null && widget.openRoute != old.openRoute) {
      _pendingRoute = widget.openRoute;
      if (_summary != null) _consumePendingRoute();
    }
  }

  /// An item's link from the notifications list.
  void _openRoute(String route) {
    _pendingRoute = route;
    _consumePendingRoute();
  }

  void _consumePendingRoute() {
    final raw = _pendingRoute;
    _pendingRoute = null;
    if (raw == null || _summary == null) return;
    final uri = Uri.tryParse(raw);
    if (uri == null) return;
    switch (uri.path) {
      case "/notifications":
        openNotifications(context, widget.api, _openRoute);
      case "/chat":
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ChatInboxScreen(api: widget.api)),
        );
      case "/school-chat":
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => staffSchoolChat(widget.api)),
        );
      case "/notices":
        // A tapped broadcast opens in full; otherwise the notices list.
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => noticesScreenForRoute(widget.api, uri),
          ),
        );
      case "/homework":
        _openModule("Homework");
      case "/attendance":
        _openModule("Attendance");
      case "/timetable":
        _openModule("Timetable");
      case "/leave":
        _openModule("My leave");
      case "/student-leave":
        _openModule("Leave requests");
      case "/complaints":
        _openModule("Complaints");
      case "/ptm":
        _openModule("PTM");
      case "/documents":
        _openModule("Documents");
      case "/marks":
        _openModule("Marks");
      case "/payslips":
        _openModule("Payslips");
      case "/profile":
        _openModule("My profile");
      case "/my-attendance":
        _pushScreen(
          MyAttendanceCalendarScreen(
            api: widget.api,
            initialMonth: uri.queryParameters["month"],
          ),
        );
    }
  }

  void _openWaiting(String kind) {
    switch (kind) {
      case "student_leave":
        _openModule("Leave requests");
      case "complaints":
        _openModule("Complaints");
      case "documents":
        _openModule("Documents");
    }
  }

  Future<void> _pushScreen(Widget screen) async {
    final changed = await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => screen));
    // The waiting counts are re-read only when that screen decided something.
    if (mounted && changed == true) setState(() => _refresh += 1);
  }

  /// [first]: the app just opened this home — paint the saved copy at once.
  Future<void> _load({bool first = false}) async {
    setState(() => _error = null);
    var ok = false;
    if (first) {
      // Last session's tiles with last session's summary — never over a
      // fresh answer.
      widget.api.cachedStaffFeatures().then((c) {
        if (c != null && mounted && !_featuresFresh) {
          setState(() => _features = c.value);
        }
      });
    }
    await loadCachedThenFresh<StaffSummary>(
      peek: first ? widget.api.cachedStaffSummary : () async => null,
      fetch: widget.api.fetchStaffSummary,
      onCached: (c) {
        if (mounted) setState(() => _summary = c.value);
      },
      onFresh: (summary) {
        ok = true;
        _clock.markFresh();
        if (mounted) {
          setState(() {
            _summary = summary;
            _staleSince = null;
          });
        }
      },
      onError: (e, since) {
        if (!mounted) return;
        setState(() {
          if (_summary != null) {
            // Keep what is on screen and say how old it is.
            _staleSince = since ?? _clock.lastFresh ?? DateTime.now();
          } else {
            _error = e is ApiException
                ? e.message
                : "Could not reach the school server.";
          }
        });
      },
    );
    if (_summary == null) return;
    // Tiles come from the ERP, so switching a feature off there removes it
    // from the phone on the next open (or resume after 2 minutes).
    if (ok) {
      try {
        final f = await widget.api.fetchStaffFeatures();
        _featuresFresh = true;
        if (mounted) setState(() => _features = f);
      } catch (_) {
        /* keep whatever we had */
      }
    }
    if (_pendingRoute != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _consumePendingRoute();
      });
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
      case "Month register":
        await _pushScreen(MonthRegisterScreen(api: widget.api));
      case "My class":
        await _pushScreen(MyClassScreen(api: widget.api));
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
        await _pushScreen(
          MarksScreen(
            api: widget.api,
            classes: summary.classes,
            canScan: _features.has("teacher_ai_tools"),
          ),
        );
      case "AI tools":
        await _pushScreen(
          TeacherAiToolsScreen(
            api: widget.api,
            features: _features,
            classes: summary.classes,
          ),
        );
      case "My leave":
        await _pushScreen(StaffLeaveScreen(api: widget.api));
      case "Timetable":
        await _pushScreen(TimetableScreen(api: widget.api));
      case "Online classes":
        await _pushScreen(OnlineClassesTeacherScreen(api: widget.api));
      case "Payslips":
        await _pushScreen(PayslipsScreen(api: widget.api));
      case "My advances":
        await _pushScreen(MyAdvancesScreen(api: widget.api));
      case "My attendance":
        await _pushScreen(MyAttendanceCalendarScreen(api: widget.api));
      case "Leave requests":
        await _pushScreen(StudentLeaveQueueScreen(api: widget.api));
      case "Complaints":
        await _pushScreen(StaffComplaintsScreen(api: widget.api));
      case "PTM":
        await _pushScreen(
          PtmTeacherScreen(
            api: widget.api,
            canBrief: _features.has("teacher_ai_tools"),
          ),
        );
      case "Message my classes":
        await _pushScreen(ClassMessageScreen(api: widget.api));
      case "Class gallery":
        await _pushScreen(ClassGalleryScreen(api: widget.api));
      case "My subjects":
        await _pushScreen(MySubjectsScreen(api: widget.api));
      case "Documents":
        await _pushScreen(DocumentsScreen(api: widget.api));
      case "Collect fees":
        await _pushScreen(FeeCounterScreen(api: widget.api));
      case "Defaulters":
        await _pushScreen(
          FeeDefaultersScreen(
            api: widget.api,
            canCollect: _features.has("fee_take"),
          ),
        );
      case "My collections":
        await _pushScreen(MyCollectionsScreen(api: widget.api));
      case "Admission leads":
        await _pushScreen(AdmissionLeadsScreen(api: widget.api));
      case "Field survey":
        await _pushScreen(SurveyDayScreen(api: widget.api));
      case "Broadcast":
        await _pushScreen(BroadcastScreen(api: widget.api));
      case "Staff leave":
        await _pushScreen(LeaveApprovalsScreen(api: widget.api));
      case "Staff today":
        await _pushScreen(StaffAttendanceTodayScreen(api: widget.api));
      case "Staff contacts":
        await _pushScreen(StaffRosterScreen(api: widget.api));
      case "Visitor gate":
      case "Gate passes":
        await _pushScreen(VisitorGateScreen(api: widget.api));
      case "Transport":
        await _pushScreen(BusRoutesScreen(api: widget.api));
      case "Bus register":
        await _pushScreen(BusRegisterScreen(api: widget.api));
      case "Log book":
        await _pushScreen(VehicleLogbookScreen(api: widget.api));
      case "Transport requests":
        await _pushScreen(TransportRequestsScreen(api: widget.api));
      case "My profile":
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) =>
                MyProfileScreen(api: widget.api, onSignOut: _signOut),
          ),
        );
        // A new photo shows in the header straight away.
        if (mounted) _load();
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
                        child: Text(context.l10n.retry),
                      ),
                      TextButton(
                        onPressed: _signOut,
                        child: Text(context.l10n.signOut),
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
        onRefresh: _pullRefresh,
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
                40,
              ),
              child: Row(
                children: [
                  StaffAvatar(
                    key: ValueKey(summary.photoUrl),
                    api: widget.api,
                    name: summary.fullName,
                    photoUrl: summary.photoUrl,
                    onTap: () => _openModule("My profile"),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _greeting(),
                          style: AppText.bodySmall.copyWith(
                            color: AppColors.accentSoft,
                          ),
                        ),
                        Text(
                          summary.fullName,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.titleMedium.copyWith(
                            color: Colors.white,
                          ),
                        ),
                        Text(
                          ct == null
                              ? "Staff"
                              : "Class teacher · ${ct.className} ${ct.sectionName}",
                          style: AppText.bodySmall.copyWith(
                            color: Color(0xFFB8C0D4),
                          ),
                        ),
                      ],
                    ),
                  ),
                  NotificationBellButton(
                    api: widget.api,
                    onOpenRoute: _openRoute,
                  ),
                  const ScreenGuideButton(
                    guideId: "teacher-home",
                    screenLabel: "Home",
                  ),
                  IconButton(
                    tooltip: context.l10n.signOut,
                    onPressed: _signOut,
                    icon: const Icon(Icons.logout, color: Colors.white),
                  ),
                ],
              ),
            ),
            StaleBanner(since: _staleSince, onRetry: _load, bottomGap: 28),
            // Notices and news scrolling across, as on the web ERP.
            RunningStrip(
              api: widget.api,
              onOpen: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => NoticesScreen(api: widget.api),
                ),
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
                    label: ct == null
                        ? null
                        : "${ct.className} ${ct.sectionName}",
                  ),
                ),
              ),
            ),
            // A class teacher's own class, one tap from the banner.
            if (ct != null &&
                (_features.has("students_view") ||
                    _features.has("attendance_mark")))
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Transform.translate(
                  offset: const Offset(0, -12),
                  child: Row(
                    children: [
                      if (_features.has("students_view"))
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _openModule("My class"),
                            icon: const Icon(
                              Icons.diversity_3_outlined,
                              size: 18,
                            ),
                            label: const Text(
                              "My class · मेरी कक्षा",
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                      if (_features.has("students_view") &&
                          _features.has("attendance_mark"))
                        const SizedBox(width: 8),
                      if (_features.has("attendance_mark"))
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _openModule("Month register"),
                            icon: const Icon(
                              Icons.calendar_view_month_outlined,
                              size: 18,
                            ),
                            label: const Text(
                              "Month register",
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  StaffCommandBar(
                    api: widget.api,
                    suggestions: [
                      if (ct != null)
                        "${ct.className}${ct.sectionName} absent today",
                      "COMMANDS",
                    ],
                  ),
                  Card(
                    margin: const EdgeInsets.only(bottom: 16),
                    child: ListTile(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => SelfAttendanceScreen(api: widget.api),
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
                      title: Text(
                        context.l10n.myAttendance,
                        style: AppText.bodyMediumInk.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      subtitle: Text(
                        context.l10n.gpsPunchInOutFromCampus,
                        style: AppText.labelMediumMuted,
                      ),
                      // The punch stays the tap; the month calendar is
                      // its own button beside it.
                      trailing: IconButton(
                        tooltip: "My month · मेरा महीना",
                        onPressed: () => _openModule("My attendance"),
                        icon: Icon(
                          Icons.calendar_month_outlined,
                          color: ModuleTone.teal.foreground,
                        ),
                      ),
                    ),
                  ),
                  Text(
                    context.l10n.todaySPeriods,
                    style: AppText.bodyLargeInk.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (summary.periodsToday.isEmpty)
                    Card(
                      child: Padding(
                        padding: EdgeInsets.all(14),
                        child: Text(
                          context.l10n.noPeriodsForYouTodayOn,
                          style: AppText.bodySmallMuted,
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
                                padding: const EdgeInsets.symmetric(
                                  vertical: 8,
                                ),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        "${p.periodNo} · ${p.subjectName.isEmpty ? "Period" : p.subjectName} — ${p.className} ${p.sectionName}",
                                        style: AppText.bodySmallInk,
                                      ),
                                    ),
                                    Text(
                                      p.startTime,
                                      style: AppText.bodySmallMuted,
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 12),
                  WaitingCard(
                    api: widget.api,
                    onOpen: _openWaiting,
                    refreshKey: _refresh,
                  ),
                  const SizedBox(height: 8),
                  // Tiles under their headings (Teaching, Students, Fees…)
                  // in the ERP's order; empty headings are left out.
                  for (final (group, modules) in groupStaffTiles(
                    _staffModules.where(
                      (m) =>
                          (kAlwaysShownStaffFeatures.contains(m.feature) ||
                              _features.has(m.feature)) &&
                          // One gate tile: the visitor gate already shows
                          // the passes.
                          !(m.feature == "gate_pass_release" &&
                              _features.has("visitor_gate")) &&
                          // My class is the class teacher's own children;
                          // a subject teacher would only be refused.
                          (m.label != "My class" || ct != null),
                    ),
                    (m) => staffGroupOf(_features, m.feature),
                    order: _features.groupOrder,
                  )) ...[
                    StaffGroupHeading(group),
                    GridView.count(
                      crossAxisCount: 4,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 8,
                      childAspectRatio: 0.82,
                      children: [
                        for (final m in modules)
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
                                  style: AppText.labelMediumInk,
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ],
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
                MaterialPageRoute(
                  builder: (_) => staffSchoolChat(widget.api),
                ),
              );
            case 3:
              _openModule("My profile");
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
                      style: AppText.bodyMedium.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: AppText.labelMedium.copyWith(
                        color: Color(0xFFE8ECE4),
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

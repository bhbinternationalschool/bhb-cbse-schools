import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// The headings the staff homes sort their tiles under (director, 13 Oct
/// 2026: "put actions in their grouping"). The ERP sends the group of each
/// feature with /api/v1/staff/features; this file is the fallback for an
/// older server and the home for tiles that carry no feature of their own.

/// Mirror of the server's GROUP_ORDER (api/v1/staff/features/route.ts).
const kStaffGroupOrder = <String>[
  "Teaching",
  "Students",
  "Fees",
  "Admissions",
  "Leadership",
  "Gate",
  "Transport",
  "Self service",
];

/// Hindi for each heading — the desk home shows both.
const kStaffGroupHindi = <String, String>{
  "Teaching": "पढ़ाई",
  "Students": "छात्र",
  "Fees": "फीस",
  "Admissions": "प्रवेश",
  "Leadership": "प्रबंधन",
  "Gate": "गेट",
  "Transport": "परिवहन",
  "Self service": "मेरा काम",
};

/// Mirror of apps/web/src/lib/mobileFeatures.ts (each feature's `group`)
/// plus the features the server injects, and the app-only "my_profile".
const kLocalFeatureGroups = <String, String>{
  "fee_take": "Fees",
  "fee_defaulters": "Fees",
  "fee_collections": "Fees",
  "admission_leads": "Admissions",
  "field_survey": "Admissions",
  "attendance_mark": "Teaching",
  "homework_post": "Teaching",
  "marks_entry": "Teaching",
  "timetable_view": "Teaching",
  "online_class_host": "Teaching",
  "period_log": "Teaching",
  "syllabus_scan": "Teaching",
  "subject_requests": "Teaching",
  "students_view": "Students",
  "student_leave_decide": "Students",
  "complaints_handle": "Students",
  "documents_verify": "Students",
  "student_notes": "Students",
  "ptm_meet": "Students",
  "class_gallery": "Students",
  "school_snapshot": "Leadership",
  "staff_leave_approve": "Leadership",
  "staff_roster": "Leadership",
  "broadcast": "Leadership",
  "transport_requests": "Leadership",
  "visitor_gate": "Gate",
  "gate_pass_release": "Gate",
  "route_manifest": "Transport",
  "gps_punch": "Self service",
  "my_leave": "Self service",
  "my_payslips": "Self service",
  "notices": "Self service",
  "messages": "Self service",
  "my_profile": "Self service",
};

/// The heading a feature's tile sits under: the server's word first, then
/// the local mirror, then "Self service".
String staffGroupOf(StaffFeatureSet f, String feature) =>
    f.groups[feature] ?? kLocalFeatureGroups[feature] ?? "Self service";

/// Tiles split under their headings, in the server's order (the local one
/// for an older server). Headings with no tile are left out; a heading the
/// order does not know goes last rather than vanishing with its tiles.
List<(String, List<T>)> groupStaffTiles<T>(
  Iterable<T> tiles,
  String Function(T tile) groupOf, {
  List<String> order = const [],
}) {
  final byGroup = <String, List<T>>{};
  for (final t in tiles) {
    byGroup.putIfAbsent(groupOf(t), () => []).add(t);
  }
  final known = order.isEmpty ? kStaffGroupOrder : order;
  return [
    for (final g in known)
      if (byGroup[g]?.isNotEmpty == true) (g, byGroup[g]!),
    for (final e in byGroup.entries)
      if (!known.contains(e.key)) (e.key, e.value),
  ];
}

/// A group heading over its grid of tiles.
class StaffGroupHeading extends StatelessWidget {
  const StaffGroupHeading(this.group, {super.key, this.bilingual = false});

  final String group;

  /// Always show the Hindi too (desk home); otherwise Hindi only when the
  /// app is in Hindi.
  final bool bilingual;

  @override
  Widget build(BuildContext context) {
    final hi = kStaffGroupHindi[group];
    final inHindi = Localizations.localeOf(context).languageCode == "hi";
    final text = hi == null
        ? group
        : bilingual
        ? "$group · $hi"
        : inHindi
        ? hi
        : group;
    return Padding(
      padding: const EdgeInsets.only(top: 14, bottom: 8),
      child: Text(
        text,
        style: AppText.bodyLargeInk.copyWith(fontWeight: FontWeight.w600),
      ),
    );
  }
}

/// The staff member's photo, or their initials when there is none (or it
/// does not load). ERP photos load with the session like other ERP images.
class StaffAvatar extends StatefulWidget {
  const StaffAvatar({
    super.key,
    required this.api,
    required this.name,
    required this.photoUrl,
    this.radius = 24,
    this.onTap,
  });

  final ApiClient api;
  final String name;

  /// Full URL or ERP path; "" for initials.
  final String photoUrl;
  final double radius;
  final VoidCallback? onTap;

  static String initials(String name) {
    final parts = name.split(" ").where((p) => p.isNotEmpty).take(2);
    final s = parts.map((p) => p[0].toUpperCase()).join();
    return s.isEmpty ? "S" : s;
  }

  @override
  State<StaffAvatar> createState() => _StaffAvatarState();
}

class _StaffAvatarState extends State<StaffAvatar> {
  // Once per avatar, so a rebuild of the home does not flash the initials.
  late final Future<Map<String, String>> _headers = widget.api.imageHeaders();

  @override
  Widget build(BuildContext context) {
    final radius = widget.radius;
    final onTap = widget.onTap;
    final fallback = CircleAvatar(
      radius: radius,
      backgroundColor: AppColors.accentSoft,
      child: Text(
        StaffAvatar.initials(widget.name),
        style: TextStyle(
          color: AppColors.primary,
          fontWeight: FontWeight.w600,
          fontSize: radius * 0.6,
        ),
      ),
    );
    final api = widget.api;
    final url = api.erpUrl(widget.photoUrl);
    final Widget avatar = url.isEmpty
        ? fallback
        : FutureBuilder<Map<String, String>>(
            future: _headers,
            builder: (context, snap) => snap.data == null
                ? fallback
                : ClipOval(
                    child: Image.network(
                      url,
                      headers: api.isOwnServer(url) ? snap.data : null,
                      width: radius * 2,
                      height: radius * 2,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => fallback,
                    ),
                  ),
          );
    if (onTap == null) return avatar;
    return Semantics(
      button: true,
      label: "My profile",
      child: GestureDetector(onTap: onTap, child: avatar),
    );
  }
}

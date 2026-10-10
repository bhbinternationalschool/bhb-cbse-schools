import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";

/// What each of my classes studies, and asking the office to change it.
///
/// A teacher cannot edit Masters — one subject list feeds the timetable,
/// homework, marks, report cards and UDISE — so every change here is a
/// request. The principal or office approves it in the web ERP (Masters →
/// Subjects) and only then does the class's list change (director, 10 Oct
/// 2026).
class MySubjectsScreen extends StatelessWidget {
  const MySubjectsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<_Data>(
      guideId: "my-subjects",
      title: "My subjects",
      load: () async => _Data.fromJson(await api.fetchSubjectRequests()),
      emptyIcon: Icons.library_books_outlined,
      emptyText:
          "No classes are given to you yet. The office adds them in Staff → Duties.",
      isEmpty: (d) => d.classes.isEmpty && d.requests.isEmpty,
      builder: (context, data, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: ModuleTone.blue.background,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text(
              "Something wrong in a class's subjects? Ask here. The office checks and approves it — nothing changes until then.",
              style: AppText.bodySmall.copyWith(
                color: ModuleTone.blue.foreground,
              ),
            ),
          ),
          const SizedBox(height: 12),
          for (final c in data.classes)
            _ClassCard(api: api, data: data, cls: c, reload: reload),
          if (data.requests.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(
              "My requests",
              style: AppText.bodyMediumInk.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            for (final r in data.requests)
              _RequestTile(api: api, r: r, reload: reload),
          ],
        ],
      ),
    );
  }
}

class _ClassCard extends StatelessWidget {
  const _ClassCard({
    required this.api,
    required this.data,
    required this.cls,
    required this.reload,
  });

  final ApiClient api;
  final _Data data;
  final _Class cls;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final waiting = data.requests
        .where((r) => r.status == "pending" && r.classId == cls.classId)
        .toList();
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ExpansionTile(
        shape: const Border(),
        title: Text(
          cls.className,
          style: AppText.titleSmall.copyWith(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          "${cls.subjects.length} subject${cls.subjects.length == 1 ? "" : "s"}"
          "${cls.isClassTeacher ? " · class teacher" : ""}"
          "${waiting.isNotEmpty ? " · ${waiting.length} waiting" : ""}",
          style: AppText.bodySmallMuted,
        ),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        children: [
          if (cls.subjects.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                "No subjects are set for this class yet.",
                style: AppText.bodySmallMuted,
              ),
            ),
          for (final s in cls.subjects)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.only(
                left: s.parentName.isEmpty ? 0 : 20,
              ),
              title: Text(s.name, style: AppText.bodyMedium),
              subtitle: Text(s.code, style: AppText.labelMediumMuted),
              trailing: IconButton(
                tooltip: "Ask to remove",
                icon: const Icon(
                  Icons.remove_circle_outline,
                  color: AppColors.muted,
                ),
                onPressed: () => _ask(
                  context,
                  change: "remove",
                  subjectId: s.id,
                  subjectName: s.name,
                ),
              ),
            ),
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: () => _askAdd(context),
              icon: const Icon(Icons.add),
              label: const Text("Ask to add a subject"),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _askAdd(BuildContext context) async {
    final have = cls.subjects.map((s) => s.id).toSet();
    final options = data.schoolSubjects
        .where((s) => !have.contains(s.id))
        .toList();
    final picked = await showModalBottomSheet<_Subject?>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (context, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: [
            Text(
              "Add to ${cls.className}",
              style: AppText.titleSmall.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              "Choose a school subject, or ask for a new one.",
              style: AppText.bodySmallMuted,
            ),
            ListTile(
              leading: const Icon(
                Icons.fiber_new_outlined,
                color: AppColors.primary,
              ),
              title: const Text("Not in the list — ask for a new subject"),
              onTap: () => Navigator.of(
                context,
              ).pop(const _Subject(id: "", code: "", name: "", parentName: "")),
            ),
            const Divider(),
            for (final s in options)
              ListTile(
                dense: true,
                title: Text(
                  s.parentName.isEmpty ? s.name : "${s.parentName} — ${s.name}",
                ),
                subtitle: Text(s.code),
                onTap: () => Navigator.of(context).pop(s),
              ),
          ],
        ),
      ),
    );
    if (picked == null || !context.mounted) return;
    if (picked.id.isEmpty) {
      await _ask(context, change: "new", subjectId: "", subjectName: "");
    } else {
      await _ask(
        context,
        change: "add",
        subjectId: picked.id,
        subjectName: picked.name,
      );
    }
  }

  Future<void> _ask(
    BuildContext context, {
    required String change,
    required String subjectId,
    required String subjectName,
  }) async {
    final name = TextEditingController(text: subjectName);
    final reason = TextEditingController();
    final title = change == "remove"
        ? "Remove $subjectName from ${cls.className}?"
        : change == "add"
        ? "Add $subjectName to ${cls.className}?"
        : "New subject for ${cls.className}";
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (change == "new")
              TextField(
                controller: name,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: "Subject name"),
              ),
            TextField(
              controller: reason,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: "Why? (helps the office decide)",
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text("Cancel"),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text("Send to office"),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await api.postSubjectRequest({
        "action": "file",
        "classId": cls.classId,
        "change": change,
        "subjectId": subjectId,
        "subjectName": change == "new" ? name.text.trim() : subjectName,
        "reason": reason.text.trim(),
      });
      Haptics.success();
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            "Sent to the office. You'll see the answer under My requests.",
          ),
        ),
      );
      await reload();
    } on ApiException catch (e) {
      Haptics.warning();
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }
}

class _RequestTile extends StatelessWidget {
  const _RequestTile({
    required this.api,
    required this.r,
    required this.reload,
  });

  final ApiClient api;
  final _Request r;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final (label, tone) = switch (r.status) {
      "approved" => ("Approved", ModuleTone.green),
      "rejected" => ("Declined", ModuleTone.coral),
      "withdrawn" => ("Withdrawn", ModuleTone.gray),
      _ => ("Waiting", ModuleTone.amber),
    };
    final what = r.action == "remove"
        ? "Remove"
        : r.action == "add"
        ? "Add"
        : "New";
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: ListTile(
        title: Text(
          "$what ${r.subjectName} · ${r.className}",
          style: AppText.bodyMedium,
        ),
        subtitle: Text(
          [
            if (r.reason.isNotEmpty) "“${r.reason}”",
            if (r.decisionNote.isNotEmpty) "Office: ${r.decisionNote}",
          ].join("\n"),
          style: AppText.bodySmallMuted,
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: tone.background,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                label,
                style: AppText.labelMediumMuted.copyWith(
                  color: tone.foreground,
                ),
              ),
            ),
            if (r.status == "pending")
              GestureDetector(
                onTap: () async {
                  try {
                    await api.postSubjectRequest({
                      "action": "withdraw",
                      "id": r.id,
                    });
                    await reload();
                  } on ApiException catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(
                        context,
                      ).showSnackBar(SnackBar(content: Text(e.message)));
                    }
                  }
                },
                child: Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    "Withdraw",
                    style: AppText.labelMediumMuted.copyWith(
                      color: AppColors.primary,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/* ── Data ─────────────────────────────────────────────────────────────── */

String _s(Object? v) => v?.toString() ?? "";

class _Subject {
  const _Subject({
    required this.id,
    required this.code,
    required this.name,
    required this.parentName,
  });
  factory _Subject.fromJson(Map<String, dynamic> j) => _Subject(
    id: _s(j["id"]),
    code: _s(j["code"]),
    name: _s(j["name"]),
    parentName: _s(j["parentName"]),
  );

  final String id;
  final String code;
  final String name;
  final String parentName;
}

class _Class {
  _Class.fromJson(Map<String, dynamic> j)
    : classId = _s(j["classId"]),
      className = _s(j["className"]),
      isClassTeacher = j["isClassTeacher"] == true,
      subjects = ((j["subjects"] as List?) ?? const [])
          .map((e) => _Subject.fromJson(e as Map<String, dynamic>))
          .toList();

  final String classId;
  final String className;
  final bool isClassTeacher;
  final List<_Subject> subjects;
}

class _Request {
  _Request.fromJson(Map<String, dynamic> j)
    : id = _s(j["id"]),
      classId = _s(j["classId"]),
      className = _s(j["className"]),
      action = _s(j["action"]),
      subjectName = _s(j["subjectName"]),
      reason = _s(j["reason"]),
      status = _s(j["status"]),
      decisionNote = _s(j["decisionNote"]);

  final String id;
  final String classId;
  final String className;
  final String action;
  final String subjectName;
  final String reason;
  final String status;
  final String decisionNote;
}

class _Data {
  _Data.fromJson(Map<String, dynamic> j)
    : classes = ((j["classes"] as List?) ?? const [])
          .map((e) => _Class.fromJson(e as Map<String, dynamic>))
          .toList(),
      schoolSubjects = ((j["schoolSubjects"] as List?) ?? const [])
          .map((e) => _Subject.fromJson(e as Map<String, dynamic>))
          .toList(),
      requests = ((j["requests"] as List?) ?? const [])
          .map((e) => _Request.fromJson(e as Map<String, dynamic>))
          .toList();

  final List<_Class> classes;
  final List<_Subject> schoolSubjects;
  final List<_Request> requests;
}

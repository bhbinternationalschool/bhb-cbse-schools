import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/dictate_field.dart";

/// Actions on one student from the roster: a discipline note (merit or
/// demerit) or a sick-room visit. Both land on the desk's discipline /
/// health modules and can push the parent.
Future<void> showStudentNoteSheet(
  BuildContext context, {
  required ApiClient api,
  required RosterStudent student,
  required String classLabel,
}) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              student.fullName,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            Text(
              classLabel,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 12),
            ListTile(
              leading: Icon(
                Icons.star_outline,
                color: ModuleTone.green.foreground,
              ),
              title: const Text("Merit / good conduct"),
              onTap: () {
                Navigator.pop(context);
                _openDiscipline(
                  context,
                  api: api,
                  student: student,
                  merit: true,
                );
              },
            ),
            ListTile(
              leading: Icon(
                Icons.flag_outlined,
                color: ModuleTone.coral.foreground,
              ),
              title: const Text("Discipline note"),
              onTap: () {
                Navigator.pop(context);
                _openDiscipline(
                  context,
                  api: api,
                  student: student,
                  merit: false,
                );
              },
            ),
            ListTile(
              leading: Icon(
                Icons.medical_services_outlined,
                color: ModuleTone.pink.foreground,
              ),
              title: const Text("Sick room / first aid"),
              onTap: () {
                Navigator.pop(context);
                _openHealth(context, api: api, student: student);
              },
            ),
          ],
        ),
      ),
    ),
  );
}

Future<void> _openDiscipline(
  BuildContext context, {
  required ApiClient api,
  required RosterStudent student,
  required bool merit,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _DisciplineSheet(api: api, student: student, merit: merit),
  );
}

Future<void> _openHealth(
  BuildContext context, {
  required ApiClient api,
  required RosterStudent student,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (_) => _HealthSheet(api: api, student: student),
  );
}

class _DisciplineSheet extends StatefulWidget {
  const _DisciplineSheet({
    required this.api,
    required this.student,
    required this.merit,
  });

  final ApiClient api;
  final RosterStudent student;
  final bool merit;

  @override
  State<_DisciplineSheet> createState() => _DisciplineSheetState();
}

class _DisciplineSheetState extends State<_DisciplineSheet> {
  List<CatalogItem>? _categories;
  String _category = "other";
  int _points = 1;
  bool _notify = false;
  bool _busy = false;
  final _desc = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.api
        .fetchDiscipline(studentId: widget.student.id)
        .then((d) {
          if (mounted) {
            setState(() {
              _categories = d.categories;
              if (widget.merit) _category = "other";
            });
          }
        })
        .catchError((_) {
          if (mounted) setState(() => _categories = const []);
        });
  }

  Future<void> _save() async {
    if (_desc.text.trim().length < 5) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text("Describe what happened.")));
      return;
    }
    setState(() => _busy = true);
    try {
      final level = await widget.api.recordIncident(
        studentId: widget.student.id,
        date: DateTime.now().toIso8601String().substring(0, 10),
        category: _category,
        pointsDelta: widget.merit ? _points : -_points,
        description: _desc.text.trim(),
        notifyParent: _notify,
      );
      Haptics.success();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            widget.merit
                ? "Merit recorded."
                : "Recorded${level.isNotEmpty && level != "None" ? " · $level" : ""}.",
          ),
        ),
      );
      Navigator.pop(context);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cats = _categories;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        16,
        20,
        MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.merit
                  ? "Merit · ${widget.student.fullName}"
                  : "Discipline note · ${widget.student.fullName}",
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 10),
            if (cats == null)
              const LinearProgressIndicator(minHeight: 2)
            else
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  for (final c in cats)
                    ChoiceChip(
                      label: Text(
                        c.label,
                        style: const TextStyle(fontSize: 12),
                      ),
                      selected: _category == c.value,
                      onSelected: (_) => setState(() => _category = c.value),
                    ),
                ],
              ),
            const SizedBox(height: 10),
            Row(
              children: [
                Text(
                  widget.merit ? "Points" : "Demerit points",
                  style: const TextStyle(fontSize: 13, color: AppColors.ink),
                ),
                const Spacer(),
                for (final p in const [1, 2, 3, 5])
                  Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: ChoiceChip(
                      label: Text("$p"),
                      selected: _points == p,
                      onSelected: (_) => setState(() => _points = p),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            DictateField(
              label: "What happened",
              controller: _desc,
              hint: widget.merit
                  ? "e.g. helped a classmate, led the assembly"
                  : "Brief, factual — the office and parent may read it",
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text(
                "Tell the parent now (app notification)",
                style: TextStyle(fontSize: 13),
              ),
              value: _notify,
              onChanged: (v) => setState(() => _notify = v),
            ),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: Text(_busy ? "Saving…" : "Save"),
            ),
          ],
        ),
      ),
    );
  }
}

class _HealthSheet extends StatefulWidget {
  const _HealthSheet({required this.api, required this.student});

  final ApiClient api;
  final RosterStudent student;

  @override
  State<_HealthSheet> createState() => _HealthSheetState();
}

class _HealthSheetState extends State<_HealthSheet> {
  List<CatalogItem>? _reasons;
  String _reason = "illness";
  bool _referred = false;
  bool _notify = true;
  bool _busy = false;
  final _symptoms = TextEditingController();
  final _action = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.api
        .fetchHealthVisits(studentId: widget.student.id)
        .then((d) {
          if (mounted) setState(() => _reasons = d.reasons);
        })
        .catchError((_) {
          if (mounted) setState(() => _reasons = const []);
        });
  }

  Future<void> _save() async {
    if (_symptoms.text.trim().length < 3) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Say what the child reported.")),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final notified = await widget.api.recordHealthVisit(
        studentId: widget.student.id,
        reason: _reason,
        symptoms: _symptoms.text.trim(),
        actionTaken: _action.text.trim(),
        referredToHospital: _referred,
        notifyParent: _notify,
      );
      Haptics.success();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            notified ? "Recorded and the parent has been told." : "Recorded.",
          ),
        ),
      );
      Navigator.pop(context);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final reasons = _reasons;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        16,
        20,
        MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              "Sick room · ${widget.student.fullName}",
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 10),
            if (reasons == null)
              const LinearProgressIndicator(minHeight: 2)
            else
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  for (final r in reasons)
                    ChoiceChip(
                      label: Text(
                        r.label,
                        style: const TextStyle(fontSize: 12),
                      ),
                      selected: _reason == r.value,
                      onSelected: (_) => setState(() => _reason = r.value),
                    ),
                ],
              ),
            const SizedBox(height: 8),
            DictateField(
              label: "What the child reported",
              controller: _symptoms,
              hint: "e.g. headache since second period",
            ),
            const SizedBox(height: 6),
            DictateField(
              label: "What was done",
              controller: _action,
              hint: "e.g. rested 20 min, ORS given",
              minLines: 1,
              maxLines: 3,
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text(
                "Referred to hospital / sent home",
                style: TextStyle(fontSize: 13),
              ),
              value: _referred,
              onChanged: (v) => setState(() => _referred = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text(
                "Tell the parent now (app notification)",
                style: TextStyle(fontSize: 13),
              ),
              value: _notify,
              onChanged: (v) => setState(() => _notify = v),
            ),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: Text(_busy ? "Saving…" : "Save"),
            ),
          ],
        ),
      ),
    );
  }
}

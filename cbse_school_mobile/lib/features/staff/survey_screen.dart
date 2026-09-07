import "dart:math";

import "package:flutter/material.dart";
import "package:flutter/services.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/dictate_field.dart";
import "../modules/module_shell.dart";

/// Door-to-door survey: pick the beat you are walking, then record each
/// family. Each capture becomes an admissions lead assigned to the agent,
/// with today as the first follow-up.
class SurveyScreen extends StatelessWidget {
  const SurveyScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<SurveySetup>(
      title: "Field survey",
      load: api.fetchSurveySetup,
      emptyIcon: Icons.map_outlined,
      emptyText:
          "No survey beat is active. The admissions desk sets the areas to canvass.",
      isEmpty: (s) => s.beats.isEmpty,
      builder: (context, setup, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: ModuleTone.green.background,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Text(
                setup.capturedTodayByMe == 0
                    ? "No families recorded by you today."
                    : "${setup.capturedTodayByMe} famil${setup.capturedTodayByMe == 1 ? "y" : "ies"} recorded by you today.",
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: ModuleTone.green.foreground,
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            "Choose the beat you are walking",
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 6),
          for (final b in setup.beats)
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: ModuleTone.blue.background,
                  child: Icon(
                    Icons.place_outlined,
                    color: ModuleTone.blue.foreground,
                    size: 20,
                  ),
                ),
                title: Text(
                  b.name,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                subtitle: Text(
                  "${b.area}${b.targetHouseholds > 0 ? " · target ${b.targetHouseholds}" : ""} · ${b.captured} recorded",
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                trailing: const Icon(
                  Icons.add_circle_outline,
                  color: AppColors.primary,
                ),
                onTap: () async {
                  final saved = await showModalBottomSheet<bool>(
                    context: context,
                    isScrollControlled: true,
                    backgroundColor: Colors.white,
                    shape: const RoundedRectangleBorder(
                      borderRadius: BorderRadius.vertical(
                        top: Radius.circular(24),
                      ),
                    ),
                    builder: (_) =>
                        _CaptureSheet(api: api, beat: b, setup: setup),
                  );
                  if (saved == true) await reload();
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _CaptureSheet extends StatefulWidget {
  const _CaptureSheet({
    required this.api,
    required this.beat,
    required this.setup,
  });

  final ApiClient api;
  final SurveyBeat beat;
  final SurveySetup setup;

  @override
  State<_CaptureSheet> createState() => _CaptureSheetState();
}

class _CaptureSheetState extends State<_CaptureSheet> {
  final _child = TextEditingController();
  final _guardian = TextEditingController();
  final _mobile = TextEditingController();
  final _locality = TextEditingController();
  final _note = TextEditingController();
  String _classId = "";
  int _age = 0;
  String _gender = "";
  bool _consent = false;
  bool _busy = false;

  late final String _clientRef =
      "srv-${DateTime.now().millisecondsSinceEpoch}-${Random().nextInt(1 << 30).toRadixString(36)}";

  @override
  void initState() {
    super.initState();
    _locality.text = widget.beat.area;
  }

  @override
  void dispose() {
    for (final c in [_child, _guardian, _mobile, _locality, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_consent) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text("Ask the parent before recording their details."),
        ),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final enq = await widget.api.captureSurvey(
        beatId: widget.beat.id,
        childName: _child.text.trim(),
        guardianName: _guardian.text.trim(),
        mobile: _mobile.text.trim(),
        clientRef: _clientRef,
        classSoughtId: _classId,
        ageYearsApprox: _age,
        gender: _gender,
        locality: _locality.text.trim(),
        note: _note.text.trim(),
      );
      Haptics.success();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Recorded — enquiry $enq")));
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
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
              "New family · ${widget.beat.name}",
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _child,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: "Child's name",
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _guardian,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: "Parent's name",
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _mobile,
              keyboardType: TextInputType.phone,
              maxLength: 10,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: "Mobile",
                isDense: true,
                counterText: "",
              ),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _classId.isEmpty ? null : _classId,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: "Class sought",
                isDense: true,
              ),
              items: [
                for (final c in widget.setup.classes)
                  DropdownMenuItem(value: c.id, child: Text(c.name)),
              ],
              onChanged: (v) => setState(() => _classId = v ?? ""),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<int>(
                    initialValue: _age == 0 ? null : _age,
                    decoration: const InputDecoration(
                      labelText: "Age (approx)",
                      isDense: true,
                    ),
                    items: [
                      for (var i = 2; i <= 16; i++)
                        DropdownMenuItem(value: i, child: Text("$i years")),
                    ],
                    onChanged: (v) => setState(() => _age = v ?? 0),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _gender.isEmpty ? null : _gender,
                    decoration: const InputDecoration(
                      labelText: "Gender",
                      isDense: true,
                    ),
                    items: const [
                      DropdownMenuItem(value: "male", child: Text("Boy")),
                      DropdownMenuItem(value: "female", child: Text("Girl")),
                    ],
                    onChanged: (v) => setState(() => _gender = v ?? ""),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _locality,
              decoration: const InputDecoration(
                labelText: "Locality / street",
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            DictateField(
              label: "Note",
              controller: _note,
              hint: "What the family said — school now, distance, fees",
              minLines: 1,
              maxLines: 3,
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              value: _consent,
              onChanged: (v) => setState(() => _consent = v ?? false),
              title: const Text(
                "The parent agreed to be contacted by the school",
                style: TextStyle(fontSize: 12.5),
              ),
            ),
            const Text(
              "Age is kept as the parent said it — an approximate age, never turned into a date of birth.",
              style: TextStyle(fontSize: 11, color: AppColors.muted),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: Text(_busy ? "Saving…" : "Save family"),
            ),
          ],
        ),
      ),
    );
  }
}

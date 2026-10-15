import "dart:math";

import "package:flutter/material.dart";
import "package:flutter/services.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/dictate_field.dart";
import "../modules/module_shell.dart";
import "../../core/i18n/locale_controller.dart";
import "survey_location_picker.dart";

/// Families recorded WITHOUT a survey day (director, 15 Oct 2026): any
/// member of staff with Field survey, any day, no start / break / end. Pick
/// the beat (or "Other area"), record the family, and place their home on the
/// map (or take the phone's location). Each one becomes an admissions lead
/// created on the server, marked "recorded without a survey day" with the
/// home as a Google Maps link, and the point shows on the office's survey
/// board for that date.
class SurveyScreen extends StatelessWidget {
  const SurveyScreen({super.key, required this.api, this.pickLocation});

  final ApiClient api;

  /// The map picker; injectable for tests.
  final Future<SurveyPoint?> Function(BuildContext context, SurveyPoint? current)? pickLocation;

  Future<void> _record(
    BuildContext context,
    SurveySetup setup,
    Future<void> Function() reload, {
    SurveyBeat? beat,
  }) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => SurveyCaptureSheet(
        beatName: beat?.name ?? "No survey day",
        initialLocality: beat?.area ?? "",
        classes: setup.classes,
        askLocation: true,
        pickLocation: pickLocation,
        save: (f) => api.captureSurvey(
          beatId: beat?.id ?? "",
          childName: f.childName,
          guardianName: f.guardianName,
          mobile: f.mobile,
          clientRef: f.clientRef,
          classSoughtId: f.classSoughtId,
          ageYearsApprox: f.ageYearsApprox,
          gender: f.gender,
          locality: f.locality,
          note: f.note,
          location: f.location,
        ),
      ),
    );
    if (saved == true) await reload();
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<SurveySetup>(
      guideId: "field-survey",
      title: "Families without a survey day",
      load: api.fetchSurveySetup,
      emptyIcon: Icons.map_outlined,
      emptyText: context.l10n.noSurveyBeatIsActiveThe,
      isEmpty: (_) => false,
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
                style: AppText.bodyMedium.copyWith(
                  color: ModuleTone.green.foreground,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            "No start, break or end — just the family and their home on the map.",
            style: AppText.bodySmallMuted,
          ),
          const SizedBox(height: 10),
          Text(
            context.l10n.chooseTheBeatYouAreWalking,
            style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
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
                  style: AppText.bodyMediumInk.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: Text(
                  "${b.area}${b.targetHouseholds > 0 ? " · target ${b.targetHouseholds}" : ""} · ${b.captured} recorded",
                  style: AppText.bodySmallMuted,
                ),
                trailing: const Icon(
                  Icons.add_circle_outline,
                  color: AppColors.primary,
                ),
                onTap: () => _record(context, setup, reload, beat: b),
              ),
            ),
          Card(
            child: ListTile(
              key: const Key("survey-other-area"),
              leading: CircleAvatar(
                backgroundColor: ModuleTone.amber.background,
                child: Icon(Icons.add_location_alt_outlined, color: ModuleTone.amber.foreground, size: 20),
              ),
              title: Text(
                "Other area (no beat)",
                style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
              ),
              subtitle: Text("Anywhere — the map pin says where.", style: AppText.bodySmallMuted),
              trailing: const Icon(Icons.add_circle_outline, color: AppColors.primary),
              onTap: () => _record(context, setup, reload),
            ),
          ),
        ],
      ),
    );
  }
}

/// One family as typed on the capture sheet.
class SurveyFamily {
  const SurveyFamily({
    required this.childName,
    required this.guardianName,
    required this.mobile,
    required this.clientRef,
    required this.classSoughtId,
    required this.ageYearsApprox,
    required this.gender,
    required this.locality,
    required this.note,
    this.location,
  });

  /// The family's home (a family recorded without a survey day); null otherwise.
  final SurveyPoint? location;

  final String childName;
  final String guardianName;
  final String mobile;

  /// Made once per sheet, so a retry after a dropped reply is not a second
  /// lead (the server returns the first one).
  final String clientRef;
  final String classSoughtId;
  final int ageYearsApprox;
  final String gender;
  final String locality;
  final String note;
}

/// The "new family" form. [save] does the sending and returns the enquiry
/// number: the plain capture (Field survey) or the signed, located one of a
/// survey day (SurveyDayScreen).
class SurveyCaptureSheet extends StatefulWidget {
  const SurveyCaptureSheet({
    super.key,
    required this.beatName,
    required this.initialLocality,
    required this.classes,
    required this.save,
    this.askLocation = false,
    this.pickLocation,
  });

  /// Ask where the family lives (map pin / phone location) — the no-day capture.
  final bool askLocation;

  /// Opens the map picker; injectable for tests.
  final Future<SurveyPoint?> Function(BuildContext context, SurveyPoint? current)? pickLocation;

  final String beatName;
  final String initialLocality;
  final List<({String id, String name})> classes;
  final Future<String> Function(SurveyFamily family) save;

  @override
  State<SurveyCaptureSheet> createState() => _CaptureSheetState();
}

class _CaptureSheetState extends State<SurveyCaptureSheet> {
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
  SurveyPoint? _location;

  Future<void> _pickLocation() async {
    final pick =
        widget.pickLocation ??
        (BuildContext c, SurveyPoint? cur) => Navigator.of(c).push<SurveyPoint>(
          MaterialPageRoute(builder: (_) => SurveyLocationPicker(initial: cur)),
        );
    final p = await pick(context, _location);
    if (p != null && mounted) setState(() => _location = p);
  }

  late final String _clientRef =
      "srv-${DateTime.now().millisecondsSinceEpoch}-${Random().nextInt(1 << 30).toRadixString(36)}";

  @override
  void initState() {
    super.initState();
    _locality.text = widget.initialLocality;
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
        SnackBar(content: Text(context.l10n.askTheParentBeforeRecordingTheir)),
      );
      return;
    }
    if (widget.askLocation && _location == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Place the family's home on the map first.")),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final enq = await widget.save(
        SurveyFamily(
          childName: _child.text.trim(),
          guardianName: _guardian.text.trim(),
          mobile: _mobile.text.trim(),
          clientRef: _clientRef,
          classSoughtId: _classId,
          ageYearsApprox: _age,
          gender: _gender,
          locality: _locality.text.trim(),
          note: _note.text.trim(),
          location: _location,
        ),
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
              "New family · ${widget.beatName}",
              style: AppText.titleMediumInk,
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _child,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(
                labelText: context.l10n.childSName,
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _guardian,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(
                labelText: context.l10n.parentSName,
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _mobile,
              keyboardType: TextInputType.phone,
              maxLength: 10,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(
                labelText: context.l10n.mobile,
                isDense: true,
                counterText: "",
              ),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _classId.isEmpty ? null : _classId,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: context.l10n.classSought,
                isDense: true,
              ),
              items: [
                for (final c in widget.classes)
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
                    decoration: InputDecoration(
                      labelText: context.l10n.ageApprox,
                      isDense: true,
                    ),
                    items: [
                      for (var i = 2; i <= 16; i++)
                        DropdownMenuItem(value: i, child: Text("$i years")),
                    ],
                    onChanged: (v) => setState(() => _age = v ?? 0),
                  ),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _gender.isEmpty ? null : _gender,
                    decoration: InputDecoration(
                      labelText: context.l10n.gender,
                      isDense: true,
                    ),
                    items: [
                      DropdownMenuItem(
                        value: "male",
                        child: Text(context.l10n.boy),
                      ),
                      DropdownMenuItem(
                        value: "female",
                        child: Text(context.l10n.girl),
                      ),
                    ],
                    onChanged: (v) => setState(() => _gender = v ?? ""),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _locality,
              decoration: InputDecoration(
                labelText: context.l10n.localityStreet,
                isDense: true,
              ),
            ),
            if (widget.askLocation) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                key: const Key("survey-pick-location"),
                icon: Icon(_location == null ? Icons.add_location_alt_outlined : Icons.location_on),
                onPressed: _busy ? null : _pickLocation,
                label: Text(
                  _location == null
                      ? "Home on the map · घर मैप पर चुनें *"
                      : "${_location!.source == "gps" ? "Phone location" : "Map pin"} ${_location!.lat.toStringAsFixed(5)}, ${_location!.lng.toStringAsFixed(5)} · change",
                ),
              ),
            ],
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
              title: Text(
                context.l10n.theParentAgreedToBeContacted,
                style: AppText.bodySmall,
              ),
            ),
            Text(
              context.l10n.ageIsKeptAsTheParent,
              style: AppText.labelMediumMuted,
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

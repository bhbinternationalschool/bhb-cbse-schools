import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "class_sheet_rules.dart";

/// A 10-digit Indian mobile from whatever is stored, or null — the web's
/// lib/sisClassTeacher mobile10.
String? mobile10(String raw) {
  final d = raw.replaceAll(RegExp(r"\D"), "");
  final ten = d.length == 12 && d.startsWith("91")
      ? d.substring(2)
      : d.length == 11 && d.startsWith("0")
      ? d.substring(1)
      : d;
  return RegExp(r"^[6-9]\d{9}$").hasMatch(ten) ? ten : null;
}

/// The family's numbers the record holds, labelled, each once. A number that
/// is not a real mobile is left out rather than dialled.
List<({String label, String number})> familyContacts(ClassStudent s) {
  final hh = s.household?.fields ?? const <String, String>{};
  String named(String who, String name) =>
      name.trim().isEmpty ? who : "$who · ${name.trim()}";
  final raw = <(String, String)>[
    ("WhatsApp (school messages)", s.whatsappNumber),
    (named("Family", hh["guardianName"] ?? ""), hh["mobile"] ?? ""),
    ("Other family number", hh["altMobile"] ?? ""),
    (
      named("Father", s.fields["fatherName"] ?? ""),
      s.fields["fatherMobile"] ?? "",
    ),
    (
      named("Mother", s.fields["motherName"] ?? ""),
      s.fields["motherMobile"] ?? "",
    ),
    (
      named("Emergency", s.fields["emergencyName"] ?? ""),
      s.fields["emergencyMobile"] ?? "",
    ),
  ];
  final seen = <String>{};
  final out = <({String label, String number})>[];
  for (final (label, number) in raw) {
    final m = mobile10(number);
    if (m == null || !seen.add(m)) continue;
    out.add((label: label, number: m));
  }
  return out;
}

String _istToday() {
  final t = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
  return t.toIso8601String().substring(0, 10);
}

String _dmy(String iso) {
  final m = RegExp(r"^(\d{4})-(\d{2})-(\d{2})").firstMatch(iso);
  return m == null ? iso : "${m[3]}/${m[2]}/${m[1]}";
}

const _waLabel = {
  "on": ("On WhatsApp", AppColors.success),
  "unchecked": ("WhatsApp not checked", AppColors.muted),
  "not_on": ("Not on WhatsApp", AppColors.danger),
  "missing": ("No number", AppColors.danger),
};

/// My class — the class teacher's own children (photo, roll, name, a tap to
/// call the family) and the UDISE+ class sheet: measured height and weight,
/// blood group, mother tongue, religion, category, parents' education and
/// CWSN, saved per child on the server (GET /api/v1/staff/class-students,
/// POST /api/v1/staff/class-sheet). The office / leadership pick a class.
class MyClassScreen extends StatefulWidget {
  const MyClassScreen({
    super.key,
    required this.api,
    this.startOnSheet = false,
  });

  final ApiClient api;

  /// Open on the class sheet rather than the children list.
  final bool startOnSheet;

  @override
  State<MyClassScreen> createState() => _MyClassScreenState();
}

class _MyClassScreenState extends State<MyClassScreen> {
  ClassStudentsData? _data;
  String? _error;
  String _sectionId = "";
  late int _view = widget.startOnSheet ? 1 : 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final data = await widget.api.fetchClassStudents(sectionId: _sectionId);
      if (mounted) setState(() => _data = data);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = context.l10n.homeCouldNotReachServerCheckConnection,
        );
      }
    }
  }

  String _subtitle(ClassStudentsData d) {
    final labels = {for (final s in d.students) s.classLabel}..remove("");
    if (labels.isNotEmpty) return labels.join(", ");
    return d.sections.isNotEmpty ? "Pick a class" : "";
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final sub = data == null ? "" : _subtitle(data);
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text("My class · मेरी कक्षा", style: AppText.titleMedium),
            if (sub.isNotEmpty)
              Text(
                sub,
                style: AppText.labelMedium.copyWith(
                  color: const Color(0xFFB8C0D4),
                ),
              ),
          ],
        ),
        actions: const [
          ScreenGuideButton(guideId: "my-class", screenLabel: "My class"),
          LanguageToggle(onLight: true),
        ],
      ),
      body: data == null
          ? Center(
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
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: _load,
                            child: Text(context.l10n.retry),
                          ),
                        ],
                      ),
                    ),
            )
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: Column(
                    children: [
                      if (data.sections.isNotEmpty) ...[
                        DropdownButtonFormField<String>(
                          key: ValueKey("sec-$_sectionId"),
                          initialValue: _sectionId.isEmpty ? null : _sectionId,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: "Class · कक्षा",
                            isDense: true,
                          ),
                          hint: const Text("Pick a class…"),
                          items: [
                            for (final s in data.sections)
                              DropdownMenuItem(
                                value: s.id,
                                child: Text(s.label),
                              ),
                          ],
                          onChanged: (v) {
                            if (v == null || v == _sectionId) return;
                            setState(() {
                              _sectionId = v;
                              _data = null;
                            });
                            _load();
                          },
                        ),
                        const SizedBox(height: 10),
                      ],
                      SizedBox(
                        width: double.infinity,
                        child: SegmentedButton<int>(
                          segments: const [
                            ButtonSegment(
                              value: 0,
                              icon: Icon(Icons.groups_outlined, size: 18),
                              label: Text("Children · बच्चे"),
                            ),
                            ButtonSegment(
                              value: 1,
                              icon: Icon(Icons.straighten, size: 18),
                              label: Text("Class sheet"),
                            ),
                          ],
                          selected: {_view},
                          showSelectedIcon: false,
                          onSelectionChanged: (s) =>
                              setState(() => _view = s.first),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Text(
                      _error!,
                      style: AppText.bodySmall.copyWith(
                        color: AppColors.danger,
                      ),
                    ),
                  ),
                Expanded(
                  child: data.students.isEmpty
                      ? RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: const EdgeInsets.all(32),
                            children: [
                              Text(
                                data.sections.isNotEmpty
                                    ? "Pick a class above."
                                    : "No children in your class.",
                                textAlign: TextAlign.center,
                                style: AppText.bodyMediumMuted,
                              ),
                            ],
                          ),
                        )
                      : _view == 0
                      ? _ChildrenList(
                          api: widget.api,
                          data: data,
                          onRefresh: _load,
                        )
                      : ClassSheetEditor(
                          key: ValueKey("sheet-$_sectionId"),
                          api: widget.api,
                          rows: data.students,
                          onSaved: _load,
                        ),
                ),
              ],
            ),
    );
  }
}

class _ChildrenList extends StatelessWidget {
  const _ChildrenList({
    required this.api,
    required this.data,
    required this.onRefresh,
  });

  final ApiClient api;
  final ClassStudentsData data;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final kids = data.students;
    final unreachable = kids
        .where(
          (s) => s.whatsappStatus == "missing" || s.whatsappStatus == "not_on",
        )
        .length;
    final manyClasses = {for (final s in kids) s.classLabel}.length > 1;
    return RefreshIndicator(
      onRefresh: onRefresh,
      color: AppColors.primary,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        itemCount: kids.length + 1,
        itemBuilder: (context, i) {
          if (i == 0) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "${kids.length} children · $unreachable not reachable on WhatsApp · tap 📞 to call the family",
                    style: AppText.bodySmallMuted,
                  ),
                  if (!data.verdictsAvailable)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        "WhatsApp check results could not be read just now — numbers show as “not checked”.",
                        style: AppText.bodySmall.copyWith(
                          color: AppColors.warning,
                        ),
                      ),
                    ),
                ],
              ),
            );
          }
          final s = kids[i - 1];
          final contacts = familyContacts(s);
          final wa = _waLabel[s.whatsappStatus] ?? ("", AppColors.muted);
          final parent =
              (s.household?.fields["guardianName"] ?? "").trim().isNotEmpty
              ? s.household!.fields["guardianName"]!.trim()
              : (s.fields["fatherName"] ?? "").trim();
          return Card(
            child: ListTile(
              dense: true,
              leading: _StudentPhoto(
                api: api,
                url: s.photoUrl,
                rollNo: s.rollNo,
              ),
              title: Text(
                "${s.rollNo.isEmpty ? "" : "${s.rollNo}. "}${s.fullName}",
                style: AppText.bodyMediumInk.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
              subtitle: Text(
                [
                  if (manyClasses && s.classLabel.isNotEmpty) s.classLabel,
                  if (parent.isNotEmpty) parent,
                  if (wa.$1.isNotEmpty) wa.$1,
                ].join(" · "),
                style: AppText.labelMedium.copyWith(
                  color:
                      s.whatsappStatus == "on" ||
                          s.whatsappStatus == "unchecked"
                      ? AppColors.muted
                      : AppColors.danger,
                ),
              ),
              trailing: contacts.isEmpty
                  ? null
                  : IconButton(
                      tooltip: context.l10n.call,
                      icon: const Icon(
                        Icons.call_outlined,
                        color: AppColors.primary,
                      ),
                      onPressed: () => _callSheet(context, s, contacts),
                    ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _callSheet(
    BuildContext context,
    ClassStudent s,
    List<({String label, String number})> contacts,
  ) async {
    Haptics.tap();
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "Call · कॉल करें — ${s.fullName}",
                style: AppText.titleMediumInk,
              ),
              const SizedBox(height: 8),
              for (final c in contacts)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(
                    Icons.call_outlined,
                    color: AppColors.primary,
                  ),
                  title: Text(c.number, style: AppText.bodyLargeInk),
                  subtitle: Text(c.label, style: AppText.bodySmallMuted),
                  onTap: () {
                    Navigator.pop(context);
                    launchUrl(Uri.parse("tel:+91${c.number}"));
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StudentPhoto extends StatelessWidget {
  const _StudentPhoto({
    required this.api,
    required this.url,
    required this.rollNo,
  });

  final ApiClient api;
  final String url;
  final String rollNo;

  @override
  Widget build(BuildContext context) {
    final fallback = CircleAvatar(
      radius: 20,
      backgroundColor: ModuleTone.teal.background,
      child: Text(
        rollNo.isEmpty ? "–" : rollNo,
        style: AppText.bodySmall.copyWith(
          color: ModuleTone.teal.foreground,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
    if (url.isEmpty) return fallback;
    final full = api.erpUrl(url);
    return FutureBuilder<Map<String, String>>(
      future: api.imageHeaders(),
      builder: (context, snap) => snap.data == null
          ? fallback
          : ClipOval(
              child: Image.network(
                full,
                headers: api.isOwnServer(full) ? snap.data : null,
                width: 40,
                height: 40,
                fit: BoxFit.cover,
                cacheWidth: 120,
                errorBuilder: (_, _, _) => fallback,
              ),
            ),
    );
  }
}

/// The class sheet: pick the columns, fill the list, one Save. Only changed
/// values of changed children are sent, each with the revision it was read
/// at — the server refuses a child someone else saved in between rather than
/// overwriting, and no child's values ever travel with another's.
class ClassSheetEditor extends StatefulWidget {
  const ClassSheetEditor({
    super.key,
    required this.api,
    required this.rows,
    required this.onSaved,
  });

  final ApiClient api;
  final List<ClassStudent> rows;
  final Future<void> Function() onSaved;

  @override
  State<ClassSheetEditor> createState() => _ClassSheetEditorState();
}

SheetDraft _baseOf(ClassStudent r) => SheetDraft.fromRecord(
  fields: r.fields,
  heightCm: r.heightCm,
  weightKg: r.weightKg,
  fatherQualification: r.fatherQualification,
  motherQualification: r.motherQualification,
  isCwsn: r.isCwsn,
);

const _textKeys = ["heightCm", "weightKg", "motherTongue"];

class _ClassSheetEditorState extends State<ClassSheetEditor> {
  final List<SheetGroup> _groups = [SheetGroup.measure, SheetGroup.blood];
  final String _today = _istToday();
  late String _date = _today;
  final Map<String, SheetDraft> _draft = {};
  final Map<String, (bool, String)> _result = {};
  final Map<String, TextEditingController> _ctl = {};
  final Set<String> _justSaved = {};
  bool _busy = false;
  (bool, String)? _msg;

  @override
  void initState() {
    super.initState();
    for (final r in widget.rows) {
      _draft[r.id] = _baseOf(r);
    }
  }

  @override
  void didUpdateWidget(covariant ClassSheetEditor old) {
    super.didUpdateWidget(old);
    final before = {for (final r in old.rows) r.id: _baseOf(r)};
    for (final r in widget.rows) {
      final now = _baseOf(r);
      final was = before[r.id];
      final d = _draft[r.id];
      if (d == null || was == null || _justSaved.contains(r.id)) {
        // New child, or just saved: show what the record holds now.
        _draft[r.id] = now;
      } else {
        // Re-read after a save or a refusal: a value the teacher did not
        // touch follows the record, so someone else's newer value is never
        // sent back as a stale "change".
        final next = d.copy();
        for (final g in SheetGroup.values) {
          for (final k in g.keys) {
            if (d.get(k) == was.get(k)) _set(next, k, now.get(k));
          }
        }
        _draft[r.id] = next;
      }
      _syncControllers(r.id);
    }
    _justSaved.clear();
  }

  @override
  void dispose() {
    for (final c in _ctl.values) {
      c.dispose();
    }
    super.dispose();
  }

  static void _set(SheetDraft d, String k, Object v) {
    switch (k) {
      case "heightCm":
        d.heightCm = v as String;
      case "weightKg":
        d.weightKg = v as String;
      case "bloodGroup":
        d.bloodGroup = v as String;
      case "motherTongue":
        d.motherTongue = v as String;
      case "religion":
        d.religion = v as String;
      case "category":
        d.category = v as String;
      case "fatherQualification":
        d.fatherQualification = v as String;
      case "motherQualification":
        d.motherQualification = v as String;
      case "isCwsn":
        d.isCwsn = v as bool;
    }
  }

  TextEditingController _controller(String id, String key) => _ctl.putIfAbsent(
    "$id|$key",
    () => TextEditingController(text: _draft[id]?.text(key) ?? ""),
  );

  void _syncControllers(String id) {
    for (final k in _textKeys) {
      final c = _ctl["$id|$k"];
      final v = _draft[id]?.get(k) as String? ?? "";
      if (c != null && c.text != v) c.text = v;
    }
  }

  void _edit(String id, String key, Object value) {
    final d = _draft[id];
    if (d == null) return;
    setState(() {
      _set(d, key, value);
      _result.remove(id);
    });
  }

  void _toggle(SheetGroup g) {
    setState(() {
      if (_groups.contains(g)) {
        if (_groups.length > 1) _groups.remove(g);
      } else {
        _groups.add(g);
      }
    });
  }

  Future<void> _pickDate() async {
    final today = DateTime.parse(_today);
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_date) ?? today,
      firstDate: today.subtract(const Duration(days: 365)),
      lastDate: today,
    );
    if (d != null) setState(() => _date = d.toIso8601String().substring(0, 10));
  }

  Future<void> _save(List<(ClassStudent, Map<String, Object>)> toSave) async {
    if (_busy || toSave.isEmpty) return;
    setState(() {
      _busy = true;
      _msg = null;
    });
    try {
      final res = await widget.api.saveClassSheet(
        measuredOn: _date,
        rows: [
          for (final (r, send) in toSave)
            {"id": r.id, "revisionAt": r.revisionAt, "values": send},
        ],
      );
      final failed = res.results.length - res.saved;
      setState(() {
        for (final x in res.results) {
          _result[x.id] = (
            x.ok,
            x.ok
                ? "Saved"
                : x.conflict
                ? "${x.error.isEmpty ? "Someone else saved this child just now" : x.error} — check and save again"
                : (x.error.isEmpty ? "Not saved" : x.error),
          );
          if (x.ok) _justSaved.add(x.id);
        }
        _msg = (
          failed == 0,
          failed > 0
              ? "Saved ${res.saved}; $failed not saved — see the red notes"
              : "Saved ${res.saved} child${res.saved == 1 ? "" : "ren"}",
        );
      });
      if (failed == 0) {
        Haptics.success();
      } else {
        Haptics.warning();
      }
      if (res.saved > 0 || res.results.any((x) => x.conflict)) {
        await widget.onSaved();
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _msg = (false, e.message));
    } catch (_) {
      if (mounted) {
        setState(
          () => _msg = (
            false,
            "Could not reach the school server — nothing lost, press Save again",
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = widget.rows;
    final state = [
      for (final r in rows)
        () {
          final base = _baseOf(r);
          final d = _draft[r.id] ?? base;
          final send = sheetRowToSend(base, d, _groups);
          final err = send.isEmpty ? null : checkSheetRow(send, base);
          return (r: r, d: d, send: send, err: err);
        }(),
    ];
    final toSave = [
      for (final x in state)
        if (x.send.isNotEmpty && x.err == null) (x.r, x.send),
    ];
    final withErrors = state
        .where((x) => x.send.isNotEmpty && x.err != null)
        .length;
    final complete = rows
        .where((r) => _groups.every((g) => sheetGroupFilled(_baseOf(r), g)))
        .length;

    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            itemCount: state.length + 1,
            itemBuilder: (context, i) {
              if (i == 0) return _header(complete, rows.length);
              final x = state[i - 1];
              return _childCard(x.r, x.d, x.send.isNotEmpty, x.err);
            },
          ),
        ),
        Material(
          elevation: 8,
          color: Colors.white,
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _busy || toSave.isEmpty
                          ? null
                          : () => _save(toSave),
                      child: Text(
                        _busy
                            ? "Saving…"
                            : toSave.isEmpty
                            ? "Nothing new to save"
                            : "Save ${toSave.length} child${toSave.length == 1 ? "" : "ren"} · सहेजें",
                      ),
                    ),
                  ),
                  if (withErrors > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        "$withErrors child${withErrors == 1 ? "" : "ren"} with something to fix — not included",
                        style: AppText.labelMedium.copyWith(
                          color: AppColors.danger,
                        ),
                      ),
                    ),
                  if (_msg != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        _msg!.$2,
                        textAlign: TextAlign.center,
                        style: AppText.labelMedium.copyWith(
                          color: _msg!.$1
                              ? AppColors.success
                              : AppColors.danger,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _header(int complete, int total) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "What are you filling today? · आज क्या भरेंगे?",
              style: AppText.labelMediumMuted.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final g in SheetGroup.values)
                  FilterChip(
                    label: Text(g.label),
                    selected: _groups.contains(g),
                    showCheckmark: false,
                    selectedColor: AppColors.primary,
                    labelStyle: TextStyle(
                      color: _groups.contains(g) ? Colors.white : AppColors.ink,
                      fontWeight: FontWeight.w600,
                      fontSize: 12,
                    ),
                    onSelected: (_) => _toggle(g),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            for (final g in SheetGroup.values)
              if (_groups.contains(g))
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: "${g.label} (${g.hindi}): ",
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink,
                          ),
                        ),
                        TextSpan(text: g.hint),
                      ],
                    ),
                    style: AppText.labelMediumMuted,
                  ),
                ),
            const SizedBox(height: 6),
            Text(
              "Complete for these columns: $complete of $total",
              style: AppText.bodyMediumInk.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            if (_groups.contains(SheetGroup.measure))
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.event_outlined, size: 18),
                  label: Text("Measured on ${_dmy(_date)}"),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _dropdown({
    required String id,
    required String key,
    required String label,
    required String value,
    required List<(String, String)> options,
  }) {
    // An old value the record holds that is not on the list stays offered,
    // so opening the sheet never changes a child's record by itself.
    final opts = value.isNotEmpty && !options.any((o) => o.$1 == value)
        ? [(value, value), ...options]
        : options;
    return DropdownButtonFormField<String>(
      key: ValueKey("$id|$key|$value"),
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, isDense: true),
      items: [
        for (final o in opts)
          DropdownMenuItem(
            value: o.$1,
            child: Text(o.$2, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (v) => _edit(id, key, v ?? ""),
    );
  }

  Widget _number(String id, String key, String label, String suffix) =>
      TextField(
        controller: _controller(id, key),
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        textAlign: TextAlign.right,
        decoration: InputDecoration(
          labelText: label,
          suffixText: suffix,
          isDense: true,
        ),
        onChanged: (v) => _edit(id, key, v),
      );

  Widget _childCard(ClassStudent r, SheetDraft d, bool dirty, String? err) {
    final age = ageYears(r.dob, _today);
    final res = _result[r.id];
    final pairs = <Widget>[];
    final wide = <Widget>[];
    if (_groups.contains(SheetGroup.measure)) {
      pairs.add(_number(r.id, "heightCm", "Height", "cm"));
      pairs.add(_number(r.id, "weightKg", "Weight", "kg"));
    }
    if (_groups.contains(SheetGroup.blood)) {
      pairs.add(
        _dropdown(
          id: r.id,
          key: "bloodGroup",
          label: "Blood group",
          value: d.bloodGroup,
          options: [
            for (final b in kBloodGroups) (b, b.isEmpty ? "Not known" : b),
          ],
        ),
      );
    }
    if (_groups.contains(SheetGroup.family)) {
      pairs.add(
        TextField(
          controller: _controller(r.id, "motherTongue"),
          textCapitalization: TextCapitalization.characters,
          inputFormatters: [
            TextInputFormatter.withFunction(
              (_, n) => n.copyWith(text: n.text.toUpperCase()),
            ),
          ],
          decoration: InputDecoration(
            labelText: "Mother tongue",
            hintText: "HINDI",
            isDense: true,
            suffixIcon: PopupMenuButton<String>(
              tooltip: "Pick",
              icon: const Icon(Icons.arrow_drop_down),
              onSelected: (v) {
                _controller(r.id, "motherTongue").text = v;
                _edit(r.id, "motherTongue", v);
              },
              itemBuilder: (_) => [
                for (final t in kMotherTongueSuggestions)
                  PopupMenuItem(value: t, child: Text(t)),
              ],
            ),
          ),
          onChanged: (v) => _edit(r.id, "motherTongue", v),
        ),
      );
      pairs.add(
        _dropdown(
          id: r.id,
          key: "religion",
          label: "Religion",
          value: d.religion,
          options: [("", "—"), for (final x in kReligions) (x, x)],
        ),
      );
      pairs.add(
        _dropdown(
          id: r.id,
          key: "category",
          label: "Category",
          value: d.category,
          options: kStudentCategories,
        ),
      );
    }
    if (_groups.contains(SheetGroup.education)) {
      for (final (k, l) in const [
        ("fatherQualification", "Father's education"),
        ("motherQualification", "Mother's education"),
      ]) {
        wide.add(
          _dropdown(
            id: r.id,
            key: k,
            label: l,
            value: d.get(k) as String,
            options: [
              ("", "Not known"),
              for (final x in kEducationLevels) (x, x),
            ],
          ),
        );
      }
    }
    if (_groups.contains(SheetGroup.cwsn)) {
      wide.add(
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          controlAffinity: ListTileControlAffinity.leading,
          value: d.isCwsn,
          title: const Text("Child with special needs (CWSN)"),
          onChanged: (v) => _edit(r.id, "isCwsn", v ?? false),
        ),
      );
    }

    String? note;
    Color noteColor = AppColors.danger;
    if (dirty && err != null) {
      note = err;
    } else if (res != null && (!dirty || !res.$1)) {
      note = res.$2;
      noteColor = res.$1 ? AppColors.success : AppColors.danger;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text:
                        "${r.rollNo.isEmpty ? "" : "${r.rollNo}. "}${r.fullName}",
                    style: AppText.bodyMediumInk.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  TextSpan(
                    text:
                        "  ${age != null ? "$age y" : "age —"}"
                        "${_groups.contains(SheetGroup.measure) && r.measuredOn.isNotEmpty ? " · measured ${_dmy(r.measuredOn)}" : ""}",
                    style: AppText.labelMediumMuted,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            for (var i = 0; i < pairs.length; i += 2)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: pairs[i]),
                    const SizedBox(width: 8),
                    Expanded(
                      child: i + 1 < pairs.length
                          ? pairs[i + 1]
                          : const SizedBox(),
                    ),
                  ],
                ),
              ),
            for (final w in wide)
              Padding(padding: const EdgeInsets.only(bottom: 8), child: w),
            if (note != null)
              Row(
                children: [
                  if (noteColor == AppColors.success)
                    const Padding(
                      padding: EdgeInsets.only(right: 4),
                      child: Icon(
                        Icons.check_circle,
                        size: 14,
                        color: AppColors.success,
                      ),
                    ),
                  Expanded(
                    child: Text(
                      note,
                      style: AppText.labelMedium.copyWith(color: noteColor),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

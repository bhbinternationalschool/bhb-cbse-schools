import "dart:async";

import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:geolocator/geolocator.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/punch/punch_device_key.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "survey_manage_screen.dart";
import "survey_screen.dart";

/// A field surveyor's day in the app (director, 13 Oct 2026) — the
/// website's /survey-day: START (beat; the gate code too for someone who
/// starts at school), BREAK / RESUME, END, and each family recorded on the
/// day. Every step is signed by this phone's punch key and carries the
/// phone's live location, so the office sees who walked where and when; the
/// server (api/public/survey-day) checks all of it and marks school staff
/// present in the staff register.
///
/// Staff not on the survey team keep the plain Field survey (no day).
class SurveyDayScreen extends StatefulWidget {
  const SurveyDayScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<SurveyDayScreen> createState() => _SurveyDayScreenState();
}

class _SurveyDayScreenState extends State<SurveyDayScreen> {
  SurveyDayStatus? _status;

  /// Why the day cannot open: "not_registered" (this phone's key is not
  /// known), "not_on_team", or "" for any other error ([_error]).
  String _blockedReason = "";
  String? _error;
  bool _loading = true;

  /// The step in flight ("start", "break", …) — one at a time.
  String _busy = "";
  String _beatId = "";
  final _gateCode = TextEditingController();
  final _pairCode = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _gateCode.dispose();
    _pairCode.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _blockedReason = "";
    });
    try {
      final s = await _send("status");
      if (!mounted) return;
      setState(() => _status = s);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _blockedReason = e.reason;
        _error = e.message;
      });
    } on _FixError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// A live, fresh location — the server refuses mocked, vague (> ±100 m)
  /// or missing fixes, so say why here before sending.
  Future<Map<String, dynamic>> _liveFix() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const _FixError(
        "Turn on location (GPS) — every survey step needs your live location.",
      );
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw const _FixError(
        "Allow location for the app in phone settings — every survey step needs it.",
      );
    }
    final Position pos;
    try {
      pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.best,
          timeLimit: Duration(seconds: 25),
        ),
      );
    } on TimeoutException {
      throw const _FixError(
        "Could not get your location in time. Step outside and try again.",
      );
    }
    if (pos.isMocked) {
      throw const _FixError(
        "A fake-location app is on. Turn it off — survey steps count only with your real location.",
      );
    }
    return {
      "lat": pos.latitude,
      "lng": pos.longitude,
      "accuracyM": pos.accuracy,
      "mocked": pos.isMocked,
    };
  }

  /// Sign and send one step. [extra] is what the signature binds besides
  /// the action (gate code / client ref / pairing code).
  Future<SurveyDayStatus> _send(
    String action, {
    String extra = "",
    Map<String, dynamic> payload = const {},
  }) async {
    final geo = action == "status" || action == "pair"
        ? null
        : await _liveFix();
    final key = await PunchDeviceKey.load();
    final ts = DateTime.now().millisecondsSinceEpoch;
    return widget.api.surveyDayStep(
      action: action,
      deviceJwk: key.publicJwk,
      signature: key.sign(
        PunchDeviceKey.surveyMessage(action: action, extra: extra, ts: ts),
      ),
      ts: ts,
      geo: geo,
      payload: payload,
    );
  }

  /// The team leader's "team" / "manage" call, signed like every step
  /// (extra = the change's op and target — surveyManageExtra).
  Future<SurveyTeamInfo> _team(String action, [Map<String, dynamic>? change]) async {
    final key = await PunchDeviceKey.load();
    final ts = DateTime.now().millisecondsSinceEpoch;
    final extra = action == "manage" ? surveyManageExtra(change ?? const {}) : "";
    return widget.api.surveyTeamStep(
      action: action,
      deviceJwk: key.publicJwk,
      signature: key.sign(PunchDeviceKey.surveyMessage(action: action, extra: extra, ts: ts)),
      ts: ts,
      change: change,
    );
  }

  /// Run a step from a button: busy state, the reply as the new picture,
  /// and the refusal in the surveyor's words.
  Future<SurveyDayStatus?> _step(
    String action, {
    String extra = "",
    Map<String, dynamic> payload = const {},
  }) async {
    if (_busy.isNotEmpty) return null;
    setState(() => _busy = action);
    try {
      final s = await _send(action, extra: extra, payload: payload);
      if (!mounted) return s;
      Haptics.success();
      setState(() => _status = s);
      return s;
    } on ApiException catch (e) {
      _say(e.message, bad: true);
    } on _FixError catch (e) {
      _say(e.message, bad: true);
    } catch (_) {
      _say("Not saved — could not reach the school server.", bad: true);
    } finally {
      if (mounted) setState(() => _busy = "");
    }
    return null;
  }

  void _say(String text, {bool bad = false}) {
    if (!mounted) return;
    if (bad) Haptics.warning();
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _pair() async {
    final code = _pairCode.text.replaceAll(RegExp(r"\D"), "");
    if (code.length != 6 || _busy.isNotEmpty) return;
    setState(() => _busy = "pair");
    try {
      await _send("pair", extra: code, payload: {"code": code});
      _pairCode.clear();
      _say("This phone is now registered to you for the survey.");
      await _load();
    } on ApiException catch (e) {
      _say(e.message, bad: true);
    } catch (_) {
      _say("Could not reach the school server.", bad: true);
    } finally {
      if (mounted) setState(() => _busy = "");
    }
  }

  Future<void> _start(SurveyDayStatus s) async {
    final code = s.startsAtSchool
        ? _gateCode.text.replaceAll(RegExp(r"\D"), "")
        : "";
    if (_beatId.isEmpty) {
      _say("Choose the beat (area) you are surveying today.", bad: true);
      return;
    }
    if (s.startsAtSchool && code.length != 6) {
      _say(
        "You start at school: type the 6-digit code on the gate QR screen.",
        bad: true,
      );
      return;
    }
    final r = await _step(
      "start",
      extra: code,
      payload: {"beatId": _beatId, "code": code},
    );
    if (r != null) _gateCode.clear();
  }

  Future<void> _end() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("End today's survey?"),
        content: const Text(
          "You cannot start again today. · आज दोबारा शुरू नहीं कर पाएँगे।",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text("Not yet"),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text("End survey"),
          ),
        ],
      ),
    );
    if (ok == true) await _step("end");
  }

  Future<void> _recordFamily(SurveyDayStatus s) async {
    final day = s.day;
    if (day == null) return;
    final beat = s.beats.where((b) => b.id == day.beatId).firstOrNull;
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => SurveyCaptureSheet(
        beatName: beat?.name ?? "Survey",
        initialLocality: beat?.area ?? "",
        classes: s.classes,
        // The sheet shows the refusal and stays open; on success it closes
        // with "Recorded — enquiry …".
        save: (f) async {
          try {
            final r = await _send(
              "capture",
              extra: f.clientRef,
              payload: {
                "family": {
                  "childName": f.childName,
                  "guardianName": f.guardianName,
                  "mobile": f.mobile,
                  "classSoughtId": f.classSoughtId,
                  "ageYearsApprox": f.ageYearsApprox,
                  "gender": f.gender,
                  "locality": f.locality,
                  "note": f.note,
                  "parentConsent": true,
                  "clientRef": f.clientRef,
                },
              },
            );
            if (mounted) setState(() => _status = r);
            return r.enquiryNo;
          } on _FixError catch (e) {
            throw ApiException(e.message);
          } on ApiException {
            rethrow;
          } catch (_) {
            throw ApiException(
              "Not saved — could not reach the school server.",
            );
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Survey day · सर्वे दिवस"),
        actions: const [
          ScreenGuideButton(guideId: "survey-day", screenLabel: "Survey day"),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: _body(context),
        ),
      ),
    );
  }

  List<Widget> _body(BuildContext context) {
    if (_loading && _status == null) {
      return const [
        Padding(
          padding: EdgeInsets.all(40),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    final s = _status;
    if (s == null) {
      if (_blockedReason == "not_registered") return _pairView();
      return [
        _note(_error ?? "Could not open the survey day.", ModuleTone.coral),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: _load, child: const Text("Try again")),
        if (_blockedReason == "not_on_team") ..._plainSurveyLink(),
      ];
    }
    final day = s.day;
    return [
      Text(s.memberName, style: AppText.titleMediumInk),
      Text(
        s.startsAtSchool
            ? "Starts at school (gate code + campus)"
            : "Starts in the field",
        style: AppText.bodySmallMuted,
      ),
      const SizedBox(height: 12),
      if (s.canManage) ...[
        OutlinedButton.icon(
          key: const Key("survey-manage-team"),
          icon: const Icon(Icons.groups_outlined),
          onPressed: () async {
            await Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => SurveyManageScreen(call: _team)),
            );
            if (mounted) await _load();
          },
          label: const Text("Manage team & beats · टीम और बीट"),
        ),
        const SizedBox(height: 12),
      ],
      if (day == null) ..._startView(s) else ..._dayView(s, day),
      if (s.captures.isNotEmpty) ...[
        const SizedBox(height: 16),
        Text(
          "Families today · ${s.captures.length}",
          style: AppText.bodyLargeInk.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 6),
        for (final c in s.captures)
          Card(
            child: ListTile(
              dense: true,
              leading: Icon(
                Icons.home_outlined,
                color: ModuleTone.green.foreground,
              ),
              title: Text(c.childName, style: AppText.bodyMediumInk),
              subtitle: Text(
                "${c.enquiryNo} · ${_clock(c.at)}",
                style: AppText.bodySmallMuted,
              ),
            ),
          ),
      ],
      ..._plainSurveyLink(),
    ];
  }

  List<Widget> _pairView() => [
    _note(
      "This phone is not registered for the survey yet. School staff: punch IN once at the gate from this app — "
      "that registers it. Or ask the office for a 6-digit phone code (ERP: Admissions → Field survey → Team → "
      "your name → Get phone code) and type it here. It works once, for 10 minutes.",
      ModuleTone.amber,
    ),
    const SizedBox(height: 12),
    TextField(
      controller: _pairCode,
      keyboardType: TextInputType.number,
      maxLength: 6,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: const InputDecoration(
        labelText: "Office pairing code",
        border: OutlineInputBorder(),
      ),
    ),
    FilledButton(
      onPressed: _busy.isEmpty ? _pair : null,
      child: Text(_busy == "pair" ? "Registering…" : "Register this phone"),
    ),
    const SizedBox(height: 8),
    OutlinedButton(
      onPressed: _load,
      child: const Text("I punched at the gate — check again"),
    ),
    ..._plainSurveyLink(),
  ];

  /// Someone who may record families but is not on today's team.
  List<Widget> _plainSurveyLink() => [
    const SizedBox(height: 16),
    TextButton.icon(
      icon: const Icon(Icons.map_outlined),
      key: const Key("survey-no-day"),
      label: const Text("Record a family without a survey day · बिना सर्वे दिवस"),
      onPressed: () => Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => SurveyScreen(api: widget.api))),
    ),
  ];

  List<Widget> _startView(SurveyDayStatus s) => [
    if (s.beats.isEmpty)
      _note(
        "No survey beat is active. Ask the admissions desk to set the areas.",
        ModuleTone.amber,
      )
    else ...[
      DropdownButtonFormField<String>(
        initialValue: _beatId.isEmpty ? null : _beatId,
        isExpanded: true,
        decoration: const InputDecoration(
          labelText: "Beat (area) today",
          border: OutlineInputBorder(),
        ),
        items: [
          for (final b in s.beats)
            DropdownMenuItem(
              value: b.id,
              child: Text(b.area.isEmpty ? b.name : "${b.name} · ${b.area}"),
            ),
        ],
        onChanged: (v) => setState(() => _beatId = v ?? ""),
      ),
      if (s.startsAtSchool) ...[
        const SizedBox(height: 12),
        TextField(
          controller: _gateCode,
          keyboardType: TextInputType.number,
          maxLength: 6,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(
            labelText: "6-digit code on the gate QR screen",
            border: OutlineInputBorder(),
          ),
        ),
      ],
      const SizedBox(height: 12),
      FilledButton.icon(
        icon: const Icon(Icons.play_arrow),
        onPressed: _busy.isEmpty ? () => _start(s) : null,
        label: Text(
          _busy == "start"
              ? "Getting your location…"
              : "Start survey · सर्वे शुरू करें",
        ),
      ),
      const SizedBox(height: 8),
      Text(
        "Your live location is recorded at every step. Fake-location apps are refused.",
        style: AppText.labelMediumMuted,
      ),
    ],
  ];

  List<Widget> _dayView(SurveyDayStatus s, SurveyDayInfo day) {
    final beat = s.beats.where((b) => b.id == day.beatId).firstOrNull;
    final state = switch (day.status) {
      "active" => "working",
      "on_break" => "on break",
      _ => "ended",
    };
    final mins = day.workedMs ~/ 60000;
    return [
      _note(
        "${beat?.name ?? "Beat"} · $state\n"
        "Started ${_clock(day.startedAt)}${day.endedAt.isEmpty ? "" : " · ended ${_clock(day.endedAt)}"}"
        " · worked ${mins ~/ 60}h ${mins % 60}m"
        "${day.breaks > 0 ? " · ${day.breaks} break${day.breaks == 1 ? "" : "s"}" : ""}",
        day.status == "ended" ? ModuleTone.gray : ModuleTone.green,
      ),
      const SizedBox(height: 12),
      if (day.status == "active")
        FilledButton.icon(
          icon: const Icon(Icons.person_add_alt_1_outlined),
          onPressed: _busy.isEmpty ? () => _recordFamily(s) : null,
          label: const Text("Record a family · परिवार दर्ज करें"),
        ),
      if (day.status != "ended") ...[
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _busy.isEmpty
                    ? () => _step(day.status == "active" ? "break" : "resume")
                    : null,
                child: Text(
                  _busy == "break" || _busy == "resume"
                      ? "…"
                      : day.status == "active"
                      ? "Break"
                      : "Resume",
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton(
                onPressed: _busy.isEmpty ? _end : null,
                child: Text(_busy == "end" ? "…" : "End survey"),
              ),
            ),
          ],
        ),
      ],
      if (day.status == "on_break")
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            "Resume to record families.",
            style: AppText.labelMediumMuted,
          ),
        ),
    ];
  }

  Widget _note(String text, ModuleTone tone) => Card(
    color: tone.background,
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Text(
        text,
        style: AppText.bodyMedium.copyWith(
          color: tone.foreground,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
  );

  /// "2026-10-13T04:12:00.000Z" → "9:42 AM" on the phone's clock.
  static String _clock(String iso) {
    final t = DateTime.tryParse(iso)?.toLocal();
    if (t == null) return "";
    final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
    return "$h:${t.minute.toString().padLeft(2, "0")} ${t.hour < 12 ? "AM" : "PM"}";
  }
}

class _FixError implements Exception {
  const _FixError(this.message);
  final String message;
}

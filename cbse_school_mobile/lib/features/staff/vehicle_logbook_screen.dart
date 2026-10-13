import "dart:io" show File;

import "package:flutter/material.dart";
import "package:image_picker/image_picker.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "bus_register_screen.dart" show TransportDayPicker, shiftMonth;

/// The driver's log book — start / end odometer per vehicle per day, fuel
/// filled (with an optional bill photo) and the month's km and ₹/km. The
/// same server record as the web ERP's Transport → Log book
/// (/api/v1/transport/logbook*).
///
/// A driver sees only their own vehicle (Staff → Duties or Fleet); the
/// office and leadership see every vehicle. A blank odometer is "not
/// recorded", never 0. Where the bus has a Fleet Edge tracker its odometer is
/// offered — labelled GPS — but a saved figure always wins.
class VehicleLogbookScreen extends StatefulWidget {
  const VehicleLogbookScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<VehicleLogbookScreen> createState() => _VehicleLogbookScreenState();
}

class _VehicleLogbookScreenState extends State<VehicleLogbookScreen> {
  LogbookDay? _day;
  String _date = "";
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await widget.api.fetchLogbook(date: _date);
      if (!mounted) return;
      setState(() {
        _day = d;
        _date = d.date;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error =
            "Could not reach the school — check the internet. "
            "स्कूल सर्वर से संपर्क नहीं हुआ।";
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final day = _day;
    return Scaffold(
      appBar: AppBar(
        title: const Text("Log book · लॉग बुक"),
        actions: [
          const ScreenGuideButton(
            guideId: "vehicle-logbook",
            screenLabel: "Log book",
          ),
          IconButton(
            tooltip: "Month · महीना",
            icon: const Icon(Icons.calendar_month_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => LogbookMonthScreen(
                  api: widget.api,
                  month: (day?.date ?? "").length >= 7
                      ? day!.date.substring(0, 7)
                      : "",
                ),
              ),
            ),
          ),
          IconButton(
            tooltip: "Refresh",
            icon: const Icon(Icons.refresh),
            onPressed: _load,
          ),
        ],
      ),
      body: _loading && day == null
          ? const Center(child: CircularProgressIndicator())
          : day == null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_error ?? "", textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: _load,
                      child: const Text("Try again · दोबारा"),
                    ),
                  ],
                ),
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  TransportDayPicker(
                    date: _date,
                    today: day.today,
                    onPick: (d) {
                      _date = d;
                      _load();
                    },
                  ),
                  const SizedBox(height: 10),
                  if (_error != null)
                    _LbNote(text: _error!, color: AppColors.danger),
                  if (!day.editable)
                    const _LbNote(
                      text:
                          "This day is closed for changes from your phone — "
                          "ask the office. इस दिन को अब फ़ोन से नहीं बदल सकते।",
                      color: AppColors.warning,
                    ),
                  if (day.unlinked)
                    const _LbNote(
                      text:
                          "You are not linked to a vehicle yet. Ask the office "
                          "to link you in Staff → Duties or Fleet.\n"
                          "आप अभी किसी गाड़ी से जुड़े नहीं हैं — दफ़्तर से "
                          "जुड़वाएँ।",
                      color: AppColors.warning,
                    ),
                  if (day.vehicles.isEmpty && !day.unlinked)
                    const _LbNote(
                      text: "No vehicles to show.",
                      color: AppColors.muted,
                    ),
                  for (final v in day.vehicles)
                    _VehicleDayCard(
                      // A reload (new row version) starts the form afresh.
                      // Fuel changes keep the half-typed odometer form.
                      key: ValueKey(
                        "${v.id}|${day.date}|${v.log?.rowVersion ?? 0}",
                      ),
                      api: widget.api,
                      vehicle: v,
                      date: day.date,
                      isToday: day.date == day.today,
                      editable: day.editable,
                      fleetWide: day.fleetWide,
                      staffId: day.staffId,
                      onChanged: _load,
                    ),
                ],
              ),
            ),
    );
  }
}

/// The odometer box's starting value: a saved figure wins; else the GPS
/// reading, labelled GPS and not yet saved (web lib/transportBoardingLog
/// odometerField).
({double? value, String source, bool saved}) odometerStart(
  double? savedValue,
  String savedSource,
  double? gpsKm,
) {
  if (savedValue != null) {
    return (
      value: savedValue,
      source: savedSource.isEmpty ? "typed" : savedSource,
      saved: true,
    );
  }
  if (gpsKm != null) return (value: gpsKm, source: "gps", saved: false);
  return (value: null, source: "", saved: false);
}

/// "gps" only while the value is still exactly the GPS reading it was filled
/// from; any edit makes it "typed" (web sourceForSave).
String odometerSourceForSave(double? value, double? gpsKm, String wasSource) {
  if (value == null) return "";
  if (wasSource == "gps" && gpsKm != null && value == gpsKm) return "gps";
  return "typed";
}

class _VehicleDayCard extends StatefulWidget {
  const _VehicleDayCard({
    super.key,
    required this.api,
    required this.vehicle,
    required this.date,
    required this.isToday,
    required this.editable,
    required this.fleetWide,
    required this.staffId,
    required this.onChanged,
  });

  final ApiClient api;
  final LogbookVehicle vehicle;
  final String date;
  final bool isToday;
  final bool editable;
  final bool fleetWide;
  final String staffId;
  final Future<void> Function() onChanged;

  @override
  State<_VehicleDayCard> createState() => _VehicleDayCardState();
}

class _VehicleDayCardState extends State<_VehicleDayCard> {
  late final TextEditingController _start;
  late final TextEditingController _end;
  late final TextEditingController _driver;
  late final TextEditingController _remarks;
  late String _startSrc;
  late String _endSrc;
  bool _busy = false;
  String? _msg;
  bool _msgOk = true;

  LogbookVehicle get v => widget.vehicle;

  double? get _gpsStart => v.gps.state == "ok" ? v.gps.firstKm : null;

  /// Today's "last reading so far" is not the evening odometer — the end
  /// figure is only offered from GPS for a finished day.
  double? get _gpsEndOffered =>
      v.gps.state == "ok" && !widget.isToday ? v.gps.lastKm : null;

  double? get _gpsEnd => v.gps.state == "ok" ? v.gps.lastKm : null;

  @override
  void initState() {
    super.initState();
    final s = odometerStart(
      v.log?.startKm,
      v.log?.startSource ?? "",
      _gpsStart,
    );
    final e = odometerStart(
      v.log?.endKm,
      v.log?.endSource ?? "",
      _gpsEndOffered,
    );
    _start = TextEditingController(
      text: s.value == null ? "" : kmText(s.value!),
    );
    _end = TextEditingController(text: e.value == null ? "" : kmText(e.value!));
    _startSrc = s.source;
    _endSrc = e.source;
    _driver = TextEditingController(
      text: (v.log?.driverName ?? "").isNotEmpty
          ? v.log!.driverName
          : v.driverName,
    );
    _remarks = TextEditingController(text: v.log?.remarks ?? "");
  }

  @override
  void dispose() {
    _start.dispose();
    _end.dispose();
    _driver.dispose();
    _remarks.dispose();
    super.dispose();
  }

  /// Blank → null; not a number → "invalid".
  static Object? _parse(String raw) {
    final t = raw.trim();
    if (t.isEmpty) return null;
    final n = double.tryParse(t);
    if (n == null || n < 0) return "invalid";
    return (n * 10).roundToDouble() / 10;
  }

  String get _kmLine {
    final a = _parse(_start.text);
    final b = _parse(_end.text);
    if (a is! double || b is! double) return "";
    if (b < a) return "End is below start — check the reading";
    return "${kmText(((b - a) * 10).roundToDouble() / 10)} km";
  }

  String get _gpsLine => switch (v.gps.state) {
    "ok" =>
      "GPS odometer: ${kmText(v.gps.firstKm ?? 0)} → "
          "${kmText(v.gps.lastKm ?? 0)} km${widget.isToday ? " (so far)" : ""}",
    "no_data" => "GPS: no odometer readings kept for this day — type them.",
    "untracked" => "No GPS tracker on this vehicle — type the figures.",
    _ => "GPS could not be read just now — type the figures or try later.",
  };

  Future<void> _save() async {
    final a = _parse(_start.text);
    final b = _parse(_end.text);
    if (a == "invalid" || b == "invalid") {
      setState(() {
        _msg = "Odometer must be a number of km (or blank).";
        _msgOk = false;
      });
      return;
    }
    final startKm = a as double?;
    final endKm = b as double?;
    setState(() {
      _busy = true;
      _msg = null;
    });
    try {
      await widget.api.saveDayLog(
        vehicleId: v.id,
        date: widget.date,
        startKm: startKm,
        startSource: odometerSourceForSave(startKm, _gpsStart, _startSrc),
        endKm: endKm,
        endSource: odometerSourceForSave(endKm, _gpsEnd, _endSrc),
        driverName: _driver.text.trim(),
        remarks: _remarks.text.trim(),
        expectedVersion: v.log?.rowVersion,
      );
      Haptics.success();
      if (!mounted) return;
      setState(() {
        _msg = "Saved · सेव हो गया";
        _msgOk = true;
      });
      await widget.onChanged();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _msg = e.statusCode == 409
            ? "Someone else saved this day first — pull down to reload, then "
                  "check and save again."
            : e.message;
        _msgOk = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _msg = "Not saved — check the internet. · सेव नहीं हुआ";
        _msgOk = false;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _odoField({
    required String label,
    required TextEditingController c,
    required String source,
    required ValueChanged<String> onEdited,
    double? gps,
    String gpsNote = "",
    required VoidCallback onUseGps,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: c,
          enabled: widget.editable,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: label,
            helperText: c.text.trim().isEmpty
                ? "Blank = not recorded"
                : source == "gps"
                ? "From GPS"
                : "Typed",
          ),
          onChanged: onEdited,
        ),
        if (widget.editable &&
            gps != null &&
            (source != "gps" || c.text.trim() != kmText(gps)))
          TextButton(
            onPressed: onUseGps,
            child: Text("Use GPS ${kmText(gps)}$gpsNote"),
          ),
      ],
    );
  }

  Future<void> _addFuel() async {
    final added = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) =>
          _FuelSheet(api: widget.api, vehicle: v, date: widget.date),
    );
    if (added == true) await widget.onChanged();
  }

  Future<void> _void(FuelFill f) async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Void this fuel entry?"),
        content: TextField(
          controller: reason,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: "Why is it wrong? · क्यों ग़लत है?",
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text("Cancel"),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text("Void"),
          ),
        ],
      ),
    );
    final why = reason.text.trim();
    reason.dispose();
    if (ok != true) return;
    if (why.isEmpty) {
      _snack("Say why the entry is wrong.");
      return;
    }
    try {
      await widget.api.voidFuelFill(id: f.id, reason: why);
      await widget.onChanged();
    } on ApiException catch (e) {
      _snack(e.message);
    } catch (_) {
      _snack("Not voided — check the internet.");
    }
  }

  void _snack(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    final unit = v.fuelUnit == "kg" ? "kg" : "L";
    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(v.name, style: AppText.titleMediumInk),
            Text(
              [
                if (v.registrationNo.isNotEmpty) v.registrationNo,
                if (v.routes.isNotEmpty) v.routes.join(", "),
              ].join(" · "),
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 4),
            Text(
              v.log == null
                  ? "Not saved for this day yet · अभी सेव नहीं"
                  : "Saved by ${v.log!.updatedByName.isEmpty ? "—" : v.log!.updatedByName}",
              style: AppText.labelMedium.copyWith(
                color: v.log == null ? AppColors.warning : AppColors.muted,
              ),
            ),
            const SizedBox(height: 4),
            Text(_gpsLine, style: AppText.bodySmallMuted),
            const SizedBox(height: 8),
            _odoField(
              label: "Start odometer (km) · शुरू का मीटर",
              c: _start,
              source: _startSrc,
              gps: _gpsStart,
              onEdited: (_) => setState(() => _startSrc = "typed"),
              onUseGps: () => setState(() {
                _start.text = kmText(_gpsStart!);
                _startSrc = "gps";
              }),
            ),
            _odoField(
              label: "End odometer (km) · आख़िरी मीटर",
              c: _end,
              source: _endSrc,
              gps: _gpsEnd,
              gpsNote: widget.isToday ? " (latest so far)" : "",
              onEdited: (_) => setState(() => _endSrc = "typed"),
              onUseGps: () => setState(() {
                _end.text = kmText(_gpsEnd!);
                _endSrc = "gps";
              }),
            ),
            if (_kmLine.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  _kmLine,
                  style: AppText.titleSmall.copyWith(
                    color: _kmLine.startsWith("End")
                        ? AppColors.danger
                        : AppColors.success,
                  ),
                ),
              ),
            TextField(
              controller: _driver,
              enabled: widget.editable,
              decoration: const InputDecoration(labelText: "Driver · चालक"),
            ),
            TextField(
              controller: _remarks,
              enabled: widget.editable,
              decoration: const InputDecoration(
                labelText: "Remarks / trips · टिप्पणी",
              ),
              maxLines: 2,
              minLines: 1,
            ),
            const SizedBox(height: 10),
            if (_msg != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  _msg!,
                  style: AppText.bodyMedium.copyWith(
                    color: _msgOk ? AppColors.success : AppColors.danger,
                  ),
                ),
              ),
            if (widget.editable)
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _busy ? null : _save,
                  icon: const Icon(Icons.save_outlined),
                  label: Text(_busy ? "Saving…" : "Save day · सेव करें"),
                ),
              ),
            const Divider(height: 26),
            Row(
              children: [
                Expanded(
                  child: Text("Fuel · ईंधन", style: AppText.titleSmallInk),
                ),
                if (widget.editable)
                  TextButton.icon(
                    onPressed: _addFuel,
                    icon: const Icon(Icons.local_gas_station_outlined),
                    label: const Text("Add fuel · जोड़ें"),
                  ),
              ],
            ),
            if (v.fills.isEmpty)
              Text(
                "No fuel entered for this day.",
                style: AppText.bodySmallMuted,
              ),
            for (final f in v.fills)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            "${kmText(f.quantity)} $unit · ${rupeesFromPaise(f.amountPaise)}"
                            "${f.odometerKm == null ? "" : " · ${kmText(f.odometerKm!)} km"}",
                            style: AppText.bodyLargeInk.copyWith(
                              decoration: f.voided
                                  ? TextDecoration.lineThrough
                                  : null,
                            ),
                          ),
                          Text(
                            [
                              if (f.createdByName.isNotEmpty) f.createdByName,
                              if (f.receiptPath.isNotEmpty) "bill photo",
                              if (f.note.isNotEmpty) f.note,
                              if (f.voided)
                                "VOID${f.voidReason.isEmpty ? "" : ": ${f.voidReason}"}",
                            ].join(" · "),
                            style: AppText.bodySmallMuted,
                          ),
                        ],
                      ),
                    ),
                    if (!f.voided &&
                        widget.editable &&
                        (widget.fleetWide ||
                            (widget.staffId.isNotEmpty &&
                                f.createdByStaffId == widget.staffId)))
                      TextButton(
                        onPressed: () => _void(f),
                        child: const Text("Void"),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Add one fuel fill. The entry id is made when the sheet opens and kept
/// across retries, so one fill can never be recorded twice.
class _FuelSheet extends StatefulWidget {
  const _FuelSheet({
    required this.api,
    required this.vehicle,
    required this.date,
  });

  final ApiClient api;
  final LogbookVehicle vehicle;
  final String date;

  @override
  State<_FuelSheet> createState() => _FuelSheetState();
}

class _FuelSheetState extends State<_FuelSheet> {
  final _qty = TextEditingController();
  final _amount = TextEditingController();
  final _odo = TextEditingController();
  final _note = TextEditingController();
  final String _id = transportClientId("fuel");
  File? _photo;
  String _receiptUrl = "";
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _qty.dispose();
    _amount.dispose();
    _odo.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick(ImageSource source) async {
    try {
      final shot = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1600,
        imageQuality: 75,
      );
      if (shot == null || !mounted) return;
      setState(() {
        _photo = File(shot.path);
        _receiptUrl = "";
      });
    } catch (_) {
      if (mounted) setState(() => _error = "Could not open the camera.");
    }
  }

  Future<void> _submit() async {
    final q = double.tryParse(_qty.text.trim());
    if (q == null || q <= 0) {
      setState(() => _error = "Enter the quantity filled.");
      return;
    }
    if (_amount.text.trim().isEmpty) {
      setState(() => _error = "Enter the amount paid in ₹.");
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // The photo goes first; the entry stores only its private file URL.
      if (_photo != null && _receiptUrl.isEmpty) {
        _receiptUrl = await widget.api.uploadFuelReceipt(
          _photo!,
          widget.vehicle.id,
        );
      }
      await widget.api.addFuelFill(
        id: _id,
        vehicleId: widget.vehicle.id,
        date: widget.date,
        quantity: _qty.text.trim(),
        amountRupees: _amount.text.trim(),
        odometerKm: _odo.text.trim(),
        receiptUrl: _receiptUrl,
        note: _note.text.trim(),
      );
      Haptics.success();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = "Not saved — check the internet and try again.",
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final unit = widget.vehicle.fuelUnit == "kg" ? "kg" : "litres";
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        16 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Fuel — ${widget.vehicle.name}",
              style: AppText.titleMediumInk,
            ),
            TextField(
              controller: _qty,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: "Quantity ($unit) · मात्रा",
              ),
            ),
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: "Amount paid (₹) · रक़म",
              ),
            ),
            TextField(
              controller: _odo,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: "Odometer (km) — optional · मीटर",
              ),
            ),
            TextField(
              controller: _note,
              decoration: const InputDecoration(
                labelText: "Pump / note — optional",
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _photo == null
                        ? "Bill photo — optional · बिल की फ़ोटो"
                        : "Bill photo attached",
                    style: AppText.bodyMedium.copyWith(
                      color: _photo == null
                          ? AppColors.muted
                          : AppColors.success,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: "Camera",
                  onPressed: _busy ? null : () => _pick(ImageSource.camera),
                  icon: const Icon(Icons.photo_camera_outlined),
                ),
                IconButton(
                  tooltip: "Gallery",
                  onPressed: _busy ? null : () => _pick(ImageSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined),
                ),
              ],
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  style: AppText.bodyMedium.copyWith(color: AppColors.danger),
                ),
              ),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _busy ? null : _submit,
                child: Text(_busy ? "Saving…" : "Save fuel · सेव करें"),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LbNote extends StatelessWidget {
  const _LbNote({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withValues(alpha: 0.3)),
    ),
    child: Text(text, style: AppText.bodyMedium.copyWith(color: color)),
  );
}

// ------------------------------------------------------------------ month

/// Vehicle km and fuel for a month: km only from days with both readings
/// (end ≥ start); the rest are counted as problem days, never guessed.
class LogbookMonthScreen extends StatefulWidget {
  const LogbookMonthScreen({super.key, required this.api, this.month = ""});

  final ApiClient api;

  /// YYYY-MM; empty = this month.
  final String month;

  @override
  State<LogbookMonthScreen> createState() => _LogbookMonthScreenState();
}

class _LogbookMonthScreenState extends State<LogbookMonthScreen> {
  late String _month;
  Future<LogbookMonth>? _future;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = widget.month.isNotEmpty
        ? widget.month
        : "${now.year}-${now.month.toString().padLeft(2, "0")}";
    _future = widget.api.fetchLogbookMonth(month: _month);
  }

  void _go(int delta) {
    setState(() {
      _month = shiftMonth(_month, delta);
      _future = widget.api.fetchLogbookMonth(month: _month);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Log book — month"),
        actions: const [
          ScreenGuideButton(
            guideId: "vehicle-logbook-month",
            screenLabel: "Log book month",
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
            child: Row(
              children: [
                IconButton(
                  onPressed: () => _go(-1),
                  icon: const Icon(Icons.chevron_left),
                ),
                Expanded(
                  child: Text(
                    _month,
                    textAlign: TextAlign.center,
                    style: AppText.titleMediumInk,
                  ),
                ),
                IconButton(
                  onPressed: () => _go(1),
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
          ),
          Expanded(
            child: FutureBuilder<LogbookMonth>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snap.hasError) {
                  final e = snap.error;
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            e is ApiException
                                ? e.message
                                : "Could not reach the school — check the internet.",
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: () => _go(0),
                            child: const Text("Try again · दोबारा"),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                final m = snap.data!;
                if (m.rows.isEmpty) {
                  return const Center(child: Text("No vehicles to show."));
                }
                return ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    for (final r in m.rows)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(r.name, style: AppText.titleMediumInk),
                              if (r.registrationNo.isNotEmpty)
                                Text(
                                  r.registrationNo,
                                  style: AppText.bodySmallMuted,
                                ),
                              const SizedBox(height: 8),
                              _MonthLine(
                                "Km run",
                                "${kmText(r.km)} km over ${r.daysWithKm} day(s)",
                              ),
                              _MonthLine(
                                "Days logged",
                                "${r.daysLogged} (GPS ${r.gpsDays}, typed ${r.typedDays})",
                              ),
                              if (r.problemDays > 0)
                                _MonthLine(
                                  "Not counted",
                                  "${r.problemDays} day(s) — a reading missing "
                                      "or end below start",
                                  color: AppColors.warning,
                                ),
                              _MonthLine(
                                "Fuel",
                                [
                                  "${r.fills} fill(s)",
                                  if (r.litres > 0) "${kmText(r.litres)} L",
                                  if (r.kg > 0) "${kmText(r.kg)} kg",
                                  rupeesFromPaise(r.amountPaise),
                                ].join(" · "),
                              ),
                              _MonthLine(
                                "₹ per km",
                                r.rupeesPerKm == null
                                    ? "— (no km counted)"
                                    : "₹${r.rupeesPerKm!.toStringAsFixed(2)}",
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _MonthLine extends StatelessWidget {
  const _MonthLine(this.label, this.value, {this.color});

  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 104, child: Text(label, style: AppText.bodySmallMuted)),
        Expanded(
          child: Text(
            value,
            style: AppText.bodyMediumInk.copyWith(color: color),
          ),
        ),
      ],
    ),
  );
}

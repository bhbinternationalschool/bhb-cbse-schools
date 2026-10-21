part of "api_client.dart";

// Bus register (v2) and the driver's log book — the same server routes the
// web ERP's Transport → Bus register and Log book use:
//   /api/v1/transport/register/{runs,run,mark,exceptions,month}
//   /api/v1/transport/logbook, /logbook/fuel, /logbook/month
//
// The server decides whose bus is shown: a driver or attendant sees only the
// bus linked to them in Staff → Duties or Fleet; the office and leadership
// see every bus. The phone never sends whose data it wants beyond the route
// it was handed by the server.
//
// The rule under all of it (web lib/transportBoardingLog.ts): a child with
// no mark is NOT MARKED — never absent, never boarded. A blank odometer is
// "not recorded", never 0.

/// A nullable number from JSON (`null` / missing / not a number → null).
double? _trNum(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v is num ? v.toDouble() : null;
}

/// A string that may arrive as null or as a number.
String _trStr(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v == null ? "" : "$v";
}

/// A status word, or null for "not marked".
String? _trStatus(Object? v) {
  final s = v is String ? v : "";
  return s == "boarded" || s == "not_boarded" || s == "dropped" ? s : null;
}

Map<String, dynamic> _trMap(Map<String, dynamic> j, String k) =>
    Map<String, dynamic>.from((j[k] as Map?) ?? const {});

// ------------------------------------------------------------ bus register

/// The buttons, in the server's words: AM = morning pick-up, PM = drop.
const kRegisterStatusLabel = {
  "boarded": "Boarded · चढ़ गए",
  "not_boarded": "Not boarded · नहीं आया",
  "dropped": "Dropped · उतर गए",
};

class RegisterCounts {
  RegisterCounts.fromJson(Map<String, dynamic> j)
    : riders = _i(j, "riders"),
      boarded = _i(j, "boarded"),
      dropped = _i(j, "dropped"),
      notBoarded = _i(j, "notBoarded"),
      unmarked = _i(j, "unmarked");

  final int riders;
  final int boarded;
  final int dropped;
  final int notBoarded;
  final int unmarked;

  int get marked => riders - unmarked;
}

/// One run of one route on one day: a morning pick-up or an afternoon drop
/// (a route with timed runs has one per shift).
class RegisterRun {
  RegisterRun.fromJson(Map<String, dynamic> j)
    : routeId = _s(j, "routeId"),
      trip = _s(j, "trip") == "PM" ? "PM" : "AM",
      shiftId = _s(j, "shiftId"),
      name = _s(j, "name"),
      departTime = _s(j, "departTime"),
      routeName = _trStr(j, "routeName"),
      busNo = _trStr(j, "busNo"),
      vehicleName = _trStr(j, "vehicleName"),
      counts = j["counts"] is Map
          ? RegisterCounts.fromJson(_trMap(j, "counts"))
          : null,
      unresolved = _i(j, "unresolved");

  final String routeId;

  /// "AM" | "PM".
  final String trip;

  /// "" when the route has no timed runs (one journey each way).
  final String shiftId;
  final String name;
  final String departTime;
  final String routeName;
  final String busNo;
  final String vehicleName;

  /// Null on the single-run reply, which carries counts at the top level.
  final RegisterCounts? counts;

  /// Children whose run could not be worked out (listed on every run).
  final int unresolved;
}

class RegisterRunsDay {
  RegisterRunsDay.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      today = _s(j, "today"),
      fleetWide = _b(j, "fleetWide"),
      unlinked = _b(j, "unlinked"),
      editableDaysBack = _i(j, "editableDaysBack"),
      classesKnown = j["classesKnown"] != false,
      runs = _list(j, "runs").map(RegisterRun.fromJson).toList();

  final String date;

  /// Today in India, from the server — the phone's clock is not asked.
  final String today;

  /// Office / leadership: every bus. Crew: only their own.
  final bool fleetWide;

  /// Crew nobody has linked to a bus yet.
  final bool unlinked;
  final int editableDaysBack;
  final bool classesKnown;
  final List<RegisterRun> runs;
}

class RegisterRider {
  RegisterRider.fromJson(Map<String, dynamic> j)
    : studentId = _s(j, "studentId"),
      fullName = _trStr(j, "fullName"),
      admissionNo = _trStr(j, "admissionNo"),
      className = _trStr(j, "className"),
      stopId = _trStr(j, "stopId"),
      stopName = _trStr(j, "stopName"),
      stopSequence = _trNum(j, "stopSequence")?.toInt(),
      shiftUnresolved = _b(j, "shiftUnresolved"),
      shiftNote = _trStr(j, "shiftNote"),
      status = _trStatus(j["status"]),
      tappedAt = _trStr(j, "tappedAt"),
      markedByName = _trStr(j, "markedByName");

  final String studentId;
  final String fullName;
  final String admissionNo;
  final String className;
  final String stopId;

  /// "" when the stop no longer resolves — the child is still listed.
  final String stopName;
  final int? stopSequence;
  final bool shiftUnresolved;
  final String shiftNote;

  /// boarded | not_boarded | dropped, or null = not marked.
  final String? status;
  final String tappedAt;
  final String markedByName;
}

class RegisterRunView {
  RegisterRunView.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      today = _s(j, "today"),
      editable = _b(j, "editable"),
      routeId = _s(_trMap(j, "route"), "id"),
      routeName = _trStr(_trMap(j, "route"), "name"),
      busNo = _trStr(_trMap(j, "route"), "busNo"),
      vehicleName = _trStr(_trMap(j, "route"), "vehicleName"),
      run = RegisterRun.fromJson(_trMap(j, "run")),
      statuses = ((j["statuses"] as List?) ?? const [])
          .map((e) => "$e")
          .where((s) => kRegisterStatusLabel.containsKey(s))
          .toList(),
      classesKnown = j["classesKnown"] != false,
      riders = _list(j, "riders").map(RegisterRider.fromJson).toList(),
      counts = RegisterCounts.fromJson(_trMap(j, "counts"));

  final String date;
  final String today;

  /// False for a day the server no longer lets this person change.
  final bool editable;
  final String routeId;
  final String routeName;
  final String busNo;
  final String vehicleName;
  final RegisterRun run;

  /// The buttons for this trip, as the server lists them.
  final List<String> statuses;
  final bool classesKnown;

  /// In the order the bus reaches the stops (reversed for a drop).
  final List<RegisterRider> riders;
  final RegisterCounts counts;
}

class RegisterMarkResult {
  RegisterMarkResult.fromJson(Map<String, dynamic> j)
    : applied = j["applied"] != false,
      studentId = _s(j, "studentId"),
      status = _trStatus(j["status"]),
      tappedAt = _trStr(j, "tappedAt"),
      markedByName = _trStr(j, "markedByName");

  /// False when a newer tap was already stored — [status] is the stored one.
  final bool applied;
  final String studentId;
  final String? status;
  final String tappedAt;
  final String markedByName;
}

class RegisterException {
  RegisterException.fromJson(Map<String, dynamic> j)
    : kind = _s(j, "kind"),
      studentId = _s(j, "studentId"),
      fullName = _trStr(j, "fullName"),
      className = _trStr(j, "className"),
      routeName = _trStr(j, "routeName"),
      stopName = _trStr(j, "stopName"),
      amStatus = _trStatus(j["amStatus"]),
      pmStatus = _trStatus(j["pmStatus"]),
      classMark = _trStr(j, "classMark");

  /// boarded_absent | present_not_boarded | no_return
  final String kind;
  final String studentId;
  final String fullName;
  final String className;
  final String routeName;
  final String stopName;
  final String? amStatus;
  final String? pmStatus;

  /// P / A / L / HD / LE, "" when none.
  final String classMark;

  String get label => switch (kind) {
    "boarded_absent" => "Boarded the morning bus, absent in class",
    "present_not_boarded" => "Present in class, not on the morning bus",
    "no_return" => "Came by bus, not on the drop",
    _ => kind,
  };
}

class RegisterExceptions {
  RegisterExceptions.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      classRegisterOk = _s(j, "classRegister") == "ok",
      sectionsWithoutRegister = _trNum(j, "sectionsWithoutRegister")?.toInt(),
      riderSections = _i(j, "riderSections"),
      unchecked = _i(j, "unchecked"),
      exceptions = _list(
        j,
        "exceptions",
      ).map(RegisterException.fromJson).toList();

  final String date;

  /// False when the class register could not be read at all — only the
  /// bus-only check ("not on the drop") is in [exceptions] then.
  final bool classRegisterOk;

  /// Null when the class register could not be read.
  final int? sectionsWithoutRegister;
  final int riderSections;

  /// Children marked on the bus whose class register was not taken.
  final int unchecked;
  final List<RegisterException> exceptions;
}

class RegisterMonthRow {
  RegisterMonthRow.fromJson(Map<String, dynamic> j)
    : studentId = _s(j, "studentId"),
      fullName = _trStr(j, "fullName"),
      admissionNo = _trStr(j, "admissionNo"),
      className = _trStr(j, "className"),
      routeName = _trStr(j, "routeName"),
      amRidden = _i(j, "amRidden"),
      pmRidden = _i(j, "pmRidden"),
      notBoarded = _i(j, "notBoarded"),
      daysRidden = _i(j, "daysRidden"),
      days = _trMap(j, "days").map((date, v) {
        final c = Map<String, dynamic>.from((v as Map?) ?? const {});
        return MapEntry(date, (am: _trStatus(c["am"]), pm: _trStatus(c["pm"])));
      });

  final String studentId;
  final String fullName;
  final String admissionNo;
  final String className;
  final String routeName;
  final int amRidden;
  final int pmRidden;
  final int notBoarded;
  final int daysRidden;

  /// date → the morning and afternoon mark (null = not marked).
  final Map<String, ({String? am, String? pm})> days;
}

class RegisterMonth {
  RegisterMonth.fromJson(Map<String, dynamic> j)
    : month = _s(j, "month"),
      dates = ((j["dates"] as List?) ?? const []).map((e) => "$e").toList(),
      fleetWide = _b(j, "fleetWide"),
      rows = _list(j, "rows").map(RegisterMonthRow.fromJson).toList();

  final String month;
  final List<String> dates;
  final bool fleetWide;
  final List<RegisterMonthRow> rows;
}

// ---------------------------------------------------------------- log book

class DayLog {
  DayLog.fromJson(Map<String, dynamic> j)
    : vehicleId = _s(j, "vehicleId"),
      logDate = _s(j, "logDate"),
      startKm = _trNum(j, "startKm"),
      startSource = _trStr(j, "startSource"),
      endKm = _trNum(j, "endKm"),
      endSource = _trStr(j, "endSource"),
      driverName = _trStr(j, "driverName"),
      remarks = _trStr(j, "remarks"),
      rowVersion = _i(j, "rowVersion"),
      updatedByName = _trStr(j, "updatedByName"),
      updatedAt = _trStr(j, "updatedAt");

  final String vehicleId;
  final String logDate;

  /// Null = not recorded (never 0).
  final double? startKm;

  /// "gps" | "typed" | "".
  final String startSource;
  final double? endKm;
  final String endSource;
  final String driverName;
  final String remarks;

  /// What a save must quote back; a mismatch means another phone saved first.
  final int rowVersion;
  final String updatedByName;
  final String updatedAt;
}

/// End − start, only when both readings are there and end ≥ start.
class DayKm {
  DayKm.fromJson(Map<String, dynamic> j)
    : ok = _b(j, "ok"),
      km = _trNum(j, "km"),
      reason = _trStr(j, "reason");

  final bool ok;
  final double? km;

  /// incomplete | end_before_start (when not ok).
  final String reason;
}

/// The Fleet Edge odometer for the day, where the bus has a tracker.
class GpsOdometer {
  GpsOdometer.fromJson(Map<String, dynamic> j)
    : state = _s(j, "state").isEmpty ? "unavailable" : _s(j, "state"),
      firstKm = _trNum(_trMap(j, "day"), "firstKm"),
      lastKm = _trNum(_trMap(j, "day"), "lastKm");

  /// ok | no_data | untracked | unavailable ("unavailable" = the feed could
  /// not be read — never shown as "no tracker").
  final String state;
  final double? firstKm;
  final double? lastKm;
}

class FuelFill {
  FuelFill.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      vehicleId = _s(j, "vehicleId"),
      fillDate = _s(j, "fillDate"),
      quantity = _trNum(j, "quantity") ?? 0,
      unit = _s(j, "unit") == "kg" ? "kg" : "litre",
      amountPaise = _i(j, "amountPaise"),
      odometerKm = _trNum(j, "odometerKm"),
      receiptPath = _trStr(j, "receiptPath"),
      note = _trStr(j, "note"),
      createdByStaffId = _trStr(j, "createdByStaffId"),
      createdByName = _trStr(j, "createdByName"),
      createdAt = _trStr(j, "createdAt"),
      voided = _b(j, "voided"),
      voidReason = _trStr(j, "voidReason");

  final String id;
  final String vehicleId;
  final String fillDate;
  final double quantity;

  /// "litre" | "kg" (CNG), from the vehicle.
  final String unit;
  final int amountPaise;
  final double? odometerKm;
  final String receiptPath;
  final String note;
  final String createdByStaffId;
  final String createdByName;
  final String createdAt;

  /// A wrong entry is voided with a reason, never deleted.
  final bool voided;
  final String voidReason;
}

class LogbookVehicle {
  LogbookVehicle.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      name = _trStr(j, "name"),
      registrationNo = _trStr(j, "registrationNo"),
      driverName = _trStr(j, "driverName"),
      fuelUnit = _s(j, "fuelUnit") == "kg" ? "kg" : "litre",
      routes = ((j["routes"] as List?) ?? const []).map((e) => "$e").toList(),
      log = j["log"] is Map ? DayLog.fromJson(_trMap(j, "log")) : null,
      km = j["km"] is Map ? DayKm.fromJson(_trMap(j, "km")) : null,
      gps = GpsOdometer.fromJson(_trMap(j, "gps")),
      fills = _list(j, "fills").map(FuelFill.fromJson).toList();

  final String id;
  final String name;
  final String registrationNo;
  final String driverName;
  final String fuelUnit;
  final List<String> routes;

  /// Null when nothing is saved for the day yet.
  final DayLog? log;
  final DayKm? km;
  final GpsOdometer gps;
  final List<FuelFill> fills;
}

class LogbookDay {
  LogbookDay.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      today = _s(j, "today"),
      fleetWide = _b(j, "fleetWide"),
      unlinked = _b(j, "unlinked"),
      editable = _b(j, "editable"),
      staffId = _trStr(j, "staffId"),
      vehicles = _list(j, "vehicles").map(LogbookVehicle.fromJson).toList();

  final String date;
  final String today;
  final bool fleetWide;
  final bool unlinked;
  final bool editable;

  /// The signed-in person — their own fuel entries may be voided by them.
  final String staffId;
  final List<LogbookVehicle> vehicles;
}

class VehicleMonthRow {
  VehicleMonthRow.fromJson(Map<String, dynamic> j)
    : vehicleId = _s(j, "vehicleId"),
      name = _trStr(j, "name"),
      registrationNo = _trStr(j, "registrationNo"),
      daysLogged = _i(j, "daysLogged"),
      daysWithKm = _i(j, "daysWithKm"),
      km = _trNum(j, "km") ?? 0,
      gpsDays = _i(j, "gpsDays"),
      typedDays = _i(j, "typedDays"),
      problemDays = _i(j, "problemDays"),
      fills = _i(j, "fills"),
      litres = _trNum(j, "litres") ?? 0,
      kg = _trNum(j, "kg") ?? 0,
      amountPaise = _i(j, "amountPaise"),
      rupeesPerKm = _trNum(j, "rupeesPerKm");

  final String vehicleId;
  final String name;
  final String registrationNo;
  final int daysLogged;
  final int daysWithKm;
  final double km;
  final int gpsDays;
  final int typedDays;

  /// One reading missing, or end below start — not counted in [km].
  final int problemDays;
  final int fills;
  final double litres;
  final double kg;
  final int amountPaise;

  /// Null when no km counted (never divided by zero).
  final double? rupeesPerKm;
}

class LogbookMonth {
  LogbookMonth.fromJson(Map<String, dynamic> j)
    : month = _s(j, "month"),
      fleetWide = _b(j, "fleetWide"),
      rows = _list(j, "rows").map(VehicleMonthRow.fromJson).toList(),
      logs = _list(j, "logs").map(DayLog.fromJson).toList(),
      fills = _list(j, "fills").map(FuelFill.fromJson).toList();

  final String month;
  final bool fleetWide;
  final List<VehicleMonthRow> rows;
  final List<DayLog> logs;
  final List<FuelFill> fills;
}

/// ₹ from paise, with at most two decimals ("₹1,250" / "₹99.5").
String rupeesFromPaise(int paise) {
  final r = paise / 100;
  final whole = r.truncate();
  final frac = ((r - whole) * 100).round();
  final digits = "$whole";
  // Indian grouping: last three, then pairs.
  String grouped;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    final head = digits.substring(0, digits.length - 3);
    final tail = digits.substring(digits.length - 3);
    final pairs = <String>[];
    for (var i = head.length; i > 0; i -= 2) {
      pairs.insert(0, head.substring(i - 2 < 0 ? 0 : i - 2, i));
    }
    grouped = "${pairs.join(",")},$tail";
  }
  if (frac == 0) return "₹$grouped";
  final f = frac % 10 == 0 ? "${frac ~/ 10}" : frac.toString().padLeft(2, "0");
  return "₹$grouped.$f";
}

/// km without a trailing ".0" ("12345" / "12345.6").
String kmText(double km) =>
    km == km.roundToDouble() ? km.toInt().toString() : km.toStringAsFixed(1);

/// An id made on the phone, so a retried save cannot create a second row
/// (the server accepts [A-Za-z0-9_-]{8,64}).
String transportClientId(String prefix) {
  final r = math.Random.secure();
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  final tail = List.generate(20, (_) => chars[r.nextInt(chars.length)]).join();
  return "${prefix}_$tail";
}

// ------------------------------------------------------------------ calls

extension TransportRegisterApi on ApiClient {
  /// The day's runs in the caller's reach. [date] empty = today (IST).
  Future<RegisterRunsDay> fetchRegisterRuns({String date = ""}) async =>
      RegisterRunsDay.fromJson(
        await _getData(
          "/api/v1/transport/register/runs"
          "${date.isEmpty ? "" : "?date=${Uri.encodeQueryComponent(date)}"}",
        ),
      );

  /// One run's riders in stop order, each with its mark.
  Future<RegisterRunView> fetchRegisterRun({
    required String date,
    required String routeId,
    required String trip,
    required String shiftId,
  }) async => RegisterRunView.fromJson(
    await _getData(
      "/api/v1/transport/register/run"
      "?date=${Uri.encodeQueryComponent(date)}"
      "&routeId=${Uri.encodeQueryComponent(routeId)}"
      "&trip=${trip == "PM" ? "PM" : "AM"}"
      "&shiftId=${Uri.encodeQueryComponent(shiftId)}",
    ),
  );

  /// One tap = one request. [status] is boarded / not_boarded / dropped, or
  /// "unmarked" to undo. [clientRef] and [tappedAt] stay the same across
  /// retries of the same tap: the server keeps the newest tap, so a late
  /// retry of an older tap cannot overwrite a newer one. Location is
  /// optional — sent when the phone already has a fix.
  Future<RegisterMarkResult> markRegister({
    required String date,
    required String routeId,
    required String trip,
    required String shiftId,
    required String studentId,
    required String status,
    required String tappedAt,
    required String clientRef,
    double? lat,
    double? lng,
    double? accuracyM,
  }) async => RegisterMarkResult.fromJson(
    await _postData("/api/v1/transport/register/mark", {
      "date": date,
      "routeId": routeId,
      "trip": trip,
      "shiftId": shiftId,
      "studentId": studentId,
      "status": status,
      "tappedAt": tappedAt,
      "clientRef": clientRef,
      "lat": ?lat,
      "lng": ?lng,
      "accuracyM": ?accuracyM,
    }),
  );

  /// Office / leadership only (the server answers 403 to crew).
  Future<RegisterExceptions> fetchRegisterExceptions({
    String date = "",
  }) async => RegisterExceptions.fromJson(
    await _getData(
      "/api/v1/transport/register/exceptions"
      "${date.isEmpty ? "" : "?date=${Uri.encodeQueryComponent(date)}"}",
    ),
  );

  /// Month-wise boarding per child. [month] is YYYY-MM.
  Future<RegisterMonth> fetchRegisterMonth({
    required String month,
    String routeId = "",
  }) async => RegisterMonth.fromJson(
    await _getData(
      "/api/v1/transport/register/month?month=${Uri.encodeQueryComponent(month)}"
      "${routeId.isEmpty ? "" : "&routeId=${Uri.encodeQueryComponent(routeId)}"}",
    ),
  );

  /// The log book for one day: every vehicle in reach, its saved readings,
  /// fuel filled and the GPS odometer where there is one.
  Future<LogbookDay> fetchLogbook({String date = ""}) async =>
      LogbookDay.fromJson(
        await _getData(
          "/api/v1/transport/logbook"
          "${date.isEmpty ? "" : "?date=${Uri.encodeQueryComponent(date)}"}",
        ),
      );

  /// Saves one vehicle-day. Null km = not recorded. [expectedVersion] is the
  /// rowVersion the form loaded (null when nothing was saved); the server
  /// answers 409 when another phone saved first.
  Future<({DayLog log, DayKm km})> saveDayLog({
    required String vehicleId,
    required String date,
    required double? startKm,
    required String startSource,
    required double? endKm,
    required String endSource,
    String driverName = "",
    String remarks = "",
    required int? expectedVersion,
  }) async {
    final data = await _postData("/api/v1/transport/logbook", {
      "vehicleId": vehicleId,
      "date": date,
      "startKm": startKm,
      "startSource": startSource,
      "endKm": endKm,
      "endSource": endSource,
      "driverName": driverName,
      "remarks": remarks,
      "expectedVersion": expectedVersion,
    });
    return (
      log: DayLog.fromJson(_trMap(data, "log")),
      km: DayKm.fromJson(_trMap(data, "km")),
    );
  }

  /// [id] is made on the phone ([transportClientId]) and kept across
  /// retries, so one fill is never recorded twice.
  Future<FuelFill> addFuelFill({
    required String id,
    required String vehicleId,
    required String date,
    required String quantity,
    required String amountRupees,
    String odometerKm = "",
    String receiptUrl = "",
    String note = "",
  }) async {
    final data = await _postData("/api/v1/transport/logbook/fuel", {
      "action": "add",
      "id": id,
      "vehicleId": vehicleId,
      "date": date,
      "quantity": quantity,
      "amountRupees": amountRupees,
      "odometerKm": odometerKm,
      "receiptUrl": receiptUrl,
      "note": note,
    });
    return FuelFill.fromJson(_trMap(data, "fill"));
  }

  Future<FuelFill> voidFuelFill({
    required String id,
    required String reason,
  }) async {
    final data = await _postData("/api/v1/transport/logbook/fuel", {
      "action": "void",
      "id": id,
      "reason": reason,
    });
    return FuelFill.fromJson(_trMap(data, "fill"));
  }

  /// Read a fuel bill photo → a draft for the fuel form (amount, date,
  /// quantity, rate, odometer, pump, bill no.). Saves nothing; fields that
  /// could not be read come back empty.
  Future<Map<String, dynamic>> scanFuelBill({
    required String vehicleId,
    required String date,
    required String imageBase64,
    String mimeType = "image/jpeg",
  }) async {
    final data = await _postData("/api/v1/staff/logbook/scan-bill", {
      "kind": "fuel_bill",
      "vehicleId": vehicleId,
      "date": date,
      "imageBase64": imageBase64,
      "mimeType": mimeType,
    });
    return Map<String, dynamic>.from((data["reading"] as Map?) ?? const {});
  }

  /// Uploads a bill photo to the school's private files (the same /api/upload
  /// the web log book uses) and returns its `/api/file/…` URL, which is what
  /// the fuel entry stores.
  Future<String> uploadFuelReceipt(File file, String vehicleId) async {
    final lower = file.path.toLowerCase();
    final ext = lower.endsWith(".png")
        ? "png"
        : lower.endsWith(".webp")
        ? "webp"
        : "jpg";
    final mime = ext == "jpg" ? "image/jpeg" : "image/$ext";
    final safeVehicle = vehicleId.replaceAll(RegExp(r"[^A-Za-z0-9_-]"), "");
    final path =
        "transport/fuel-receipts/$safeVehicle/"
        "${DateTime.now().millisecondsSinceEpoch}-${transportClientId("r")}.$ext";
    final req = http.MultipartRequest("POST", _uri("/api/upload"));
    final headers = await _authHeaders();
    headers.remove("Content-Type");
    req.headers.addAll(headers);
    req.fields["path"] = path;
    req.fields["bucket"] = "school-files";
    req.files.add(
      await http.MultipartFile.fromPath(
        "file",
        file.path,
        filename: path.split("/").last,
        contentType: MediaType.parse(mime),
      ),
    );
    final res = await http.Response.fromStream(await _uploadHttp.send(req));
    if (res.statusCode != 200) _throwFrom(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final url = "${body["url"] ?? ""}";
    if (body["ok"] != true || !url.startsWith("/api/file/")) {
      throw ApiException(
        "The bill photo was not saved — try again.",
        res.statusCode,
      );
    }
    return url;
  }

  /// Vehicle km and fuel for a month ([month] YYYY-MM).
  Future<LogbookMonth> fetchLogbookMonth({
    required String month,
  }) async => LogbookMonth.fromJson(
    await _getData(
      "/api/v1/transport/logbook/month?month=${Uri.encodeQueryComponent(month)}",
    ),
  );
}

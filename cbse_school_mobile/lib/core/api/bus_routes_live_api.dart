part of "api_client.dart";

// All bus routes, live — /api/v1/staff/bus-routes/live.
//
// The same position source as the web ERP's Transport → Live map (Fleet Edge
// telemetry). The server works out the run on the road, which stops the bus
// has already been to and roughly when it reaches the rest (web
// lib/busRouteEta.ts). This side only shows it, and never upgrades an old fix
// into a live one: a stale fix carries no arrival times at all.

double? _blNum(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v is num ? v.toDouble() : null;
}

String _blStr(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v == null ? "" : "$v";
}

DateTime? _blTime(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v is String && v.isNotEmpty ? DateTime.tryParse(v) : null;
}

class LiveBusFix {
  LiveBusFix.fromJson(Map<String, dynamic> j)
    : lat = _blNum(j, "lat") ?? 0,
      lng = _blNum(j, "lng") ?? 0,
      speedKmh = _blNum(j, "speedKmh"),
      headingDeg = _blNum(j, "headingDeg"),
      fixAt = _blTime(j, "fixAt"),
      ageSec = (j["ageSec"] as num?)?.toInt() ?? 0,
      // Anything the server did not call fresh is treated as stale.
      stale = j["stale"] != false;

  final double lat;
  final double lng;
  final double? speedKmh;
  final double? headingDeg;
  final DateTime? fixAt;
  final int ageSec;
  final bool stale;

  bool get hasPoint => lat.abs() > 0.0001 && lng.abs() > 0.0001;
}

class LiveRouteStop {
  LiveRouteStop.fromJson(Map<String, dynamic> j)
    : id = _blStr(j, "id"),
      name = _blStr(j, "name"),
      sequence = (j["sequence"] as num?)?.toInt() ?? 0,
      lat = _blNum(j, "lat"),
      lng = _blNum(j, "lng"),
      state = switch (_blStr(j, "state")) {
        "passed" => "passed",
        "not_seen" => "not_seen",
        "unpinned" => "unpinned",
        _ => "upcoming",
      },
      passedAt = _blTime(j, "passedAt"),
      etaAt = _blTime(j, "etaAt"),
      etaMinutes = (j["etaMinutes"] as num?)?.toInt();

  final String id;
  final String name;
  final int sequence;
  final double? lat;
  final double? lng;

  /// passed · not_seen · upcoming · unpinned
  final String state;
  final DateTime? passedAt;
  final DateTime? etaAt;
  final int? etaMinutes;

  bool get pinned => lat != null && lng != null;
}

class LiveRouteRun {
  LiveRouteRun.fromJson(Map<String, dynamic> j)
    : shiftId = _blStr(j, "shiftId"),
      name = _blStr(j, "name"),
      trip = _blStr(j, "trip") == "PM" ? "PM" : "AM",
      departTime = _blStr(j, "departTime");

  final String shiftId;
  final String name;
  final String trip;
  final String departTime;
}

class LiveRouteView {
  LiveRouteView.fromJson(Map<String, dynamic> j)
    : routeId = _blStr(j, "routeId"),
      code = _blStr(j, "code"),
      name = _blStr(j, "name"),
      busNo = _blStr(j, "busNo"),
      vehicleName = j["vehicle"] is Map
          ? _blStr(Map<String, dynamic>.from(j["vehicle"] as Map), "name")
          : "",
      vehicleReg = j["vehicle"] is Map
          ? _blStr(
              Map<String, dynamic>.from(j["vehicle"] as Map),
              "registrationNo",
            )
          : "",
      status = switch (_blStr(j, "status")) {
        "live" => "live",
        "stale" => "stale",
        "off_shift" => "off_shift",
        "untracked" => "untracked",
        _ => "no_vehicle",
      },
      run = j["run"] is Map
          ? LiveRouteRun.fromJson(Map<String, dynamic>.from(j["run"] as Map))
          : null,
      fix = j["fix"] is Map
          ? LiveBusFix.fromJson(Map<String, dynamic>.from(j["fix"] as Map))
          : null,
      trailUnread = j["trailUnread"] == true,
      stops = ((j["stops"] as List?) ?? const [])
          .map(
            (s) => LiveRouteStop.fromJson(Map<String, dynamic>.from(s as Map)),
          )
          .toList(),
      schoolEtaAt = j["schoolEta"] is Map
          ? _blTime(Map<String, dynamic>.from(j["schoolEta"] as Map), "etaAt")
          : null,
      schoolEtaMinutes = j["schoolEta"] is Map
          ? ((j["schoolEta"] as Map)["etaMinutes"] as num?)?.toInt()
          : null;

  final String routeId;
  final String code;
  final String name;
  final String busNo;
  final String vehicleName;
  final String vehicleReg;

  /// live · stale · off_shift · untracked · no_vehicle
  final String status;
  final LiveRouteRun? run;
  final LiveBusFix? fix;
  final bool trailUnread;
  final List<LiveRouteStop> stops;
  final DateTime? schoolEtaAt;
  final int? schoolEtaMinutes;
}

class BusRoutesLive {
  BusRoutesLive.fromJson(Map<String, dynamic> j)
    : at = _blTime(j, "at"),
      schoolLat = j["school"] is Map
          ? ((j["school"] as Map)["lat"] as num?)?.toDouble()
          : null,
      schoolLng = j["school"] is Map
          ? ((j["school"] as Map)["lng"] as num?)?.toDouble()
          : null,
      staleAfterMinutes = (j["staleAfterMinutes"] as num?)?.toInt() ?? 10,
      scoped = j["scoped"] == true,
      routes = ((j["routes"] as List?) ?? const [])
          .map(
            (r) => LiveRouteView.fromJson(Map<String, dynamic>.from(r as Map)),
          )
          .toList();

  final DateTime? at;
  final double? schoolLat;
  final double? schoolLng;
  final int staleAfterMinutes;
  final bool scoped;
  final List<LiveRouteView> routes;
}

extension BusRoutesLiveApi on ApiClient {
  /// Every route in the caller's reach, or one with [routeId].
  Future<BusRoutesLive> fetchBusRoutesLive({
    String routeId = "",
  }) async => BusRoutesLive.fromJson(
    await _getData(
      "/api/v1/staff/bus-routes/live"
      "${routeId.isEmpty ? "" : "?routeId=${Uri.encodeQueryComponent(routeId)}"}",
    ),
  );
}

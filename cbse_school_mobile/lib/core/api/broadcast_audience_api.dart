part of "api_client.dart";

// Broadcast with an audience picker and a custom message (20 Oct 2026,
// requests mr_mva0gr5aop3y and mr_mva0ik2uqmoy) — /api/v1/staff/broadcast/
// audience, the web ERP's send path. The server decides who may aim where:
// school-wide audiences need the broadcast permission; a teacher can pick
// only their own sections. The JSON helpers (_s, _i, _b, _list) are
// staff_api.dart's — same library.

class BroadcastSectionOption {
  BroadcastSectionOption.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      name = _s(j, "name"),
      label = _s(j, "label");
  final String id;
  final String name;
  final String label;
}

class BroadcastClassOption {
  BroadcastClassOption.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      name = _s(j, "name"),
      sections = _list(
        j,
        "sections",
      ).map(BroadcastSectionOption.fromJson).toList();
  final String id;
  final String name;
  final List<BroadcastSectionOption> sections;
}

class BroadcastIdLabel {
  BroadcastIdLabel(this.id, this.label);
  BroadcastIdLabel.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      label = _s(j, "label").isNotEmpty ? _s(j, "label") : _s(j, "name");
  final String id;
  final String label;
}

class BroadcastTemplateVar {
  BroadcastTemplateVar.fromJson(Map<String, dynamic> j)
    : key = _s(j, "key"),
      label = _s(j, "label").isEmpty ? _s(j, "key") : _s(j, "label"),
      auto = _b(j, "auto");
  final String key;
  final String label;

  /// Filled per recipient by the server (parent's name, child, class…).
  final bool auto;
}

/// An approved template family: Hindi and English both approved, so each
/// family gets its own language.
class BroadcastTemplateFamily {
  BroadcastTemplateFamily.fromJson(Map<String, dynamic> j)
    : familyKey = _s(j, "familyKey"),
      name = _s(j, "name"),
      module = _s(j, "module"),
      category = _s(j, "category"),
      bodyEn = _s(j, "bodyEn"),
      bodyHi = _s(j, "bodyHi"),
      variables = _list(
        j,
        "variables",
      ).map(BroadcastTemplateVar.fromJson).toList();
  final String familyKey;
  final String name;
  final String module;
  final String category;
  final String bodyEn;
  final String bodyHi;
  final List<BroadcastTemplateVar> variables;

  /// The fields the sender types (the rest the server fills per family).
  List<BroadcastTemplateVar> get askFor =>
      variables.where((v) => !v.auto).toList();

  String preview(Map<String, String> values, {bool hindi = false}) {
    var out = hindi && bodyHi.isNotEmpty ? bodyHi : bodyEn;
    for (final v in variables) {
      final val = (values[v.key] ?? "").trim();
      out = out.replaceAll(
        "{{${v.key}}}",
        v.auto ? "[${v.label}]" : (val.isEmpty ? "[${v.label}]" : val),
      );
    }
    return out;
  }
}

class BroadcastAudienceOptions {
  BroadcastAudienceOptions.fromJson(Map<String, dynamic> j)
    : schoolWide = _b(j, "schoolWide"),
      classes = _list(j, "classes").map(BroadcastClassOption.fromJson).toList(),
      designations = _list(
        j,
        "designations",
      ).map(BroadcastIdLabel.fromJson).toList(),
      routes = _list(j, "routes").map(BroadcastIdLabel.fromJson).toList(),
      feeStages = _list(j, "feeStages").map(BroadcastIdLabel.fromJson).toList(),
      templates = j["templates"] is List
          ? _list(j, "templates").map(BroadcastTemplateFamily.fromJson).toList()
          : null,
      customTemplateReady = j["customTemplateReady"] is bool
          ? j["customTemplateReady"] as bool
          : null,
      customMax = _i(j, "customMax") > 0 ? _i(j, "customMax") : 1000;

  /// May aim at the whole school (else: own sections only).
  final bool schoolWide;
  final List<BroadcastClassOption> classes;
  final List<BroadcastIdLabel> designations;
  final List<BroadcastIdLabel> routes;
  final List<BroadcastIdLabel> feeStages;

  /// Null = the template list could not be read (not "none approved").
  final List<BroadcastTemplateFamily>? templates;

  /// Is "School notice" approved in both languages? Null = not known.
  final bool? customTemplateReady;
  final int customMax;
}

/// Which audience kinds the screen offers.
enum BroadcastAudienceKind { parents, sections, staff, route, feeDefaulters }

/// The audience being built on screen. Pure — `toSpec` is what the server
/// resolves; a list of numbers is never sent.
class BroadcastAudienceSelection {
  BroadcastAudienceSelection({
    this.kind = BroadcastAudienceKind.sections,
    Set<String>? sectionIds,
    this.staffStream = "all",
    Set<String>? designationIds,
    Set<String>? routeIds,
    Set<String>? feeStages,
  }) : sectionIds = sectionIds ?? {},
       designationIds = designationIds ?? {},
       routeIds = routeIds ?? {},
       feeStages = feeStages ?? {"S2", "S3", "S4"};

  BroadcastAudienceKind kind;
  final Set<String> sectionIds;

  /// "all" | "teaching" | "non_teaching"
  String staffStream;
  final Set<String> designationIds;
  final Set<String> routeIds;
  final Set<String> feeStages;

  /// Kinds this person may pick — a teacher gets their own sections only.
  static List<BroadcastAudienceKind> offered(BroadcastAudienceOptions o) => [
    if (o.schoolWide) BroadcastAudienceKind.parents,
    if (o.classes.isNotEmpty) BroadcastAudienceKind.sections,
    if (o.schoolWide) BroadcastAudienceKind.staff,
    if (o.schoolWide && o.routes.isNotEmpty) BroadcastAudienceKind.route,
    if (o.schoolWide && o.feeStages.isNotEmpty)
      BroadcastAudienceKind.feeDefaulters,
  ];

  /// Null while the pick is incomplete (no section, no route…).
  Map<String, dynamic>? toSpec() {
    switch (kind) {
      case BroadcastAudienceKind.parents:
        return {"kind": "parents"};
      case BroadcastAudienceKind.sections:
        if (sectionIds.isEmpty) return null;
        return {"kind": "parents", "sectionIds": sectionIds.toList()..sort()};
      case BroadcastAudienceKind.staff:
        return {
          "kind": "staff",
          "stream": staffStream,
          if (designationIds.isNotEmpty)
            "designationIds": designationIds.toList()..sort(),
        };
      case BroadcastAudienceKind.route:
        if (routeIds.isEmpty) return null;
        return {
          "kind": "transport_route",
          "routeIds": routeIds.toList()..sort(),
        };
      case BroadcastAudienceKind.feeDefaulters:
        if (feeStages.isEmpty) return null;
        return {"kind": "fee_stage", "stages": feeStages.toList()..sort()};
    }
  }
}

class BroadcastEstimate {
  BroadcastEstimate.fromJson(Map<String, dynamic> j)
    : paise = _i(j, "paise"),
      gstPct = (j["gstPct"] as num?)?.toDouble() ?? 0,
      ratesConfirmed = _b(j, "ratesConfirmed");
  final int paise;
  final double gstPct;

  /// False = the school's rate card still holds the default list rates.
  final bool ratesConfirmed;

  String get rupees => "₹${(paise / 100).toStringAsFixed(2)}";
}

class AudienceBroadcastResult {
  AudienceBroadcastResult.fromJson(Map<String, dynamic> j)
    : mode = _s(j, "mode"),
      audienceLabel = _s(j, "audienceLabel"),
      wholeSchool = _b(j, "wholeSchool"),
      channel = _s(j, "channel"),
      messageMode = _s(j, "messageMode"),
      families = _i(j, "families"),
      recipientCount = _i(j, "recipientCount"),
      viaFreeText = _i(j, "viaFreeText"),
      viaTemplate = _i(j, "viaTemplate"),
      cannotReach = _i(j, "cannotReach"),
      windowKnown = j["windowKnown"] != false,
      skippedOptOut = _i(j, "skippedOptOut"),
      skippedNotOnWhatsApp = _i(j, "skippedNotOnWhatsApp"),
      skippedNoNumber = _i(j, "skippedNoNumber"),
      estimate = j["estimate"] is Map
          ? BroadcastEstimate.fromJson(
              Map<String, dynamic>.from(j["estimate"] as Map),
            )
          : null,
      sample = ((j["sample"] as List?) ?? const []).map((e) => "$e").toList(),
      sent = _i(j, "sent"),
      failed = _i(j, "failed"),
      deferred = _i(j, "deferred"),
      skippedNoTemplate = _i(j, "skippedNoTemplate"),
      pushSent = j["push"] is Map
          ? _i(Map<String, dynamic>.from(j["push"] as Map), "sent")
          : 0,
      error = _s(j, "error");

  final String mode;
  final String audienceLabel;
  final bool wholeSchool;
  final String channel;
  final String messageMode;
  final int families;

  /// What the live send must confirm: WhatsApp numbers, or (app only)
  /// families / staff.
  final int recipientCount;
  final int viaFreeText;
  final int viaTemplate;
  final int cannotReach;
  final bool windowKnown;
  final int skippedOptOut;
  final int skippedNotOnWhatsApp;
  final int skippedNoNumber;

  /// Null = the rate card could not be read: no figure, not ₹0.
  final BroadcastEstimate? estimate;
  final List<String> sample;
  final int sent;
  final int failed;
  final int deferred;
  final int skippedNoTemplate;
  final int pushSent;
  final String error;
  bool get isDryRun => mode != "live";
  int get skippedTotal =>
      skippedOptOut + skippedNotOnWhatsApp + skippedNoNumber;
}

/// A fresh id per confirmed send; the server claims it once, so a double
/// tap cannot send twice.
String newBroadcastSendId() {
  final r = math.Random();
  final t = DateTime.now().millisecondsSinceEpoch.toRadixString(36);
  final n = List.generate(8, (_) => r.nextInt(36).toRadixString(36)).join();
  return "app_${t}_$n";
}

extension BroadcastAudienceApi on ApiClient {
  Future<BroadcastAudienceOptions> fetchBroadcastAudienceOptions() async =>
      BroadcastAudienceOptions.fromJson(
        await _getData("/api/v1/staff/broadcast/audience"),
      );

  /// Dry run by default (counts only). A live send needs [confirmCount]
  /// from the dry run and a [sendId] from [newBroadcastSendId].
  Future<AudienceBroadcastResult> broadcastToAudience({
    required Map<String, dynamic> audience,
    required String mode, // "template" | "custom"
    String templateFamilyKey = "",
    Map<String, String> variables = const {},
    String text = "",
    String title = "",
    String channel = "whatsapp", // "whatsapp" | "app"
    bool dryRun = true,
    int? confirmCount,
    String? sendId,
  }) async {
    final data = await _postData("/api/v1/staff/broadcast/audience", {
      "audience": audience,
      "mode": mode,
      if (mode == "template") "templateFamilyKey": templateFamilyKey,
      if (mode == "template") "variables": variables,
      if (mode == "custom") "text": text,
      if (mode == "custom" && title.isNotEmpty) "title": title,
      "channel": channel,
      "dryRun": dryRun,
      "confirmCount": ?confirmCount,
      "sendId": ?sendId,
    });
    return AudienceBroadcastResult.fromJson(data);
  }
}

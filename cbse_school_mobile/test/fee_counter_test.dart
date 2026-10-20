// Fee counter on the staff phone — requests mr_mv9zqkve5jy8 (total paying
// now split across heads; discount per head) and mr_mv9ztcw6hkgt (a
// reference for every payment that is not cash).

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/features/staff/fee_counter_logic.dart";
import "package:cbse_school_mobile/features/staff/fee_counter_screen.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";

AllocDue d(String key, String dueOn, int paise, [int? rank]) => AllocDue(
  key: key,
  dueKey: key.split("|").last,
  dueOn: dueOn,
  balancePaise: paise,
  rank: rank,
);

void main() {
  // Listed in household order; the server's ranks put the sibling's April
  // tuition first, then April transport, then May.
  final household = [
    d("a|acad:a:may", "2026-05-10", 150000, 2),
    d("a|trn:a:apr", "2026-04-10", 80000, 1),
    d("b|acad:b:apr", "2026-04-10", 120000, 0),
  ];

  group("total paying now", () {
    test("a part payment fills the oldest dues first, across heads", () {
      final s = splitPayingNow(household, 150000);
      expect(s.ok, isTrue);
      expect(s.amounts["b|acad:b:apr"], 120000);
      expect(s.amounts["a|trn:a:apr"], 30000);
      expect(s.amounts["a|acad:a:may"], 0);
      expect(s.amounts.values.fold<int>(0, (a, b) => a + b), 150000);
    });

    test("the exact bill settles every due", () {
      final s = splitPayingNow(household, 350000);
      expect(s.ok, isTrue);
      expect(s.amounts, {
        "a|acad:a:may": 150000,
        "a|trn:a:apr": 80000,
        "b|acad:b:apr": 120000,
      });
    });

    test("more than the bill is refused", () {
      final s = splitPayingNow(household, 350100);
      expect(s.ok, isFalse);
      expect(s.error, "over");
      expect(s.basisPaise, 350000);
      expect(splitPayingNow(household, 0).ok, isFalse);
    });

    test("without server ranks it falls back to due date, then key", () {
      final noRank = [
        d("a|z", "2026-05-01", 1000),
        d("a|b", "2026-04-01", 1000),
        d("a|a", "2026-04-01", 1000),
      ];
      final s = splitPayingNow(noRank, 1500);
      expect(s.amounts, {"a|a": 1000, "a|b": 500, "a|z": 0});
    });

    test("the box takes whole rupees; empty means not in use", () {
      expect(payingNowPaiseFrom(""), isNull);
      expect(payingNowPaiseFrom(" 1500 "), 150000);
    });
  });

  group("reference rule", () {
    test("cash needs none", () {
      expect(referenceMissing("cash", ""), isFalse);
    });
    for (final mode in [
      "upi",
      "card",
      "cheque",
      "rtgs",
      "neft",
      "imps",
      "bank",
    ]) {
      test("$mode without a reference is refused", () {
        expect(referenceMissing(mode, ""), isTrue);
        expect(referenceMissing(mode, "   "), isTrue);
        expect(referenceMissing(mode, "UTR123"), isFalse);
      });
    }
  });

  group("discount per head", () {
    CounterDue due(Map<String, dynamic> extra) => CounterDue.fromJson({
      "dueKey": "acad:a:jun",
      "label": "Tuition · June",
      "balancePaise": 90000,
      "balanceLabel": "₹900",
      ...extra,
    });

    test("an older server (no field) and a null are both 'not loaded'", () {
      expect(due({}).discountPaise, isNull);
      expect(due({"discountPaise": null}).discountPaise, isNull);
      expect(discountStateOf(null), DiscountState.notLoaded);
      expect(discountStateOf(0), DiscountState.none);
      expect(discountStateOf(3000), DiscountState.some);
    });

    Future<void> pump(WidgetTester t, CounterDue d) => t.pumpWidget(
      MaterialApp(
        localizationsDelegates: L.localizationsDelegates,
        supportedLocales: L.supportedLocales,
        locale: const Locale("en"),
        home: Scaffold(body: FeeDueDiscount(due: d)),
      ),
    );

    testWidgets("unknown shows 'not loaded', never ₹0", (t) async {
      await pump(t, due({}));
      expect(find.text("Discount: not loaded"), findsOneWidget);
      expect(find.textContaining("₹0"), findsNothing);
    });

    testWidgets("a known discount shows its amount and itemisation", (t) async {
      await pump(
        t,
        due({
          "billedPaise": 120000,
          "discountPaise": 30000,
          "discountLines": ["Sibling discount · 25% · 2nd child · −₹300"],
        }),
      );
      expect(find.textContaining("Discount −₹300"), findsOneWidget);
      expect(find.textContaining("billed ₹1,200"), findsOneWidget);
      expect(
        find.text("Sibling discount · 25% · 2nd child · −₹300"),
        findsOneWidget,
      );
    });

    testWidgets("a known zero says no discount", (t) async {
      await pump(t, due({"discountPaise": 0}));
      expect(find.text("No discount"), findsOneWidget);
    });
  });
}

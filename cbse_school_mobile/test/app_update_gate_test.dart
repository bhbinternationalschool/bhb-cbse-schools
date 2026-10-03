import "package:cbse_school_mobile/core/update/app_build.dart";
import "package:cbse_school_mobile/core/update/app_update_gate.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";

void main() {
  tearDown(() {
    AppBuild.updateRequired.value = false;
    AppBuild.flavor = "";
    AppBuild.build = 0;
  });

  test("headers carry only what is known", () {
    expect(AppBuild.headers, isEmpty, reason: "unknown build sends nothing");
    AppBuild.flavor = "staff";
    AppBuild.build = 15;
    expect(AppBuild.headers, {"X-App-Flavor": "staff", "X-App-Build": "15"});
  });

  testWidgets("the app runs until the server says this build is too old", (tester) async {
    final messenger = GlobalKey<ScaffoldMessengerState>();
    await tester.pumpWidget(
      MaterialApp(
        scaffoldMessengerKey: messenger,
        localizationsDelegates: L.localizationsDelegates,
        supportedLocales: L.supportedLocales,
        // flavor is empty, so the gate makes no network call in the test.
        builder: (context, child) => AppUpdateGate(
          apiBaseUrl: "https://example.invalid",
          messenger: messenger,
          child: child!,
        ),
        home: const Text("home screen"),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text("home screen"), findsOneWidget);
    expect(find.text("Update the app to continue"), findsNothing);

    // A request answered 426 sets this (ApiClient._throwFrom).
    AppBuild.updateRequired.value = true;
    await tester.pump();
    expect(find.text("Update the app to continue"), findsOneWidget);
    expect(find.text("home screen"), findsNothing);
    expect(find.text("Update now"), findsOneWidget);
  });
}

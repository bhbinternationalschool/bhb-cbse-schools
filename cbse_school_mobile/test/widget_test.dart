import "package:cbse_school_mobile/app/app_audience.dart";
import "package:cbse_school_mobile/app/cbse_school_app.dart";
import "package:cbse_school_mobile/app/routes_parent.dart";
import "package:cbse_school_mobile/app/routes_staff.dart";
import "package:flutter_test/flutter_test.dart";

void main() {
  // The school's language for parents is Hindi unless the family chose
  // English, so a parent who has never picked sees Hindi — even on a phone
  // set to English, which is what this test runs as.
  testWidgets("parent app opens on the OTP login screen, in Hindi", (
    tester,
  ) async {
    await tester.pumpWidget(
      const CbseSchoolApp(
        audience: AppAudience.parent,
        buildRoutes: parentRoutes,
      ),
    );
    await tester.pump();
    expect(find.text("मोबाइल नंबर"), findsOneWidget);
    expect(find.text("OTP भेजें"), findsOneWidget);
  });

  // Staff keep following the phone's language.
  testWidgets("staff app opens on the same login screen", (tester) async {
    await tester.pumpWidget(
      const CbseSchoolApp(
        audience: AppAudience.staff,
        buildRoutes: staffRoutes,
      ),
    );
    await tester.pump();
    expect(find.text("Mobile number"), findsOneWidget);
  });

  // The split is only worth anything if each build refuses the other's users.
  // These are the rules the router leans on to send someone to /wrong-app.
  test("each audience serves only its own personas", () {
    expect(AppAudience.parent.servesPersona(null), isTrue);
    expect(AppAudience.parent.servesPersona("parent"), isTrue);
    expect(AppAudience.parent.servesPersona("staff"), isFalse);
    expect(AppAudience.parent.servesPersona("field"), isFalse);

    expect(AppAudience.staff.servesPersona("staff"), isTrue);
    expect(AppAudience.staff.servesPersona("field"), isTrue);
    expect(AppAudience.staff.servesPersona(null), isFalse);
    expect(AppAudience.staff.servesPersona("parent"), isFalse);
  });
}

import "package:cbse_school_mobile/app/cbse_school_app.dart";
import "package:flutter_test/flutter_test.dart";

void main() {
  testWidgets("shows parent OTP login screen", (tester) async {
    await tester.pumpWidget(const CbseSchoolApp());
    await tester.pump();
    expect(find.text("Mobile number"), findsOneWidget);
    expect(find.text("Send OTP"), findsOneWidget);
  });
}

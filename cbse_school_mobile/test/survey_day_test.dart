import 'package:cbse_school_mobile/core/api/api_client.dart';
import 'package:cbse_school_mobile/core/punch/punch_device_key.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('survey steps are signed over the server\'s exact text (lib/surveyDay surveyMessage)', () {
    // apps/web/src/lib/surveyDay.ts: `survey|${action}|${extra}|${ts}`
    expect(PunchDeviceKey.surveyMessage(action: 'start', extra: '482913', ts: 1791000000000),
        'survey|start|482913|1791000000000');
    expect(PunchDeviceKey.surveyMessage(action: 'status', extra: '', ts: 5), 'survey|status||5');
    final key = PunchDeviceKey.generate();
    final msg = PunchDeviceKey.surveyMessage(action: 'capture', extra: 'srv-1', ts: 7);
    final sig = key.sign(msg);
    expect(key.verify(msg, sig), isTrue);
    expect(key.verify(PunchDeviceKey.surveyMessage(action: 'end', extra: 'srv-1', ts: 7), sig), isFalse,
        reason: 'a signature must not lift onto another step');
  });

  test('reads the server\'s status reply', () {
    final s = SurveyDayStatus.fromJson({
      'member': {'name': 'Ravi', 'startMode': 'school', 'kind': 'staff'},
      'day': {
        'status': 'on_break',
        'beatId': 'b1',
        'startedAt': '2026-10-13T03:30:00.000Z',
        'endedAt': null,
        'breaks': 1,
        'workedMs': 5400000,
      },
      'captures': [
        {'enquiryNo': 'ENQ-12', 'childName': 'Asha', 'at': '2026-10-13T04:00:00.000Z'},
      ],
      'beats': [
        {'id': 'b1', 'name': 'Ward 4', 'area': 'Shivpur'},
      ],
      'classes': [
        {'id': 'c1', 'name': 'Nursery'},
      ],
      'enquiryNo': 'ENQ-12',
      'duplicate': false,
    });
    expect(s.memberName, 'Ravi');
    expect(s.startsAtSchool, isTrue);
    expect(s.day!.status, 'on_break');
    expect(s.day!.endedAt, '');
    expect(s.day!.workedMs, 5400000);
    expect(s.captures.single.enquiryNo, 'ENQ-12');
    expect(s.beats.single.area, 'Shivpur');
    expect(s.classes.single.name, 'Nursery');
    expect(s.enquiryNo, 'ENQ-12');

    final none = SurveyDayStatus.fromJson({'member': {'name': 'X', 'startMode': 'field'}, 'day': null});
    expect(none.day, isNull);
    expect(none.startsAtSchool, isFalse);
  });
}

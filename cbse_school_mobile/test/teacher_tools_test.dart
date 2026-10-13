import 'package:cbse_school_mobile/core/api/api_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reads GET /api/v1/staff/broadcast', () {
    final d = ClassBroadcastDesk.fromJson({
      'staffId': 'st1',
      'sections': [
        {'sectionId': 's1', 'classId': 'c5', 'label': 'Class 5 A', 'families': 31},
      ],
      'sent': [
        {
          'id': 'sb_1',
          'at': '2026-10-13T05:30:00.000Z',
          'staffId': 'st1',
          'audience': 'class_parents',
          'sectionIds': ['s1'],
          'sectionLabels': ['Class 5 A'],
          'body': 'कल छुट्टी है',
          'templateName': '',
          'families': 31,
          'recipientCount': 30,
          'skippedOptOut': 1,
          'sent': 28,
          'failed': 2,
          'pushSent': 9,
        },
      ],
    });
    expect(d.sections.single.label, 'Class 5 A');
    expect(d.sections.single.families, 31);
    expect(d.sent!.single.sectionLabels, ['Class 5 A']);
    expect(d.sent!.single.failed, 2);
    expect(d.sent!.single.pushSent, 9);
  });

  test('an unreadable sent log stays unknown, not empty', () {
    final d = ClassBroadcastDesk.fromJson({'sections': [], 'sent': null});
    expect(d.sent, isNull);
  });

  test('reads the send / dry-run reply (bare object, not {data})', () {
    final dry = ClassBroadcastResult.fromJson({
      'ok': true,
      'mode': 'dry_run',
      'recipientCount': 40,
      'families': 42,
      'skippedOptOut': 2,
      'results': [],
    });
    expect(dry.isDryRun, isTrue);
    expect(dry.families, 42);
    expect(dry.pushSent, 0);
    final live = ClassBroadcastResult.fromJson({
      'mode': 'live',
      'recipientCount': 40,
      'families': 42,
      'sent': 39,
      'failed': 1,
      'push': {'sent': 12, 'expired': 0, 'failed': 0},
    });
    expect(live.isDryRun, isFalse);
    expect(live.pushSent, 12);
  });

  test('lays out a PTM sitting: slot length plus break, whole slots only', () {
    expect(
      ptmSlotStarts(from: '09:00', until: '10:00', slotMinutes: 15),
      ['09:00', '09:15', '09:30', '09:45'],
    );
    expect(
      ptmSlotStarts(from: '09:00', until: '10:00', slotMinutes: 15, breakMinutes: 5),
      ['09:00', '09:20', '09:40'],
    );
    expect(ptmSlotStarts(from: '10:00', until: '09:00', slotMinutes: 15), isEmpty);
    expect(ptmSlotStarts(from: 'x', until: '09:00', slotMinutes: 15), isEmpty);
    expect(ptmSlotMinutes('10:00', '10:20'), 20);
    expect(ptmSlotMinutes('10:20', '10:00'), 0);
    expect(hhmmLabel('13:05'), '1:05 PM');
    expect(hhmmLabel('00:30'), '12:30 AM');
  });

  test('reads canAddSlots on a PTM event', () {
    final e = PtmTeacherEvent.fromJson({
      'id': 'e1',
      'name': 'Term 1 PTM',
      'date': '2026-10-20',
      'endDate': '2026-10-20',
      'canAddSlots': true,
      'slots': [],
    });
    expect(e.canAddSlots, isTrue);
    expect(e.slots, isEmpty);
  });
}

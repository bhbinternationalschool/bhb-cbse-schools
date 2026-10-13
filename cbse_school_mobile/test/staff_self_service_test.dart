import 'package:cbse_school_mobile/core/api/api_client.dart';
import 'package:cbse_school_mobile/features/staff/home_groups.dart';
import 'package:cbse_school_mobile/features/staff/outdoor_duty_card.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reads my advances (GET /api/v1/staff/my-advances)', () {
    final d = MyAdvances.fromJson({
      'staffId': 's1',
      'outstanding': 3000,
      'advances': [
        {
          'id': 'adv_1',
          'amount': 5000,
          'givenDate': '2026-07-10',
          'note': 'Medical',
          'status': 'open',
          'recovered': 2000,
          'outstanding': 3000,
          'recoveries': [
            {
              'month': '2026-09',
              'method': 'salary',
              'amount': 1000,
              'recoveredAt': '2026-10-05T10:00:00.000Z',
              'note': '',
            },
            {
              'month': '2026-08',
              'method': 'salary',
              'amount': 500,
              'recoveredAt': '2026-09-05T10:00:00.000Z',
              'note': '',
            },
            {
              'month': '',
              'method': 'return_to_school',
              'amount': 500,
              'recoveredAt': '2026-08-20T10:00:00.000Z',
              'note': 'cash',
            },
            {
              'month': '2026-09',
              'method': 'salary',
              'amount': 0,
              'recoveredAt': '',
              'note': '',
            },
          ],
        },
        {
          'id': 'adv_0',
          'amount': 2000,
          'givenDate': '2026-04-01',
          'status': 'closed',
          'recovered': 2000,
          'outstanding': 0,
        },
      ],
    });
    expect(d.outstanding, 3000);
    expect(d.advances, hasLength(2));
    final a = d.advances.first;
    expect(a.amount, 5000);
    expect(a.recovered, 2000);
    expect(a.closed, isFalse);
    expect(a.recoveries, hasLength(4));
    expect(a.recoveries[2].fromSalary, isFalse);
    expect(a.salaryMonths, [
      '2026-08',
      '2026-09',
    ], reason: 'each payslip month once, oldest first');
    final b = d.advances.last;
    expect(b.closed, isTrue);
    expect(b.note, '');
    expect(b.recoveries, isEmpty);
  });

  test('reads an outdoor-duty session and the empty answer', () {
    final s = OutdoorDutySession.fromJson({
      'id': 'od_1',
      'staffId': 's1',
      'purpose': 'bank',
      'destination': 'SBI Ayar',
      'note': '',
      'startedAt': '2026-10-13T05:00:00.000Z',
      'startGeo': {'lat': 25.4, 'lng': 82.9, 'at': '2026-10-13T05:00:00.000Z'},
      'endedAt': null,
      'endGeo': null,
      'status': 'active',
      'createdBy': 'Ravi',
    });
    expect(s.active, isTrue);
    expect(s.hasStartGeo, isTrue);
    expect(s.hasEndGeo, isFalse);
    expect(s.endedAt, '');
    expect(outdoorPurposeLabel(s.purpose), 'Bank work');
    expect(outdoorPurposeLabel('nonsense'), 'Other');
    // The purposes the server accepts, in its order.
    expect(kOutdoorDutyPurposes.map((p) => p.$1).toList(), [
      'bank',
      'inspection',
      'vendor_meeting',
      'admission_survey',
      'official_errand',
      'other',
    ]);
  });

  test('leadership FYI matches the web wording', () {
    expect(
      outdoorStartMessage(
        name: 'Ravi',
        purpose: 'bank',
        destination: 'SBI Ayar',
        note: ' deposit ',
        gps: true,
      ),
      'Ravi checked out for outdoor duty — Bank work · SBI Ayar. deposit (GPS captured)',
    );
    expect(
      outdoorStartMessage(
        name: 'Ravi',
        purpose: 'other',
        destination: 'BSA office',
      ),
      'Ravi checked out for outdoor duty — Other · BSA office.',
    );
    expect(
      outdoorEndMessage(
        name: 'Ravi',
        purpose: 'inspection',
        destination: 'BSA office',
      ),
      'Ravi checked back in from outdoor duty (Inspection / audit · BSA office).',
    );
  });

  test('payslip carries its PDF link when the server offers one', () {
    final p = PayslipList.fromJson({
      'preparing': 0,
      'slips': [
        {
          'runId': 'r1',
          'month': '2026-09',
          'status': 'paid',
          'pdfUrl': '/api/v1/staff/payslips/2026-09/pdf',
        },
        {'runId': 'r0', 'month': '2026-08', 'status': 'paid'},
      ],
    });
    expect(p.slips.first.pdfUrl, '/api/v1/staff/payslips/2026-09/pdf');
    expect(
      p.slips.last.pdfUrl,
      '',
      reason: 'an older server sends none — no PDF button',
    );
  });

  test('my advances is an own-record tile on every staff home', () {
    expect(kAlwaysShownStaffFeatures, contains('my_advances'));
    expect(kLocalFeatureGroups['my_advances'], 'Self service');
  });
}

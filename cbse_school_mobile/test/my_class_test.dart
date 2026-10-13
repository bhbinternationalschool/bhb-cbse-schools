import 'package:cbse_school_mobile/core/api/api_client.dart';
import 'package:cbse_school_mobile/features/staff/class_sheet_rules.dart';
import 'package:cbse_school_mobile/features/staff/month_register_screen.dart';
import 'package:cbse_school_mobile/features/staff/my_class_screen.dart';
import 'package:cbse_school_mobile/core/config/app_config.dart';
import 'package:cbse_school_mobile/core/i18n/locale_controller.dart';
import 'package:cbse_school_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _app(Widget child) => LocaleScope(
  controller: LocaleController(),
  child: MaterialApp(
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    home: Scaffold(body: child),
  ),
);

Map<String, dynamic> _student({
  String bloodGroup = 'B(+)',
  String category = '',
}) => {
  'id': 's1',
  'admissionNo': 'A-12',
  'classLabel': 'III A',
  'photoUrl': '/api/file/abc',
  'revisionAt': '2026-10-10T05:00:00.000Z',
  'fields': {
    'fullName': 'Asha Devi',
    'rollNo': '4',
    'dob': '2018-03-09',
    'bloodGroup': bloodGroup,
    'religion': 'HINDU',
    'category': category,
    'motherTongue': '',
    'fatherName': 'Ram',
    'fatherMobile': '+91 98390 12345',
    'motherMobile': '9839012345',
    'emergencyMobile': '12345',
  },
  'household': {
    'id': 'h1',
    'revisionAt': '2026-10-01T00:00:00.000Z',
    'fields': {
      'guardianName': 'Ram Kumar',
      'mobile': '07007001234',
      'whatsappMobile': '',
    },
  },
  'measure': {'heightCm': '', 'weightKg': '19', 'measuredOn': '2026-10-07'},
  'sheet': {
    'fatherQualification': 'B.A. BTC',
    'motherQualification': '',
    'isCwsn': false,
  },
  'whatsapp': {'number': '', 'status': 'missing'},
};

Map<String, dynamic> _monthJson() => {
  'academicYearCode': '2026-27',
  'today': '2026-10-13',
  'months': ['2026-10', '2026-09'],
  'canEdit': true,
  'month': '2026-10',
  'days': [
    {
      'date': '2026-10-10',
      'working': true,
      'half': false,
      'label': '',
      'future': false,
    },
    {
      'date': '2026-10-11',
      'working': false,
      'half': false,
      'label': 'Sunday Holiday',
      'future': false,
    },
    {
      'date': '2026-10-12',
      'working': true,
      'half': true,
      'label': 'Half day',
      'future': false,
    },
    {
      'date': '2026-10-13',
      'working': true,
      'half': false,
      'label': '',
      'future': false,
    },
    {
      'date': '2026-10-14',
      'working': true,
      'half': false,
      'label': '',
      'future': true,
    },
  ],
  'students': [
    {
      'id': 's1',
      'name': 'Asha',
      'rollNo': '1',
      'startsOn': '2026-04-01',
      'marks': {'2026-10-10': 'P', '2026-10-12': 'HD'},
      'month': {
        'workingDays': 3,
        'presentDays': 1.5,
        'unmarkedDays': 1,
        'percent': 50,
      },
      'session': {
        'workingDays': 100,
        'presentDays': 90.5,
        'unmarkedDays': 0,
        'percent': 90.5,
      },
    },
    {
      'id': 's2',
      'name': 'Babu',
      'rollNo': '2',
      'startsOn': '2026-10-12',
      'marks': {'2026-10-12': 'L', '2026-10-13': 'LE'},
      'month': {
        'workingDays': 2,
        'presentDays': 1,
        'unmarkedDays': 0,
        'percent': null,
      },
      'session': {
        'workingDays': 2,
        'presentDays': 1,
        'unmarkedDays': 0,
        'percent': null,
      },
    },
  ],
};

void main() {
  test('reads /api/v1/staff/class-students', () {
    final d = ClassStudentsData.fromJson({
      'academicYearCode': '2026-27',
      'sections': [],
      'sectionId': '',
      'verdictsAvailable': false,
      'students': [_student()],
      'summary': {'total': 1},
    });
    expect(d.verdictsAvailable, isFalse);
    final s = d.students.single;
    expect(s.fullName, 'Asha Devi');
    expect(s.rollNo, '4');
    expect(s.household!.fields['guardianName'], 'Ram Kumar');
    expect(s.weightKg, '19');
    expect(s.heightCm, '', reason: 'never measured stays blank');
    expect(s.fatherQualification, 'B.A. BTC');
    expect(s.whatsappStatus, 'missing');
    expect(s.revisionAt, '2026-10-10T05:00:00.000Z');
  });

  test('family numbers: real mobiles only, each once', () {
    final s = ClassStudent.fromJson(_student());
    final c = familyContacts(s);
    expect(c.map((x) => x.number), ['7007001234', '9839012345']);
    expect(c.first.label, 'Family · Ram Kumar');
    expect(
      c[1].label,
      'Father · Ram',
      reason: 'mother has the same number — listed once',
    );
    expect(mobile10('919839012345'), '9839012345');
    expect(mobile10('12345'), isNull);
  });

  test('class sheet: draft, send and the server checks', () {
    final s = ClassStudent.fromJson(_student());
    final base = SheetDraft.fromRecord(
      fields: s.fields,
      heightCm: s.heightCm,
      weightKg: s.weightKg,
      fatherQualification: s.fatherQualification,
      motherQualification: s.motherQualification,
      isCwsn: s.isCwsn,
    );
    expect(base.bloodGroup, 'B+', reason: 'old import B(+) shows as B+');
    expect(base.motherTongue, '', reason: 'unknown is never defaulted');

    // Nothing touched → nothing sent.
    final d = base.copy();
    expect(sheetRowToSend(base, d, SheetGroup.values), isEmpty);

    // Height typed: height AND weight travel together; other groups untouched.
    d.heightCm = '112.5';
    final send = sheetRowToSend(base, d, [
      SheetGroup.measure,
      SheetGroup.family,
    ]);
    expect(send, {'heightCm': '112.5', 'weightKg': '19'});
    expect(checkSheetRow(send, base), isNull);

    // A change in a group that is not chosen is not sent.
    d.religion = 'SIKH';
    expect(
      sheetRowToSend(base, d, [SheetGroup.measure]).containsKey('religion'),
      isFalse,
    );
    expect(sheetRowToSend(base, d, [SheetGroup.family]), {'religion': 'SIKH'});

    // The old "B.A. BTC" may go back unchanged, but not a new free text.
    expect(checkSheetRow({'fatherQualification': 'B.A. BTC'}, base), isNull);
    expect(
      checkSheetRow({'fatherQualification': 'BA'}, base),
      "Father's education: pick from the list",
    );
    expect(
      checkSheetRow({'bloodGroup': 'C+'}, base),
      'Pick a blood group from the list',
    );
    expect(checkSheetRow({'bloodGroup': 'o positive'}, base), isNull);
    expect(
      checkSheetRow({'motherTongue': 'HINDI1'}, base),
      'Mother tongue: letters only, e.g. HINDI',
    );
    expect(
      checkSheetRow({'category': 'GENERAL'}, base),
      'Pick a category from the list',
    );
    expect(
      checkSheetRow({'religion': 'NONE'}, base),
      'Pick a religion from the list',
    );
  });

  test('measurement checks match lib/studentMeasurements', () {
    expect(checkMeasurement('', '').ok, isTrue);
    final ok = checkMeasurement('112.25', '19,5');
    expect((ok.heightCm, ok.weightKg), ('112.3', '19.5'));
    expect(checkMeasurement('120', '').weightKg, '');
    expect(
      checkMeasurement('1.12', '').error,
      'Height 1.12 looks like metres — type centimetres (e.g. 112)',
    );
    expect(
      checkMeasurement('', '19000').error,
      'Weight 19000 looks like grams — type kilograms (e.g. 19)',
    );
    expect(
      checkMeasurement('20', '112').error,
      'Height and weight look swapped — height in cm, weight in kg',
    );
    expect(
      checkMeasurement('200', '').error,
      'Height must be between 60 and 190 cm',
    );
    expect(
      checkMeasurement('', '5').error,
      'Weight must be between 8 and 110 kg',
    );
    expect(
      checkMeasurement('abc', '').error,
      'Height must be a number in cm, e.g. 112 or 112.5',
    );
    expect(ageYears('2018-03-09', '2026-10-13'), 8);
    expect(ageYears('2018-11-09', '2026-10-13'), 7);
    expect(ageYears('', '2026-10-13'), isNull);
  });

  test('reads /api/v1/attendance/month and lays out cells', () {
    final r = MonthRegister.fromJson(_monthJson());
    expect(r.months.first, '2026-10');
    expect(r.students.first.month.presentDays, 1.5);
    expect(r.students[1].session.percent, isNull);
    final [a, b] = r.students;
    final days = r.days;
    expect(days.map((d) => monthCell(a, d)).toList(), ['P', 'H', 'HD', '', '']);
    expect(days.map((d) => monthCell(b, d)).toList(), [
      '–',
      'H',
      'L',
      'LE',
      '',
    ]);
    expect(dayHeadcount(r.students, days[2]), 1.5, reason: 'HD ½ + L (late) 1');
    expect(
      dayHeadcount(r.students, days[3]),
      0,
      reason: 'LE is leave, not presence; blank is not presence',
    );
    expect(monthTitle('2026-10'), 'October 2026');
  });

  testWidgets('the month grid fits a phone: names pinned, days scroll', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      _app(
        ListView(
          children: [
            MonthRegisterGrid(register: MonthRegister.fromJson(_monthJson())),
          ],
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('1. Asha'), findsOneWidget);
    expect(find.text('1.5/3 · 1 unmarked'), findsWidgets);
    expect(find.text('90.5%'), findsOneWidget);
    expect(find.byType(SingleChildScrollView), findsOneWidget);
    // Sliding the days leaves the names where they were.
    final before = tester.getTopLeft(find.text('1. Asha'));
    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(-200, 0),
    );
    await tester.pump();
    expect(tester.getTopLeft(find.text('1. Asha')), before);
  });

  testWidgets(
    'class sheet: one typed height makes one child to save; a slip is caught',
    (tester) async {
      tester.view.physicalSize = const Size(400, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final rows = [ClassStudent.fromJson(_student())];
      await tester.pumpWidget(
        _app(
          ClassSheetEditor(
            api: ApiClient(AppConfig.production),
            rows: rows,
            onSaved: () async {},
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Nothing new to save'), findsOneWidget);
      expect(find.text('Complete for these columns: 0 of 1'), findsOneWidget);
      expect(find.text('B+'), findsOneWidget, reason: 'old B(+) shown as B+');

      await tester.enterText(find.widgetWithText(TextField, 'Height'), '112');
      await tester.pump();
      expect(find.text('Save 1 child · सहेजें'), findsOneWidget);

      await tester.enterText(find.widgetWithText(TextField, 'Height'), '1.12');
      await tester.pump();
      expect(find.text('Nothing new to save'), findsOneWidget);
      expect(
        find.text('1 child with something to fix — not included'),
        findsOneWidget,
      );
      expect(
        find.text(
          'Height 1.12 looks like metres — type centimetres (e.g. 112)',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'a re-read never sends someone else\'s newer value back as stale',
    (tester) async {
      tester.view.physicalSize = const Size(400, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      Widget editor(List<ClassStudent> rows) => _app(
        ClassSheetEditor(
          key: const ValueKey('sheet'),
          api: ApiClient(AppConfig.production),
          rows: rows,
          onSaved: () async {},
        ),
      );
      await tester.pumpWidget(editor([ClassStudent.fromJson(_student())]));
      await tester.enterText(find.widgetWithText(TextField, 'Height'), '112');
      await tester.pump();

      // The office weighed the child meanwhile (19 → 20) and the list re-read.
      final newer = _student();
      newer['revisionAt'] = '2026-10-13T06:00:00.000Z';
      newer['measure'] = {
        'heightCm': '',
        'weightKg': '20',
        'measuredOn': '2026-10-13',
      };
      await tester.pumpWidget(editor([ClassStudent.fromJson(newer)]));
      await tester.pump();

      final weight = tester.widget<TextField>(
        find.widgetWithText(TextField, 'Weight'),
      );
      expect(
        weight.controller!.text,
        '20',
        reason: 'untouched value follows the record',
      );
      final height = tester.widget<TextField>(
        find.widgetWithText(TextField, 'Height'),
      );
      expect(
        height.controller!.text,
        '112',
        reason: 'the teacher\'s typing is kept',
      );
      expect(find.text('Save 1 child · सहेजें'), findsOneWidget);
    },
  );
}

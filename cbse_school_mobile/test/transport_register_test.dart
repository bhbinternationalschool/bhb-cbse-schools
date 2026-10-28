import 'package:cbse_school_mobile/core/api/api_client.dart';
import 'package:cbse_school_mobile/features/staff/bus_register_screen.dart';
import 'package:cbse_school_mobile/features/staff/vehicle_logbook_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reads /register/runs (crew, linked)', () {
    final d = RegisterRunsDay.fromJson({
      'date': '2026-10-13',
      'today': '2026-10-13',
      'fleetWide': false,
      'unlinked': false,
      'editableDaysBack': 1,
      'classesKnown': true,
      'runs': [
        {
          'routeId': 'r1',
          'trip': 'AM',
          'shiftId': '',
          'name': 'Morning pick-up',
          'departTime': '',
          'routeName': 'Magic-1',
          'busNo': 4,
          'vehicleId': 'v1',
          'vehicleName': 'Magic',
          'counts': {'riders': 12, 'boarded': 7, 'dropped': 0, 'notBoarded': 1, 'unmarked': 4},
          'unresolved': 0,
        },
        {
          'routeId': 'r1',
          'trip': 'PM',
          'shiftId': 's2',
          'name': 'Juniors',
          'departTime': '12:30',
          'routeName': 'Magic-1',
          'busNo': '',
          'vehicleName': '',
          'counts': {'riders': 5, 'boarded': 0, 'dropped': 0, 'notBoarded': 0, 'unmarked': 5},
          'unresolved': 2,
        },
      ],
    });
    expect(d.fleetWide, isFalse);
    expect(d.runs, hasLength(2));
    expect(d.runs.first.busNo, '4', reason: 'a numeric bus no. must not throw');
    expect(d.runs.first.counts!.marked, 8);
    expect(d.runs.last.trip, 'PM');
    expect(d.runs.last.shiftId, 's2');
    expect(d.runs.last.unresolved, 2);
  });

  test('a run: unmarked stays null, unknown status words are not invented', () {
    final v = RegisterRunView.fromJson({
      'date': '2026-10-13',
      'today': '2026-10-13',
      'editable': true,
      'route': {'id': 'r1', 'name': 'Magic-1', 'busNo': '4', 'vehicleId': 'v1', 'vehicleName': 'Magic'},
      'run': {'routeId': 'r1', 'trip': 'PM', 'shiftId': '', 'name': 'Afternoon drop', 'departTime': ''},
      'runs': [],
      'statuses': ['boarded', 'dropped', 'not_boarded'],
      'classesKnown': true,
      'riders': [
        {
          'studentId': 'st1',
          'fullName': 'Asha',
          'admissionNo': 'A1',
          'className': 'III',
          'stopId': 'p1',
          'stopName': 'Ayar Mod',
          'stopSequence': 3,
          'shiftUnresolved': false,
          'shiftNote': '',
          'status': 'dropped',
          'tappedAt': '2026-10-13T08:00:00.000Z',
          'markedByName': 'Ravi',
        },
        {
          'studentId': 'st2',
          'fullName': 'Kabir',
          'stopId': 'gone',
          'stopName': '',
          'stopSequence': null,
          'status': null,
          'tappedAt': null,
        },
        {'studentId': 'st3', 'fullName': 'Meera', 'status': 'unmarked'},
      ],
      'counts': {'riders': 3, 'boarded': 0, 'dropped': 1, 'notBoarded': 0, 'unmarked': 2},
    });
    expect(v.routeName, 'Magic-1');
    expect(v.run.trip, 'PM');
    expect(v.statuses, ['boarded', 'dropped', 'not_boarded']);
    expect(v.riders[0].status, 'dropped');
    expect(v.riders[0].stopSequence, 3);
    expect(v.riders[1].status, isNull);
    expect(v.riders[1].stopSequence, isNull);
    expect(v.riders[1].tappedAt, '');
    expect(v.riders[2].status, isNull, reason: '"unmarked" reads as no mark');
    expect(v.counts.unmarked, 2);
  });

  test('mark reply, exceptions and month', () {
    final m = RegisterMarkResult.fromJson({
      'applied': false,
      'studentId': 'st1',
      'status': 'boarded',
      'tappedAt': '2026-10-13T08:00:00.000Z',
      'markedByName': 'Ravi',
    });
    expect(m.applied, isFalse);
    expect(m.status, 'boarded');

    final x = RegisterExceptions.fromJson({
      'date': '2026-10-13',
      'classRegister': 'unavailable',
      'sectionsWithoutRegister': null,
      'riderSections': 6,
      'unchecked': 0,
      'exceptions': [
        {
          'kind': 'no_return',
          'studentId': 'st1',
          'fullName': 'Asha',
          'className': 'III',
          'routeName': 'Magic-1',
          'stopName': 'Ayar Mod',
          'amStatus': 'boarded',
          'pmStatus': 'not_boarded',
          'classMark': null,
        },
      ],
    });
    expect(x.classRegisterOk, isFalse);
    expect(x.sectionsWithoutRegister, isNull);
    expect(x.exceptions.single.label, 'Came by bus, not on the drop');
    expect(x.exceptions.single.classMark, '');

    final month = RegisterMonth.fromJson({
      'month': '2026-10',
      'dates': ['2026-10-01', '2026-10-02'],
      'fleetWide': false,
      'routes': [],
      'rows': [
        {
          'studentId': 'st1',
          'fullName': 'Asha',
          'admissionNo': 'A1',
          'className': 'III',
          'routeName': 'Magic-1',
          'days': {
            '2026-10-02': {'am': 'boarded', 'pm': null},
          },
          'amRidden': 1,
          'pmRidden': 0,
          'notBoarded': 0,
          'daysRidden': 1,
        },
      ],
    });
    expect(month.rows.single.days['2026-10-02']!.am, 'boarded');
    expect(month.rows.single.days['2026-10-02']!.pm, isNull);
    expect(month.rows.single.days['2026-10-01'], isNull);
  });

  test('log book day: blank km stays null, GPS states, fills', () {
    final d = LogbookDay.fromJson({
      'date': '2026-10-12',
      'today': '2026-10-13',
      'fleetWide': false,
      'unlinked': false,
      'editable': true,
      'staffId': 'stf1',
      'vehicles': [
        {
          'id': 'v1',
          'name': 'Magic',
          'registrationNo': 'UP65 AB 1234',
          'driverName': 'Ravi',
          'fuelUnit': 'litre',
          'routes': ['Magic-1'],
          'log': {
            'vehicleId': 'v1',
            'logDate': '2026-10-12',
            'startKm': 41200,
            'startSource': 'gps',
            'endKm': null,
            'endSource': '',
            'driverName': 'Ravi',
            'remarks': '',
            'rowVersion': 3,
            'updatedByName': 'Ravi',
            'updatedAt': '2026-10-12T02:00:00Z',
          },
          'km': {'ok': false, 'reason': 'incomplete'},
          'gps': {
            'state': 'ok',
            'vehicleRef': 'x',
            'day': {'firstKm': 41200, 'lastKm': 41262.4, 'firstAt': '', 'lastAt': ''},
          },
          'fills': [
            {
              'id': 'fuel_abcdefgh',
              'vehicleId': 'v1',
              'fillDate': '2026-10-12',
              'quantity': 20.5,
              'unit': 'litre',
              'amountPaise': 190065,
              'odometerKm': null,
              'receiptPath': '/api/file/transport/fuel-receipts/v1/x.jpg',
              'note': '',
              'createdByStaffId': 'stf1',
              'createdByName': 'Ravi',
              'createdAt': '',
              'voided': false,
              'voidReason': '',
            },
          ],
        },
        {
          'id': 'v2',
          'name': 'Van',
          'fuelUnit': 'kg',
          'log': null,
          'km': null,
          'gps': {'state': 'unavailable'},
          'fills': [],
        },
      ],
    });
    final v = d.vehicles.first;
    expect(v.log!.startKm, 41200);
    expect(v.log!.endKm, isNull, reason: 'blank is not recorded, never 0');
    expect(v.log!.rowVersion, 3);
    expect(v.km!.ok, isFalse);
    expect(v.km!.reason, 'incomplete');
    expect(v.gps.lastKm, 41262.4);
    expect(v.fills.single.odometerKm, isNull);
    expect(v.fills.single.amountPaise, 190065);
    expect(d.vehicles.last.log, isNull);
    expect(d.vehicles.last.fuelUnit, 'kg');
    expect(d.vehicles.last.gps.state, 'unavailable');
    expect(d.vehicles.last.gps.firstKm, isNull);
  });

  test('log book month: ₹/km null when no km counted', () {
    final m = LogbookMonth.fromJson({
      'month': '2026-10',
      'fleetWide': true,
      'rows': [
        {
          'vehicleId': 'v1',
          'name': 'Magic',
          'registrationNo': 'UP65',
          'daysLogged': 2,
          'daysWithKm': 0,
          'km': 0,
          'gpsDays': 0,
          'typedDays': 1,
          'problemDays': 2,
          'fills': 1,
          'litres': 20,
          'kg': 0,
          'amountPaise': 190000,
          'rupeesPerKm': null,
        },
      ],
      'logs': [],
      'fills': [],
    });
    expect(m.rows.single.rupeesPerKm, isNull);
    expect(m.rows.single.problemDays, 2);
  });

  test('odometer box rules mirror the web (odometerField / sourceForSave)', () {
    expect(odometerStart(41200, 'typed', 41199).value, 41200, reason: 'a saved figure wins');
    expect(odometerStart(41200, '', null).source, 'typed');
    final g = odometerStart(null, '', 41199);
    expect((g.value, g.source, g.saved), (41199.0, 'gps', false));
    expect(odometerStart(null, '', null).value, isNull);

    expect(odometerSourceForSave(null, 41199, 'gps'), '');
    expect(odometerSourceForSave(41199, 41199, 'gps'), 'gps');
    expect(odometerSourceForSave(41200, 41199, 'gps'), 'typed');
    expect(odometerSourceForSave(41199, 41199, 'typed'), 'typed');
  });

  test('helpers: dates, months, rupees, km, client ids', () {
    expect(shiftIsoDate('2026-10-01', -1), '2026-09-30');
    expect(shiftIsoDate('2026-03-01', -1), '2026-02-28');
    expect(shiftMonth('2026-01', -1), '2025-12');
    expect(shiftMonth('2026-12', 1), '2027-01');
    expect(rupeesFromPaise(190065), '₹1,900.65');
    expect(rupeesFromPaise(12345600), '₹1,23,456');
    expect(rupeesFromPaise(9950), '₹99.5');
    expect(kmText(41200), '41200');
    expect(kmText(41262.4), '41262.4');
    final id = transportClientId('fuel');
    expect(RegExp(r'^[A-Za-z0-9_-]{8,64}$').hasMatch(id), isTrue);
    expect(transportClientId('fuel'), isNot(id));
  });
}

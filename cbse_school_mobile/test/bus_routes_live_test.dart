import 'package:cbse_school_mobile/core/api/api_client.dart';
import 'package:cbse_school_mobile/features/modules/bus_route_live_screen.dart';
import 'package:cbse_school_mobile/l10n/app_localizations_en.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _payload({required String status, bool stale = false}) => {
  'at': '2026-10-20T01:30:00.000Z',
  'school': {'lat': 25.43, 'lng': 82.94},
  'staleAfterMinutes': 10,
  'scoped': false,
  'routes': [
    {
      'routeId': 'r1',
      'code': 'M1',
      'name': 'Magic-1',
      'busNo': '',
      'vehicle': {'id': 'v1', 'name': 'Magic', 'registrationNo': 'UP65XX0000'},
      'status': status,
      'run': {
        'shiftId': 'am',
        'name': 'Morning',
        'trip': 'AM',
        'departTime': '06:00',
      },
      'fix': {
        'lat': 25.41,
        'lng': 82.9,
        'speedKmh': 28,
        'headingDeg': 90,
        'fixAt': '2026-10-20T01:29:00.000Z',
        'ageSec': 60,
        'stale': stale,
      },
      'trailUnread': false,
      'stops': [
        {
          'id': 'st_a',
          'name': 'A',
          'sequence': 1,
          'lat': 25.4,
          'lng': 82.9,
          'state': 'passed',
          'passedAt': '2026-10-20T01:22:00.000Z',
          'etaAt': null,
          'etaMinutes': null,
        },
        {
          'id': 'st_b',
          'name': 'B',
          'sequence': 2,
          'lat': 25.41,
          'lng': 82.9,
          'state': 'not_seen',
          'passedAt': null,
          'etaAt': null,
          'etaMinutes': null,
        },
        {
          'id': 'st_c',
          'name': 'C',
          'sequence': 3,
          'lat': 25.42,
          'lng': 82.9,
          'state': 'upcoming',
          'passedAt': null,
          'etaAt': '2026-10-20T01:36:00.000Z',
          'etaMinutes': 6,
        },
        {
          'id': 'st_d',
          'name': 'D',
          'sequence': 4,
          'lat': null,
          'lng': null,
          'state': 'unpinned',
          'passedAt': null,
          'etaAt': null,
          'etaMinutes': null,
        },
        {
          'id': 'st_e',
          'name': 'E',
          'sequence': 5,
          'lat': 25.43,
          'lng': 82.9,
          'state': 'upcoming',
          'passedAt': null,
          'etaAt': null,
          'etaMinutes': null,
        },
      ],
      'schoolEta': {'etaAt': '2026-10-20T01:45:00.000Z', 'etaMinutes': 15},
    },
  ],
};

void main() {
  final l = LEn();

  test('reads /staff/bus-routes/live', () {
    final d = BusRoutesLive.fromJson(_payload(status: 'live'));
    expect(d.routes, hasLength(1));
    final r = d.routes.single;
    expect(r.status, 'live');
    expect(r.run!.trip, 'AM');
    expect(r.fix!.stale, isFalse);
    expect(r.fix!.hasPoint, isTrue);
    expect(r.stops.map((s) => s.id), ['st_a', 'st_b', 'st_c', 'st_d', 'st_e']);
    expect(r.stops[3].pinned, isFalse);
    expect(r.schoolEtaMinutes, 15);
  });

  test('a fix with no stale flag is treated as stale, never live', () {
    final p = _payload(status: 'live');
    ((p['routes'] as List).first as Map)['fix'] = {
      'lat': 25.4,
      'lng': 82.9,
      'fixAt': '2026-10-20T01:29:00.000Z',
    };
    expect(BusRoutesLive.fromJson(p).routes.single.fix!.stale, isTrue);
  });

  test('an unknown status is not upgraded to live', () {
    final d = BusRoutesLive.fromJson(_payload(status: 'something-new'));
    expect(d.routes.single.status, 'no_vehicle');
  });

  test(
    'stop lines say passed-at, not seen, an estimate, or nothing invented',
    () {
      final r = BusRoutesLive.fromJson(_payload(status: 'live')).routes.single;
      final passed = liveStopLine(l, r.stops[0]);
      expect(passed, startsWith('passed at '));
      expect(
        passed,
        contains(liveHhmm(DateTime.parse('2026-10-20T01:22:00.000Z'))),
      );
      expect(liveStopLine(l, r.stops[1]), l.busLiveNotSeen);
      expect(liveStopLine(l, r.stops[2]), contains('6 min'));
      expect(liveStopLine(l, r.stops[3]), l.busLiveUnpinned);
      expect(
        liveStopLine(l, r.stops[4]),
        l.busLiveNoEta,
        reason: 'no ETA from the server → no time shown',
      );
    },
  );

  test('polling runs only in the foreground', () {
    expect(livePollAllowed(AppLifecycleState.resumed), isTrue);
    expect(livePollAllowed(AppLifecycleState.paused), isFalse);
    expect(livePollAllowed(AppLifecycleState.inactive), isFalse);
    expect(livePollAllowed(AppLifecycleState.hidden), isFalse);
    expect(livePollAllowed(AppLifecycleState.detached), isFalse);
    expect(kBusRouteLivePoll, const Duration(seconds: 15));
  });
}

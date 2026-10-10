/**
 * What the server last said the transport desk holds — for this page session.
 *
 * Nothing here touches localStorage, and that is the point. On 14 Sep 2026 a
 * phone whose storage was full downloaded the whole desk (6 routes, 174
 * assignments), failed to cache it, read the cache back as empty, and then
 * `seedTransportIfEmpty` invented a five-vehicle fleet and pushed it — twelve
 * times in an hour, each refused by the server guard. The seed asked "is the
 * cache empty?" when the question that matters is "did the SERVER say the
 * desk is empty?". Those are different questions on any browser that cannot
 * hold the cache, and a phone is such a browser.
 *
 * `null` means the server has not answered yet in this session. Unknown is
 * not empty: nothing may be seeded, and nothing may be pushed as a deletion,
 * until it has.
 */

export type TransportDeskAnswer = {
  routes: number;
  vehicles: number;
  assignments: number;
};

let answer: TransportDeskAnswer | null = null;

export function recordTransportDeskAnswer(next: TransportDeskAnswer): void {
  answer = {
    routes: Math.max(0, Number(next.routes) || 0),
    vehicles: Math.max(0, Number(next.vehicles) || 0),
    assignments: Math.max(0, Number(next.assignments) || 0),
  };
}

export function transportDeskAnswer(): TransportDeskAnswer | null {
  return answer;
}

/**
 * true  — the server confirmed it holds no routes, vehicles or assignments;
 *         seeding a starter fleet is legitimate (a new tenant).
 * false — the server holds data; an empty cache is a cache problem.
 * null  — no answer yet; treat as "do nothing that assumes either".
 */
export function serverTransportDeskIsEmpty(): boolean | null {
  if (!answer) return null;
  return answer.routes === 0 && answer.vehicles === 0 && answer.assignments === 0;
}

export function resetTransportDeskAnswer(): void {
  answer = null;
}

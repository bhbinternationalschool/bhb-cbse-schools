/**
 * Two parents writing at once, and one desk.
 *
 * WHY (24 Sep 2026): the parent chat desk is ONE record — every thread the
 * school has, in a single blob that is read, changed and written back. A
 * reply is written at the end of handling the message, and handling takes
 * seconds: the syllabus is loaded, the model is asked, the drill is opened.
 * Two families writing inside that window each start from the copy they
 * read, and the second one to write puts back a desk that never had the
 * first one's turns in it.
 *
 * 18:02 IST that evening, KANHAIYA PATEL tapped *अभ्यास शुरू करें* for
 * SUMIT (V). The drill opened, the scope question was sent, WhatsApp
 * reported it delivered and then read — and eight seconds later another
 * family's reply was written over the top. On the desk the school looks at,
 * that family has said nothing since 21 September.
 *
 * The office not seeing what the bot told a family is how a parent gets
 * told something twice, or contradicted. `appendSisBotClosing` already
 * re-reads the desk and patches its one thread for exactly this reason;
 * this is that, for the turns the bot and the office add.
 *
 * It narrows the window rather than closing it — the read and the write are
 * still two steps — but it takes it from the whole of handling a message
 * down to the write itself, and within one server the re-read sees the
 * other reply because the desk is cached in the process.
 */

/** The little a merge needs to know about a message. */
type Turn = { id: string };

/** The little a merge needs to know about a thread. */
type Thread<M extends Turn> = { id: string; messages: M[] };

/**
 * `next` folded into `threads` as they stand now.
 *
 * `next` is the thread as the caller wants it — status, unread count,
 * pending ask and the rest — and `turns` are the messages it added. The
 * messages come from the STORED copy plus those turns, so a reply written
 * to another thread (or to this one) while this message was being handled
 * is kept.
 *
 * A turn already in the stored copy is not added twice, so a retry of the
 * same write is harmless. A thread that is not on the desk yet is new, and
 * goes to the front where `findOrCreate` puts it.
 */
export function mergeThreadTurns<M extends Turn, T extends Thread<M>>(
  threads: T[],
  next: T,
  turns: M[],
): T[] {
  const stored = threads.find((t) => t.id === next.id);
  if (!stored) return [next, ...threads];
  const already = new Set(stored.messages.map((m) => m.id));
  const merged: T = {
    ...next,
    messages: [...stored.messages, ...turns.filter((t) => !already.has(t.id))],
  };
  return threads.map((t) => (t.id === next.id ? merged : t));
}

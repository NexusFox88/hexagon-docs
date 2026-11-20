/** Application-owned delivery helpers, not Hexagon SDK methods.
 * Authorize the viewer before calling forwardStoredEvents. readAfter must return
 * committed rows for exactly this Run, ordered by numeric ID, strictly after the
 * cursor. One database read loop supplies history and later events alike.
 */
const eventNumber = value => {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error('Expected a positive decimal event ID string');
  }
  return BigInt(value);
};

export async function* forwardStoredEvents({runId, after = '0', readAfter, wait, signal}) {
  if (after !== '0') eventNumber(after);
  let cursor = after;
  while (!signal.aborted) {
    const rows = await readAfter(runId, cursor, signal);
    if (signal.aborted) return;
    if (!rows.length) {
      await wait(signal);
      continue; // Empty application history does not mean a completed Run.
    }
    for (const event of rows) {
      if (signal.aborted) return;
      if (eventNumber(event.id) <= BigInt(cursor)) throw new Error('Unordered stored events');
      yield {run_id: runId, event};
      cursor = event.id;
    }
  }
}

/** One viewer's in-memory projection. Reload without durable local storage must
 * rebuild from cursor 0, or atomically restore both the timeline and its cursor.
 */
export class RunTimeline {
  constructor(runId) {
    this.runId = runId;
    this.cursor = '0';
    this.rows = new Map();
    this.connection = 'disconnected';
    this.run = null;
  }
  connectionChanged(state) {
    this.connection = state; // Does not change execution state.
  }
  apply({run_id, event}) {
    if (run_id !== this.runId) throw new Error('Unexpected Run');
    const id = eventNumber(event.id);
    if (this.rows.has(event.id)) return false;
    if (id <= BigInt(this.cursor)) throw new Error('Unseen event behind viewer cursor');
    this.rows.set(event.id, event);
    this.cursor = event.id;
    return true;
  }
  reconcileRun(run) {
    if (run.id !== this.runId) throw new Error('Unexpected Run query result');
    this.run = run; // Render this authoritative state/output separately.
  }
}

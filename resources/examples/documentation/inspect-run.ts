/** Read an existing Run; no submission/cancellation/approval/resource mutations. */
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Hexagon } from '../../sdk/typescript/dist/index.js';

type Reader = Pick<Hexagon, 'run' | 'session' | 'events' | 'artifacts'>;
export async function inspect(client: Reader, sessionId: string, runId: string, after = '0', maxPages = 20) {
  const run = await client.run(runId);
  if (run.session_id !== sessionId) throw new Error('Run does not belong to the supplied Session');
  const session = await client.session(sessionId);
  const counts: Record<string, number> = Object.create(null);
  let cursor = after, drained = false;
  for (let page = 0; page < maxPages; page++) {
    const { events } = await client.events(runId, cursor);
    if (!events.length) { drained = true; break; }
    for (const event of events) {
      if (typeof event.id !== 'string' || !/^[0-9]+$/.test(event.id) || BigInt(event.id) <= BigInt(cursor)) {
        throw new Error('Expected strictly increasing decimal-string event IDs');
      }
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      cursor = event.id;
    }
  }
  const latest = await client.run(runId);
  const { artifacts } = await client.artifacts(runId);
  return {
    session_id: sessionId, run_id: runId, session_state: session.state, run_state: latest.state,
    error_code: latest.error?.code ?? null,
    after, last_observed_cursor: cursor, reached_empty_event_page: drained,
    event_type_counts: counts,
    artifacts: artifacts.map(a => ({ id: a.id, size: a.size, sha256: a.sha256 })),
    scope: 'Bounded observation, not an atomic snapshot or persisted event consumer checkpoint',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: {
    session: { type: 'string' }, run: { type: 'string' },
    after: { type: 'string', default: '0' }, 'max-pages': { type: 'string', default: '20' },
  } });
  const pages = Number(values['max-pages']);
  if (!values.session || !values.run || !/^[0-9]+$/.test(values.after!) || !Number.isInteger(pages) || pages < 1 || pages > 1000) {
    throw new Error('Supply --session and --run; after must be decimal digits and max-pages 1–1000');
  }
  console.log(JSON.stringify(await inspect(await Hexagon.local(), values.session, values.run, values.after, pages), null, 2));
}

/** Local application transport demo. Synthetic source; no Hexagon credentials.
 * Production adapters must authenticate/authorize before resolving the Run,
 * read committed application rows, and query Hexagon only on the backend.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {forwardStoredEvents} from './event-delivery.mjs';

export function deliveryServer({runId, readAfter, queryRun}) {
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    try {
      if (url.pathname === '/' || url.pathname === '/event-delivery.mjs') {
        const html = url.pathname === '/';
        response.setHeader('Content-Type', html ? 'text/html; charset=utf-8' : 'text/javascript');
        response.end(await readFile(new URL(html ? './event-delivery-viewer.html' : './event-delivery.mjs', import.meta.url)));
      } else if (url.pathname === '/run') {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(await queryRun()));
      } else if (url.pathname === '/events') {
        const after = url.searchParams.get('after') ?? '0';
        if (!/^(0|[1-9][0-9]*)$/.test(after)) { response.writeHead(400).end(); return; }
        const controller = new AbortController();
        response.on('close', () => controller.abort()); // Observation only.
        response.writeHead(200, {'Content-Type':'text/event-stream', 'Cache-Control':'no-store'});
        response.flushHeaders();
        const wait = signal => delay(100, undefined, {signal});
        try {
          for await (const envelope of forwardStoredEvents({runId, after, readAfter, wait, signal:controller.signal})) {
            if (!response.write(`data: ${JSON.stringify(envelope)}\n\n`)) {
              await once(response, 'drain', {signal:controller.signal});
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        } finally { response.end(); }
      } else { response.writeHead(404).end(); }
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
      else response.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runId = 'synthetic-delivery-run';
  let started;
  const count = () => {
    started ??= Date.now(); // Begin when the first viewer queries this fixture.
    return Math.min(12, Math.floor((Date.now() - started) / 2000) + 1);
  };
  // Synthetic committed history remains replayable after disconnects.
  const rows = () => Array.from({length:count()}, (_, i) => ({id:String(9007199254740993n + BigInt(i)), type:'demo.progress', data:{step:i + 1}}));
  const server = deliveryServer({runId,
    readAfter:async (_, after) => rows().filter(row => BigInt(row.id) > BigInt(after)),
    queryRun:async () => ({id:runId, state:count() === 12 ? 'completed' : 'running', output:{text:'Synthetic source; no cloud task is submitted.'}}),
  });
  server.listen(0, '127.0.0.1', () => console.log(`Synthetic delivery demo: http://127.0.0.1:${server.address().port}/ (Ctrl-C to stop)`));
}

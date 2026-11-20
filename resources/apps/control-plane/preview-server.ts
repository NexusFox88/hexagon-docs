import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { ExecutionError } from '../../modules/execution/runs.js';
import type { Previews } from '../../modules/sandboxes/previews.js';

/** Separate origin per preview: sandbox scripts never share Console authority. */
export function createPreviewServer(previews: Previews) {
  // Browsers can preconnect without sending HTTP headers. Those sockets are
  // not idle HTTP requests and otherwise keep shutdown pending indefinitely.
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024, forceCloseConnections: true });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ExecutionError ? error.status : 502).send({ error: { code: error instanceof ExecutionError ? error.code : 'preview_unavailable' } }));
  app.all('/*', async (request, reply) => {
    const url = new URL(request.url, 'http://preview.invalid');
    const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('hexagon_preview='))?.slice('hexagon_preview='.length);
    const ticket = url.searchParams.get('ticket');
    const grant = await previews.authorize(request.hostname.split(':')[0]!, ticket ?? cookie ?? '');
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff');
    if (ticket) {
      if (request.method !== 'GET') throw new ExecutionError('preview_unauthorized', 401);
      const seconds = Math.max(0, Math.floor((new Date(grant.expires_at).getTime() - Date.now()) / 1000));
      reply.header('set-cookie', `hexagon_preview=${ticket}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${request.protocol === 'https' ? '; Secure' : ''}`);
      url.searchParams.delete('ticket');
      return reply.redirect(url.pathname + url.search);
    }
    if (request.headers.origin && request.headers.origin !== `${request.protocol}://${request.headers.host}`) throw new ExecutionError('preview_origin_rejected', 403);
    const target = await previews.target(grant);
    const disconnected = new AbortController();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      disconnected.abort();
      target.release?.();
    };
    reply.raw.once('close', release);
    try {
      if (reply.raw.destroyed) { release(); return reply; }
      const upstream = new URL(target.url);
      // Preserve the trusted connector origin; user paths cannot choose another host.
      upstream.pathname = url.pathname; upstream.search = url.search;
      const headers: Record<string, string> = { ...target.headers };
      for (const name of ['content-type', 'accept', 'range', 'if-none-match']) { const value = request.headers[name]; if (typeof value === 'string') headers[name] = value; }
      const response = await fetch(upstream, { method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : request.body === undefined ? undefined : new Uint8Array(request.body as Buffer), redirect: 'manual', signal: AbortSignal.any([disconnected.signal, AbortSignal.timeout(30000)]) });
      if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        const location = new URL(response.headers.get('location')!, upstream);
        await response.body?.cancel();
        if (location.origin !== upstream.origin) throw new ExecutionError('preview_external_redirect_blocked', 502);
        return reply.code(response.status).header('location', location.pathname + location.search).send();
      }
      reply.code(response.status).header('content-security-policy', "sandbox allow-scripts allow-forms allow-same-origin; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
      for (const name of ['content-type', 'content-range', 'accept-ranges', 'etag']) { const value = response.headers.get(name); if (value) reply.header(name, value); }
      // Do not forward provider cookies, credentials, CORS, or upstream framing policy.
      return response.body && request.method !== 'HEAD' ? reply.send(Readable.fromWeb(response.body as any)) : reply.send();
    } catch (error) { release(); throw error; }
  });
  return app;
}

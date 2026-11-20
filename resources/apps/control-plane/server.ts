import {runOriginInput} from '../../modules/execution/runs.js';
import {harnessProtocols} from '../../modules/harnesses/protocols.js';
import {harnessCatalogEntry,templateCatalog} from '../../modules/harnesses/catalog.js';
import {HarnessImages} from '../../modules/harnesses/images.js';
import type {LocalAccess} from '../../modules/credentials/local-access.js';
import {ApplicationTokens,applicationRoute} from '../../modules/credentials/application-tokens.js';
import {ExecutionQueries} from '../../modules/execution/queries.js';
import {ResourceOperations} from '../../modules/sandboxes/operations.js';
import type {DeploymentSettings} from '../../modules/deployment/settings.js';
import type {DevelopmentIngress} from '../../modules/deployment/ingress.js';
import { applicationCatalog } from '../../integrations/apps/registry.js';
import { ToolReconciliation } from '../../modules/tools/reconciliation.js';
import { HarnessPackages } from '../../modules/execution/harness-packages.js';
import { Previews, previewInput } from '../../modules/sandboxes/previews.js';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { Artifacts } from '../../modules/artifacts/artifacts.js';
import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import { z, ZodError } from 'zod';
import { authenticateIdentity } from '../../modules/credentials/api-auth.js';
import { ExecutionError, Runs } from '../../modules/execution/runs.js';
import { Connections, connectionInput, connectionPatch } from '../../modules/connections/connections.js';
import { Sessions, agentInput, sessionInput } from '../../modules/execution/sessions.js';
import type { SandboxLifecycle } from '../../modules/sandboxes/lifecycle.js';
import { SessionInputs, uploadInput } from '../../modules/execution/inputs.js';

declare module 'fastify' { interface FastifyRequest { tenant: string } }

export function createServer(pool: pg.Pool, services?: { harnessImages?:HarnessImages; consoleRelease?:{root:string;version:string};localAccess?:LocalAccess; connections: Connections; sessions: Sessions; lifecycle?: SandboxLifecycle; workerHealth?: () => unknown; accessHealth?: () => Promise<unknown>; credentialHealth?: (tenant: string) => Promise<{ state: string; check?: string }>; previews?: Previews; deployment?:DeploymentSettings; deploymentRevision?:string; ingress?:DevelopmentIngress }) {
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 });
  const runs = new Runs(pool);
  const inputs = new SessionInputs(pool);
  const artifacts = new Artifacts(pool);
  app.decorateRequest('tenant', '');
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ExecutionError) return reply.code(error.status).send({ error: { code: error.code } });
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'invalid_request', fields: error.issues.map(i => i.path.join('.')) } });
    const httpError = error as { statusCode?: number; code?: string };
    if (httpError.code?.startsWith('FST_') && httpError.statusCode && httpError.statusCode >= 400 && httpError.statusCode < 500) return reply.code(httpError.statusCode).send({ error: { code: 'invalid_http_request' } });
    // Never return database/HTTP exceptions which may contain credentials or queries.
    return reply.code(500).send({ error: { code: 'internal_error' } });
  });
  app.register(staticFiles, { root:services?.consoleRelease?.root??fileURLToPath(new URL('../console/', import.meta.url)), prefix: '/console/', setHeaders(response) { response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'no-store'); } });
  app.get('/console/version',async(_request,reply)=>reply.header('cache-control','no-store').send({version:services?.consoleRelease?.version??'development'}));
  app.get('/', async (_request, reply) => reply.redirect('/console/'));
  if(services) app.get('/oauth/callback',async(request,reply)=>{reply.header('cache-control','no-store');reply.header('referrer-policy','no-referrer');return reply.redirect(await services.connections.oauth().callback(new URL(request.url,'http://localhost').searchParams));});
  if(services?.localAccess)app.post('/local/connect',async(request,reply)=>{reply.header('cache-control','no-store');const grant=services.localAccess!.bootstrap(request);return grant?grant:reply.code(403).send({error:{code:'local_bootstrap_forbidden'}});});
  app.get('/health/live', async () => ({ status: 'alive' }));
  app.register(async api => {
    api.addHook('onRequest', async (request, reply) => {
      const identity = services?.localAccess?.authenticate(request)??await authenticateIdentity(pool, request.headers.authorization);
      if (!identity) return reply.code(401).send({ error: { code: 'unauthorized' } });
      if(identity.role==='application'&&!applicationRoute(request.method,request.url))return reply.code(403).send({error:{code:'owner_token_required'}});
      request.tenant = identity.tenant_id;
      (request as any).executionPrincipal={key_id:identity.id,role:identity.role};
    });
    const tokens=new ApplicationTokens(pool);
    api.get('/tokens',async req=>tokens.list(req.tenant));
    api.post('/tokens',async(req,reply)=>reply.header('cache-control','no-store').code(201).send(await tokens.create(req.tenant,req.body)));
    api.post('/tokens/:id/rotate',async(req,reply)=>reply.header('cache-control','no-store').send(await tokens.rotate(req.tenant,z.object({id:z.string()}).parse(req.params).id)));
    api.delete('/tokens/:id',async req=>tokens.revoke(req.tenant,z.object({id:z.string()}).parse(req.params).id));
    api.get('/health', async (request, reply) => {
      await pool.query('SELECT 1');
      const activeRuns=(await pool.query("SELECT EXISTS(SELECT 1 FROM runs WHERE tenant_id=$1 AND state NOT IN ('completed','failed','cancelled')) AS active",[request.tenant])).rows[0].active;
      const credentials = await services?.credentialHealth?.(request.tenant) ?? { state: 'not_configured' };
      if (credentials.state === 'unavailable') reply.code(503);
      return { process_id:process.pid, active_runs:activeRuns, api: 'ready', database: 'ready', credentials, credential_access:await services?.accessHealth?.()??services?.connections.access().configuration()??{state:'not_configured'}, execution: services?.workerHealth?.() ?? 'not_configured' };
    });
    if (services) {
      const { connections, sessions } = services;
      if(services.deployment) {
        const localOwner = (tenant:string) => {if(tenant!=='local-workspace')throw new ExecutionError('deployment_management_forbidden',403);};
        api.get('/deployment',async req=>{localOwner(req.tenant);const saved=await services.deployment!.read();return {...saved,restart_required:saved.revision!==services.deploymentRevision,ingress:services.ingress?.status(),environment_overrides:{proxy:Boolean(process.env.HTTPS_PROXY||process.env.https_proxy),ingress:Boolean(process.env.HEXAGON_ACCESS_URL&&!process.env.HEXAGON_ACCESS_TUNNEL)}};});
        api.put('/deployment',async req=>{localOwner(req.tenant);return services.deployment!.update(req.body);});
        api.post('/deployment/ingress/retry',async req=>{localOwner(req.tenant);if(process.env.HEXAGON_ACCESS_TUNNEL!=='cloudflare')throw new ExecutionError('development_ingress_disabled',409);if((await pool.query("SELECT 1 FROM runs WHERE state NOT IN ('completed','failed','cancelled') LIMIT 1")).rowCount)throw new ExecutionError('active_run',409);void services.ingress?.retry();return services.ingress?.status();});
        api.post('/deployment/ingress/stop',async req=>{localOwner(req.tenant);if((await pool.query("SELECT 1 FROM runs WHERE state NOT IN ('completed','failed','cancelled') LIMIT 1")).rowCount)throw new ExecutionError('active_run',409);await services.ingress?.stop();return services.ingress?.status();});
      }

      const idOf = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
      const managedSecrets=connections.managedSecrets();
      api.addHook('onSend',async(_req,reply,payload)=>{reply.header('cache-control','no-store');return payload;});
      api.get('/secrets',async req=>({secrets:await managedSecrets.list(req.tenant)}));
      api.post('/secrets',async(req,reply)=>reply.code(201).send(await managedSecrets.create(req.tenant,req.body)));
      api.get('/secrets/:id',async req=>managedSecrets.get(req.tenant,idOf(req.params)));
      api.patch('/secrets/:id',async req=>managedSecrets.patch(req.tenant,idOf(req.params),req.body));
      api.delete('/secrets/:id',async(req,reply)=>{await managedSecrets.remove(req.tenant,idOf(req.params));return reply.code(204).send();});
      api.get('/applications', async req=>({applications:applicationCatalog(),oauth_clients:await connections.oauth().configurations(req.tenant)}));
      api.put('/applications/:provider/oauth-client',async req=>connections.oauth().configure(req.tenant,z.object({provider:z.string()}).parse(req.params).provider,req.body));
      api.post('/connections/:id/authorize',async req=>connections.oauth().start(req.tenant,idOf(req.params)));
      api.get('/authorization-flows/:id',async req=>connections.oauth().flow(req.tenant,idOf(req.params)));
      api.delete('/authorization-flows/:id',async req=>connections.oauth().cancel(req.tenant,idOf(req.params)));
      api.get('/catalog', async req => ({ connections: connections.catalog(), harnesses: (await sessions.catalog(req.tenant)).map(harnessCatalogEntry), harness_templates:templateCatalog(), harness_protocols:harnessProtocols }));
      api.post('/harnesses', async (req,reply)=>reply.code(201).send(await (services?.harnessImages??new HarnessImages(pool)).register(req.tenant,req.body)));
      api.post('/harness-packages', async (req, reply) => reply.code(201).send(await new HarnessPackages(pool).register(req.tenant, req.body)));
      api.get('/connections', async req => ({ connections: await connections.list(req.tenant) }));
      api.post('/connections', async (req, reply) => reply.code(201).send(await connections.create(req.tenant, connectionInput.parse(req.body))));
      api.get('/connections/:id/usage',async req=>connections.usage(req.tenant,idOf(req.params),req.query));
      api.get('/connections/:id/dependencies',async req=>connections.dependencies(req.tenant,idOf(req.params)));
      api.get('/connections/:id', async req => connections.get(req.tenant, idOf(req.params)));
      api.patch('/connections/:id', async req => connections.patch(req.tenant, idOf(req.params), connectionPatch.parse(req.body)));
      api.post('/connections/:id/discover-mcp',async req=>connections.discoverMcp(req.tenant,idOf(req.params)));
      api.get('/connections/:id/authorization',async req=>connections.oauth().status(req.tenant,idOf(req.params)));
      api.post('/connections/:id/disconnect',async req=>connections.disconnect(req.tenant,idOf(req.params)));
      api.post('/connections/:id/validate', async req => connections.validate(req.tenant, idOf(req.params)));
      api.delete('/connections/:id', async (req, reply) => { await connections.remove(req.tenant, idOf(req.params)); return reply.code(204).send(); });
      api.get('/agents', async req => ({ agents: await sessions.listAgents(req.tenant) }));
      api.post('/agents', async (req, reply) => reply.code(201).send(await sessions.createAgent(req.tenant, agentInput.parse(req.body))));
      api.get('/agents/:id',async req=>sessions.getAgent(req.tenant,idOf(req.params)));
      api.put('/agents/:id',async req=>sessions.reviseAgent(req.tenant,idOf(req.params),req.body));
      api.post('/agents/:id/archive',async req=>sessions.archiveAgent(req.tenant,idOf(req.params)));
      api.post('/agents/:id/copy',async(req,reply)=>reply.code(201).send(await sessions.copyAgent(req.tenant,idOf(req.params),z.object({name:z.string().min(1).max(200)}).strict().parse(req.body).name)));
      api.post('/agents/preflight',async req=>sessions.preflightDefinition(req.tenant,req.body));
      const queries=new ExecutionQueries(pool);
      api.get('/overview',async req=>queries.overview(req.tenant));
      api.get('/pending',async req=>queries.pending(req.tenant,req.query));
      api.get('/runs',async req=>queries.list(req.tenant,'runs',req.query));
      api.get('/sessions',async req=>queries.list(req.tenant,'sessions',req.query));
      api.get('/sessions/activity',async req=>queries.activity(req.tenant,z.object({period:z.enum(['24h','7d']).default('24h')}).parse(req.query).period));
      api.get('/fleet', async req => ({ sessions: await sessions.fleet(req.tenant) }));
      api.post('/sessions/preflight',async req=>sessions.create(req.tenant,sessionInput.parse(req.body),true));
      api.post('/sessions', async (req, reply) => reply.code(201).send(await sessions.create(req.tenant, sessionInput.parse(req.body))));
      const access=connections.access();
      api.get('/sessions/:id/access',async req=>({grants:await access.list(req.tenant,idOf(req.params))}));
      api.post('/sessions/:id/access',async(req,reply)=>{
        const body=z.object({connection_id:z.string().uuid()}).strict().parse(req.body);
        reply.header('cache-control','no-store');
        return reply.code(201).send(await access.issue(req.tenant,idOf(req.params),body.connection_id));
      });
      api.delete('/access/:id',async(req,reply)=>{await access.revoke(req.tenant,idOf(req.params));return reply.code(204).send();});
      api.get('/sessions/:id/environment',async(req,reply)=>reply.header('cache-control','no-store').send(await sessions.environment(req.tenant,idOf(req.params))));
      api.get('/sessions/:id/authorization',async req=>sessions.authorization(req.tenant,idOf(req.params)));
      api.delete('/sessions/:id/connections/:connection',async req=>{const p=z.object({id:z.string(),connection:z.string()}).parse(req.params);return sessions.revokeConnection(req.tenant,p.id,p.connection);});
      api.get('/sessions/:id/initialization',async request=>sessions.initialization(request.tenant,idOf(request.params)));
      api.get('/sessions/:id', async req => sessions.get(req.tenant, idOf(req.params)));
      api.get('/sessions/:id/files', async req => ({ files: await inputs.list(req.tenant, idOf(req.params)) }));
      api.post('/sessions/:id/files', async req => ({ files: await inputs.upload(req.tenant, idOf(req.params), uploadInput.parse(req.body)) }));
      if (services.lifecycle) {
        const operations=new ResourceOperations(pool,services.lifecycle);
        api.get('/resource-operations',async req=>{const q=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).default(0)}).parse(req.query);return operations.list(req.tenant,q.limit,q.offset);});
        api.get('/resource-operations/:id',async req=>operations.get(req.tenant,idOf(req.params)));
        api.post('/resource-operations/:id/review',async req=>operations.review(req.tenant,idOf(req.params),req.body));
        const lifecycle = services.lifecycle;
        api.post('/sessions/:id/pause',async req=>lifecycle.pause(req.tenant,idOf(req.params),z.object({scope:z.enum(['session','sandbox']).default('session')}).strict().parse(req.body??{}).scope));
        api.post('/sessions/:id/resume',async req=>lifecycle.resume(req.tenant,idOf(req.params)));
        api.post('/sessions/:id/close', async req => lifecycle.close(req.tenant, idOf(req.params)));
      }
    }
    if (services?.previews) {
      const previews = services.previews;
      api.post('/sessions/:id/previews', async (request, reply) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        return reply.code(201).send(await previews.create(request.tenant, id, previewInput.parse(request.body)));
      });
      api.delete('/previews/:id', async (request, reply) => {
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        await previews.revoke(request.tenant, id); return reply.code(204).send();
      });
    }
    api.post('/sessions/:id/runs', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { input,origin } = z.object({ input: z.string().min(1).max(100000),origin:runOriginInput.optional() }).strict().parse(request.body);
      const key = z.string().min(1).max(256).parse(request.headers['idempotency-key']);
      const run = await runs.submit(request.tenant, id, key, input,origin,(request as any).executionPrincipal);
      return reply.code(202).send(publicRun(run));
    });
    api.get('/sessions/:id/runs', async request => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { before } = z.object({ before: z.string().datetime().optional() }).parse(request.query);
      if (!(await pool.query('SELECT 1 FROM sessions WHERE tenant_id=$1 AND id=$2', [request.tenant, id])).rowCount) throw new ExecutionError('session_not_found', 404);
      const rows = (await pool.query('SELECT * FROM runs WHERE tenant_id=$1 AND session_id=$2 AND ($3::timestamptz IS NULL OR created_at<$3) ORDER BY created_at DESC LIMIT 100', [request.tenant, id, before ?? null])).rows;
      return { runs: rows.map(publicRun) };
    });
    api.get('/runs/:id', async request => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      return publicRun(await runs.get(request.tenant, id));
    });
    api.get('/runs/:id/artifacts', async request => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      return { artifacts: await artifacts.list(request.tenant, id) };
    });
    api.get('/artifacts/:id/content', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const artifact = await artifacts.read(request.tenant, id);
      return reply.header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="artifact"; filename*=UTF-8''${encodeURIComponent(artifact.name.split('/').at(-1))}`)
        .header('x-content-type-options', 'nosniff').header('cache-control', 'private, no-store')
        .header('x-content-sha256', artifact.sha256).send(artifact.content);
    });
    api.get('/runs/:id/events', async request => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { after } = z.object({ after: z.string().regex(/^\d+$/).default('0') }).parse(request.query);
      return { events: await runs.events(request.tenant, id, after) };
    });
    api.get('/runs/:id/stream', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const query = z.object({ after: z.string().regex(/^\d+$/).optional() }).parse(request.query);
      let cursor = z.string().regex(/^\d+$/).parse(query.after ?? request.headers['last-event-id'] ?? '0');
      await runs.get(request.tenant, id);
      const abort = new AbortController();
      reply.raw.once('close', () => abort.abort());
      const stream = Readable.from((async function* () {
        try {
          let heartbeat = Date.now();
          while (!abort.signal.aborted) {
            const rows = await runs.events(request.tenant, id, cursor);
            for (const row of rows) {
              cursor = row.id;
              yield `id: ${row.id}\nevent: ${row.type}\ndata: ${JSON.stringify(row.data)}\n\n`;
            }
            if (rows.length) continue;
            const run = await runs.get(request.tenant, id);
            if (['completed', 'failed', 'cancelled'].includes(run.state)) {
              // Re-read after observing terminal state, so the final committed
              // event cannot be missed between an empty page and the state read.
              const final = await runs.events(request.tenant, id, cursor);
              if (final.length) continue;
              yield `event: stream.end\ndata: ${JSON.stringify({ state: run.state })}\n\n`;
              return;
            }
            if (Date.now() - heartbeat >= 15000) { yield ': keepalive\n\n'; heartbeat = Date.now(); }
            await sleep(500, undefined, { signal: abort.signal });
          }
        } catch (error) { if (!abort.signal.aborted) throw error; }
      })());
      return reply.header('content-type', 'text/event-stream').header('cache-control', 'no-cache').header('x-accel-buffering', 'no').send(stream);
    });
    api.get('/runs/:id/tool-calls', async request => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      return { calls: await new ToolReconciliation(pool).list(request.tenant, id) };
    });
    api.post('/runs/:id/tool-calls/:call/resolve', async request => {
      const { id, call } = z.object({ id: z.string().uuid(), call: z.string().uuid() }).parse(request.params);
      return new ToolReconciliation(pool).resolve(request.tenant, id, call, request.body);
    });
    api.post('/runs/:id/tool-calls/:call/deny-authorization', async request => {
      const { id, call } = z.object({ id: z.string().uuid(), call: z.string().uuid() }).parse(request.params);
      return new ToolReconciliation(pool).denyAuthorization(request.tenant, id, call, request.body);
    });
    api.post('/runs/:id/cancel', async request => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      return publicRun(await runs.cancel(request.tenant, id));
    });
    api.get('/runs/:id/approvals',async req=>{const {id}=z.object({id:z.string().uuid()}).parse(req.params);await runs.get(req.tenant,id);return {approvals:(await pool.query('SELECT id,run_id,action,state,decision,created_at FROM approvals WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at',[req.tenant,id])).rows};});
    api.post('/approvals/:id/decision', async request => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { approved } = z.object({ approved: z.boolean() }).strict().parse(request.body);
      const row = await runs.decide(request.tenant, id, approved);
      return { id: row.id, run_id: row.run_id, state: row.state };
    });
  }, { prefix: '/v1' });
  return app;
}

function publicRun(run: Record<string, unknown>) {
  const { id, session_id, state, input, output, error, created_at, updated_at, origin, execution_identity } = run;
  return { id, session_id, state, input, output, error, created_at, updated_at, origin, execution_identity };
}

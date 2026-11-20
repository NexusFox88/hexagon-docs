import { resolveCombination } from './compatibility.js';
import { accessOrigin } from '../access/access.js';
import {compileInitialization} from './initialization.js';
import { failureDiagnostic } from '../diagnostics/failure.js';
import { ConnectionAccess } from '../access/access.js';
import { withSandboxEnvironment } from '../sandboxes/environment.js';
import { environmentInput } from './environment.js';
import { ZodError } from 'zod';
import { Artifacts } from '../artifacts/artifacts.js';
import { ToolBroker } from '../tools/broker.js';
import { toolOperations } from '../tools/adapters.js';
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { SecretStore } from '../credentials/secret-store.js';
import { transaction } from '../storage/database.js';
import { SandboxLifecycle } from '../sandboxes/lifecycle.js';
import { RuntimeClient, RuntimeUnavailableError } from '../sandboxes/runtime-client.js';
import { ExecutionError, Runs, type Lease } from './runs.js';
import { SessionInputs } from './inputs.js';
import { HarnessRegistry } from './harness.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Polls persisted Runs. HTTP/SSE clients never own task lifetime. */
export class ExecutionWorker {
  readonly id = randomUUID();
  private stopped = false;
  private task?: Promise<void>;
  private cleanupTask?: Promise<void>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private lastTick?: string;
  private active?: string;
  private runs: Runs;
  constructor(private pool: pg.Pool, private secrets: SecretStore, private lifecycle: SandboxLifecycle, private harnesses: HarnessRegistry, private ensureCredentials?:()=>Promise<void>) { this.runs = new Runs(pool); }
  health() { return { state: this.stopped ? 'stopped' : this.task ? 'running' : 'not_started', last_tick: this.lastTick, busy: !!this.active }; }
  start() {
    if (this.task) return;
    this.task = this.loop();
    const cleanup = () => {
      if (!this.cleanupTask) this.cleanupTask = this.lifecycle.reapExpired().then(()=>this.lifecycle.pauseIdle()).catch(() => {}).finally(() => { this.cleanupTask = undefined; });
    };
    cleanup();
    this.cleanupTimer = setInterval(cleanup, 5000);
    this.cleanupTimer.unref();
  }
  async stop() { this.stopped = true; clearInterval(this.cleanupTimer); await Promise.all([this.task, this.cleanupTask]); }
  private async loop() {
    while (!this.stopped) {
      this.lastTick = new Date().toISOString();
      try {
        const run = await this.runs.claim(this.id, 60);
        if (run) { this.active = run.id; await this.execute(run); }
      } catch { /* Leave the persisted lease for recovery; never log credentials. */ }
      finally { this.active = undefined; }
      await delay(500);
    }
  }
  private async execute(initial: any) {
    const lease: Lease = initial;
    let lostLease = false;
    let stage = 'session';
    const heartbeat = setInterval(() => { void this.runs.heartbeat(lease, 60).catch(() => { lostLease = true; }); }, 10000);
    const owned = async () => { if (lostLease || this.stopped) throw new Error('worker_stopped_or_lease_lost'); await this.runs.heartbeat(lease, 60); };
    try {
      let run = await this.runs.get(lease.tenant_id, lease.id);
      const session = (await this.pool.query('SELECT * FROM sessions WHERE tenant_id=$1 AND id=$2', [run.tenant_id, run.session_id])).rows[0];
      if(session.definition.connections?.some((c:any)=>c.kind==='model')&&session.definition.credential_boundary!=='external-v1')throw new ExecutionError('legacy_credentials_require_new_session',409);
      const harness = (await this.harnesses.resolveForTenant(session.tenant_id || run.tenant_id, session.definition.harness));
      if (run.state === 'cancelling') {
        // No persisted invocation means no Harness process was submitted. A
        // broken bootstrap must not block cancellation or subsequent cleanup.
        const invoked=await this.pool.query('SELECT 1 FROM run_invocations WHERE tenant_id=$1 AND run_id=$2',[run.tenant_id,run.id]);
        if(!invoked.rowCount){await this.runs.advance(lease,'cancelled');return;}
      }
      if (run.state === 'queued') await this.runs.advance(lease, 'provisioning');
      await owned();
      stage = 'credential_readiness';
      await this.ensureCredentials?.();
      await owned();
      stage = 'sandbox_wake';
      await this.lifecycle.ensureAwake(run.tenant_id,run.session_id);
      await owned();
      stage = 'sandbox_provision';
      const resource = await this.lifecycle.provision(run.tenant_id, run.session_id, true);
      const connector = await this.lifecycle.access(run.tenant_id, run.session_id);
      stage = 'runtime_binding';
      const binding = await transaction(this.pool, async db => {
        await db.query('SELECT id FROM sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [run.tenant_id, run.session_id]);
        let row = (await db.query('SELECT * FROM session_runtimes WHERE tenant_id=$1 AND session_id=$2', [run.tenant_id, run.session_id])).rows[0];
        if (!row) {
          const secret = await this.secrets.save(run.tenant_id, `runtime:${run.session_id}`, randomBytes(32).toString('hex'), db);
          row = (await db.query('INSERT INTO session_runtimes(tenant_id,session_id,secret_id) VALUES($1,$2,$3) RETURNING *', [run.tenant_id, run.session_id, secret])).rows[0];
        }
        // Provider-managed cold sleep can happen before our idle sweep marks the
        // Session paused. Prepare a new invocation's Runtime without reinstalling
        // its workspace; never restart a possibly running/recovering invocation.
        if(row.state==='ready'&&session.definition.capabilities?.includes('automatic_standby')&&
          !(await db.query('SELECT 1 FROM run_invocations WHERE tenant_id=$1 AND run_id=$2',[run.tenant_id,run.id])).rowCount){
          row=(await db.query("UPDATE session_runtimes SET state='restoring' WHERE tenant_id=$1 AND session_id=$2 RETURNING *",[run.tenant_id,run.session_id])).rows[0];
        }
        return row;
      });
      if (binding.state === 'interrupted') throw new Error('workspace_requires_recovery');
      const token = await this.secrets.read(run.tenant_id, binding.secret_id, `runtime:${run.session_id}`);
      const runtime = new RuntimeClient(connector, resource.id, token);
      if (!['ready', 'unreachable'].includes(binding.state)) {
        await owned();
        // Preparation has no process side effect and can resume after partial uploads.
        // Persist launch intent after preparation; reconcile ambiguous launches under the daemon lock.
        const restoring=binding.state.startsWith('restoring');
        const preparing = await this.pool.query("UPDATE session_runtimes SET state=CASE WHEN state LIKE 'restoring%' THEN 'restoring_preparing' ELSE 'preparing' END WHERE tenant_id=$1 AND session_id=$2 AND state IN ('reserved','preparing','restoring','restoring_preparing') RETURNING session_id", [run.tenant_id, run.session_id]);
        if (preparing.rowCount) {
          stage = 'runtime_prepare';
          await runtime.prepare();
          await owned();
          await this.pool.query("UPDATE session_runtimes SET state=CASE WHEN state='restoring_preparing' THEN 'restoring_starting' ELSE 'starting' END WHERE tenant_id=$1 AND session_id=$2 AND state IN ('preparing','restoring_preparing')", [run.tenant_id, run.session_id]);
          stage = 'runtime_launch';
          await runtime.start();
        } else {
          stage = 'runtime_reconcile';
          if((await this.pool.query('SELECT 1 FROM run_invocations WHERE tenant_id=$1 AND run_id=$2',[run.tenant_id,run.id])).rowCount)await runtime.request('GET','/health');
          else await runtime.reconcileStart();
        }
        await owned();
        if(!restoring){
        const env = session.env_secret_id ? environmentInput.parse(JSON.parse(await this.secrets.read(run.tenant_id, session.env_secret_id, `session-env:${session.id}`))) : {};
        stage = 'harness_install';
      await harness.install(await withSandboxEnvironment(connector, resource.id, env), resource.id);
        const files = await new SessionInputs(this.pool).readForProvisioning(run.tenant_id, run.session_id);
        stage = 'runtime_inputs';
      const uploaded = await runtime.request('POST', '/inputs', { files: files.map(file => ({ path: file.path, content_base64: file.content.toString('base64') })) });
        if (files.some(file => !uploaded.files.some((value: any) => value.path === file.path && value.sha256 === file.sha256))) throw new Error('input_verification_failed');
        await owned();
        await this.runs.markRuntimeReady(lease, run.session_id, files.map(file => ({ path: file.path, sha256: file.sha256, size: file.content.length })));
        }else await this.runs.markRuntimeReady(lease,run.session_id,[]);
      }
      await owned();
      run = await this.runs.get(lease.tenant_id, lease.id);
      if (run.state === 'provisioning') await this.runs.advance(lease, 'running');
      if (run.state === 'cancelling') {
        const invoked = await this.pool.query('SELECT 1 FROM run_invocations WHERE tenant_id=$1 AND run_id=$2', [run.tenant_id, run.id]);
        if (!invoked.rowCount) { await this.runs.advance(lease, 'cancelled'); return; }
      }
      stage = 'invocation';
      const invocation = await this.invocation(run, session, binding.native_session, Boolean(connector.configureCredentialAccess));
      await owned();
      const {native_credential_access,credential_boundary,...runtimeInvocation}=invocation;
      if(native_credential_access){
        if(!connector.configureCredentialAccess)throw new ExecutionError('native_credential_access_unavailable',409);
        // Reapplying the identical persisted policy is idempotent on recovery.
        // Never fall back to sending these grants into the guest after a failure.
        await connector.configureCredentialAccess(resource.id,session.definition.network,native_credential_access);
        await owned();
      }
      stage = 'runtime_run';
      await runtime.request('POST', '/runs', runtimeInvocation);
      await this.runs.recordRuntimeReachable(lease);
      while (!this.stopped && !lostLease) {
        await owned();
        run = await this.runs.get(lease.tenant_id, lease.id);
        if (run.state === 'cancelling') await runtime.request('POST', `/runs/${run.id}/cancel`);
        const state = await runtime.request('GET', `/runs/${run.id}`);
        if (state.state === 'running' && ['running', 'waiting_authorization', 'waiting_approval'].includes(run.state)) {
          const pending = await runtime.request('GET', `/runs/${run.id}/tools`);
          for (const call of pending.calls) {
            const outcome = await new ToolBroker(this.pool, this.secrets).process(lease, call);
            if (outcome.state === 'completed') await runtime.request('POST', `/runs/${run.id}/tool-results`, { id: call.id, result: outcome.result });
          }
        }
        await this.drain(lease, runtime, String(run.runtime_cursor));
        if (['exited', 'cancelled', 'failed', 'interrupted'].includes(state.state)) {
          run = await this.runs.get(lease.tenant_id, lease.id);
          await this.drain(lease, runtime, String(run.runtime_cursor));
          if (state.state !== 'interrupted') {
            try {
              const exported = await runtime.request('GET', `/runs/${run.id}/artifacts`);
              await new Artifacts(this.pool).capture(lease, exported);
            } catch (error) {
              if (error instanceof ZodError || (error instanceof ExecutionError && ['invalid_artifact_manifest', 'artifact_integrity_failed', 'artifact_conflict'].includes(error.code)) || (error instanceof Error && error.message === 'runtime_request_failed_409')) {
                await this.runs.advance(lease, 'failed', { code: 'artifact_export_rejected' });
                return;
              }
              throw error;
            }
          }
          await this.finish(lease, session, state);
          return;
        }
        await delay(700);
      }
    } catch (error) {
      const definite = ['sandbox_image_build_failed','sandbox_image_deleted','sandbox_image_contract_incomplete','harness_runtime_prerequisites_unavailable','sandbox_openssh_unavailable','workspace_requires_recovery', 'harness_requires_2048mb', 'input_verification_failed', 'harness_version_mismatch', 'harness_package_integrity_failed', 'harness_interpreter_unavailable'];
      if (!lostLease && !this.stopped) {
        // A provider-confirmed missing Sandbox cannot resume this workspace.
        // Transport failures remain uncertain and must not be treated as loss.
        if(error instanceof ExecutionError&&error.code==='sandbox_image_build_pending')await this.runs.waitForImage(lease).catch(()=>{});
        else if (error instanceof ExecutionError && ['combination_contract_changed','combination_contract_unsupported','credential_ingress_unreachable','credential_ingress_recovery_blocked','credential_proxy_tunnel_unavailable','sandbox_quota_exceeded', 'sandbox_lost', 'connection_not_ready','legacy_credentials_require_new_session','session_connection_changed','session_access_expired','credential_proxy_not_configured','credential_proxy_url_invalid','native_credential_access_unavailable','initialization_too_large','context_file_changed','context_file_encoding'].includes(error.code)) await this.runs.advance(lease, 'failed', { code: error.code }).catch(() => {});
        else if (error instanceof Error && definite.includes(error.message)) await this.runs.advance(lease, 'failed', { code: error.message }).catch(() => {});
        else await this.runs.recordRecoveryNeeded(lease, error instanceof RuntimeUnavailableError, { stage, failure: failureDiagnostic(error) }).catch(() => {});
      }
    } finally { clearInterval(heartbeat); }
  }

  private async invocation(run: any, session: any, nativeSession?: string, nativeAuth=false) {
    return transaction(this.pool, async db => {
      const current=(await db.query('SELECT state FROM runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [run.tenant_id, run.id])).rows[0];
      if(!current||['completed','failed','cancelled'].includes(current.state))throw new ExecutionError('lease_lost',409);
      const prior = (await db.query('SELECT secret_id FROM run_invocations WHERE tenant_id=$1 AND run_id=$2', [run.tenant_id, run.id])).rows[0];
      if (prior) {const request=JSON.parse(await this.secrets.read(run.tenant_id, prior.secret_id, `invocation:${run.id}`, db));if(request.credential_boundary!=='external-v1')throw new ExecutionError('legacy_credentials_require_new_session',409);return request;}
      if(current.state==='cancelling')throw new ExecutionError('lease_lost',409);
      // Recheck after queueing; an already persisted invocation must remain recoverable.
      const required = await db.query('SELECT enabled,status,deleted_at FROM connections WHERE tenant_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE', [run.tenant_id, [session.sandbox_connection_id, session.model_connection_id]]);
      if (required.rowCount !== 2 || required.rows.some(row => !row.enabled || row.status !== 'ready' || row.deleted_at)) throw new ExecutionError('connection_not_ready', 409);
      const model = (await db.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=$2', [run.tenant_id, session.model_connection_id])).rows[0];
      if (!model?.enabled || model.status !== 'ready') throw new Error('model_connection_not_ready');
      const pinned = session.definition.connections.find((c: any) => c.id === model.id);
      // Existing invocations are recovered above without reinterpreting accepted work.
      // New invocations use the same resolver and the Session-pinned capability contract.
      const contract=session.definition.combination;
      if(contract){
        if(contract.schema_version!==1)throw new ExecutionError('combination_contract_unsupported',409);
        const adapter=await this.harnesses.resolveForTenant(run.tenant_id,session.definition.harness);
        const compatibility=resolveCombination({harness:adapter.definition,
          sandboxCapabilities:contract.requirements.sandbox_capabilities,
          toolCapabilities:contract.requirements.tool_capabilities,
          modelProvider:pinned.provider,requiredCapabilities:session.definition.required_capabilities,
          initialization:Boolean(compileInitialization(session.definition)),network:session.definition.network,
          credentialHost:new URL(accessOrigin()).hostname});
        if(compatibility.compatibility.status==='unsupported')throw new ExecutionError('combination_contract_changed',409);
      }
      const access=new ConnectionAccess(this.pool,this.secrets);
      const modelAccess=await access.issue(run.tenant_id,session.id,model.id,db,run.id);
      const nativeBindings=[{base_url:modelAccess.base_url,token:modelAccess.token}];
      const credential=nativeAuth?randomBytes(32).toString('hex'):modelAccess.token;
      const connectionAccess:Record<string,unknown>={};
      for(const binding of (await db.query('SELECT name,connection_id FROM session_connections t WHERE tenant_id=$1 AND session_id=$2 AND NOT EXISTS(SELECT 1 FROM session_connection_revocations rev WHERE rev.tenant_id=t.tenant_id AND rev.session_id=t.session_id AND rev.connection_id=t.connection_id)',[run.tenant_id,session.id])).rows){const grant=await access.issue(run.tenant_id,session.id,binding.connection_id,db,run.id);nativeBindings.push({base_url:grant.base_url,token:grant.token});connectionAccess[binding.name]={base_url:grant.base_url,headers:{Authorization:`Bearer ${nativeAuth?randomBytes(32).toString('hex'):grant.token}`}};}
      const bindings = (await db.query('SELECT t.name,c.provider,c.config FROM session_tools t JOIN connections c ON c.tenant_id=t.tenant_id AND c.id=t.connection_id WHERE t.tenant_id=$1 AND t.session_id=$2 AND NOT EXISTS(SELECT 1 FROM session_connection_revocations rev WHERE rev.tenant_id=t.tenant_id AND rev.session_id=t.session_id AND rev.connection_id=t.connection_id) ORDER BY t.name', [run.tenant_id, session.id])).rows;
      const definitions = bindings.flatMap(binding => {
        const pinnedTool=session.definition.connections.find((c:any)=>c.id===session.definition.tool_bindings[binding.name]);
        return Object.entries(toolOperations(binding.provider,pinnedTool?.config??binding.config)).map(([operation, config]) => ({ name: `${binding.name}__${operation}`, binding: binding.name, operation, description: config.description, inputSchema: config.input_schema }));
      });
      const documents=[];
      for(const file of session.definition.context?.files??[]){const row=(await db.query('SELECT content,sha256 FROM session_inputs WHERE tenant_id=$1 AND session_id=$2 AND path=$3',[run.tenant_id,session.id,file.path])).rows[0];if(!row||row.sha256!==file.sha256)throw new ExecutionError('context_file_changed',409);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(row.content);}catch{throw new ExecutionError('context_file_encoding',400);}documents.push({name:file.path,text});}
      const effectiveInitialization=compileInitialization(session.definition,documents.length?documents:undefined);
      const request = (await this.harnesses.resolveForTenant(session.tenant_id || run.tenant_id, session.definition.harness)).invocation(run.id, run.input, { ...pinned.config, provider:pinned.provider, base_url:modelAccess.base_url, credential }, nativeSession, definitions.length ? { token: randomBytes(32).toString('hex'), definitions } : undefined, effectiveInitialization);
      const env = session.env_secret_id ? environmentInput.parse(JSON.parse(await this.secrets.read(run.tenant_id, session.env_secret_id, `session-env:${session.id}`, db))) : {};
      request.env = { ...env, ...request.env, HEXAGON_CONNECTIONS:JSON.stringify(connectionAccess) };
      Object.assign(request,{credential_boundary:'external-v1',...(nativeAuth?{native_credential_access:nativeBindings}:{})});
      const secret = await this.secrets.save(run.tenant_id, `invocation:${run.id}`, JSON.stringify(request), db);
      const initialization=compileInitialization(session.definition);
      if(initialization)await db.query("INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,'agent.initialized',$3)",[run.tenant_id,run.id,{schema_version:1,digest:initialization.digest,harness:session.definition.harness,context_delivery:initialization.context?(nativeSession?'native_history':'initial_input'):'none',files:session.definition.context?.files??[],session_id:session.id,agent_id:session.agent_id,agent_revision:session.agent_revision}]);
      await db.query('INSERT INTO run_invocations(tenant_id,run_id,secret_id) VALUES($1,$2,$3)', [run.tenant_id, run.id, secret]);
      return request;
    });
  }

  private async drain(lease: Lease, runtime: RuntimeClient, after: string) {
    let cursor = after;
    while (true) {
      const batch = await runtime.request('GET', `/runs/${lease.id}/events?after=${cursor}`);
      if (!batch.events.length) return;
      cursor = await this.runs.ingest(lease, batch.events);
    }
  }

  private async finish(lease: Lease, session: any, state: any) {
    const run = await this.runs.get(lease.tenant_id, lease.id);
    if (state.state === 'interrupted') {
      await this.runs.advance(lease, 'failed', { code: 'runtime_interrupted', runtime_state: 'interrupted' });
      return;
    }
    if (run.state === 'cancelling') { await this.runs.advance(lease, 'cancelled'); return; }
    const rows = (await this.pool.query("SELECT data FROM events WHERE tenant_id=$1 AND run_id=$2 AND type='harness.stdout' ORDER BY sequence", [lease.tenant_id, lease.id])).rows;
    const result = (await this.harnesses.resolveForTenant(session.tenant_id || run.tenant_id, session.definition.harness)).result(rows.map(row => row.data.text ?? '').join(''));
    const { text, native_session: native } = result;
    if (['waiting_authorization', 'waiting_approval'].includes(run.state) || state.state !== 'exited' || state.exit_code !== 0 || !text || result.failed) {
      const lastModel=(await this.pool.query("SELECT data FROM events WHERE tenant_id=$1 AND run_id=$2 AND type='model.response' ORDER BY sequence DESC LIMIT 1",[lease.tenant_id,lease.id])).rows[0]?.data;
      const modelCode=lastModel?.transport==='failed'?'model_transport_failed':lastModel?.status===401||lastModel?.status===403?'model_authentication_failed':lastModel?.status===429?'model_rate_limited':lastModel?.status>=400?'model_request_failed':undefined;
      await this.runs.advance(lease, 'failed', { code: modelCode??'harness_execution_failed', ...(modelCode?{model_status:lastModel.status}:{}), runtime_state: state.state, exit_code: state.exit_code });
      return;
    }
    // Native session is persisted before completing the Run, so the next Run
    // can safely continue it even after a worker restart.
    if (native) await this.pool.query('UPDATE session_runtimes SET native_session=$3 WHERE tenant_id=$1 AND session_id=$2', [lease.tenant_id, session.id, native]);
    const artifacts = await new Artifacts(this.pool).list(lease.tenant_id, lease.id);
    await this.runs.advance(lease, 'completed', { role: 'assistant', text, artifacts });
  }
}

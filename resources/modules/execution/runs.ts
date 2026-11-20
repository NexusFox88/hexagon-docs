import {z} from 'zod';
import {compileInitialization} from './initialization.js';
import {harnessActivity} from '../harnesses/activity.js';
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../storage/database.js';

export const runOriginInput=z.object({message_id:z.string().min(1).max(256).optional(),request_id:z.string().min(1).max(256).optional(),channel:z.string().min(1).max(100).optional()}).strict();
export type RunOrigin=z.infer<typeof runOriginInput>;

export {ExecutionError} from './errors.js';
import {ExecutionError} from './errors.js';
export type Lease = { tenant_id: string; id: string; generation: number; lease_owner: string };
const terminal = new Set(['completed', 'failed', 'cancelled']);

async function event(db: pg.PoolClient, tenant: string, run: string, type: string, data: unknown) {
  await db.query('INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,$3,$4)', [tenant, run, type, JSON.stringify(data)]);
}

/** Transactions serialize Session writes; leases fence stale worker updates. */
export class Runs {
  constructor(private pool: pg.Pool) {}

  async submit(tenant: string, session: string, key: string, input: string, origin:RunOrigin={}, principal?:{key_id?:string;role?:string}) {
    origin=runOriginInput.parse(origin);
    if (!key || !input.trim()) throw new ExecutionError('invalid_submission', 400);
    const hash = createHash('sha256').update(JSON.stringify({ input, ...(Object.keys(origin).length?{origin}:{}) })).digest('hex');
    return transaction(this.pool, async db => {
      const owner = await db.query('SELECT state,sandbox_connection_id,model_connection_id,agent_id,agent_revision,definition FROM sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, session]);
      if (!owner.rowCount) throw new ExecutionError('session_not_found', 404);
      const prior = await db.query('SELECT * FROM runs WHERE tenant_id=$1 AND session_id=$2 AND idempotency_key=$3', [tenant, session, key]);
      if (prior.rowCount) {
        if (prior.rows[0].request_hash !== hash) throw new ExecutionError('idempotency_conflict', 409);
        return prior.rows[0];
      }
      if (!['open','paused','pausing','resuming'].includes(owner.rows[0].state)) throw new ExecutionError('session_closed',409);
      if ((await db.query("SELECT 1 FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='create' AND detail->>'expiry'='control_plane' AND (detail->>'expires_at')::timestamptz<=now() AND $3='open'", [tenant, session,owner.rows[0].state])).rowCount) throw new ExecutionError('sandbox_expired', 409);
      const files=owner.rows[0].definition?.context?.files??[];
      const documents:Array<{name:string;text:string}>=[];
      for(const file of files){
        const row=(await db.query('SELECT sha256,size,content FROM session_inputs WHERE tenant_id=$1 AND session_id=$2 AND path=$3',[tenant,session,file.path])).rows[0];
        if(!row)throw new ExecutionError('context_file_missing',409);
        if(row.sha256!==file.sha256)throw new ExecutionError('context_file_changed',409);
        if(row.size>32768)throw new ExecutionError('context_file_too_large',413);
        let text:string;
        try{text=new TextDecoder('utf-8',{fatal:true}).decode(row.content);}catch{throw new ExecutionError('context_file_encoding',400);}
        if(text.includes('\0'))throw new ExecutionError('context_file_encoding',400);
        documents.push({name:file.path,text});
      }
      const initialization=compileInitialization(owner.rows[0].definition??{},documents.length?documents:undefined);
      // CLI adapters must remain below the per-argument OS limit, including UTF-8 input.
      if(Buffer.byteLength(input)+Buffer.byteLength(initialization?.context??'')>120000)throw new ExecutionError('input_too_large',413);
      const active = await db.query("SELECT id FROM runs WHERE tenant_id=$1 AND session_id=$2 AND state NOT IN ('completed','failed','cancelled')", [tenant, session]);
      if (active.rowCount) throw new ExecutionError('session_busy', 409);
      const bindings = owner.rows[0];
      const connections = await db.query('SELECT enabled,status,deleted_at FROM connections WHERE tenant_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE', [tenant, [bindings.sandbox_connection_id, bindings.model_connection_id]]);
      if (connections.rowCount !== 2 || connections.rows.some(row => !row.enabled || row.status !== 'ready' || row.deleted_at)) throw new ExecutionError('connection_not_ready', 409);
      const executionIdentity={tenant_id:tenant,session_id:session,agent_id:bindings.agent_id,agent_revision:bindings.agent_revision,...(principal?{principal}: {})};
      const result = await db.query('INSERT INTO runs(tenant_id,id,session_id,idempotency_key,request_hash,input,origin,execution_identity) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [tenant, randomUUID(), session, key, hash, input,origin,executionIdentity]);
      const run = result.rows[0];
      await event(db, tenant, run.id, 'run.queued', { session_id: session });
      return run;
    });
  }

  async get(tenant: string, id: string) {
    const result = await this.pool.query('SELECT * FROM runs WHERE tenant_id=$1 AND id=$2', [tenant, id]);
    if (!result.rowCount) throw new ExecutionError('run_not_found', 404);
    return result.rows[0];
  }

  async events(tenant: string, id: string, after = '0') {
    if (!/^\d+$/.test(after)) throw new ExecutionError('invalid_cursor', 400);
    await this.get(tenant, id);
    const result = await this.pool.query('SELECT sequence::text AS id,type,data,created_at FROM events WHERE tenant_id=$1 AND run_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 500', [tenant, id, after]);
    return result.rows;
  }

  async claim(worker: string, seconds = 30) {
    return transaction(this.pool, async db => {
      const next = await db.query("SELECT r.* FROM runs r WHERE r.state IN ('queued','provisioning','running','cancelling','waiting_authorization','waiting_approval') AND (r.lease_until IS NULL OR r.lease_until<now()) AND EXISTS(SELECT 1 FROM sessions s WHERE s.tenant_id=r.tenant_id AND s.id=r.session_id AND s.state IN ('open','paused','pausing','resuming')) ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1");
      if (!next.rowCount) return null;
      const run = next.rows[0];
      // A closure may commit while the selection waits for a Run lock. Recheck
      // in a fresh statement before granting another worker lease.
      const session = (await db.query('SELECT state FROM sessions WHERE tenant_id=$1 AND id=$2', [run.tenant_id, run.session_id])).rows[0];
      if (!['open','paused','pausing','resuming'].includes(session?.state)) return null;
      const result = await db.query("UPDATE runs SET lease_owner=$3,lease_until=now()+$4*interval '1 second',generation=generation+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *", [run.tenant_id, run.id, worker, seconds]);
      await event(db, run.tenant_id, run.id, 'run.claimed', { generation: result.rows[0].generation, recovery: run.state !== 'queued' });
      return result.rows[0];
    });
  }

  private async lockLease(db: pg.PoolClient, lease: Lease) {
    const result = await db.query('SELECT *,lease_until>now() AS live FROM runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [lease.tenant_id, lease.id]);
    const run = result.rows[0];
    if (!run || !run.live || run.generation !== lease.generation || run.lease_owner !== lease.lease_owner || terminal.has(run.state)) throw new ExecutionError('lease_lost', 409);
    return run;
  }

  async heartbeat(lease: Lease, seconds = 30) {
    return transaction(this.pool, async db => {
      await this.lockLease(db, lease);
      await db.query("UPDATE runs SET lease_until=now()+$3*interval '1 second' WHERE tenant_id=$1 AND id=$2", [lease.tenant_id, lease.id, seconds]);
    });
  }

  async ingest(lease: Lease, items: { cursor: number; type: string; data: unknown }[]) {
    return transaction(this.pool, async db => {
      const run = await this.lockLease(db, lease);
      let cursor = BigInt(run.runtime_cursor);
      for (const item of items) {
        if (!Number.isSafeInteger(item.cursor) || item.cursor < 0) throw new ExecutionError('invalid_runtime_cursor', 400);
        if (BigInt(item.cursor) <= cursor) continue;
        await db.query('INSERT INTO events(tenant_id,run_id,type,data,source_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,run_id,source_key) DO NOTHING', [lease.tenant_id, lease.id, item.type, JSON.stringify(item.data), `runtime:${item.cursor}`]);
        const activity=item.type==='harness.stdout'?harnessActivity(item.data):undefined;
        if(activity)await db.query('INSERT INTO events(tenant_id,run_id,type,data,source_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,run_id,source_key) DO NOTHING',[lease.tenant_id,lease.id,activity.type,JSON.stringify(activity.data),`runtime:${item.cursor}:activity`]);
        cursor = BigInt(item.cursor);
      }
      await db.query('UPDATE runs SET runtime_cursor=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2', [lease.tenant_id, lease.id, cursor.toString()]);
      return cursor.toString();
    });
  }

  async waitForImage(lease: Lease) {
    return transaction(this.pool, async db => {
      const run=await this.lockLease(db,lease);
      if(run.state!=='provisioning')return;
      await db.query("UPDATE runs SET error=NULL,lease_owner=NULL,lease_until=now()+interval '5 seconds',updated_at=now() WHERE tenant_id=$1 AND id=$2",[lease.tenant_id,lease.id]);
      await db.query("INSERT INTO events(tenant_id,run_id,type,data,source_key) VALUES($1,$2,'sandbox.image_building','{}','image:building') ON CONFLICT(tenant_id,run_id,source_key) DO NOTHING",[lease.tenant_id,lease.id]);
    });
  }

  async recordRecoveryNeeded(lease: Lease, runtimeUnreachable = false, diagnostic: Record<string, unknown> = {}) {
    return transaction(this.pool, async db => {
      const run = await this.lockLease(db, lease);
      if (runtimeUnreachable) await db.query("UPDATE session_runtimes SET state='unreachable' WHERE tenant_id=$1 AND session_id=$2 AND state IN ('ready','unreachable')", [lease.tenant_id, run.session_id]);
      await db.query("UPDATE runs SET error=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2", [lease.tenant_id, lease.id, { code: 'execution_reconciliation_required', ...diagnostic }]);
      await event(db, lease.tenant_id, lease.id, 'run.recovery_needed', { generation: lease.generation, ...diagnostic });
    });
  }

  async recordRuntimeReachable(lease: Lease) {
    return transaction(this.pool, async db => {
      const run = await this.lockLease(db, lease);
      const changed = await db.query("UPDATE session_runtimes SET state='ready' WHERE tenant_id=$1 AND session_id=$2 AND state='unreachable' RETURNING session_id", [lease.tenant_id, run.session_id]);
      if (changed.rowCount) {
        await db.query("UPDATE runs SET error=NULL WHERE tenant_id=$1 AND id=$2 AND error->>'code'='execution_reconciliation_required'", [lease.tenant_id, lease.id]);
        await event(db, lease.tenant_id, lease.id, 'runtime.reconnected', {});
      }
    });
  }

  async markRuntimeReady(lease: Lease, session: string, files: { path: string; sha256: string; size: number }[]) {
    return transaction(this.pool, async db => {
      const run = await this.lockLease(db, lease);
      if (run.session_id !== session) throw new ExecutionError('runtime_session_mismatch', 409);
      const updated = await db.query("UPDATE session_runtimes SET state='ready' WHERE tenant_id=$1 AND session_id=$2 RETURNING session_id", [lease.tenant_id, session]);
      if (!updated.rowCount) throw new ExecutionError('runtime_binding_missing', 409);
      await db.query("INSERT INTO events(tenant_id,run_id,type,data,source_key) VALUES($1,$2,'workspace.inputs_verified',$3,'workspace:inputs_verified') ON CONFLICT(tenant_id,run_id,source_key) DO NOTHING", [lease.tenant_id, lease.id, { session_id: session, files }]);
    });
  }

  async advance(lease: Lease, state: 'provisioning' | 'running' | 'completed' | 'failed' | 'cancelled', data: unknown = {}) {
    const allowed: Record<string, string[]> = {
      queued: ['provisioning', 'failed'], provisioning: ['running', 'failed'],
      waiting_authorization: ['failed'], waiting_approval: ['failed'],
      running: ['completed', 'failed'], cancelling: ['cancelled', 'failed'],
    };
    return transaction(this.pool, async db => {
      const run = await this.lockLease(db, lease);
      if (!allowed[run.state]?.includes(state)) throw new ExecutionError('invalid_transition', 409);
      if (state === 'failed' && (data as { runtime_state?: string })?.runtime_state === 'interrupted') {
        await db.query("UPDATE session_runtimes SET state='interrupted' WHERE tenant_id=$1 AND session_id=$2", [lease.tenant_id, run.session_id]);
      }
      await db.query('UPDATE runs SET state=$3,output=$4,error=$5,lease_until=CASE WHEN $6 THEN NULL ELSE lease_until END,updated_at=now() WHERE tenant_id=$1 AND id=$2', [lease.tenant_id, lease.id, state, state === 'completed' ? JSON.stringify(data) : null, state === 'failed' ? JSON.stringify(data) : null, terminal.has(state)]);
      await event(db, lease.tenant_id, lease.id, `run.${state}`, data);
    });
  }

  async requestApproval(lease: Lease, action: unknown) {
    return transaction(this.pool, async db => {
      const run = await this.lockLease(db, lease);
      if (run.state !== 'running') throw new ExecutionError('invalid_transition', 409);
      const id = randomUUID();
      await db.query('INSERT INTO approvals(tenant_id,id,run_id,action) VALUES($1,$2,$3,$4)', [lease.tenant_id, id, lease.id, JSON.stringify(action)]);
      await db.query("UPDATE runs SET state='waiting_approval',lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2", [lease.tenant_id, lease.id]);
      await event(db, lease.tenant_id, lease.id, 'approval.required', { id, action });
      return id;
    });
  }

  async decide(tenant: string, approval: string, approved: boolean) {
    return transaction(this.pool, async db => {
      const found = await db.query('SELECT run_id FROM approvals WHERE tenant_id=$1 AND id=$2', [tenant, approval]);
      if (!found.rowCount) throw new ExecutionError('approval_not_found', 404);
      // Always lock Run before Approval, matching cancellation's order.
      const run = (await db.query('SELECT * FROM runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, found.rows[0].run_id])).rows[0];
      const row = (await db.query('SELECT * FROM approvals WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, approval])).rows[0];
      const decision = approved ? 'approved' : 'denied';
      if (row.state === decision) return row;
      if (row.state !== 'pending' || run.state !== 'waiting_approval') throw new ExecutionError('stale_approval', 409);
      const result = await db.query('UPDATE approvals SET state=$3,decision=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *', [tenant, approval, decision, JSON.stringify({ approved })]);
      await db.query("UPDATE runs SET state='running',updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, run.id]);
      await event(db, tenant, run.id, 'approval.decided', { id: approval, approved });
      return result.rows[0];
    });
  }

  async cancel(tenant: string, id: string) {
    return transaction(this.pool, async db => {
      const result = await db.query('SELECT * FROM runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, id]);
      if (!result.rowCount) throw new ExecutionError('run_not_found', 404);
      const run = result.rows[0];
      if (terminal.has(run.state) || run.state === 'cancelling') return run;
      const state = run.state === 'queued' ? 'cancelled' : 'cancelling';
      const updated = await db.query('UPDATE runs SET state=$3,cancel_requested=true,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *', [tenant, id, state]);
      await db.query("UPDATE approvals SET state='expired' WHERE tenant_id=$1 AND run_id=$2 AND state='pending'", [tenant, id]);
      await event(db, tenant, id, `run.${state}`, {});
      return updated.rows[0];
    });
  }
}

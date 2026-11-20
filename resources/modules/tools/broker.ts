import {validMcpArguments} from '../../integrations/mcp/remote.js';
import { ApplicationOAuth } from '../apps/oauth.js';
import { toolOperations, executeTool } from './adapters.js';
import { AppRequestError } from '../../integrations/apps/registry.js';
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { SecretStore } from '../credentials/secret-store.js';
import { ExecutionError, type Lease } from '../execution/runs.js';
import { ToolAuthenticationError, validToolArguments } from '../../integrations/tools/http-json.js';

export const toolCall = z.object({ id: z.string().uuid(), binding: z.string(), operation: z.string(), arguments: z.record(z.unknown()) }).strict();
export type ToolCall = z.infer<typeof toolCall>;

export class ToolBroker {
  constructor(private pool: pg.Pool, private secrets: SecretStore) {}
  async process(lease: Lease, input: ToolCall): Promise<{ state: string; result?: unknown }> {
    const call = toolCall.parse(input);
    const hash = createHash('sha256').update(JSON.stringify([call.binding, call.operation, call.arguments])).digest('hex');
    const db = await this.pool.connect();
    const lock = JSON.stringify([lease.tenant_id, lease.id, call.id]);
    let locked = false;
    try {
      locked = (await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,1)) AS locked', [lock])).rows[0].locked;
      if (!locked) return { state: 'pending' };
      await db.query('BEGIN');
      const run = (await db.query('SELECT *,lease_until>now() AS live FROM runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [lease.tenant_id, lease.id])).rows[0];
      if (!run?.live || run.generation !== lease.generation || run.lease_owner !== lease.lease_owner) throw new ExecutionError('lease_lost', 409);
      if (!['running', 'waiting_authorization', 'waiting_approval'].includes(run.state)) throw new ExecutionError('tool_run_not_active', 409);
      await db.query('INSERT INTO tool_calls(tenant_id,run_id,id,binding,operation,arguments,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [lease.tenant_id, lease.id, call.id, call.binding, call.operation, call.arguments, hash]);
      const row = (await db.query('SELECT * FROM tool_calls WHERE tenant_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE', [lease.tenant_id, lease.id, call.id])).rows[0];
      if (row.request_hash !== hash) throw new ExecutionError('tool_call_conflict', 409);
      if (row.state === 'completed') { await db.query('COMMIT'); return { state: 'completed', result: row.result }; }
      const uncertain = ['executing', 'unknown'].includes(row.state);
      if (uncertain && (!row.execution_policy || (row.execution_policy.method !== 'GET' && row.execution_policy.replay !== 'idempotency_key'))) {
        await this.wait(db, lease, call.id, 'waiting_approval', 'tool.outcome_unknown', { call_id: call.id }, false, 'unknown');
        await db.query('COMMIT'); return { state: 'unknown' };
      }
      const connection = (await db.query('SELECT c.* FROM session_tools t JOIN connections c ON c.tenant_id=t.tenant_id AND c.id=t.connection_id WHERE t.tenant_id=$1 AND t.session_id=$2 AND t.name=$3', [lease.tenant_id, run.session_id, call.binding])).rows[0];
      if (!connection || connection.deleted_at) throw new ExecutionError('tool_binding_unavailable', 409);
      if (uncertain && row.execution_policy.connection_version !== connection.version) {
        await this.wait(db, lease, call.id, 'waiting_approval', 'tool.outcome_unknown', { call_id: call.id }, false, 'unknown');
        await db.query('COMMIT'); return { state: 'unknown' };
      }
      if((await db.query('SELECT 1 FROM session_connection_revocations WHERE tenant_id=$1 AND session_id=$2 AND connection_id=$3',[lease.tenant_id,run.session_id,connection.id])).rowCount){
        const result={isError:true,content:[{type:'text',text:'Session access to this tool has been revoked.'}]};
        await this.complete(db,lease,call.id,result);await db.query('COMMIT');return {state:'completed',result};
      }
      const config = connection.config;
      const op = toolOperations(connection.provider,config)[call.operation];
      const session=(await db.query('SELECT definition FROM sessions WHERE tenant_id=$1 AND id=$2',[lease.tenant_id,run.session_id])).rows[0];
      const pinned=session?.definition.connections?.find((c:any)=>c.id===connection.id);
      if(connection.status==='ready'&&pinned?.account&&pinned.account!==connection.validation?.account)throw new ExecutionError('tool_account_changed',409);
      if(pinned && !Object.hasOwn(toolOperations(connection.provider,pinned.config),call.operation))throw new ExecutionError('tool_operation_unavailable',400);
      if(connection.provider==='mcp-remote'&&pinned&&JSON.stringify(pinned.config.tools?.[call.operation])!==JSON.stringify(config.tools?.[call.operation]))throw new ExecutionError('mcp_schema_changed',409);
      if (!op) throw new ExecutionError('tool_operation_unavailable', 400);
      if (!(connection.provider==='mcp-remote'?validMcpArguments:validToolArguments)(op.input_schema, call.arguments)) {
        const result = { isError: true, content: [{ type: 'text', text: 'Tool arguments do not match the declared input schema.' }] };
        await this.complete(db, lease, call.id, result); await db.query('COMMIT'); return { state: 'completed', result };
      }
      if (!connection.enabled || connection.status !== 'ready' || (!connection.secret_id && !(connection.provider==='mcp-remote'&&config.authentication==='none'))) {
        await this.wait(db, lease, call.id, 'waiting_authorization', 'authorization.required', { connection_id: connection.id });
        await db.query('COMMIT'); return { state: 'waiting_authorization' };
      }
      if (op.approval) {
        let approval = row.approval_id ? (await db.query('SELECT * FROM approvals WHERE tenant_id=$1 AND id=$2', [lease.tenant_id, row.approval_id])).rows[0] : undefined;
        if (approval && row.connection_version !== connection.version) {
          await db.query("UPDATE approvals SET state='expired' WHERE tenant_id=$1 AND id=$2", [lease.tenant_id, approval.id]);
          approval = undefined;
        }
        if (!approval) {
          const id = randomUUID();
          const action = { call_id: call.id, binding: call.binding, operation: call.operation, arguments: call.arguments, connection_id: connection.id, connection_version: connection.version };
          await db.query('INSERT INTO approvals(tenant_id,id,run_id,action) VALUES($1,$2,$3,$4)', [lease.tenant_id, id, lease.id, action]);
          await db.query('UPDATE tool_calls SET approval_id=$4,connection_version=$5 WHERE tenant_id=$1 AND run_id=$2 AND id=$3', [lease.tenant_id, lease.id, call.id, id, connection.version]);
          await this.wait(db, lease, call.id, 'waiting_approval', 'approval.required', { id, action }, true);
          await db.query('COMMIT'); return { state: 'waiting_approval' };
        }
        if (approval.state === 'pending') { await db.query('COMMIT'); return { state: 'waiting_approval' }; }
        if (approval.state !== 'approved') {
          const result = { isError: true, content: [{ type: 'text', text: 'Tool operation was not approved.' }] };
          await this.complete(db, lease, call.id, result); await db.query('COMMIT'); return { state: 'completed', result };
        }
      }
      let credential = ''; 
      await db.query("UPDATE tool_calls SET state='executing',execution_policy=$4,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND id=$3", [lease.tenant_id, lease.id, call.id, { connection_id: connection.id, connection_version: connection.version, provider:connection.provider, base_url: config.base_url??connection.provider, path: op.path, method: op.method, replay: op.replay }]);
      await db.query("UPDATE runs SET state='running',updated_at=now() WHERE tenant_id=$1 AND id=$2", [lease.tenant_id, lease.id]);
      await db.query('COMMIT');
      let result: unknown;
      try {
        credential = await new ApplicationOAuth(this.pool,this.secrets).credential(lease.tenant_id,connection.id,connection.version);
        const value = await executeTool(connection.provider, config, credential, call.operation, call.arguments, call.id);
        result = connection.provider==='mcp-remote'?value:{ content: [{ type: 'text', text: JSON.stringify(value).replaceAll(credential, '[REDACTED]') }] };
      } catch (error) {
        await db.query('BEGIN');
        if (error instanceof AppRequestError) {
          const result={isError:true,code:error.code,content:[{type:'text',text:error.code}]};
          await this.complete(db,lease,call.id,result);await db.query('COMMIT');return {state:'completed',result};
        }
        if (error instanceof ToolAuthenticationError) {
          await db.query("UPDATE connections SET status='invalid',enabled=false,validation=jsonb_build_object('code','credential_reauthorization_required'),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3", [lease.tenant_id, connection.id, connection.version]);
          await this.wait(db, lease, call.id, 'waiting_authorization', 'authorization.required', { connection_id: connection.id });
          await db.query('COMMIT'); return { state: 'waiting_authorization' };
        }
        await this.wait(db, lease, call.id, 'waiting_approval', 'tool.outcome_unknown', { call_id: call.id }, true, 'unknown');
        await db.query('COMMIT'); return { state: 'unknown' };
      }
      await db.query('BEGIN');
      await this.complete(db, lease, call.id, result);
      await db.query('COMMIT'); return { state: 'completed', result };
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally {
      try { if (locked) await db.query('SELECT pg_advisory_unlock(hashtextextended($1,1))', [lock]); } finally { db.release(); }
    }
  }
  private async active(db: pg.PoolClient, lease: Lease) {
    const row = (await db.query('SELECT *,lease_until>now() AS live FROM runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [lease.tenant_id, lease.id])).rows[0];
    // Cancellation cannot retract an already dispatched external operation.
    // Its result still belongs in the audit trail, without resuming the Run.
    // New dispatches remain forbidden by the entry guard above.
    if (!row?.live || row.generation !== lease.generation || row.lease_owner !== lease.lease_owner || !['running', 'waiting_authorization', 'waiting_approval', 'cancelling'].includes(row.state)) throw new ExecutionError('lease_lost', 409);
    return row;
  }
  private async wait(db: pg.PoolClient, lease: Lease, id: string, state: string, event: string, data: unknown, force = false, callState = state) {
    const run = await this.active(db, lease);
    const changed = await db.query('UPDATE tool_calls SET state=$4,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND id=$3 AND state<>$4 RETURNING id', [lease.tenant_id, lease.id, id, callState]);
    await db.query("UPDATE runs SET state=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state<>'cancelling'", [lease.tenant_id, lease.id, state]);
    if (changed.rowCount || force) await db.query('INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,$3,$4)', [lease.tenant_id, lease.id, run.state === 'cancelling' ? 'tool.result_after_cancellation' : event, run.state === 'cancelling' ? { call_id: id, outcome: callState } : data]);
  }
  private async complete(db: pg.PoolClient, lease: Lease, id: string, result: unknown) {
    await this.active(db, lease);
    await db.query("UPDATE tool_calls SET state='completed',result=$4,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND id=$3", [lease.tenant_id, lease.id, id, result]);
    await db.query("UPDATE runs SET state='running',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('waiting_authorization','waiting_approval')", [lease.tenant_id, lease.id]);
    await db.query("INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,'tool.completed',$3)", [lease.tenant_id, lease.id, { call_id: id }]);
  }
}

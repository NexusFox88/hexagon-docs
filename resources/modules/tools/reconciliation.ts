import type pg from 'pg';
import { z } from 'zod';
import { ExecutionError } from '../execution/runs.js';
import { transaction } from '../storage/database.js';

export const toolResolutionInput = z.object({
  request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(['completed', 'failed']),
  text: z.string().min(1).max(65536),
  evidence: z.string().min(1).max(4000),
}).strict();

/** Records a caller-verified outcome. Never retries an uncertain remote operation. */
export class ToolReconciliation {
  constructor(private pool: pg.Pool) {}
  /** Refuses this invocation only; neither revokes credentials nor retries HTTP. */
  async denyAuthorization(tenant: string, run: string, id: string, input: unknown) {
    const { request_hash } = z.object({ request_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(input);
    return transaction(this.pool, async db => {
      const key = JSON.stringify([tenant, run, id]);
      const lock = (await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,1)) AS locked', [key])).rows[0];
      if (!lock.locked) throw new ExecutionError('tool_call_in_flight', 409);
      const active = (await db.query('SELECT state FROM runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, run])).rows[0];
      if (!active) throw new ExecutionError('run_not_found', 404);
      const call = (await db.query('SELECT * FROM tool_calls WHERE tenant_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE', [tenant, run, id])).rows[0];
      if (!call) throw new ExecutionError('tool_call_not_found', 404);
      if (call.request_hash !== request_hash) throw new ExecutionError('tool_call_conflict', 409);
      if (call.state === 'completed' && call.result?.code === 'tool_authorization_denied') return { id, state: 'completed', result: call.result };
      if (!['running', 'waiting_authorization', 'waiting_approval'].includes(active.state)) throw new ExecutionError('tool_run_not_active', 409);
      if (call.state !== 'waiting_authorization') throw new ExecutionError('tool_authorization_not_pending', 409);
      const result = { isError: true, code: 'tool_authorization_denied', content: [{ type: 'text', text: 'The user denied authorization for this tool invocation. No further request was sent. Explain the limitation without claiming the operation succeeded.' }] };
      await db.query("UPDATE tool_calls SET state='completed',result=$4,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND id=$3", [tenant, run, id, result]);
      // Preserve another call's approval wait. The worker will deliver this result.
      await db.query("UPDATE runs SET state='running',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='waiting_authorization'", [tenant, run]);
      await db.query("INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,'authorization.denied',$3),($1,$2,'tool.completed',$3)", [tenant, run, { call_id: id, source: 'caller', outcome: 'authorization_denied' }]);
      return { id, state: 'completed', result };
    });
  }
  async list(tenant: string, run: string) {
    if (!(await this.pool.query('SELECT 1 FROM runs WHERE tenant_id=$1 AND id=$2', [tenant, run])).rowCount) throw new ExecutionError('run_not_found', 404);
    return (await this.pool.query('SELECT id,binding,operation,arguments,request_hash,state,approval_id,execution_policy,resolution,(result->>\'isError\')::boolean AS is_error,updated_at FROM tool_calls WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at,id', [tenant, run])).rows;
  }
  async resolve(tenant: string, run: string, id: string, input: unknown) {
    const resolution = toolResolutionInput.parse(input);
    return transaction(this.pool, async db => {
      // Same lock as ToolBroker. Never accept reconciliation while a remote
      // request remains in flight, even if the worker's Run lease has expired.
      const key = JSON.stringify([tenant, run, id]);
      const lock = (await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,1)) AS locked', [key])).rows[0];
      if (!lock.locked) throw new ExecutionError('tool_call_in_flight', 409);
      const active = (await db.query('SELECT state FROM runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, run])).rows[0];
      if (!active) throw new ExecutionError('run_not_found', 404);
      const call = (await db.query('SELECT * FROM tool_calls WHERE tenant_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE', [tenant, run, id])).rows[0];
      if (!call) throw new ExecutionError('tool_call_not_found', 404);
      if (call.request_hash !== resolution.request_hash) throw new ExecutionError('tool_call_conflict', 409);
      if (call.resolution) {
        if (JSON.stringify(toolResolutionInput.parse(call.resolution)) !== JSON.stringify(resolution)) throw new ExecutionError('tool_resolution_conflict', 409);
        return { id, state: 'completed', resolution: call.resolution };
      }
      if (!['running', 'waiting_authorization', 'waiting_approval'].includes(active.state)) throw new ExecutionError('tool_run_not_active', 409);
      if (call.state !== 'unknown') throw new ExecutionError('tool_outcome_not_unknown', 409);
      const result = { ...(resolution.outcome === 'failed' ? { isError: true } : {}), content: [{ type: 'text', text: resolution.text }] };
      await db.query("UPDATE tool_calls SET state='completed',result=$4,resolution=$5,updated_at=now() WHERE tenant_id=$1 AND run_id=$2 AND id=$3", [tenant, run, id, result, resolution]);
      await db.query("UPDATE runs SET state='running',updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, run]);
      await db.query("INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,'tool.outcome_resolved',$3)", [tenant, run, { call_id: id, outcome: resolution.outcome, evidence: resolution.evidence, source: 'caller_verified' }]);
      await db.query("INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,'tool.completed',$3)", [tenant, run, { call_id: id, source: 'caller_verified' }]);
      return { id, state: 'completed', resolution };
    });
  }
}

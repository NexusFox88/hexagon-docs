import {prepareSandboxImage,cleanupSandboxImages} from './image-preparation.js';
import {checkpointTransition} from './checkpoints.js';
import {HarnessImages} from '../harnesses/images.js';
import { SandboxCreationRejected } from './connector.js';
import { failureDiagnostic } from '../diagnostics/failure.js';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { SecretStore } from '../credentials/secret-store.js';
import { ExecutionError } from '../execution/runs.js';
import type { SandboxConnector, SandboxResource } from './connector.js';

export type ConnectorFactory = (provider: string, config: Record<string, unknown>, credential: string) => SandboxConnector;

/** Serializes each Session's remote mutations while recording intent before effects. */
export class SandboxLifecycle {
  constructor(private pool: pg.Pool, private secrets: SecretStore, private factory: ConnectorFactory) {}

  async access(tenant: string, session: string) {
    const db = await this.pool.connect();
    try {
      const row = (await db.query('SELECT * FROM sessions WHERE tenant_id=$1 AND id=$2', [tenant, session])).rows[0];
      if (!row) throw new ExecutionError('session_not_found', 404);
      return await this.connector(db, row, false);
    } finally { db.release(); }
  }

  private async locked<T>(tenant: string, session: string, work: (db: pg.PoolClient, row: any) => Promise<T>) {
    const db = await this.pool.connect();
    const key = JSON.stringify([tenant, session]);
    let locked = false;
    try {
      await db.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
      locked = true;
      const row = (await db.query('SELECT * FROM sessions WHERE tenant_id=$1 AND id=$2', [tenant, session])).rows[0];
      if (!row) throw new ExecutionError('session_not_found', 404);
      return await work(db, row);
    } finally {
      try { if (locked) await db.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]); }
      finally { db.release(); }
    }
  }

  private async connector(db: pg.PoolClient, row: any, requireEnabled: boolean) {
    const connection = (await db.query('SELECT * FROM connections WHERE tenant_id=$1 AND id=$2', [row.tenant_id, row.sandbox_connection_id])).rows[0];
    if (!connection?.secret_id) throw new ExecutionError('sandbox_credential_missing', 409);
    if (requireEnabled && (!connection.enabled || connection.status !== 'ready' || connection.deleted_at)) throw new ExecutionError('connection_not_ready', 409);
    const pinned = row.definition.connections.find((c: any) => c.id === row.sandbox_connection_id);
    const credential = await this.secrets.read(row.tenant_id, connection.secret_id, `connection:${connection.id}`, db);
    return this.factory(pinned.provider, pinned.config, credential);
  }

  async provision(tenant: string, session: string, scheduled = false): Promise<SandboxResource> {
    return this.locked(tenant, session, async (db, row) => {
      if (row.state !== 'open') throw new ExecutionError('session_closed', 409);
      if (row.sandbox?.id) {
        const connector = await this.connector(db, row, false);
        const actual = await connector.inspect(row.sandbox.id);
        if (!actual) throw new ExecutionError('sandbox_lost', 409);
        return actual;
      }
      const prior = (await db.query("SELECT * FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='create' ORDER BY created_at LIMIT 1", [tenant, session])).rows[0];
      const connector = await this.connector(db, row, !prior);
      if (prior) {
        if (scheduled && prior.state === 'unknown' && (prior.review_state !== 'automatic' || (prior.next_check_at && new Date(prior.next_check_at).getTime() > Date.now()))) throw new ExecutionError(prior.review_state !== 'automatic' ? 'resource_review_required' : 'resource_reconciliation_scheduled',409);
        if (prior.state === 'rejected') throw new ExecutionError('sandbox_quota_exceeded', 409);
        // Even zero matches may be an eventually consistent or still-running create.
        // Never submit another create merely because the first response was lost.
        let matches:SandboxResource[];
        try { const known=prior.provider_resource_id?await connector.inspect(prior.provider_resource_id):null;matches=known?[known]:await connector.findByOperation(prior.id); }
        catch { await this.uncertain(db,tenant,prior.id,'reconciliation_unavailable');throw new ExecutionError('sandbox_creation_unconfirmed',409); }
        if (matches.length !== 1) {
          await this.uncertain(db, tenant, prior.id, matches.length ? 'multiple_resources' : 'creation_unconfirmed');
          throw new ExecutionError('sandbox_creation_unconfirmed', 409);
        }
        await this.recordResource(db, row, prior.id, matches[0]!);
        return matches[0]!;
      }
      const image=row.definition.harness_image;
      const registryCredential=image?.registry_secret_id?await new HarnessImages(this.pool,this.secrets).credential(tenant,image.registry_secret_id):undefined;
      await connector.preflight?.();
      const preparedImage=image?await prepareSandboxImage(db,tenant,session,connector,{reference:image.reference,user:image.user,registry_credential:registryCredential}):undefined;
      const operation = randomUUID();
      const detail = connector.expiry === 'control_plane' ? { expires_at: new Date(Date.now() + row.definition.resources.timeout_seconds * 1000).toISOString(), expiry: 'control_plane' } : {};
      await db.query("INSERT INTO resource_operations(tenant_id,id,session_id,kind,state,detail) VALUES($1,$2,$3,'create','pending',$4)", [tenant, operation, session, detail]);
      try {
        const resource = await connector.create({ ...(preparedImage?{prepared_image:preparedImage}:{}), ...(image?{image:{reference:image.reference,user:image.user,registry_credential:registryCredential}}:{}), operation_id: operation, session_id: session, timeout_seconds: row.definition.resources.timeout_seconds, network: row.definition.network, record: async(resourceId,providerOperationId)=>{await db.query("UPDATE resource_operations SET provider_resource_id=$3,detail=detail || $4::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,operation,resourceId,{provider_operation_id:providerOperationId}]);} });
        await this.recordResource(db, row, operation, resource);
        return resource;
      } catch (error) {
        if (error instanceof SandboxCreationRejected) {
          await db.query("UPDATE resource_operations SET state='rejected',detail=detail || $3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, operation, { reason: error.code }]);
          throw new ExecutionError(error.code, 409);
        }
        await db.query("UPDATE resource_operations SET detail=detail || $3::jsonb WHERE tenant_id=$1 AND id=$2", [tenant, operation, { failure: failureDiagnostic(error) }]);
        await this.uncertain(db, tenant, operation, 'creation_unconfirmed');
        throw new ExecutionError('sandbox_creation_unconfirmed', 409);
      }
    });
  }

  private async recordResource(db: pg.PoolClient, session: any, operation: string, resource: SandboxResource) {
    await db.query('BEGIN');
    try {
      const intent = (await db.query('SELECT detail FROM resource_operations WHERE tenant_id=$1 AND id=$2', [session.tenant_id, operation])).rows[0]?.detail;
      if (intent?.expiry === 'control_plane') resource = { ...resource, expires_at: intent.expires_at, expiry_enforcement: 'control_plane' };
      await db.query("UPDATE resource_operations SET state='completed',provider_resource_id=$3,review_state='automatic',next_check_at=NULL,last_checked_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2", [session.tenant_id, operation, resource.id]);
      await db.query('UPDATE sessions SET sandbox=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2', [session.tenant_id, session.id, resource]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  }

  private async uncertain(db: pg.PoolClient, tenant: string, operation: string, reason: string) {
    await db.query("UPDATE resource_operations SET state='unknown',detail=detail || $3::jsonb,attempt_count=attempt_count+1,last_checked_at=now(),next_check_at=CASE WHEN review_state='acknowledged' OR attempt_count>=2 THEN NULL ELSE now()+make_interval(secs=>LEAST(900,30*power(2,LEAST(attempt_count,5)))::int) END,review_state=CASE WHEN review_state='acknowledged' THEN 'acknowledged' WHEN attempt_count>=2 THEN 'needs_review' ELSE 'automatic' END,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, operation, { reason }]);
  }

  /** Idle-only pause. Durable transitional states are reconciled without replaying a remote mutation. */
  async ensureAwake(tenant:string,session:string){
    const row=(await this.pool.query('SELECT state,pause_scope FROM sessions WHERE tenant_id=$1 AND id=$2',[tenant,session])).rows[0];
    if(!row)throw new ExecutionError('session_not_found',404);
    if(row.state==='pausing')await this.pause(tenant,session,row.pause_scope);
    if(['paused','pausing','resuming'].includes(row.state))await this.resume(tenant,session);
  }
  async pauseIdle(){
    const pending=(await this.pool.query("SELECT tenant_id,id,state,pause_scope FROM sessions WHERE state IN ('pausing','resuming') ORDER BY updated_at LIMIT 20")).rows;
    for(const row of pending){try{if(row.state==='pausing')await this.pause(row.tenant_id,row.id,row.pause_scope);else await this.resume(row.tenant_id,row.id);}catch{/* Inspect-only recovery retains uncertainty. */}}

    const rows=(await this.pool.query(`SELECT s.tenant_id,s.id FROM sessions s WHERE s.state='open' AND s.sandbox IS NOT NULL
      AND (s.definition->'capabilities' ? 'pause_resume' OR s.definition->'capabilities' ? 'automatic_standby')
      AND NOT EXISTS(SELECT 1 FROM runs r WHERE r.tenant_id=s.tenant_id AND r.session_id=s.id AND r.state NOT IN ('completed','failed','cancelled'))
      AND GREATEST(s.updated_at,COALESCE((SELECT max(r.updated_at) FROM runs r WHERE r.tenant_id=s.tenant_id AND r.session_id=s.id),s.updated_at))
       <now()-make_interval(secs=>LEAST(COALESCE((s.definition->'resources'->>'idle_timeout_seconds')::int,60),COALESCE((s.definition->'resources'->>'timeout_seconds')::int,600)-10))
      ORDER BY s.updated_at LIMIT 20`)).rows;
    for(const row of rows){try{await this.pause(row.tenant_id,row.id,'sandbox');}catch{/* New requests win the row lock; remote uncertainty remains durable. */}}
  }
  async pause(tenant:string,session:string,scope:'session'|'sandbox'='session') {
    return this.changePause(tenant,session,false,scope);
  }
  async resume(tenant:string,session:string) {return this.changePause(tenant,session,true);}
  private async changePause(tenant:string,session:string,resume:boolean,requested:'session'|'sandbox'='session'){
    return this.locked(tenant,session,async(db,row)=>{
      const target=resume?'open':'paused',pending=resume?'resuming':'pausing';
      if(['closed','closing'].includes(row.state))throw new ExecutionError('session_closed',409);
      if(row.state===target){if(!resume&&row.pause_scope!==requested)throw new ExecutionError('session_pause_scope_conflict',409);return {state:row.state,scope:row.pause_scope};}
      if(row.state!==(resume?'paused':'open')&&row.state!==pending)throw new ExecutionError('session_transition_pending',409);
      const scope=resume?(row.pause_scope??'session'):requested;
      if(row.state===pending&&row.pause_scope!==scope)throw new ExecutionError('session_pause_scope_conflict',409);
      const providerManaged=scope==='sandbox'&&row.definition.capabilities.includes('automatic_standby');
      const native=scope==='sandbox'&&!!row.sandbox?.id&&!providerManaged;
      const deadline=(await db.query("SELECT detail->>'expires_at' AS deadline FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='create' AND detail->>'expiry'='control_plane'",[tenant,session])).rows[0]?.deadline??row.sandbox?.expires_at;
      const remaining=resume?(row.definition.resources?.timeout_seconds??600):deadline?Math.floor((new Date(deadline).getTime()-Date.now())/1000):row.definition.resources?.timeout_seconds;
      if(resume&&remaining!==undefined&&remaining<=0)throw new ExecutionError('sandbox_expired',409);
      const connector=(native||providerManaged)?await this.connector(db,row,false):null;
      if(scope==='sandbox'&&!providerManaged&&(!row.definition.capabilities.includes('pause_resume')||native&&!(connector?.snapshot&&connector.restore)&&(!connector?.pause||!connector.resume)))throw new ExecutionError('sandbox_pause_unsupported',409);
      const recovery=row.state===pending;
      if(!recovery){
        await db.query('BEGIN');
        try{
          await db.query('SELECT id FROM sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,session]);
          if(!resume&&(await db.query("SELECT 1 FROM runs WHERE tenant_id=$1 AND session_id=$2 AND state NOT IN ('completed','failed','cancelled')",[tenant,session])).rowCount)throw new ExecutionError('session_busy',409);
          if((await db.query("SELECT 1 FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='create' AND state IN ('pending','unknown')",[tenant,session])).rowCount)throw new ExecutionError('sandbox_creation_unconfirmed',409);
          await db.query('UPDATE sessions SET state=$3,pause_scope=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,session,pending,scope]);
          await db.query('INSERT INTO session_lifecycle_events(tenant_id,session_id,type,data) VALUES($1,$2,$3,$4)',[tenant,session,'session.'+pending,{scope}]);
          if(resume&&(native||providerManaged))await db.query("UPDATE resource_operations SET detail=jsonb_set(detail,'{expires_at}',to_jsonb((now()+make_interval(secs=>$3))::text)) WHERE tenant_id=$1 AND session_id=$2 AND kind='create' AND detail->>'expiry'='control_plane'",[tenant,session,remaining]);
          await db.query('COMMIT');
        }catch(e){await db.query('ROLLBACK');throw e;}
      }
      if(native&&connector?.snapshot&&connector.restore){
        row.sandbox=await checkpointTransition(db,row,connector,resume);
      }else if(native){
        if(!recovery){try{if(resume)await connector!.resume!(row.sandbox.id,remaining);else await connector!.pause!(row.sandbox.id);}catch{/* Inspect the exact resource; never blindly replay. */}}
        else if(resume&&connector!.reconcileResume){try{await connector!.reconcileResume(row.sandbox.id,remaining);}catch{/* An occupied lease or lost response remains pending until exact-resource inspection. */}}
        const actual=await connector!.inspect(row.sandbox.id);
        if(!actual)throw new ExecutionError('sandbox_lost',409);
        if(actual.state!==(resume?'running':'paused'))throw new ExecutionError('session_transition_pending',409);
        row.sandbox=actual;
      }
      if(connector?.expiry==='control_plane'&&row.sandbox){
        row.sandbox={...row.sandbox,expiry_enforcement:'control_plane'};
        if(resume){const active=(await db.query("SELECT detail->>'expires_at' AS deadline FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='create' AND detail->>'expiry'='control_plane'",[tenant,session])).rows[0];row.sandbox.expires_at=active?.deadline;}
        else delete row.sandbox.expires_at;
      }
      await db.query('BEGIN');
      try{
        if(resume&&(native||providerManaged))await db.query("UPDATE session_runtimes SET state='restoring' WHERE tenant_id=$1 AND session_id=$2 AND state<>'interrupted'",[tenant,session]);
        await db.query('UPDATE sessions SET state=$3,pause_scope=$4,sandbox=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,session,target,resume?null:scope,row.sandbox]);
        await db.query('INSERT INTO session_lifecycle_events(tenant_id,session_id,type,data) VALUES($1,$2,$3,$4)',[tenant,session,resume?'session.resumed':'session.paused',{scope,compute_paused:native&&!resume,provider_managed_standby:providerManaged}]);
        await db.query('COMMIT');
      }catch(e){await db.query('ROLLBACK');throw e;}
      return {state:target,scope,compute_paused:native&&!resume,provider_managed_standby:providerManaged};
    });
  }

  async close(tenant: string, session: string) {
    return this.closeSession(tenant, session, false);
  }

  /** Called by an independent worker loop, including after a control-plane restart. */
  async reapExpired() {
    const due = (await this.pool.query(`SELECT s.tenant_id,s.id FROM sessions s
      JOIN resource_operations o ON o.tenant_id=s.tenant_id AND o.session_id=s.id
      WHERE s.state<>'closed' AND NOT (s.state='paused' AND s.pause_scope='sandbox') AND o.kind='create' AND o.detail->>'expiry'='control_plane'
      AND (o.detail->>'expires_at')::timestamptz <= now()
      GROUP BY s.tenant_id,s.id ORDER BY MIN(COALESCE((o.detail->>'expiry_attempted_at')::timestamptz,'epoch')) LIMIT 20`)).rows;
    const closing=(await this.pool.query(`SELECT s.tenant_id,s.id FROM sessions s WHERE s.state='closing' AND NOT EXISTS (SELECT 1 FROM resource_operations o WHERE o.tenant_id=s.tenant_id AND o.session_id=s.id AND o.state='unknown' AND (o.review_state<>'automatic' OR o.next_check_at>now())) ORDER BY s.updated_at LIMIT 20`)).rows;
    for (const row of closing) {try {await this.closeSession(row.tenant_id,row.id,false,true);}catch { /* Persisted outcome remains pending. */ }}
    for (const row of due) {
      try { await this.closeSession(row.tenant_id, row.id, true); }
      catch { /* Persisted closing/unknown operations are retried on the next sweep. */ }
    }
  }

  private async closeSession(tenant: string, session: string, expired: boolean, scheduled=false) {
    return this.locked(tenant, session, async (db, row) => {
      if (row.state === 'closed') return { state: 'closed' };
      if(expired&&row.state==='paused'&&row.pause_scope==='sandbox')return {state:row.state};
      if (expired && !(await db.query(`SELECT 1 FROM resource_operations WHERE tenant_id=$1 AND session_id=$2
        AND kind='create' AND detail->>'expiry'='control_plane' AND (detail->>'expires_at')::timestamptz<=now()`, [tenant, session])).rowCount) return { state: row.state };
      if (expired) await db.query("UPDATE resource_operations SET detail=detail || jsonb_build_object('expiry_attempted_at',now()) WHERE tenant_id=$1 AND session_id=$2 AND kind='create' AND detail->>'expiry'='control_plane'", [tenant, session]);
      // Transaction takes the same Session row lock as Run submission.
      await db.query('BEGIN');
      try {
        await db.query('SELECT id FROM sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenant, session]);
        const active = await db.query("SELECT id,state FROM runs WHERE tenant_id=$1 AND session_id=$2 AND state NOT IN ('completed','failed','cancelled') FOR UPDATE", [tenant, session]);
        if (active.rowCount && !expired) throw new ExecutionError('session_busy', 409);
        for (const run of active.rows.filter(run=>run.state!=='cancelling')) {
          await db.query("UPDATE runs SET state='cancelling',cancel_requested=true,generation=generation+1,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, run.id]);
          await db.query("UPDATE approvals SET state='expired' WHERE tenant_id=$1 AND run_id=$2 AND state='pending'", [tenant, run.id]);
          await db.query("INSERT INTO events(tenant_id,run_id,type,data,source_key) VALUES($1,$2,'run.cancelling',$3,'resource:expired') ON CONFLICT(tenant_id,run_id,source_key) DO NOTHING", [tenant, run.id, { reason: 'sandbox_expired' }]);
        }
        await db.query("UPDATE sessions SET state='closing',updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, session]);
        await db.query('COMMIT');
      } catch (error) { await db.query('ROLLBACK'); throw error; }

      // Expiry fences execution immediately; provider backoff only delays remote reconciliation.
      if ((expired||scheduled) && (await db.query("SELECT 1 FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND state='unknown' AND (review_state<>'automatic' OR next_check_at>now())",[tenant,session])).rowCount) throw new ExecutionError('resource_reconciliation_scheduled',409);

      // Never delete the source of an unresolved checkpoint: it may still be
      // needed for provider-side reconciliation. Absence of a receipt is not success.
      if((await db.query("SELECT 1 FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='checkpoint' AND state<>'deleted' AND provider_resource_id IS NULL",[tenant,session])).rowCount)throw new ExecutionError('sandbox_checkpoint_unconfirmed',409);

      const creates = (await db.query("SELECT * FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind IN ('create','restore') AND state<>'rejected'", [tenant, session])).rows;
      if (row.sandbox?.id || creates.length) {
        const connector = await this.connector(db, row, false);
        const ids = new Set<string>();
        if (row.sandbox?.id) ids.add(row.sandbox.id);
        for (const create of creates) {
          if (create.provider_resource_id) ids.add(create.provider_resource_id);
          else if (!create.detail?.reconciled_ids?.length) {
            let found:SandboxResource[];
            try {found = await connector.findByOperation(create.id);} catch {await this.uncertain(db,tenant,create.id,'reconciliation_unavailable');throw new ExecutionError('sandbox_creation_unconfirmed',409);}
            if (!found.length) {await this.uncertain(db,tenant,create.id,'creation_unconfirmed');throw new ExecutionError('sandbox_creation_unconfirmed', 409);}
            for (const resource of found) ids.add(resource.id);
            // Retain the reconciled ids even if deletion fails below.
            await db.query("UPDATE resource_operations SET state='completed',review_state='automatic',next_check_at=NULL,last_checked_at=now(),detail=detail || $3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, create.id, { reconciled_ids: found.map(r => r.id) }]);
          }
          for (const id of create.detail?.reconciled_ids ?? []) ids.add(id);
        }
        for (const id of ids) {
          let operation = (await db.query("SELECT * FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='delete' AND provider_resource_id=$3 LIMIT 1", [tenant, session, id])).rows[0];
          if (!operation) {
            operation = { id: randomUUID() };
            await db.query("INSERT INTO resource_operations(tenant_id,id,session_id,kind,provider_resource_id) VALUES($1,$2,$3,'delete',$4)", [tenant, operation.id, session, id]);
          }
          try {
            await connector.cleanupAssociatedResources?.(id);
            if (connector.reconcileDeletion) {
              await connector.reconcileDeletion(id, {
                provider_operation_id: operation.detail?.provider_operation_id,
                record: async providerOperationId => {
                  await db.query('UPDATE resource_operations SET detail=detail || $3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2', [tenant, operation.id, { provider_operation_id: providerOperationId }]);
                },
              });
            } else if (await connector.inspect(id)) await connector.destroy(id);
            if (await connector.inspect(id)) throw new Error('deletion not confirmed');
            await db.query("UPDATE resource_operations SET state='completed',review_state='automatic',next_check_at=NULL,last_checked_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, operation.id]);
          } catch {
            await this.uncertain(db, tenant, operation.id, 'deletion_unconfirmed');
            throw new ExecutionError('sandbox_deletion_unconfirmed', 409);
          }
        }
      }
      const checkpoints=(await db.query("SELECT * FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='checkpoint' AND state<>'deleted'",[tenant,session])).rows;
      if(checkpoints.length){
        const connector=await this.connector(db,row,false);
        for(const checkpoint of checkpoints){
          if(!checkpoint.provider_resource_id||!connector.deleteSnapshot)throw new ExecutionError('sandbox_checkpoint_unconfirmed',409);
          await connector.deleteSnapshot(checkpoint.provider_resource_id);
          await db.query("UPDATE resource_operations SET state='deleted',updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,checkpoint.id]);
        }
      }
      if((await db.query("SELECT 1 FROM resource_operations WHERE tenant_id=$1 AND session_id=$2 AND kind='image_prepare' AND state<>'deleted'",[tenant,session])).rowCount)await cleanupSandboxImages(db,tenant,session,await this.connector(db,row,false));
      await db.query('BEGIN');
      try {
        if (expired) {
          const cancelled = await db.query("UPDATE runs SET state='cancelled',lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND session_id=$2 AND state='cancelling' RETURNING id", [tenant, session]);
          for (const run of cancelled.rows) await db.query("INSERT INTO events(tenant_id,run_id,type,data) VALUES($1,$2,'run.cancelled',$3)", [tenant, run.id, { reason: 'sandbox_expired', resource_cleanup: 'confirmed' }]);
        }
        await db.query("UPDATE sessions SET state='closed',sandbox=CASE WHEN sandbox IS NULL THEN NULL ELSE sandbox || '{\"state\":\"destroyed\"}'::jsonb END,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenant, session]);
        await db.query('COMMIT');
      } catch (error) { await db.query('ROLLBACK'); throw error; }
      return { state: 'closed' };
    });
  }
}

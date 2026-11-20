import {randomBytes,randomUUID} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {tokenDigest} from './api-auth.js';
import {ExecutionError} from '../execution/runs.js';
import {transaction} from '../storage/database.js';
const input=z.object({label:z.string().trim().min(1).max(200),expires_in_days:z.number().int().min(1).max(365).default(30)}).strict();
export class ApplicationTokens {
 constructor(private pool:pg.Pool){}
 async list(tenant:string){return {tokens:(await this.pool.query("SELECT id,label,role,expires_at,last_used_at,revoked_at,created_at FROM api_keys WHERE tenant_id=$1 ORDER BY created_at DESC",[tenant])).rows};}
 async create(tenant:string,value:unknown){const parsed=input.parse(value),token=`hx_app_${randomBytes(32).toString('base64url')}`;const row=(await this.pool.query("INSERT INTO api_keys(digest,tenant_id,id,label,role,expires_at) VALUES($1,$2,$3,$4,'application',now()+make_interval(days=>$5)) RETURNING id,label,role,expires_at,created_at",[tokenDigest(token),tenant,randomUUID(),parsed.label,parsed.expires_in_days])).rows[0];return {...row,token};}
 async revoke(tenant:string,id:string){const row=(await this.pool.query("UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND id=$2 AND role='application' RETURNING id,revoked_at",[tenant,id])).rows[0];if(!row)throw new ExecutionError('application_token_not_found',404);return row;}
 async rotate(tenant:string,id:string){return transaction(this.pool,async db=>{const old=(await db.query("SELECT * FROM api_keys WHERE tenant_id=$1 AND id=$2 AND role='application' AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",[tenant,id])).rows[0];if(!old)throw new ExecutionError('application_token_not_found',404);const token=`hx_app_${randomBytes(32).toString('base64url')}`,next=randomUUID();await db.query('UPDATE api_keys SET revoked_at=now() WHERE tenant_id=$1 AND id=$2',[tenant,id]);const row=(await db.query("INSERT INTO api_keys(digest,tenant_id,id,label,role,expires_at) VALUES($1,$2,$3,$4,'application',$5) RETURNING id,label,role,expires_at,created_at",[tokenDigest(token),tenant,next,old.label,old.expires_at])).rows[0];return {...row,token};});}
}
/** Application tokens execute configured work; workspace administration stays with owners. */
export function applicationRoute(method:string,path:string){
 const route=path.split('?')[0]!.replace(/^\/v1/,'');
 if(method==='GET')return /^\/(?:health|catalog|agents(?:\/[^/]+)?|connections(?:\/[^/]+)?|sessions(?:\/[^/]+(?:\/(?:runs|files|access|initialization))?)?|runs(?:\/[^/]+(?:\/(?:stream|events|artifacts|tool-calls|approvals))?)?|artifacts\/[^/]+\/content)$/.test(route);
 if(method==='POST')return /^\/(?:agents|agents\/preflight|sessions|sessions\/preflight|sessions\/[^/]+\/(?:runs|files|close|previews|access)|runs\/[^/]+\/cancel)$/.test(route);
 if(method==='DELETE')return /^\/(?:previews|access)\/[^/]+$/.test(route);
 return false;
}

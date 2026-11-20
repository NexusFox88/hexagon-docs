import {mkdir,readFile,writeFile,lstat,readdir,rename,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {openDatabase} from '../storage/database.js';
import {SecretCipher,SecretStore} from '../credentials/secret-store.js';
import {tokenDigest} from '../credentials/api-auth.js';

const privateFiles=['master.key','owner.json','deployment.json'] as const;
const digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
function postgresEnvironment(database:string){
 const url=new URL(database);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('backup_database_url_invalid');
 return {...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:url.searchParams.get('sslmode')??'prefer',PGOPTIONS:url.searchParams.get('options')??''};
}
async function pg(command:string,args:string[],database:string){
 await new Promise<void>((done,reject)=>{
  const child=spawn(command,args,{env:postgresEnvironment(database),stdio:'ignore'});
  let timedOut=false,force:ReturnType<typeof setTimeout>|undefined;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),5000);},120000);
  const clear=()=>{clearTimeout(timer);if(force)clearTimeout(force);};
  child.on('error',()=>{clear();reject(Error('backup_postgres_tools_unavailable'));});
  child.on('exit',code=>{clear();if(timedOut)reject(Error('backup_postgres_timeout'));else if(code===0)done();else reject(Error('backup_postgres_command_failed'));});
 });
}
async function stopped(data:string){
 try{const pid=Number(await readFile(join(data,'service.pid'),'utf8'));if(Number.isInteger(pid)&&pid>1){let alive=true;try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw error;}if(alive)throw Error('backup_stop_service_first');}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 // Direct launches do not own service.pid, but still publish local discovery.
 let descriptor,owner;try{descriptor=JSON.parse(await readFile(join(data,'connection.json'),'utf8'));owner=JSON.parse(await readFile(join(data,'owner.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 const origin=new URL(descriptor.base_url);
 if(origin.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||origin.username||origin.password)throw Error('backup_discovery_invalid');
 let response;try{response=await fetch(new URL('/v1/health',origin),{headers:{authorization:`Bearer ${owner.token}`},redirect:'error',signal:AbortSignal.timeout(3000)});}catch{return;}
 if(response.ok)throw Error('backup_stop_service_first');
}
async function checkIdentity(database:string,data:string){
 const db=openDatabase(database);try{
  const owner=JSON.parse(await readFile(join(data,'owner.json'),'utf8'));
  if(owner.tenant!=='local-workspace'||typeof owner.token!=='string'||!(await db.query("SELECT 1 FROM api_keys WHERE digest=$1 AND tenant_id=$2 AND role='owner' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())",[tokenDigest(owner.token),owner.tenant])).rowCount)throw Error('backup_identity_mismatch');
  const cipher=new SecretCipher(await readFile(join(data,'master.key')));
  for(const row of (await db.query('SELECT tenant_id,id,purpose,envelope FROM secrets')).rows)cipher.open(row.envelope,JSON.stringify([row.tenant_id,row.id,row.purpose]));
  if((await new SecretStore(db,cipher).health(owner.tenant)).state!=='ready')throw Error('backup_identity_mismatch');
 }finally{await db.end();}
}
/** Offline bundle: one database schema plus its matching private identity. Never overwrite a backup. */
export async function backupLocal(database:string,dataDirectory:string,destination:string){
 const data=resolve(dataDirectory),target=resolve(destination);await stopped(data);
 const db=openDatabase(database);let schema:string,migrations:unknown[];
 try{
  schema=(await db.query('SELECT current_schema() AS name')).rows[0].name;
  if(!schema||!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))throw Error('backup_schema_invalid');
  if((await db.query("SELECT 1 FROM sessions WHERE state<>'closed' LIMIT 1")).rowCount)throw Error('backup_close_sessions_first');
  migrations=(await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows;
 }finally{await db.end();}
 await checkIdentity(database,data);
 await mkdir(target,{mode:0o700}); // EEXIST deliberately refuses reuse.
 const files:Record<string,string>={};
 for(const name of privateFiles){try{const stat=await lstat(join(data,name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('backup_private_file_invalid');const bytes=await readFile(join(data,name));await writeFile(join(target,name),bytes,{mode:0o600,flag:'wx'});files[name]=digest(bytes);}catch(error){if(name==='deployment.json'&&(error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}}
 await writeFile(join(target,'database.dump'),'',{mode:0o600,flag:'wx'});
 await pg('pg_dump',['--format=custom','--no-owner','--no-acl',`--schema=${schema!}`,'--file',join(target,'database.dump')],database);
 files['database.dump']=digest(await readFile(join(target,'database.dump')));
 const manifest={format:1,schema:schema!,created_at:new Date().toISOString(),migrations:migrations!,files};
 await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
 return {directory:target,schema:schema!,files:Object.keys(files),state:'verified'};
}
/** Restore only into an empty database and an absent/empty directory. No live resource resurrection. */
export async function restoreLocal(database:string,directory:string,source:string){
 const target=resolve(directory),bundle=resolve(source);await stopped(target);
 try{if((await readdir(target)).some(name=>name!=='operation.lock'))throw Error('restore_data_directory_not_empty');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const manifest=JSON.parse(await readFile(join(bundle,'manifest.json'),'utf8'));
 if(manifest.format!==1||!manifest.files||!manifest.files['master.key']||!manifest.files['owner.json']||!manifest.files['database.dump']||!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(manifest.schema))throw Error('restore_manifest_invalid');
 for(const [name,hash] of Object.entries(manifest.files)){
  if(![...privateFiles,'database.dump'].includes(name as any))throw Error('restore_manifest_invalid');
  const stat=await lstat(join(bundle,name));if(!stat.isFile()||stat.isSymbolicLink()||digest(await readFile(join(bundle,name)))!==hash)throw Error('restore_integrity_failed');
 }
 const db=openDatabase(database);try{if((await db.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S') LIMIT 1")).rowCount)throw Error('restore_database_not_empty');}finally{await db.end();}
 const staging=target+'.restore-'+randomUUID();await mkdir(staging,{recursive:true,mode:0o700});
 for(const name of privateFiles)if(manifest.files[name])await writeFile(join(staging,name),await readFile(join(bundle,name)),{mode:0o600,flag:'wx'});
 await pg('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname',postgresEnvironment(database).PGDATABASE,join(bundle,'database.dump')],database);
 const checkUrl=new URL(database);checkUrl.searchParams.set('options',`-c search_path=${manifest.schema}`);
 await checkIdentity(checkUrl.href,staging);
 await mkdir(target,{recursive:true,mode:0o700});
 for(const name of privateFiles)if(manifest.files[name])await rename(join(staging,name),join(target,name));
 await rmdir(staging);
 return {state:'verified',directory:target,schema:manifest.schema,requires_start:true};
}

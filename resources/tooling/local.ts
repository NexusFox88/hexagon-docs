import {supportDiagnostics} from '../modules/diagnostics/support.js';
import {fileURLToPath} from 'node:url';
import {backupLocal,restoreLocal} from '../modules/deployment/backup.js';
import {DeploymentSettings,deploymentEnvironment} from '../modules/deployment/settings.js';
import {readFile,writeFile,mkdir,open,unlink} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../modules/storage/database.js';
import {migrate} from '../modules/storage/migrate.js';
const data=resolve(process.env.HEXAGON_DATA_DIR??'.local/control-plane');
const settings=new DeploymentSettings(data);
const base=`http://127.0.0.1:${process.env.PORT??8787}`;
async function health(){try{const owner=JSON.parse(await readFile(`${data}/owner.json`,'utf8'));const r=await fetch(`${base}/v1/health`,{headers:{authorization:`Bearer ${owner.token}`},signal:AbortSignal.timeout(8000)});return r.ok?await r.json():null;}catch{return null;}}
async function alive(){try{const pid=Number(await readFile(`${data}/service.pid`,'utf8'));if(!Number.isInteger(pid)||pid<2)return false;process.kill(pid,0);return true;}catch{return false;}}
async function stop(){
 const status=await health();if(!status){if(await alive())throw new Error('Managed process exists but cannot be authenticated; no process was signalled. Inspect service.log.');console.log('Local service is stopped.');return;}
 if(status.execution.busy||status.active_runs)throw new Error('Active Run: cancel/close it in Fleet before stopping the control plane.');
 const pid=Number(await readFile(`${data}/service.pid`,'utf8'));
 if(status.process_id!==pid)throw new Error('Service identity cannot be verified; no process was signalled.');
 process.kill(pid,'SIGTERM');
 for(let n=0;n<150;n++){try{process.kill(pid,0);}catch{console.log('Control plane and development ingress stopped.');return;}await delay(200);}
 throw new Error('Graceful shutdown is still pending; no forced kill was issued.');
}
async function doctor(){
 const [major,minor]=process.versions.node.split('.').map(Number);
 const checks:Record<string,unknown>={node:{ready:major!>22||(major===22&&minor!>=19),version:process.versions.node,required:'>=22.19.0'}};
 for(const [name,command,args] of [['python','python3',['--version']],['openssh','ssh',['-V']],['cloudflared',process.env.CLOUDFLARED_BINARY??'cloudflared',['--version']]] as const){try{execFileSync(command,[...args],{stdio:'ignore',timeout:5000});checks[name]={ready:true,required:name==='python'?'Python SDK':name==='openssh'?'Instabox':'development ingress'};}catch{checks[name]={ready:false,required:name==='python'?'Python SDK':name==='openssh'?'Instabox':'development ingress'};}}
 const db=openDatabase(process.env.DATABASE_URL??'postgres://hexagon@127.0.0.1:55432/hexagon');try{await db.query('SELECT 1');checks.database={ready:true};}catch{checks.database={ready:false,code:'database_unreachable'};}finally{await db.end();}
 console.log(JSON.stringify(checks));if(!(checks.node as {ready:boolean}).ready||!(checks.database as {ready:boolean}).ready)process.exitCode=1;return checks;
}
async function start(){
 const existing=await health();if(existing){console.log(JSON.stringify({state:'already_running',console:`${base}/console/`,owner_credential_file:`${data}/owner.json`,owner_credential_field:'token',credential_access:existing.credential_access}));return;}
 if(await alive())throw new Error('Managed process is starting or unreachable; inspect service.log before restarting.');
 await mkdir(data,{recursive:true,mode:0o700});
 const db=openDatabase(process.env.DATABASE_URL??'postgres://hexagon@127.0.0.1:55432/hexagon');try{await migrate(db);}finally{await db.end();}
 const log=await open(`${data}/service.log`,'a',0o600);
 const env=deploymentEnvironment((await settings.read()).config,{...process.env,HEXAGON_DATA_DIR:data});
 const compiled=import.meta.url.endsWith('.js');
 const entry=fileURLToPath(new URL('../apps/control-plane/main.'+(compiled?'js':'ts'),import.meta.url));
 const child=spawn(process.execPath,compiled?[entry]:['--import','tsx',entry],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,detached:true,stdio:['ignore',log.fd,log.fd]});
 child.unref();await log.close();await writeFile(`${data}/service.pid`,String(child.pid),{mode:0o600});
 const deadline=Date.now()+90000;
 while(Date.now()<deadline){const current=await health();if(current){console.log(JSON.stringify({state:'running',console:`${base}/console/`,owner_credential_file:`${data}/owner.json`,owner_credential_field:'token',credential_access:current.credential_access}));return;}if(child.exitCode!==null)throw new Error('Startup failed; inspect the private service.log.');await delay(1000);}
 throw new Error('Startup did not become healthy; inspect service.log before retrying.');
}
await mkdir(data,{recursive:true,mode:0o700});
let lock;
try{if((process.argv[2]??'status')!=='status'){lock=await open(`${data}/operation.lock`,'wx',0o600);}
switch(process.argv[2]??'status'){case'backup':{if(!process.argv[3])throw Error('Provide a new private backup directory');console.log(JSON.stringify(await backupLocal(process.env.DATABASE_URL??'postgres://hexagon@127.0.0.1:55432/hexagon',data,process.argv[3])));break;}case'restore':{if(!process.argv[3])throw Error('Provide a backup directory and an empty DATABASE_URL target');console.log(JSON.stringify(await restoreLocal(process.env.DATABASE_URL??'postgres://hexagon@127.0.0.1:55432/hexagon',data,process.argv[3])));break;}case'diagnostics':{const target=process.argv[3];if(!target)throw Error('Provide a new diagnostics JSON path');const report=supportDiagnostics(await health(),{platform:process.platform,arch:process.arch,node:process.versions.node});await writeFile(resolve(target),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({written:true}));break;}case'doctor':await doctor();break;case'configure':{const file=process.argv[3];if(!file)throw new Error('Provide a deployment JSON file');const current=await settings.read();const result=await settings.update({config:JSON.parse(await readFile(resolve(file),'utf8')),expected_revision:current.revision});console.log(JSON.stringify({revision:result.revision,restart_required:true}));break;}case'start':await start();break;case'stop':await stop();break;case'restart':await stop();await start();break;case'status':console.log(JSON.stringify(await health()??{state:await alive()?'unreachable':'stopped'}));break;default:throw new Error('Usage: npm run local -- start|stop|restart|status|doctor|diagnostics <new-file>|configure <file>|backup <new-directory>|restore <backup-directory>');}}catch(error){console.error(error instanceof Error?error.message:'local_operation_failed');process.exitCode=1;}finally{if(lock){await lock.close();await unlink(`${data}/operation.lock`);}}

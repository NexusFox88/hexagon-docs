import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,cp,readdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const target=resolve(process.argv[2]??`.local/releases/local-${randomUUID()}`);
await mkdir(target,{recursive:false,mode:0o700});
const compiler=spawn(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.build.json','--outDir',target],{stdio:'inherit'});
await new Promise<void>((done,reject)=>{compiler.on('error',reject);compiler.on('exit',code=>code===0?done():reject(Error('local_build_failed')));});
for(const root of ['apps','modules','runtime','integrations','examples']){
 async function assets(dir:string){for(const ent of await readdir(dir,{withFileTypes:true})){if(['__pycache__','node_modules','.venv','.local','.git'].includes(ent.name))continue;const file=join(dir,ent.name);if(ent.isDirectory())await assets(file);else if(!file.endsWith('.ts')&&!file.endsWith('.pyc')&&!file.includes('.test.')&&!ent.name.startsWith('.')&&!/^(owner\.json|master\.key|deployment\.json)$/.test(ent.name)){await mkdir(join(target,dir),{recursive:true});await cp(file,join(target,file));}}}await assets(root);
}
// Console's download instructions must work from the installed distribution too.
const sdkBuild=spawn(process.execPath,['node_modules/typescript/bin/tsc','-p','sdk/typescript/tsconfig.json'],{stdio:'inherit'});
await new Promise<void>((done,reject)=>{sdkBuild.on('error',reject);sdkBuild.on('exit',code=>code===0?done():reject(Error('sdk_build_failed')));});
await cp('sdk/python',join(target,'sdk/python'),{recursive:true,filter:path=>!/(?:__pycache__|\.egg-info|\.venv|\/build(?:\/|$))/.test(path)});
await cp('sdk/typescript/dist',join(target,'sdk/typescript/dist'),{recursive:true});
const sdkPackage=JSON.parse(await readFile('sdk/typescript/package.json','utf8'));
sdkPackage.scripts={build:"node -e \"import('./dist/index.js')\""};
await writeFile(join(target,'sdk/typescript/package.json'),JSON.stringify(sdkPackage,null,2));
const pkg=JSON.parse(await readFile('package.json','utf8'));pkg.scripts={local:'node tooling/local.js',start:'node tooling/local.js start','db:migrate':'node tooling/migrate.js'};
await writeFile(join(target,'package.json'),JSON.stringify(pkg,null,2));await cp('package-lock.json',join(target,'package-lock.json'));
await cp('docs/local-installation.md',join(target,'README.md'));
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md','SECURITY.md'])await cp(name,join(target,name));
await cp('third_party',join(target,'third_party'),{recursive:true});
await cp('docs',join(target,'docs'),{recursive:true});
await cp('sdk/typescript/LICENSE',join(target,'sdk/typescript/LICENSE'));
const fingerprint=createHash('sha256');async function hash(dir:string){for(const ent of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(dir,ent.name);if(ent.isDirectory())await hash(p);else fingerprint.update(p.slice(target.length)).update(await readFile(p));}}await hash(target);
await writeFile(join(target,'release.json'),JSON.stringify({format:1,sha256:fingerprint.digest('hex'),built_at:new Date().toISOString()},null,2));
console.log(JSON.stringify({directory:target,install:'npm ci --omit=dev',start:'npm run local -- start'}));

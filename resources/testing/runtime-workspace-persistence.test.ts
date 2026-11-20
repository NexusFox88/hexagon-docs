import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {RuntimeClient} from '../modules/sandboxes/runtime-client.js';
import type {SandboxConnector} from '../modules/sandboxes/connector.js';

it('retains Runtime, Pi, OpenCode and managed-CLI state after temporary paths disappear',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hexagon-persistence-')),temporary=join(dir,'tmp'),persistent=join(dir,'home');
 await mkdir(temporary);
 const connector={persistentWorkspaceRoot:persistent,execute:async(_id:string,command:string)=>{
  if(command.startsWith('python3 -'))await promisify(execFile)('sh',['-c',command.replace("Path('/tmp')",`Path('${temporary}')`)]);
  return {exit_code:0,stdout:'',stderr:''};
 },write:async()=>{}} as unknown as SandboxConnector;
 const runtime=new RuntimeClient(connector,'fixture','fixture-token');
 try{
  await runtime.prepare();
  const directories=['hexagon-runtime','hexagon-pi','hexagon-harnesses','hexagon-harness'];
  for(const name of directories)await writeFile(join(temporary,name,'retained'),name);
  await rm(temporary,{recursive:true});await mkdir(temporary);
  await runtime.prepare();
  for(const name of directories){expect((await lstat(join(temporary,name))).isSymbolicLink()).toBe(true);expect(await readFile(join(temporary,name,'retained'),'utf8')).toBe(name);}
  // Refuse to overwrite a foreign path rather than silently discarding state.
  await rm(join(temporary,'hexagon-pi'));await mkdir(join(temporary,'hexagon-pi'));
  await expect(runtime.prepare()).rejects.toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});

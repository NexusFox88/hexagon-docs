import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
// Explicit local configuration only; credentials remain in the control plane.
if(!process.argv[2])throw Error('Usage: npm run verify:cloud -- <private-config.json> [harness ...]');
const config=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
const packages=JSON.parse(await readFile('.local/evidence/sdk-packages.json','utf8'));
if(packages.state!=='verified')throw Error('Run verify:packages first');
const root=resolve('.local/evidence/cloud-'+randomUUID());await mkdir(root,{mode:0o700});
const file=join(root,'config.json');await writeFile(file,JSON.stringify({...config,evidence_directory:root}),{mode:0o600});
const harnesses=process.argv.slice(3).length?process.argv.slice(3):Object.keys(config.harnesses);
const rows=[];
for(const harness of harnesses){
 if(!config.harnesses[harness]||!/^[a-z0-9-]+$/.test(harness))throw Error('unknown_harness');
 for(const language of ['python','typescript']){
  const environment={...process.env,HEXAGON_JOURNEY_CONFIG:file,PYTHONPATH:join(packages.root,'python'),HEXAGON_TEST_TS_MODULE:pathToFileURL(join(packages.root,'consumer/node_modules/@hexagon/agent-sdk/dist/index.js')).href};
  const child=spawn(language==='python'?'python3':process.execPath,language==='python'?['tooling/cloud-journey.py',harness]:['--import','tsx','tooling/cloud-journey.ts',harness],{env:environment,stdio:'inherit'});
  const code=await new Promise<number>((done,reject)=>{child.on('error',reject);child.on('exit',code=>done(code??1));});
  rows.push({harness,language,passed:code===0});
  await writeFile(join(root,'matrix.json'),JSON.stringify({rows,complete:false},null,2),{mode:0o600});
 }
}
await writeFile(join(root,'matrix.json'),JSON.stringify({rows,complete:true,passed:rows.every(row=>row.passed)},null,2),{mode:0o600});
console.log({evidence:root,rows});if(rows.some(row=>!row.passed))process.exitCode=1;

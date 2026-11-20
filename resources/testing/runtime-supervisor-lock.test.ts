import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('the generated supervisor holds a process lock and does not start a duplicate listener',()=>{
 const source=readFileSync('modules/sandboxes/runtime-client.ts','utf8');
 const literal=source.match(/const launcher = ("[^\n]+")\s*;/)?.[1];expect(literal).toBeTruthy();const launcher=JSON.parse(literal!);
 // Execute the actual generated Python with fake filesystem/flock/runpy and check both paths.
 const probe=`import json,sys,types,builtins\nsource=json.loads(sys.argv[1])\ncalls=[]\nbuiltins.open=lambda *a: object()\nclass P:\n def __init__(self,*a):pass\n def read_text(self): return 'fixture'\nsys.modules['pathlib']=types.SimpleNamespace(Path=P)\nsys.modules['runpy']=types.SimpleNamespace(run_path=lambda *a,**k:calls.append('serve'))\ndef lock(*a):\n if sys.argv[2]=='busy': raise BlockingIOError()\nsys.modules['fcntl']=types.SimpleNamespace(flock=lock,LOCK_EX=1,LOCK_NB=2)\ntry: exec(source)\nexcept SystemExit as e: assert e.code==0\nprint(json.dumps(calls))`;
 expect(JSON.parse(execFileSync('python3',['-c',probe,JSON.stringify(launcher),'free'],{encoding:'utf8'}))).toEqual(['serve']);
 expect(JSON.parse(execFileSync('python3',['-c',probe,JSON.stringify(launcher),'busy'],{encoding:'utf8'}))).toEqual([]);
});

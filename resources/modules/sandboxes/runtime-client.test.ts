import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeClient, RuntimeUnavailableError } from './runtime-client.js';
import type { SandboxConnector } from './connector.js';

describe('Runtime transport recovery', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('can repeat a partial preparation without launching a process', async () => {
    const execute = vi.fn().mockResolvedValue({exit_code:0});
    const write = vi.fn().mockRejectedValueOnce(new Error('upload interrupted')).mockResolvedValue(undefined);
    const client = new RuntimeClient({execute,write} as unknown as SandboxConnector,'sandbox','token');
    await expect(client.prepare()).rejects.toThrow('upload interrupted');
    await client.prepare();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every(call => call[2] === undefined)).toBe(true);
    expect(write).toHaveBeenCalledTimes(5);
  });
  it('reconciles a lost upload response using exact bytes without resending or launching', async()=>{
    const files=new Map<string,Uint8Array>();
    const execute=vi.fn().mockResolvedValue({exit_code:0});
    const write=vi.fn(async(_id:string,path:string,bytes:Uint8Array)=>{files.set(path,bytes);if(path.endsWith('server.py'))throw new TypeError('response lost');});
    const read=vi.fn(async(_id:string,path:string)=>files.get(path)!);
    await new RuntimeClient({execute,write,read} as unknown as SandboxConnector,'sandbox','token').prepare();
    expect(write).toHaveBeenCalledTimes(4);expect(read).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]![2]).toBeUndefined();
  });
  it('does not upload or launch after a rejected directory preparation', async () => {
    const write = vi.fn();
    const client = new RuntimeClient({execute:async()=>({exit_code:1}),write} as unknown as SandboxConnector,'sandbox','token');
    await expect(client.bootstrap()).rejects.toThrow('runtime_prepare_failed');
    expect(write).not.toHaveBeenCalled();
  });
  it('releases request-scoped tunnels only after consuming the body and reacquires for the next request', async () => {
    const releases = [vi.fn(), vi.fn()];
    const preview = vi.fn().mockResolvedValueOnce({url:'http://localhost:1234',headers:{},release:releases[0]})
      .mockResolvedValueOnce({url:'http://localhost:5678',headers:{},release:releases[1]});
    let finish!: () => void;
    const body = new ReadableStream({start(controller) { finish=()=>{controller.enqueue(new TextEncoder().encode('{"state":"ready","protocol":1}'));controller.close();}; }});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(body)).mockResolvedValueOnce(new Response('{}',{status:409})));
    const client=new RuntimeClient({preview} as unknown as SandboxConnector,'sandbox','token');
    const pending=client.request('GET','/health');
    await vi.waitFor(()=>expect(preview).toHaveBeenCalledTimes(1));
    expect(releases[0]).not.toHaveBeenCalled();
    finish();expect(await pending).toEqual({state:'ready',protocol:1});expect(releases[0]).toHaveBeenCalledTimes(1);
    await expect(client.request('POST','/runs',{})).rejects.toThrow('runtime_request_failed_409');
    expect(preview).toHaveBeenCalledTimes(2);expect(releases[1]).toHaveBeenCalledTimes(1);
  });
  it('pins the internal listener instead of inheriting the provider PORT', async () => {
    const files = new Map<string,string>();
    const connector = {
      execute: async () => ({stdout:'',stderr:'',exit_code:0}),
      write: async (_id:string,path:string,bytes:Uint8Array) => { files.set(path,Buffer.from(bytes).toString()); },
      preview: async () => ({url:'https://runtime.example',headers:{}}),
    } as unknown as SandboxConnector;
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"state":"ready","protocol":1}')));
    await new RuntimeClient(connector,'sandbox','fixture').bootstrap();
    const launcher = files.get('/tmp/hexagon-runtime/launch.py')!;
    expect(launcher.indexOf("os.environ['PORT'] = '8765'")).toBeGreaterThan(-1);
    expect(launcher.indexOf("os.environ['PORT'] = '8765'")).toBeLessThan(launcher.indexOf('runpy.run_path'));
  });
  it('retries the identical Run submission after a lost response and caches its private target', async () => {
    const preview = vi.fn(async () => ({ url: 'https://runtime.example', headers: { 'private-token': 'fixture' } }));
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValue(new Response('{"state":"running"}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const client = new RuntimeClient({ preview } as unknown as SandboxConnector, 'sandbox', 'runtime-token');
    expect(await client.request('POST', '/runs', { id: 'same-run', command: ['fixture'] })).toEqual({ state: 'running' });
    expect(fetch.mock.calls[0]![1].body).toBe(fetch.mock.calls[1]![1].body);
    expect(preview).toHaveBeenCalledTimes(1);
  });
  it('classifies a failed private endpoint as uncertain, without including upstream details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sensitive upstream detail', { status: 502 })));
    const client = new RuntimeClient({ preview: async () => ({ url: 'https://runtime.example', headers: {} }) } as unknown as SandboxConnector, 'sandbox', 'runtime-token');
    await expect(client.request('GET', '/health')).rejects.toBeInstanceOf(RuntimeUnavailableError);
    await expect(client.request('GET', '/health')).rejects.toThrow('runtime_unreachable');
  });
  it('does not retry an explicit conflict', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 409 }));
    vi.stubGlobal('fetch', fetch);
    const client = new RuntimeClient({ preview: async () => ({ url: 'https://runtime.example', headers: {} }) } as unknown as SandboxConnector, 'sandbox', 'runtime-token');
    await expect(client.request('POST', '/runs', {})).rejects.toThrow('runtime_request_failed_409');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses the private health path and rejects a provider-edge success response', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const client = new RuntimeClient({ preview: async () => ({ url: 'https://runtime.example', headers: {} }) } as unknown as SandboxConnector, 'sandbox', 'runtime-token');
    await expect(client.request('GET', '/health')).rejects.toBeInstanceOf(RuntimeUnavailableError);
    expect(fetch.mock.calls[0]![0]).toBe('https://runtime.example/_hexagon/health');
  });
});

it.each(['free','held','invalid'])('reconciles a %s daemon lock without blind launch retries',async lock=>{
 const execute=vi.fn().mockResolvedValue({exit_code:0,stdout:lock});
 const client=new RuntimeClient({execute} as unknown as SandboxConnector,'sandbox','token');
 vi.spyOn(client,'request').mockRejectedValue(new RuntimeUnavailableError());
 const start=vi.spyOn(client,'start').mockResolvedValue(undefined);
 if(lock==='free'){await client.reconcileStart();expect(start).toHaveBeenCalledTimes(1);}else{await expect(client.reconcileStart()).rejects.toBeInstanceOf(RuntimeUnavailableError);expect(start).not.toHaveBeenCalled();}
 expect(execute.mock.calls[0]![1]).toContain('LOCK_EX|fcntl.LOCK_NB');expect(execute.mock.calls[0]![2]).toBeUndefined();
});
it('does not inspect or relaunch a healthy daemon after a lost startup response',async()=>{
 const execute=vi.fn();const client=new RuntimeClient({execute} as unknown as SandboxConnector,'sandbox','token');
 vi.spyOn(client,'request').mockResolvedValue({state:'ready',protocol:1});const start=vi.spyOn(client,'start');
 await client.reconcileStart();expect(execute).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled();
});

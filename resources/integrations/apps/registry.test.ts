import {afterEach,expect,it,vi} from 'vitest';
import {applications,applicationCatalog,applicationConfig,applicationOperations,applicationRequest,AppRequestError} from './registry.js';
import {executeTool} from '../../modules/tools/adapters.js';
import {ToolAuthenticationError,validToolArguments} from '../tools/http-json.js';
import {github,linear} from './collaboration.js';
import {exa} from './search.js';
import {deepl,notion,todoist} from './productivity.js';
// @ts-expect-error Browser catalog is intentionally plain JS.
import {catalogs} from '../../apps/console/i18n.js';
afterEach(()=>vi.unstubAllGlobals());
it.each([null,{issueCreate:{success:true,issue:{id:'created-issue'}}}])('preserves uncertainty for Linear mutations with GraphQL errors and data %j',async data=>{
 const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({data,errors:[{message:'resolver failed'}]})));
 vi.stubGlobal('fetch',fetch);
 await expect(executeTool('linear',{operations:['create_issue']},'private-key','create_issue',{team_id:'team',title:'Task'},'call')).rejects.toThrow('app_remote_outcome_unknown');
 expect(fetch).toHaveBeenCalledTimes(1);
 await expect(executeTool('linear',{operations:['list_teams']},'private-key','list_teams',{},'read')).rejects.toBeInstanceOf(AppRequestError);
 await expect(applicationRequest(linear,'private-key',linear.verify({}),{write:false})).rejects.toBeInstanceOf(AppRequestError);
});
it('validates all catalog schemas, localizes operations, and requires approval for all writes',()=>{
 expect(applications).toHaveLength(37);
 for(const app of applications){
  const config=app.id==='salesforce'?{instance_url:'https://acme.my.salesforce.com'}:{};
  const defaults=applicationOperations(app,config);
  for(const [name,op] of Object.entries(app.operations)){
   expect(catalogs.en[`app.operation.${name}`]).toBeTruthy();expect(catalogs['zh-CN'][`app.operation.${name}`]).toBeTruthy();
   expect(Object.hasOwn(defaults,name)).toBe(!op.write);
   const selected=applicationOperations(app,{...config,operations:[name]})[name]!;expect(selected.approval).toBe(op.write);
   expect(selected.replay).toBe('never');
  }
  expect(applicationConfig(app).safeParse({operations:['not_an_operation']}).success).toBe(false);
 }
 expect(JSON.stringify(applicationCatalog())).not.toContain('client_secret');
});
it('uses migrated DeepL mapping and official Exa contents shape without exposing credentials',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({translations:[{text:'Hello'}]})));vi.stubGlobal('fetch',fetch);
 expect(await executeTool('deepl',{},'private-key','translate_text',{text:'\u4f60\u597d',target_lang:'EN-US'},'call')).toEqual({translations:[{text:'Hello'}]});
 const [url,options]=fetch.mock.calls[0]!;expect(String(url)).toBe('https://api-free.deepl.com/v2/translate');expect(options.headers.Authorization).toBe('DeepL-Auth-Key private-key');expect(JSON.parse(options.body)).toEqual({text:['\u4f60\u597d'],target_lang:'EN-US'});expect(options.redirect).toBe('error');
 expect(exa.operations.contents!.request({urls:['https://example.com']},{}).body).toEqual({ids:['https://example.com'],highlights:true});
 expect(deepl.verify({region:'paid'}).url).toBe('https://api.deepl.com/v2/usage');
});
it('bounds rich text and rejects unsaved operations before any request',async()=>{
 expect(validToolArguments(notion.operations.create_page!.input_schema,{parent_page_id:'page',title:'a'.repeat(2001)})).toBe(false);
 vi.stubGlobal('fetch',vi.fn());await expect(executeTool('todoist',{operations:['list_tasks']},'key','create_task',{content:'hello'},'id')).rejects.toThrow('tool_operation_unavailable');expect(fetch).not.toHaveBeenCalled();
 const update=todoist.operations.update_task!.request({task_id:'abc',content:'new'},{});expect(update.body).toEqual({content:'new'});
});
it('distinguishes authentication, rejection and unknown effects; never follows redirects or retries',async()=>{
 const request=github.verify({});
 for(const [status,type] of [[401,ToolAuthenticationError],[403,AppRequestError],[429,AppRequestError],[503,Error]] as const){const fetch=vi.fn().mockResolvedValue(new Response('{}',{status}));vi.stubGlobal('fetch',fetch);await expect(applicationRequest(github,'key',request)).rejects.toBeInstanceOf(type);expect(fetch).toHaveBeenCalledTimes(1);}
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({echo:'private-key'}))));expect(await applicationRequest(github,'private-key',request)).toEqual({echo:'[REDACTED]'});
});

// Request mappings adapted from Activepieces community Todoist/DeepL actions (MIT).
// Source snapshots and license: third_party/activepieces/.
import {type AppDefinition,operation,string,id,page,encode} from './types.js';
const todo='https://api.todoist.com/api/v1';
export const todoist:AppDefinition={id:'todoist',name:'Todoist',category:'tasks',credential_url:'https://app.todoist.com/app/settings/integrations/developer',
 verify:()=>({url:`${todo}/user`,method:'GET'}),identity:b=>b.email||b.full_name,
 oauth:{authorize:'https://app.todoist.com/oauth/authorize',token:'https://api.todoist.com/oauth/access_token',issuer:'https://todoist.com',pkce:false,client_auth:'post',scopes:['data:read_write']},
 operations:{
  list_projects:operation('List accessible Todoist projects.',false,{cursor:string},[],a=>({url:`${todo}/projects`,method:'GET',query:a})),
  list_tasks:operation('List tasks, optionally within one project. Follow next_cursor for more results.',false,{project_id:id,cursor:string,limit:page},[],a=>({url:`${todo}/tasks`,method:'GET',query:a})),
  get_task:operation('Read one task.',false,{task_id:id},['task_id'],a=>({url:`${todo}/tasks/${encode(a.task_id)}`,method:'GET'})),
  create_task:operation('Create a Todoist task; without project_id it goes to Inbox.',true,{content:string,description:string,project_id:id,due_date:string,due_string:string,priority:{type:'integer',minimum:1,maximum:4},labels:{type:'array',items:string,maxItems:30}},['content'],a=>({url:`${todo}/tasks`,method:'POST',body:a})),
  update_task:operation('Update a task title, description, priority or due date.',true,{task_id:id,content:string,description:string,due_date:string,priority:{type:'integer',minimum:1,maximum:4}},['task_id'],({task_id,...body})=>({url:`${todo}/tasks/${encode(task_id)}`,method:'POST',body})),
  complete_task:operation('Complete a task.',true,{task_id:id},['task_id'],a=>({url:`${todo}/tasks/${encode(a.task_id)}/close`,method:'POST'})),
 }};
export const deepl:AppDefinition={id:'deepl',name:'DeepL',category:'knowledge',credential_url:'https://www.deepl.com/account/summary',authHeader:token=>({Authorization:`DeepL-Auth-Key ${token}`}),
 verify:c=>({url:`https://${c.region==='paid'?'api':'api-free'}.deepl.com/v2/usage`,method:'GET'}),
 operations:{translate_text:operation('Translate plain text with DeepL; target_lang is a language code such as EN-US or ZH.',false,{text:string,target_lang:string,source_lang:string,formality:{type:'string',enum:['default','more','less','prefer_more','prefer_less']}},['text','target_lang'],(a,c)=>({url:`https://${c.region==='paid'?'api':'api-free'}.deepl.com/v2/translate`,method:'POST',body:{...a,text:[a.text]}}))}};
const notionBase='https://api.notion.com/v1';
const rich=(text:string)=>[{type:'text',text:{content:text}}];
export const notion:AppDefinition={id:'notion',name:'Notion',category:'knowledge',credential_url:'https://www.notion.so/profile/integrations',headers:{'Notion-Version':'2025-09-03'},
 verify:()=>({url:`${notionBase}/users/me`,method:'GET'}),identity:b=>b.bot?.workspace_name||b.name,
 oauth:{authorize:'https://api.notion.com/v1/oauth/authorize',token:`${notionBase}/oauth/token`,issuer:'https://api.notion.com',pkce:false,client_auth:'basic',scopes:[],params:{owner:'user'},json:true},
 operations:{
  search:operation('Search accessible Notion pages by title. Results are limited to granted content.',false,{query:string,start_cursor:string,page_size:page},[],a=>({url:`${notionBase}/search`,method:'POST',body:a})),
  read_page:operation('Read page properties. Use read_blocks for page content.',false,{page_id:id},['page_id'],a=>({url:`${notionBase}/pages/${encode(a.page_id)}`,method:'GET'})),
  read_blocks:operation('Read direct child blocks; follow child IDs and pagination for complete content.',false,{block_id:id,start_cursor:string,page_size:page},['block_id'],({block_id,...query})=>({url:`${notionBase}/blocks/${encode(block_id)}/children`,method:'GET',query})),
  read_comments:operation('Read accessible comments attached to a page or block; requires comment-read capability.',false,{block_id:id,start_cursor:string,page_size:page},['block_id'],a=>({url:`${notionBase}/comments`,method:'GET',query:a})),
  create_page:operation('Create a child page with a title and plain text paragraph.',true,{parent_page_id:id,title:{...string,maxLength:2000},text:{...string,maxLength:2000}},['parent_page_id','title'],a=>({url:`${notionBase}/pages`,method:'POST',body:{parent:{page_id:a.parent_page_id},properties:{title:{type:'title',title:rich(a.title)}},...(a.text?{children:[{object:'block',type:'paragraph',paragraph:{rich_text:rich(a.text)}}]}:{})}})),
  append_text:operation('Append a paragraph to an existing page.',true,{page_id:id,text:{...string,maxLength:2000}},['page_id','text'],a=>({url:`${notionBase}/blocks/${encode(a.page_id)}/children`,method:'PATCH',body:{children:[{object:'block',type:'paragraph',paragraph:{rich_text:rich(a.text)}}]}})),
  update_paragraph:operation('Replace the text of a paragraph block.',true,{block_id:id,text:{...string,maxLength:2000}},['block_id','text'],a=>({url:`${notionBase}/blocks/${encode(a.block_id)}`,method:'PATCH',body:{paragraph:{rich_text:rich(a.text)}}})),
  add_comment:operation('Add a comment to a page.',true,{page_id:id,text:{...string,maxLength:2000}},['page_id','text'],a=>({url:`${notionBase}/comments`,method:'POST',body:{parent:{page_id:a.page_id},rich_text:rich(a.text)}})),
 }};

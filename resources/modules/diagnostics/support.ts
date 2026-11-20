/** Public-support projection: never serialize arbitrary health fields or error messages. */
export function supportDiagnostics(health:any,host:{platform:string;arch:string;node:string}){
 const state=(value:unknown,allowed:string[])=>typeof value==='string'&&allowed.includes(value)?value:'unknown';
 return {format:1,created_at:new Date().toISOString(),host:{platform:host.platform,arch:host.arch,node:host.node},
  reachable:health!=null,
  api:state(health?.api,['ready','unavailable']),database:state(health?.database,['ready','unavailable']),
  credentials:state(health?.credentials?.state,['ready','unavailable']),
  execution:{state:state(health?.execution?.state,['running','stopped','unavailable']),busy:health?.execution?.busy===true},
  credential_access:state(health?.credential_access?.state,['reachable','unreachable','disabled','starting','unavailable']),
  active_runs:health?.active_runs===true};
}

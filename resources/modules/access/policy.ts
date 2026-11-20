import ipaddr from 'ipaddr.js';
import { z } from 'zod';
export const endpointInput=z.string().url().refine(value=>{
  const url=new URL(value);
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(ipaddr.isValid(host)&&ipaddr.process(host).range()!=='unicast')return false;
  return url.protocol==='https:' && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port==='443');
},'public_https_endpoint_required');
const path=z.string().min(1).max(1024).regex(/^\/[A-Za-z0-9_./~-]*$/).refine(v=>!v.includes('..')&&!v.includes('//'),'canonical_path_required');
export const httpConnectionConfig=z.object({
  endpoint:endpointInput,
  authentication:z.discriminatedUnion('type',[
    z.object({type:z.literal('bearer')}).strict(),
    z.object({type:z.literal('header'),name:z.string().regex(/^[a-zA-Z0-9-]+$/).refine(v=>!['host','connection','content-length','transfer-encoding','cookie','proxy-authorization'].includes(v.toLowerCase()))}).strict(),
  ]),
  access:z.object({rules:z.array(z.object({methods:z.array(z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD'])).min(1),path}).strict()).min(1).max(32)}).strict(),
}).strict();
export function permits(config:z.infer<typeof httpConnectionConfig>,method:string,rawPath:string) {
  const p=rawPath.split('?')[0]!;
  return path.safeParse(p).success && config.access.rules.some(rule=>rule.path===p&&rule.methods.includes(method as any));
}

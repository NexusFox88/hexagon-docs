import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {FastifyRequest} from 'fastify';
const loopback=(host:string)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(host);
/** Local browser bootstrap is enabled only on an explicitly loopback-bound server. */
export class LocalAccess {
  private token=randomBytes(32).toString('base64url');
  constructor(readonly dataDirectory:string){}
  private target(request:FastifyRequest){
    if(!loopback(request.raw.socket.remoteAddress??''))return null;
    try{const url=new URL(`http://${request.headers.host}`);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||Number(url.port||80)!==request.raw.socket.localPort)return null;return url.origin;}catch{return null;}
  }
  bootstrap(request:FastifyRequest){
    const origin=this.target(request);
    if(!origin||request.headers.origin!==origin||request.headers['x-hexagon-local']!=='1'||request.headers['sec-fetch-site']!=='same-origin')return null;
    return {mode:'local',token:this.token,data_directory:this.dataDirectory};
  }
  authenticate(request:FastifyRequest){
    if(!this.target(request))return null;
    const supplied=Buffer.from(request.headers.authorization?.replace(/^Bearer /,'')??''),expected=Buffer.from(this.token);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return null;
    return {tenant_id:'local-workspace',role:'owner',id:'local-browser'};
  }
}

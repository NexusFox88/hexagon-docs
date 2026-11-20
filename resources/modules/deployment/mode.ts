import {SecretCipher} from '../credentials/secret-store.js';
/** Hosted startup is explicit; it never generates development owner files or keys. */
export function deploymentMode(env:NodeJS.ProcessEnv){
 const mode=env.HEXAGON_DEPLOYMENT_MODE??'local';
 if(!['local','hosted'].includes(mode))throw new Error('invalid_deployment_mode');
 if(mode==='local')return {mode:'local' as const};
 if(!env.DATABASE_URL||!env.HEXAGON_MASTER_KEY||!env.HEXAGON_BOOTSTRAP_TOKEN)throw new Error('hosted_identity_and_storage_required');
 const key=Buffer.from(env.HEXAGON_MASTER_KEY,'base64');
 if(key.length!==32||key.toString('base64')!==env.HEXAGON_MASTER_KEY)throw new Error('hosted_master_key_invalid');
 let origin:URL;try{origin=new URL(env.HEXAGON_ACCESS_URL!);}catch{throw new Error('hosted_https_ingress_required');}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||env.HEXAGON_ACCESS_TUNNEL)throw new Error('hosted_https_ingress_required');
 return {mode:'hosted' as const,cipher:new SecretCipher(key),token:env.HEXAGON_BOOTSTRAP_TOKEN};
}

export interface LocalOptions {dataDirectory?:string;baseUrl?:string}
export async function localIdentity(options:LocalOptions={}){
  const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
  const configured=options.dataDirectory??process.env.HEXAGON_DATA_DIR;
  let file:string|undefined;
  if(configured)file=path.join(path.resolve(configured),'connection.json');
  else {
    let current=process.cwd();
    for(;;){const candidate=path.join(current,'.local','control-plane','connection.json');try{await fs.access(candidate);file=candidate;break;}catch{}const parent=path.dirname(current);if(parent===current)break;current=parent;}
    file??=process.env.HEXAGON_LOCAL_DISCOVERY_FILE??path.join(os.homedir(),'.hexagon','local.json');
  }
  async function privateJson(location:string){
    const handle=await fs.open(location,'r');try{const stat=await handle.stat();if(!stat.isFile()||(process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid?.())))throw Error('local_identity_permissions');return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
  }
  let descriptor;try{descriptor=await privateJson(file);}catch{throw Error('local_workspace_not_found_or_unreadable: start Hexagon locally or set dataDirectory');}
  const url=new URL(descriptor.base_url);
  if(descriptor.version!==1||url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('local_endpoint_required');
  if(options.baseUrl){const expected=new URL(options.baseUrl);if(expected.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(expected.hostname)||expected.port!==url.port||expected.username||expected.password||expected.pathname!=='/'||expected.search||expected.hash)throw Error('local_workspace_endpoint_mismatch');}
  const identity=await privateJson(path.join(descriptor.data_directory,'owner.json'));
  if(identity.tenant!=='local-workspace'||typeof identity.token!=='string'||!identity.token)throw Error('invalid_local_identity');
  return {base:url.origin,token:identity.token};
}

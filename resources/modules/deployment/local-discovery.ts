import {mkdir,writeFile,rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export async function publishLocalDiscovery(dataDirectory:string,baseUrl:string){
  const descriptor={version:1,base_url:baseUrl,data_directory:dataDirectory};
  const locations=[join(dataDirectory,'connection.json'),process.env.HEXAGON_LOCAL_DISCOVERY_FILE??join(homedir(),'.hexagon','local.json')];
  for(const target of locations){await mkdir(dirname(target),{recursive:true,mode:0o700});const temp=`${target}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(descriptor),{mode:0o600,flag:'wx'});await rename(temp,target);}
}

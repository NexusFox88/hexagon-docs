import {Agent,EnvHttpProxyAgent,setGlobalDispatcher} from 'undici';
/** Use the installed Undici parser consistently, including mixed NO_PROXY lists.
 * Node's bundled fetch proxy parser differs across supported Node releases.
 */
export function configureOutboundProxy(env:NodeJS.ProcessEnv){
 const dispatcher=env.NODE_USE_ENV_PROXY==='0'?new Agent():new EnvHttpProxyAgent({
  httpProxy:env.HTTP_PROXY??env.http_proxy??'',httpsProxy:env.HTTPS_PROXY??env.https_proxy??env.HTTP_PROXY??env.http_proxy??'',
  noProxy:env.NO_PROXY??env.no_proxy??'127.0.0.1,localhost,::1',
 });
 setGlobalDispatcher(dispatcher);return dispatcher;
}

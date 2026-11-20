export type JsonSchema = Record<string, unknown>;
export interface RequestSpec { url:string; method:string; headers?:Record<string,string>; body?:unknown; query?:Record<string,unknown> }
export interface AppOperation {
  description:string; input_schema:JsonSchema; write:boolean; scopes?:string[];
  request(args:Record<string,any>,config:Record<string,any>):RequestSpec;
}
export interface AppDefinition {
  id:string; name:string; category:'knowledge'|'tasks'|'search'|'communication'|'calendar'|'development'|'crm';
  credential_url:string; operations:Record<string,AppOperation>;
  credential_fields?:{name:string;label_key:string}[];
  accessToken?:(credential:string)=>Promise<string>;
  authenticate?:(credential:string,request:RequestSpec)=>RequestSpec;
  authHeader?:(token:string)=>Record<string,string>;
  headers?:Record<string,string>;
  verify(config:Record<string,any>):RequestSpec;
  permissionProbe?:(operation:string,config:Record<string,any>)=>RequestSpec|undefined;
  permissionResult?:(operation:string,body:any)=>boolean;
  grantedScopes?:(body:any)=>string[]|undefined;
  verificationActive?:(body:any)=>boolean;
  identity?:(body:any)=>string|undefined;
  oauth?:{authorize:string;token:string;issuer:string;pkce:boolean;client_auth:'basic'|'post';scopes:string[];scope_separator?:string;params?:Record<string,string>;json?:boolean};
}
export const string = {type:'string',minLength:1,maxLength:20000};
export const id = {type:'string',minLength:1,maxLength:512,pattern:'^(?!\\.{1,2}$).+'};
export const object = (properties:Record<string,unknown>, required:string[]=[]) => ({type:'object',properties,required,additionalProperties:false});
export const page = {type:'integer',minimum:1,maximum:100};
export const encode = (value:unknown)=>encodeURIComponent(String(value));
export const operation=(description:string,write:boolean,properties:Record<string,unknown>,required:string[],request:AppOperation['request'],scopes?:string[]):AppOperation=>({description,write,input_schema:object(properties,required),request,scopes});

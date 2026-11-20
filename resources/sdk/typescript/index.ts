export interface SessionPreflight {
  ready: boolean;
  readiness: {status: 'ready'; checked_at: string};
  combination: {
    schema_version: 1;
    requirements: {sandbox_capabilities: string[]; tool_capabilities: string[][]};
    compatibility: {status: 'supported' | 'unsupported'; reasons: string[]};
    capabilities: string[];
    verification: {status: 'unverified'; evidence: string[]};
  };
  lifecycle: {mode: string; preservation: string; automatic_wake: boolean; idle_timeout_seconds: number};
  connections: Record<string, {implementation: string; raw_secret_in_sandbox: boolean; delegated_token_in_sandbox: boolean}>;
}
export interface AgentBehavior {identity?:{name:string;role?:string;description?:string};instructions?:string;context?:{text?:string;files?:Array<{path:string;sha256:string}>;documents?:Array<{name:string;text:string}>}}
/** An immutable OCI registration; tags resolve to a verified manifest digest. */
export interface HarnessImageInput {
 image:string; id?:string; name?:string; version?:string;
 protocol?:'hexagon-json-v1'|'opencode-v1'|'pi-v1'|'aider-v1'|'claude-code-v1'|'deepseek-v1'|'codex-v1'|'hermes-v1'|'openclaw-v1';
 command?:string[]; capabilities?:('conversation'|'tools'|'initialization')[]; registry_secret_id?:string;
}
/** Ordinary configuration, readable by Sandbox code. Never use for managed secrets. */
export type AgentEnvironment = Record<string, string>;
export interface AgentInput extends AgentBehavior {
  bindings?:Pick<SessionInput,'sandbox_connection_id'|'model_connection_id'|'tools'|'connections'>;
  name: string; harness: { id: string; version: string }; env?: AgentEnvironment; variables?: AgentEnvironment;
  required_capabilities?: string[]; tools?: { name: string; required_at_start?: boolean }[];
  resources?: { timeout_seconds?: number; idle_timeout_seconds?:number }; network?: { mode?: 'unrestricted' | 'allowlist'; allowed_hosts?: string[] };
}
export interface SessionInput extends AgentBehavior {
  agent_revision?:number;
  agent_id?: string; harness?: {id:string;version:string}; name?:string;
  resources?:{timeout_seconds?:number;idle_timeout_seconds?:number}; network?:{mode?:'unrestricted'|'allowlist';allowed_hosts?:string[]};
  required_capabilities?:string[]; optional_tools?:string[];
  sandbox_connection_id: string; model_connection_id: string;
  connections?: Record<string,string>; tools?: Record<string, string>; env?: AgentEnvironment; variables?: AgentEnvironment;
}
export interface Artifact { id: string; session_id: string; run_id: string; name: string; sha256: string; size: number; created_at: string }
export interface RunOrigin {message_id?:string;request_id?:string;channel?:string}
export interface Run {
  origin?:RunOrigin;execution_identity?:{tenant_id:string;session_id:string;agent_id:string|null;agent_revision:number|null;principal?:{key_id?:string;role?:string}};
  id: string; session_id: string; state: string;
  output: { role: 'assistant'; text: string; artifacts?: Artifact[] } | null;
  error: { code: string } | null;
}
export interface RunEvent { id?: string; type: string; data: unknown }
/** Effective configuration pinned at Session creation. Contains no environment or credential values. */
export interface SessionInitialization {
  schema_version:1; session_id:string; created_at:string;
  source:{kind:'agent'|'direct';agent_id:string|null;agent_revision:number|null};
  definition:{name:string;harness:{id:string;version:string};harness_image?:Record<string,unknown>;
    connections:Array<{id:string;name?:string;kind:string;provider:string;version:number;account?:string;config:Record<string,unknown>}>;
    tool_bindings:Record<string,string>;protected_api_bindings:Record<string,string>;
    resources:Record<string,unknown>;network:Record<string,unknown>;[key:string]:unknown};
  environment:{names:string[];values_redacted:true};
}
export class HexagonError extends Error {
  constructor(public status: number, public code: string) { super(`Hexagon request failed: ${code} (${status})`); }
}

export class Hexagon {
  /** Trusted local process: discover the workspace without manually supplying a token. */
  static async local(options:import('./local.js').LocalOptions={}) { const {localIdentity}=await import('./local.js');const identity=await localIdentity(options);return new Hexagon(identity.base,identity.token); }
  private base: string;
  constructor(base: string, private token: string) { this.base = base.replace(/\/+$/, ''); }
  async request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.base}/v1${path}`, { method, redirect:'error', headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new HexagonError(response.status, data.error?.code ?? 'http_error');
    }
    return response.status === 204 ? undefined as T : response.json();
  }
  createPreview(session: string, port: number, ttlSeconds = 600) { return this.request('POST', `/sessions/${encodeURIComponent(session)}/previews`, { port, ttl_seconds: ttlSeconds }); }
  revokePreview(id: string) { return this.request('DELETE', `/previews/${encodeURIComponent(id)}`); }
  registerHarness(input: HarnessImageInput) { return this.request('POST', '/harnesses', input); }
  /** Legacy source package compatibility for existing callers. */
  registerHarnessPackage(input: unknown) { return this.request('POST', '/harness-packages', input); }
  applications() { return this.request('GET','/applications'); }
  configureApplicationOAuth(provider:string,input:{client_id:string;client_secret:string;redirect_uri:string}) { return this.request('PUT',`/applications/${encodeURIComponent(provider)}/oauth-client`,input); }
  authorizeConnection(id:string) { return this.request('POST',`/connections/${encodeURIComponent(id)}/authorize`); }
  authorizationFlow(id:string) { return this.request('GET',`/authorization-flows/${encodeURIComponent(id)}`); }
  cancelAuthorization(id:string) { return this.request('DELETE',`/authorization-flows/${encodeURIComponent(id)}`); }
  overview() { return this.request('GET','/overview'); }
  listSessions(query:{limit?:number;offset?:number;search?:string;state?:string}={}) { return this.request('GET','/sessions?'+new URLSearchParams(Object.entries(query).map(([key,value])=>[key,String(value)]))); }
  listRuns(query:{limit?:number;offset?:number;search?:string;state?:string}={}) { return this.request('GET','/runs?'+new URLSearchParams(Object.entries(query).map(([key,value])=>[key,String(value)]))); }
  pending(limit=25,offset=0) { return this.request('GET',`/pending?limit=${limit}&offset=${offset}`); }
  approvals(run:string) { return this.request('GET',`/runs/${encodeURIComponent(run)}/approvals`); }
  connectionDependencies(id:string) { return this.request('GET',`/connections/${encodeURIComponent(id)}/dependencies`); }
  listTokens() { return this.request('GET','/tokens'); }
  createToken(label:string,expiresInDays=30) { return this.request('POST','/tokens',{label,expires_in_days:expiresInDays}); }
  rotateToken(id:string) { return this.request('POST',`/tokens/${encodeURIComponent(id)}/rotate`); }
  revokeToken(id:string) { return this.request('DELETE',`/tokens/${encodeURIComponent(id)}`); }
  deployment() { return this.request('GET','/deployment'); }
  updateDeployment(config:unknown,expectedRevision:string) { return this.request('PUT','/deployment',{config,expected_revision:expectedRevision}); }
  retryIngress() { return this.request('POST','/deployment/ingress/retry'); }
  resourceOperations(limit=50,offset=0) { return this.request('GET',`/resource-operations?limit=${limit}&offset=${offset}`); }
  resourceOperation(id:string) { return this.request('GET',`/resource-operations/${encodeURIComponent(id)}`); }
  reviewResourceOperation(id:string,action:'acknowledge'|'reopen'|'reconcile',note='') { return this.request('POST',`/resource-operations/${encodeURIComponent(id)}/review`,{action,note}); }
  catalog() { return this.request('GET', '/catalog'); }
  createSecret(input: {name:string;value:string}) { return this.request('POST','/secrets',input); }
  sessionEnvironment(id:string) {return this.request('GET',`/sessions/${encodeURIComponent(id)}/environment`);}
  sessionAuthorization(id:string) {return this.request('GET',`/sessions/${encodeURIComponent(id)}/authorization`);}
  revokeSessionConnection(id:string,connection:string) {return this.request('DELETE',`/sessions/${encodeURIComponent(id)}/connections/${encodeURIComponent(connection)}`);}
  listSecrets() { return this.request('GET','/secrets'); }
  secret(id:string) { return this.request('GET',`/secrets/${encodeURIComponent(id)}`); }
  updateSecret(id:string,input:{name?:string;value?:string;enabled?:boolean}) { return this.request('PATCH',`/secrets/${encodeURIComponent(id)}`,input); }
  deleteSecret(id:string) { return this.request('DELETE',`/secrets/${encodeURIComponent(id)}`); }
  preflightSession(input:SessionInput) { return this.request<SessionPreflight>('POST','/sessions/preflight',input); }
  createAccess(session:string,connectionId:string) { return this.request('POST',`/sessions/${encodeURIComponent(session)}/access`,{connection_id:connectionId}); }
  listAccess(session:string) { return this.request('GET',`/sessions/${encodeURIComponent(session)}/access`); }
  revokeAccess(id:string) { return this.request('DELETE',`/access/${encodeURIComponent(id)}`); }
  listConnections() {return this.request('GET','/connections');}
  connection(id:string) {return this.request('GET',`/connections/${encodeURIComponent(id)}`);}
  createConnection(input: unknown) { return this.request('POST', '/connections', input); }
  discoverMcpTools(id:string) {return this.request('POST',`/connections/${encodeURIComponent(id)}/discover-mcp`);}
  connectionAuthorization(id:string) { return this.request('GET',`/connections/${encodeURIComponent(id)}/authorization`); }
  disconnectConnection(id:string) { return this.request('POST',`/connections/${encodeURIComponent(id)}/disconnect`); }
  validateConnection(id: string) { return this.request('POST', `/connections/${encodeURIComponent(id)}/validate`); }
  updateConnection(id: string, input: unknown) { return this.request('PATCH', `/connections/${encodeURIComponent(id)}`, input); }
  deleteConnection(id: string) { return this.request('DELETE', `/connections/${encodeURIComponent(id)}`); }
  listAgents() { return this.request('GET','/agents'); }
  agent(id:string) { return this.request('GET',`/agents/${encodeURIComponent(id)}`); }
  reviseAgent(id:string,definition:AgentInput,expectedRevision:number) { return this.request('PUT',`/agents/${encodeURIComponent(id)}`,{definition,expected_revision:expectedRevision}); }
  archiveAgent(id:string) { return this.request('POST',`/agents/${encodeURIComponent(id)}/archive`); }
  copyAgent(id:string,name:string) { return this.request('POST',`/agents/${encodeURIComponent(id)}/copy`,{name}); }
  preflightAgent(definition:AgentInput,bindings:Omit<SessionInput,'agent_id'>) { return this.request<SessionPreflight>('POST','/agents/preflight',{definition,bindings}); }
  createAgent(input: AgentInput) { return this.request('POST', '/agents', input); }
  createSession(input: SessionInput) { return this.request('POST', '/sessions', input); }
  sessionInitialization(id:string) {return this.request<SessionInitialization>('GET',`/sessions/${encodeURIComponent(id)}/initialization`);}
  session(id: string) { return this.request('GET', `/sessions/${encodeURIComponent(id)}`); }
  upload(session: string, files: { path: string; content_base64: string }[]) { return this.request('POST', `/sessions/${encodeURIComponent(session)}/files`, { files }); }
  submit(session: string, input: string, idempotencyKey: string, origin?:RunOrigin) { return this.request<Run>('POST', `/sessions/${encodeURIComponent(session)}/runs`, { input,...(origin?{origin}:{}) }, { 'idempotency-key': idempotencyKey }); }
  run(id: string) { return this.request<Run>('GET', `/runs/${encodeURIComponent(id)}`); }
  toolCalls(run: string) { return this.request('GET', `/runs/${encodeURIComponent(run)}/tool-calls`); }
  denyToolAuthorization(run: string, call: string, requestHash: string) { return this.request('POST', `/runs/${encodeURIComponent(run)}/tool-calls/${encodeURIComponent(call)}/deny-authorization`, { request_hash: requestHash }); }
  resolveToolCall(run: string, call: string, resolution: { request_hash: string; outcome: 'completed' | 'failed'; text: string; evidence: string }) { return this.request('POST', `/runs/${encodeURIComponent(run)}/tool-calls/${encodeURIComponent(call)}/resolve`, resolution); }
  cancel(id: string) { return this.request<Run>('POST', `/runs/${encodeURIComponent(id)}/cancel`); }
  pause(session:string,scope:'session'|'sandbox'='session') {return this.request('POST',`/sessions/${encodeURIComponent(session)}/pause`,{scope});}
  resume(session:string) {return this.request('POST',`/sessions/${encodeURIComponent(session)}/resume`);}
  sessionActivity(period:'24h'|'7d'='24h') {return this.request('GET','/sessions/activity?period='+period);}
  close(session: string) { return this.request('POST', `/sessions/${encodeURIComponent(session)}/close`); }
  decide(approval: string, approved: boolean) { return this.request('POST', `/approvals/${encodeURIComponent(approval)}/decision`, { approved }); }
  events(run: string, after = '0') { return this.request<{ events: RunEvent[] }>('GET', `/runs/${encodeURIComponent(run)}/events?after=${encodeURIComponent(after)}`); }
  artifacts(run: string) { return this.request<{ artifacts: Artifact[] }>('GET', `/runs/${encodeURIComponent(run)}/artifacts`); }
  async downloadArtifact(id: string): Promise<Uint8Array> {
    const response = await fetch(`${this.base}/v1/artifacts/${encodeURIComponent(id)}/content`, { headers: { authorization: `Bearer ${this.token}` } });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new HexagonError(response.status, error.error?.code ?? 'artifact_download_failed');
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  /** Reconnect with the last yielded id; reconnecting never submits another Run. */
  async *stream(run: string, after = '0', signal?: AbortSignal): AsyncGenerator<RunEvent> {
    const response = await fetch(`${this.base}/v1/runs/${encodeURIComponent(run)}/stream?after=${encodeURIComponent(after)}`, { headers: { authorization: `Bearer ${this.token}`, accept: 'text/event-stream' }, signal });
    if (!response.ok) throw new HexagonError(response.status, 'event_stream_failed');
    if (!response.body) throw new Error('Event stream body missing');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let end: number;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          const block = pending.slice(0, end); pending = pending.slice(end + 2);
          const lines = block.split('\n');
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim() ?? 'message';
          const id = lines.find(line => line.startsWith('id:'))?.slice(3).trim();
          yield { ...(id ? { id } : {}), type, data: JSON.parse(data) };
          if (type === 'stream.end') return;
        }
        if (done) {
          if (pending.trim()) throw new Error('Truncated event stream; reconnect from the last event id');
          throw new Error('Event stream disconnected before terminal event; reconnect from the last event id');
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

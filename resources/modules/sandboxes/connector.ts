/** A provider-confirmed refusal: no resource or operation was accepted. */
export class SandboxCreationRejected extends Error {
  readonly code = 'sandbox_quota_exceeded';
  constructor() { super('sandbox_quota_exceeded'); }
}
/** Safe local prerequisite code; never includes subprocess output. */
export class SandboxPrerequisiteError extends Error {
  readonly code = 'sandbox_openssh_unavailable';
  constructor() { super('sandbox_openssh_unavailable'); }
}
/** Provider account credentials never cross this control-plane boundary. */
export interface SandboxRequest {
  prepared_image?: string;
  image?: {reference:string;user?:string;registry_credential?:{username:string;password:string}};
  operation_id: string;
  /** Persist a provider-accepted handle before asynchronous polling; never a retry instruction. */
  record?: (resourceId:string, providerOperationId:string)=>Promise<void>;
  session_id: string;
  timeout_seconds: number;
  network: { mode: 'unrestricted' | 'allowlist'; allowed_hosts: string[] };
}
export interface SandboxResource { id: string; state: string; expires_at?: string; memory_mb?: number; expiry_enforcement?: 'control_plane'; checkpoint?: string }
/** A request-scoped tunnel must be released after the response body settles. */
export interface SandboxHttpTarget {
  url: string;
  headers: Record<string, string>;
  release?: () => void;
}
/** Durable provider deletion handle, recorded before polling asynchronous cleanup. */
export interface SandboxDeletion {
  provider_operation_id?: string;
  record(providerOperationId: string): Promise<void>;
}
/** Only delegated proxy grants, never original upstream keys. Persist intent before applying. */
export interface NativeCredentialAccess { base_url: string; token: string }
export interface SandboxCheckpoint {
  operation_id: string;
  record(imageId:string):Promise<void>;
}
export interface PreparedSandboxImage { id: string; build_id: string }
export interface SandboxImagePreparation {
  operation_id: string;
  image: NonNullable<SandboxRequest['image']>;
  record(handle: PreparedSandboxImage): Promise<void>;
}
export interface SandboxConnector {
  prepareImage?(request: SandboxImagePreparation): Promise<PreparedSandboxImage>;
  inspectImage?(handle: PreparedSandboxImage): Promise<'building' | 'ready' | 'failed'>;
  findImageByOperation?(operation: string): Promise<PreparedSandboxImage | undefined>;
  deleteImage?(handle: PreparedSandboxImage): Promise<void>;
  /** Idle suspension preserves workspace; filesystem-only providers require Runtime restart. */
  readonly resumeMode?: 'memory' | 'filesystem';
  /** Durable guest directory when /tmp is cleared on cold boot. */
  readonly persistentWorkspaceRoot?: string;
  pause?(id:string):Promise<void>;
  resume?(id:string,timeoutSeconds?:number):Promise<void>;
  /** Provider-specific fenced convergence of an uncertain wake; never creates replacement compute. */
  reconcileResume?(id:string,timeoutSeconds?:number):Promise<void>;
  snapshot?(id:string,context?:SandboxCheckpoint):Promise<string>;
  restore?(checkpoint:string,request:SandboxRequest):Promise<SandboxResource>;
  deleteSnapshot?(checkpoint:string):Promise<void>;
  preflight?(): Promise<void>;
  configureCredentialAccess?(id:string, network:SandboxRequest['network'], bindings:NativeCredentialAccess[]):Promise<void>;
  reconcileDeletion?(id: string, context: SandboxDeletion): Promise<void>;
  /** Persistent providers require the control plane to enforce and reconcile expiry. */
  readonly expiry?: 'control_plane';
  create(request: SandboxRequest): Promise<SandboxResource>;
  findByOperation(operation: string): Promise<SandboxResource[]>;
  inspect(id: string): Promise<SandboxResource | null>;
  destroy(id: string): Promise<void>;
  /** Reconcile provider-owned endpoints even after compute has expired or disappeared. */
  cleanupAssociatedResources?(id: string): Promise<void>;
  execute(id: string, command: string, options?: { timeout_seconds?: number; background?: boolean }): Promise<{ stdout: string; stderr: string; exit_code: number | null; pid?: number }>;
  write(id: string, path: string, bytes: Uint8Array): Promise<void>;
  read(id: string, path: string): Promise<Uint8Array>;
  /** Internal proxy target; headers must not be exposed by public API. */
  preview(id: string, port: number): Promise<SandboxHttpTarget>;
}

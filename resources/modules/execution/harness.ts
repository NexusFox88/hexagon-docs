import type {HarnessInitialization} from './initialization.js';
import type {HarnessImages} from '../harnesses/images.js';
import type { HarnessPackages } from './harness-packages.js';
import type { SandboxConnector } from '../sandboxes/connector.js';
import { ExecutionError } from './runs.js';

export interface HarnessDefinition {
  image?: {reference:string;digest:string;platform:string;user?:string;registry_secret_id?:string};
  id: string; version: string; capabilities: string[]; model_providers: string[];
}
export type RuntimeTools = { token: string; definitions: Array<{ name: string; binding: string; operation: string; description: string; inputSchema: Record<string, unknown> }> };
export interface HarnessInvocation {
  id: string;
  command: string[];
  env: Record<string, string>;
  stdin?: string;
  tools?: RuntimeTools;
}
export interface HarnessAdapter {
  definition: HarnessDefinition;
  install(connector: SandboxConnector, sandbox: string): Promise<void>;
  invocation(id: string, input: string, model: { base_url: string; model: string; credential: string; provider?: string }, nativeSession?: string, tools?: RuntimeTools, initialization?:HarnessInitialization): HarnessInvocation;
  result(stdout: string): { text: string; native_session?: string; failed: boolean };
}

/** One registry supplies both the advertised catalog and the executable adapters. */
export class HarnessRegistry {
  private readonly adapters = new Map<string, HarnessAdapter>();
  constructor(adapters: HarnessAdapter[], private packages?: HarnessPackages, private images?:HarnessImages) {
    for (const adapter of adapters) {
      const key = this.key(adapter.definition);
      if (this.adapters.has(key)) throw new Error('duplicate_harness_version');
      this.adapters.set(key, adapter);
    }
  }
  private key(reference: { id: string; version: string }) { return JSON.stringify([reference.id, reference.version]); }
  catalog() { return [...this.adapters.values()].map(adapter => structuredClone(adapter.definition)); }
  async catalogForTenant(tenant: string) { return [...this.catalog(), ...await this.packages?.catalog(tenant) || [], ...await this.images?.catalog(tenant)||[]]; }
  async resolveForTenant(tenant: string, reference: { id: string; version: string }) {
    const image=await this.images?.resolveForTenant(tenant,reference);if(image)return image;
    if (reference.id.startsWith('custom.') && this.packages) return this.packages.resolve(tenant, reference);
    return this.resolve(reference);
  }
  resolve(reference: { id: string; version: string }) {
    const adapter = this.adapters.get(this.key(reference));
    if (!adapter) throw new ExecutionError('unsupported_harness', 400);
    return adapter;
  }
}

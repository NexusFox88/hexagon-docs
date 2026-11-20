import type { HarnessDefinition } from './harness.js';

export interface CombinationInput {
  harness: HarnessDefinition;
  sandboxCapabilities: readonly string[];
  modelProvider: string;
  toolCapabilities: readonly (readonly string[])[];
  requiredCapabilities: readonly string[];
  initialization: boolean;
  network: { mode: string; allowed_hosts: string[] };
  credentialHost: string;
}

/** Structural compatibility is not evidence of a successful provider allocation or cloud test. */
export function resolveCombination(input: CombinationInput) {
  const { harness, sandboxCapabilities: sandbox, toolCapabilities: tools } = input;
  const reasons: string[] = [];
  if (!harness.model_providers.includes(input.modelProvider)) reasons.push('incompatible_model');
  if (tools.length && !harness.capabilities.includes('tools')) reasons.push('harness_tools_unsupported');
  if (harness.image && !sandbox.includes('oci_image')) reasons.push('sandbox_oci_image_unsupported');
  if (harness.image?.registry_secret_id && !sandbox.includes('private_oci_image')) reasons.push('sandbox_private_image_unsupported');
  if (input.initialization && !harness.capabilities.includes('initialization')) reasons.push('harness_initialization_unsupported');
  // Ownership is explicit: an arbitrary adapter cannot grant another layer's capability.
  const capabilities = new Set([
    ...sandbox.filter(capability => !['tools', 'initialization', 'conversation', 'approval'].includes(capability)),
    ...harness.capabilities.filter(capability => ['tools', 'initialization', 'conversation'].includes(capability)),
  ]);
  if (harness.capabilities.includes('tools') && tools.length && tools.every(value => value.includes('approval'))) capabilities.add('approval');
  if (input.requiredCapabilities.some(capability => !capabilities.has(capability))) reasons.push('missing_capability');
  if (input.network.mode === 'allowlist') {
    if (!sandbox.includes('network_allowlist')) reasons.push('network_policy_unsupported');
    if (!input.network.allowed_hosts.includes(input.credentialHost)) reasons.push('credential_proxy_not_allowed_by_network_policy');
  }
  return {
    schema_version: 1 as const,
    requirements: {
      sandbox_capabilities: [...sandbox],
      tool_capabilities: tools.map(value => [...value]),
    },
    compatibility: { status: reasons.length ? 'unsupported' as const : 'supported' as const, reasons },
    capabilities: [...capabilities].sort(),
    // Historical matrix entries must not certify newly changed contracts.
    verification: { status: 'unverified' as const, evidence: [] as string[] },
  };
}

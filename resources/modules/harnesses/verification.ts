import type {HarnessVerification} from './catalog.js';
/** Exact, scoped observations; historical records retain their own evidence. */
export const verifiedHarnessCombinations:HarnessVerification[] = [
  {
    "image": "docker.io/nousresearch/hermes-agent@sha256:2fd023efbb8d3d2b0ce1a73d028b07370cff34f567cfe0e999553e8c327ea283",
    "protocol": "hermes-v1",
    "command": [
      "/opt/hermes/.venv/bin/hermes"
    ],
    "sandbox_provider": "modal",
    "model_provider": "openai-compatible",
    "model": "deepseek-ai/DeepSeek-V4-Flash",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-harness-delivery.md"
  },
  {
    "image": "ghcr.io/anomalyco/opencode@sha256:763ea3bce6bdaee6d6092775c83c03a90b11b2a74dcfb89942a4cb82a99f974e",
    "protocol": "opencode-v1",
    "command": [
      "opencode"
    ],
    "sandbox_provider": "modal",
    "model_provider": "anthropic-compatible",
    "model": "deepseek-ai/DeepSeek-V4-Flash",
    "clients": [
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-oci-harness.md"
  },
  {
    "image": "docker.io/paulgauthier/aider@sha256:764924922f1f9a47e1185ebaa72e6435027af657deaff3febf0f20a176403c1e",
    "protocol": "aider-v1",
    "command": [
      "/venv/bin/aider"
    ],
    "sandbox_provider": "modal",
    "model_provider": "anthropic-compatible",
    "model": "deepseek-ai/DeepSeek-V4-Flash",
    "clients": [
      "typescript"
    ],
    "scenarios": [
      "single-turn",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-oci-harness.md"
  },
  {
    "image": "ghcr.io/stuffbucket/ai-cli-codex@sha256:73ca8ee424a9ee4a23cbce99482ab94321cb23366d9c93dcad56098f84cf54e1",
    "protocol": "codex-v1",
    "command": [
      "codex"
    ],
    "sandbox_provider": "fly-machines",
    "model_provider": "openai-responses",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "docker.io/nousresearch/hermes-agent@sha256:2fd023efbb8d3d2b0ce1a73d028b07370cff34f567cfe0e999553e8c327ea283",
    "protocol": "hermes-v1",
    "command": [
      "/opt/hermes/.venv/bin/hermes"
    ],
    "sandbox_provider": "fly-machines",
    "model_provider": "openai-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/openclaw/openclaw@sha256:97781490d6cd01cec8d1f0ad300ff8bedfaae18ec5b8c30666aaebc470a6309f",
    "protocol": "openclaw-v1",
    "command": [
      "node",
      "/app/openclaw.mjs"
    ],
    "sandbox_provider": "fly-machines",
    "model_provider": "anthropic-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/openclaw/openclaw@sha256:97781490d6cd01cec8d1f0ad300ff8bedfaae18ec5b8c30666aaebc470a6309f",
    "protocol": "openclaw-v1",
    "command": [
      "node",
      "/app/openclaw.mjs"
    ],
    "sandbox_provider": "fly-machines",
    "model_provider": "openai-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/openclaw/openclaw@sha256:97781490d6cd01cec8d1f0ad300ff8bedfaae18ec5b8c30666aaebc470a6309f",
    "protocol": "openclaw-v1",
    "command": [
      "node",
      "/app/openclaw.mjs"
    ],
    "sandbox_provider": "fly-machines",
    "model_provider": "openai-responses",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/anomalyco/opencode@sha256:763ea3bce6bdaee6d6092775c83c03a90b11b2a74dcfb89942a4cb82a99f974e",
    "protocol": "opencode-v1",
    "command": [
      "opencode"
    ],
    "sandbox_provider": "fly-machines",
    "model_provider": "anthropic-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/anomalyco/opencode@sha256:763ea3bce6bdaee6d6092775c83c03a90b11b2a74dcfb89942a4cb82a99f974e",
    "protocol": "opencode-v1",
    "command": [
      "opencode"
    ],
    "sandbox_provider": "fly-machines",
    "model_provider": "openai-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/anomalyco/opencode@sha256:763ea3bce6bdaee6d6092775c83c03a90b11b2a74dcfb89942a4cb82a99f974e",
    "protocol": "opencode-v1",
    "command": [
      "opencode"
    ],
    "sandbox_provider": "fly-machines",
    "model_provider": "openai-responses",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "docker.io/paulgauthier/aider@sha256:764924922f1f9a47e1185ebaa72e6435027af657deaff3febf0f20a176403c1e",
    "protocol": "aider-v1",
    "command": [
      "/venv/bin/aider"
    ],
    "sandbox_provider": "fly-machines",
    "model_provider": "anthropic-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "single-turn",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/stuffbucket/ai-cli-codex@sha256:73ca8ee424a9ee4a23cbce99482ab94321cb23366d9c93dcad56098f84cf54e1",
    "protocol": "codex-v1",
    "command": [
      "codex"
    ],
    "sandbox_provider": "modal",
    "model_provider": "openai-responses",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "docker.io/nousresearch/hermes-agent@sha256:2fd023efbb8d3d2b0ce1a73d028b07370cff34f567cfe0e999553e8c327ea283",
    "protocol": "hermes-v1",
    "command": [
      "/opt/hermes/.venv/bin/hermes"
    ],
    "sandbox_provider": "modal",
    "model_provider": "openai-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/openclaw/openclaw@sha256:97781490d6cd01cec8d1f0ad300ff8bedfaae18ec5b8c30666aaebc470a6309f",
    "protocol": "openclaw-v1",
    "command": [
      "node",
      "/app/openclaw.mjs"
    ],
    "sandbox_provider": "modal",
    "model_provider": "anthropic-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/openclaw/openclaw@sha256:97781490d6cd01cec8d1f0ad300ff8bedfaae18ec5b8c30666aaebc470a6309f",
    "protocol": "openclaw-v1",
    "command": [
      "node",
      "/app/openclaw.mjs"
    ],
    "sandbox_provider": "modal",
    "model_provider": "openai-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/openclaw/openclaw@sha256:97781490d6cd01cec8d1f0ad300ff8bedfaae18ec5b8c30666aaebc470a6309f",
    "protocol": "openclaw-v1",
    "command": [
      "node",
      "/app/openclaw.mjs"
    ],
    "sandbox_provider": "modal",
    "model_provider": "openai-responses",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/anomalyco/opencode@sha256:763ea3bce6bdaee6d6092775c83c03a90b11b2a74dcfb89942a4cb82a99f974e",
    "protocol": "opencode-v1",
    "command": [
      "opencode"
    ],
    "sandbox_provider": "modal",
    "model_provider": "anthropic-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/anomalyco/opencode@sha256:763ea3bce6bdaee6d6092775c83c03a90b11b2a74dcfb89942a4cb82a99f974e",
    "protocol": "opencode-v1",
    "command": [
      "opencode"
    ],
    "sandbox_provider": "modal",
    "model_provider": "openai-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "ghcr.io/anomalyco/opencode@sha256:763ea3bce6bdaee6d6092775c83c03a90b11b2a74dcfb89942a4cb82a99f974e",
    "protocol": "opencode-v1",
    "command": [
      "opencode"
    ],
    "sandbox_provider": "modal",
    "model_provider": "openai-responses",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "native-continuation",
      "remote-tool",
      "environment",
      "artifacts",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  },
  {
    "image": "docker.io/paulgauthier/aider@sha256:764924922f1f9a47e1185ebaa72e6435027af657deaff3febf0f20a176403c1e",
    "protocol": "aider-v1",
    "command": [
      "/venv/bin/aider"
    ],
    "sandbox_provider": "modal",
    "model_provider": "anthropic-compatible",
    "model": "MiniMax-M3",
    "clients": [
      "python",
      "typescript"
    ],
    "scenarios": [
      "single-turn",
      "cleanup"
    ],
    "checked_at": "2026-11-18",
    "evidence": "testing/evidence/2026-11-18-minimax-matrix.md"
  }
];

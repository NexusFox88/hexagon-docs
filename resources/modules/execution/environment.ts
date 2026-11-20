import { z } from 'zod';

/** Platform adapters own these names. User env applies to agent processes, never the control plane. */
export const environmentInput = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/).refine(name => !/^(HEXAGON_|OPENCODE_|PI_)/.test(name) && !['PORT', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME', 'LD_PRELOAD', 'LD_LIBRARY_PATH'].includes(name), 'reserved_environment_name'),
  z.string().max(16384).refine(value => !value.includes('\0'), 'invalid_environment_value'),
).superRefine((env, context) => {
  if (Object.keys(env).length > 64 || Buffer.byteLength(JSON.stringify(env)) > 65536) context.addIssue({ code: z.ZodIssueCode.custom, message: 'environment_too_large' });
});

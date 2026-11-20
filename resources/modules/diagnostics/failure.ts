/** Deliberately excludes messages, bodies, URLs and arbitrary provider codes. */
export function failureDiagnostic(error: unknown): { category: string; status?: number; code?: string } {
  const value = error as { name?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const categories = ['Error', 'TypeError', 'TimeoutError', 'AbortError', 'SandboxError', 'NotFoundError', 'ConnectError'];
  const category = typeof value?.name === 'string' && categories.includes(value.name) ? value.name : 'provider_error';
  const status = value?.status ?? value?.statusCode;
  const code = value?.code ?? value?.cause?.code;
  return { category, ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}), ...(typeof code === 'string' && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) ? { code } : {}) };
}

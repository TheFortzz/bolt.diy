/**
 * @cline/agents 0.0.90's bundled Worker entry imports these gateway helpers
 * even when the host provides a prebuilt AgentModel. The published browser
 * entry omits them, so Vite aliases this module only to satisfy those unused
 * provider-ID paths. Bolt supplies its own prebuilt model adapter.
 */
export function createGateway() {
  throw new Error('Bolt supplies a prebuilt provider model to the Cline Agent.');
}

export function classifyProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/context.?length|context window|maximum context/i.test(message)) return 'context_window_exceeded';
  if (/unauthorized|forbidden|invalid api.?key|\b401\b|\b403\b/i.test(message)) return 'auth';
  return 'unknown';
}

export function isRetryableProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /rate.?limit|\b429\b|\b5\d\d\b|network|fetch failed|timeout|temporarily unavailable/i.test(message);
}

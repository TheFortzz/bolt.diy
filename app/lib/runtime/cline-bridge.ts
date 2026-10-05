export interface ClineAgentRequest {
  prompt: string;
  files: Record<string, string>;
  readOnly?: boolean;
  planningOnly?: boolean;
  approvedBlueprint?: unknown;
  executionToken?: string;
  systemContext?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  previewErrors?: Array<{ message: string; source?: string; line?: number }>;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ClineAgentEvent {
  type: string;
  payload?: any;
}

/** Run the Cline SDK agent in Bolt's own API route. */
export async function runClineAgent(
  request: ClineAgentRequest,
  options: {
    signal?: AbortSignal;
    onEvent: (event: ClineAgentEvent) => void;
  },
) {
  const response = await fetch('/api/cline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(result?.error || `Bolt Cline API returned HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error('Bolt Cline API returned an empty stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let resultEvent: ClineAgentEvent | undefined;

  while (true) {
    if (options.signal?.aborted) throw new DOMException('Cline run cancelled.', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;

      const event = JSON.parse(raw) as ClineAgentEvent;
      options.onEvent(event);
      if (event.type === 'fatal_error') {
        throw new Error(event.payload?.error || 'Cline Agent failed.');
      }
      if (event.type === 'result') resultEvent = event;
    }
  }

  if (!resultEvent) throw new Error('Cline Agent stream ended without a result.');
  return resultEvent;
}

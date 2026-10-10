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

function actionableClineError(message: string) {
  if (/\b429\b|rate.?limit|quota exceeded/i.test(message)) {
    return `${message}\n\nThe selected provider is rate-limited. Choose another configured provider/model above or retry after its quota resets.`;
  }
  return message;
}

function consumeSseChunk(
  chunk: string,
  onEvent: (event: ClineAgentEvent) => void,
  state: { resultEvent?: ClineAgentEvent },
) {
  for (const line of chunk.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const raw = trimmed.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;

    let event: ClineAgentEvent;

    try {
      event = JSON.parse(raw) as ClineAgentEvent;
    } catch {
      throw new Error('Cline Agent stream returned malformed JSON.');
    }

    onEvent(event);

    if (event.type === 'fatal_error') {
      throw new Error(actionableClineError(event.payload?.error || 'Cline Agent failed.'));
    }

    if (event.type === 'result') {
      state.resultEvent = event;
    }
  }
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
    throw new Error(actionableClineError(result?.error || `Bolt Cline API returned HTTP ${response.status}.`));
  }
  if (!response.body) throw new Error('Bolt Cline API returned an empty stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const state: { resultEvent?: ClineAgentEvent } = {};
  let sawAnyEvent = false;

  const onEvent = (event: ClineAgentEvent) => {
    sawAnyEvent = true;
    options.onEvent(event);
  };

  while (true) {
    if (options.signal?.aborted) throw new DOMException('Cline run cancelled.', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    consumeSseChunk(lines.join('\n'), onEvent, state);
  }

  // Flush a trailing SSE frame that arrived without a final newline.
  buffer += decoder.decode();
  if (buffer.trim()) {
    consumeSseChunk(buffer, onEvent, state);
  }

  if (!state.resultEvent) {
    if (!sawAnyEvent) {
      throw new Error('Cline Agent stream ended without a result (empty stream).');
    }

    throw new Error('Cline Agent stream ended without a result.');
  }

  return state.resultEvent;
}

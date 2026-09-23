import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
} from 'ai';

type LanguageModelV1FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown';

export const FORTZ_RESPONSES_URL =
  'https://fortz-ai-resource.services.ai.azure.com/api/projects/fortz-ai/openai/v1/responses';

/** Deployment id Azure expects (display name can differ). */
export const FORTZ_DEPLOYMENT_MODEL = 'gpt-4.1-mini';

function extractTextContent(content: LanguageModelV1Prompt[number]['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }

      if ('text' in part && typeof (part as { text?: string }).text === 'string') {
        return (part as { text: string }).text;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function convertPrompt(prompt: LanguageModelV1Prompt): {
  instructions?: string;
  input: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> | string;
} {
  const instructionsParts: string[] = [];
  const input: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

  for (const message of prompt) {
    const text = extractTextContent(message.content).trim();

    if (!text) {
      continue;
    }

    if (message.role === 'system') {
      instructionsParts.push(text);
      continue;
    }

    if (message.role === 'user' || message.role === 'assistant') {
      input.push({ role: message.role, content: text });
    }
  }

  return {
    instructions: instructionsParts.length > 0 ? instructionsParts.join('\n\n') : undefined,
    input: input.length === 1 && input[0].role === 'user' ? input[0].content : input,
  };
}

function extractCompletedText(payload: any): string {
  if (!payload) {
    return '';
  }

  if (typeof payload.output_text === 'string') {
    return payload.output_text;
  }

  const chunks: string[] = [];

  for (const item of payload.output || []) {
    if (item?.type !== 'message') {
      continue;
    }

    for (const part of item.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('');
}

export function createAzureResponsesModel(apiKey: string, modelId: string = FORTZ_DEPLOYMENT_MODEL): LanguageModelV1 {
  const resolvedModel = !modelId || modelId === 'fortz-ai' || modelId === 'gpt-6-luna' || modelId === 'gpt-oss-120b'
    ? FORTZ_DEPLOYMENT_MODEL
    : modelId;

  return {
    specificationVersion: 'v1',
    provider: 'fortz.azure-responses',
    modelId: resolvedModel,
    defaultObjectGenerationMode: undefined,

    async doGenerate(options: LanguageModelV1CallOptions) {
      const { instructions, input } = convertPrompt(options.prompt);
      const body: Record<string, unknown> = {
        model: resolvedModel,
        input,
        stream: false,
      };

      if (instructions) {
        body.instructions = instructions;
      }

      if (typeof options.maxTokens === 'number') {
        body.max_output_tokens = options.maxTokens;
      }

      if (typeof options.temperature === 'number') {
        body.temperature = options.temperature;
      }

      const response = await fetch(FORTZ_RESPONSES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      });

      const rawText = await response.text();
      let json: any = null;

      try {
        json = rawText ? JSON.parse(rawText) : null;
      } catch {
        json = null;
      }

      if (!response.ok) {
        const message = json?.error?.message || json?.message || rawText || `Azure Responses error (${response.status})`;
        throw new Error(message);
      }

      const text = extractCompletedText(json);

      return {
        text,
        finishReason: 'stop' as const,
        usage: {
          promptTokens: json?.usage?.input_tokens ?? 0,
          completionTokens: json?.usage?.output_tokens ?? 0,
        },
        rawCall: { rawPrompt: body, rawSettings: {} },
        rawResponse: {
          headers: Object.fromEntries(response.headers.entries()),
        },
      };
    },

    async doStream(options: LanguageModelV1CallOptions) {
      const { instructions, input } = convertPrompt(options.prompt);
      const body: Record<string, unknown> = {
        model: resolvedModel,
        input,
        stream: true,
      };

      if (instructions) {
        body.instructions = instructions;
      }

      if (typeof options.maxTokens === 'number') {
        body.max_output_tokens = options.maxTokens;
      }

      if (typeof options.temperature === 'number') {
        body.temperature = options.temperature;
      }

      const response = await fetch(FORTZ_RESPONSES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      });

      if (!response.ok || !response.body) {
        const rawText = await response.text().catch(() => '');
        let message = rawText || `Azure Responses stream error (${response.status})`;

        try {
          const parsed = JSON.parse(rawText);
          message = parsed?.error?.message || parsed?.message || message;
        } catch {
          // keep message
        }

        throw new Error(message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finishReason: LanguageModelV1FinishReason = 'stop';
      let usage = { promptTokens: 0, completionTokens: 0 };

      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          const enqueue = (part: LanguageModelV1StreamPart) => controller.enqueue(part);

          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const chunks = buffer.split('\n');
              buffer = chunks.pop() || '';

              for (const line of chunks) {
                const trimmed = line.trim();

                if (!trimmed || trimmed.startsWith('event:')) {
                  continue;
                }

                if (!trimmed.startsWith('data:')) {
                  continue;
                }

                const data = trimmed.slice(5).trim();

                if (!data || data === '[DONE]') {
                  continue;
                }

                let event: any;

                try {
                  event = JSON.parse(data);
                } catch {
                  continue;
                }

                if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') {
                  enqueue({ type: 'text-delta', textDelta: event.delta });
                } else if (event?.type === 'response.completed') {
                  usage = {
                    promptTokens: event?.response?.usage?.input_tokens ?? usage.promptTokens,
                    completionTokens: event?.response?.usage?.output_tokens ?? usage.completionTokens,
                  };

                  if (event?.response?.status === 'incomplete') {
                    finishReason = 'length';
                  }
                } else if (event?.type === 'response.failed' || event?.type === 'error') {
                  finishReason = 'error';
                  const message = event?.error?.message || event?.message || 'Azure Responses stream failed';
                  enqueue({ type: 'error', error: new Error(message) } as any);
                }
              }
            }

            enqueue({
              type: 'finish',
              finishReason,
              usage,
            });
            controller.close();
          } catch (error) {
            controller.error(error);
          } finally {
            try {
              reader.releaseLock();
            } catch {
              // ignore
            }
          }
        },
        cancel() {
          try {
            reader.cancel();
          } catch {
            // ignore
          }
        },
      });

      return {
        stream,
        rawCall: { rawPrompt: body, rawSettings: {} },
        rawResponse: {
          headers: Object.fromEntries(response.headers.entries()),
        },
      };
    },
  };
}

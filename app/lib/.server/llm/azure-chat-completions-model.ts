import type { LanguageModelV1, LanguageModelV1CallOptions, LanguageModelV1Prompt, LanguageModelV1StreamPart } from 'ai';
import { imageDataUrl } from '~/lib/.server/llm/azure-responses-model';

type FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown';
type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ChatContentPart[] };

function convertMessageContent(content: LanguageModelV1Prompt[number]['content']): string | ChatContentPart[] {
  if (typeof content === 'string') {
    return content;
  }

  const parts: ChatContentPart[] = [];

  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    if ('text' in part && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
      continue;
    }

    if ('image' in part) {
      const url = imageDataUrl(part as unknown as Record<string, unknown>);

      if (url) {
        parts.push({ type: 'image_url', image_url: { url } });
      }
    }
  }

  if (!parts.some((part) => part.type === 'image_url')) {
    return parts
      .filter((part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
  }

  return parts;
}

function convertPrompt(prompt: LanguageModelV1Prompt): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const message of prompt) {
    const content = convertMessageContent(message.content);
    const hasContent = typeof content === 'string' ? Boolean(content.trim()) : content.length > 0;

    if (!hasContent) {
      continue;
    }

    if (message.role === 'system') {
      const systemContent =
        typeof content === 'string'
          ? content
          : content
              .filter((part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text')
              .map((part) => part.text)
              .join('\n');

      if (systemContent.trim()) {
        messages.push({ role: 'system', content: systemContent });
      }

      continue;
    }

    if (message.role === 'user' || message.role === 'assistant') {
      messages.push({ role: message.role, content });
    }
  }

  return messages;
}

function resolveFinishReason(reason: unknown): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content-filter';
    case 'tool_calls':
    case 'function_call':
      return 'tool-calls';
    default:
      return 'other';
  }
}

function outputText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

function getError(response: Response, body: string, apiName: string) {
  let parsed: any;

  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }

  const message = parsed?.error?.message || parsed?.message || body || `Azure ${apiName} error (${response.status})`;
  const requestId = response.headers.get('apim-request-id') || response.headers.get('x-ms-request-id');
  const requestLabel = requestId ? ` (request ID ${requestId})` : '';

  return new Error(`Azure ${apiName} API HTTP ${response.status}${requestLabel}: ${message}`);
}

function createRequestBody(options: LanguageModelV1CallOptions, modelId: string, stream: boolean) {
  const body: Record<string, unknown> = {
    model: modelId,
    messages: convertPrompt(options.prompt),
    stream,
    max_completion_tokens:
      typeof options.maxTokens === 'number' && Number.isFinite(options.maxTokens)
        ? Math.max(1, Math.floor(options.maxTokens))
        : 32768,
  };

  if (/^gpt-6(?:-|$)/i.test(modelId)) {
    // Avoid GPT-6's default medium reasoning effort for this latency-sensitive studio workflow.
    body.reasoning_effort = 'low';
  } else {
    body.temperature = typeof options.temperature === 'number' ? options.temperature : 0.85;
  }

  return body;
}

export function createAzureChatCompletionsModel(
  apiKey: string,
  modelId: string,
  chatCompletionsUrl: string,
): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'fortz.azure-chat-completions',
    modelId,
    defaultObjectGenerationMode: undefined,

    async doGenerate(options: LanguageModelV1CallOptions) {
      const body = createRequestBody(options, modelId, false);
      const response = await fetch(chatCompletionsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      });
      const rawText = await response.text();

      if (!response.ok) {
        throw getError(response, rawText, 'Chat Completions');
      }

      let json: any = null;

      try {
        json = rawText ? JSON.parse(rawText) : null;
      } catch {
        json = null;
      }

      const choice = json?.choices?.[0];

      return {
        text: outputText(choice?.message?.content),
        finishReason: resolveFinishReason(choice?.finish_reason),
        usage: {
          promptTokens: json?.usage?.prompt_tokens ?? 0,
          completionTokens: json?.usage?.completion_tokens ?? 0,
        },
        rawCall: { rawPrompt: body, rawSettings: {} },
        rawResponse: { headers: Object.fromEntries(response.headers.entries()) },
      };
    },

    async doStream(options: LanguageModelV1CallOptions) {
      const body = createRequestBody(options, modelId, true);
      const response = await fetch(chatCompletionsUrl, {
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
        throw getError(response, await response.text().catch(() => ''), 'Chat Completions');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finishReason: FinishReason = 'stop';
      let usage = { promptTokens: 0, completionTokens: 0 };

      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          const parseEvent = (line: string) => {
            const trimmed = line.trim();

            if (!trimmed.startsWith('data:')) {
              return;
            }

            const data = trimmed.slice(5).trim();

            if (!data || data === '[DONE]') {
              return;
            }

            let event: any;

            try {
              event = JSON.parse(data);
            } catch {
              return;
            }

            if (event?.error) {
              finishReason = 'error';
              controller.enqueue({
                type: 'error',
                error: new Error(event.error.message || 'Azure Chat Completions stream failed'),
              } as any);
              return;
            }

            const choice = event?.choices?.[0];
            const delta = choice?.delta?.content;

            if (typeof delta === 'string' && delta) {
              controller.enqueue({ type: 'text-delta', textDelta: delta });
            } else if (Array.isArray(delta)) {
              for (const part of delta) {
                if (part?.type === 'text' && typeof part.text === 'string' && part.text) {
                  controller.enqueue({ type: 'text-delta', textDelta: part.text });
                }
              }
            }

            if (choice?.finish_reason) {
              finishReason = resolveFinishReason(choice.finish_reason);
            }

            if (event?.usage) {
              usage = {
                promptTokens: event.usage.prompt_tokens ?? usage.promptTokens,
                completionTokens: event.usage.completion_tokens ?? usage.completionTokens,
              };
            }
          };

          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                parseEvent(line);
              }
            }

            buffer += decoder.decode();

            if (buffer.trim()) {
              parseEvent(buffer);
            }

            controller.enqueue({ type: 'finish', finishReason, usage });
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
          void reader.cancel().catch(() => undefined);
        },
      });

      return {
        stream,
        rawCall: { rawPrompt: body, rawSettings: {} },
        rawResponse: { headers: Object.fromEntries(response.headers.entries()) },
      };
    },
  };
}

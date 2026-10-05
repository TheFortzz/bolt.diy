import type { LanguageModelV1, LanguageModelV1CallOptions, LanguageModelV1Prompt, LanguageModelV1StreamPart } from 'ai';
import { imageDataUrl } from '~/lib/.server/llm/azure-responses-model';

type FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown';
type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type ChatMessage =
  | { role: 'system' | 'user'; content: string | ChatContentPart[] }
  | {
      role: 'assistant';
      content: string | ChatContentPart[] | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; content: string; tool_call_id: string };

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
    if (message.role === 'tool') {
      for (const result of message.content) {
        messages.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
        });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const textParts = message.content.filter((part) => part.type === 'text');
      const toolCalls = message.content
        .filter((part) => part.type === 'tool-call')
        .map((part) => ({
          id: part.toolCallId,
          type: 'function' as const,
          function: { name: part.toolName, arguments: JSON.stringify(part.args ?? {}) },
        }));
      const textContent = textParts.map((part) => part.text).join('\n');
      const content: string | null = textContent || (toolCalls.length ? null : '');
      messages.push({ role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }

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

    if (message.role === 'user') {
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
    const hasFunctionTools = options.mode?.type === 'regular' &&
      options.mode.tools?.some((tool) => tool.type === 'function');
    // Azure's Chat Completions endpoint rejects tool calls with non-none
    // reasoning_effort. Keep fast reasoning for plain chat, disable it when
    // the Cline agent supplies structured function tools.
    body.reasoning_effort = hasFunctionTools ? 'none' : 'low';
  } else {
    body.temperature = typeof options.temperature === 'number' ? options.temperature : 0.85;
  }

  if (options.mode?.type === 'regular') {
    const tools = options.mode.tools?.filter((tool) => tool.type === 'function');
    if (tools?.length) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          parameters: tool.parameters,
        },
      }));
    }
    if (options.mode.toolChoice) {
      const choice = options.mode.toolChoice;
      body.tool_choice =
        choice.type === 'tool' ? { type: 'function', function: { name: choice.toolName } } : choice.type;
    }
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
      const toolCalls = Array.isArray(choice?.message?.tool_calls)
        ? choice.message.tool_calls.map((call: any) => ({
            toolCallType: 'function' as const,
            toolCallId: String(call.id || ''),
            toolName: String(call.function?.name || ''),
            args: typeof call.function?.arguments === 'string'
              ? call.function.arguments
              : JSON.stringify(call.function?.arguments || {}),
          }))
        : [];

      return {
        text: outputText(choice?.message?.content),
        finishReason: toolCalls.length ? 'tool-calls' : resolveFinishReason(choice?.finish_reason),
        ...(toolCalls.length ? { toolCalls } : {}),
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
      const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
      let emittedToolCalls = false;

      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          const emitToolCalls = () => {
            for (const [index, call] of toolCalls) {
              if (!call.id || !call.name) {
                throw new Error(`Azure returned an incomplete function call at index ${index}.`);
              }
              controller.enqueue({
                type: 'tool-call',
                toolCallType: 'function',
                toolCallId: call.id,
                toolName: call.name,
                args: call.arguments || '{}',
              });
            }
            emittedToolCalls = true;
          };

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

            for (const toolDelta of choice?.delta?.tool_calls || []) {
              const index = Number.isInteger(toolDelta.index) ? toolDelta.index : toolCalls.size;
              const current = toolCalls.get(index) || { arguments: '' };
              if (typeof toolDelta.id === 'string') current.id = toolDelta.id;
              if (typeof toolDelta.function?.name === 'string') current.name = toolDelta.function.name;
              if (typeof toolDelta.function?.arguments === 'string') current.arguments += toolDelta.function.arguments;
              toolCalls.set(index, current);
            }

            if (choice?.finish_reason) {
              finishReason = resolveFinishReason(choice.finish_reason);
              if (toolCalls.size && !emittedToolCalls) {
                emitToolCalls();
                finishReason = 'tool-calls';
              }
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

            // Some compatible endpoints omit or mislabel finish_reason even
            // though they streamed valid function calls. Never drop those
            // calls: the agent loop must receive them to execute Bolt tools.
            if (toolCalls.size && !emittedToolCalls) {
              emitToolCalls();
              finishReason = 'tool-calls';
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

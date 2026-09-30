import type { LanguageModelV1, LanguageModelV1CallOptions, LanguageModelV1Prompt, LanguageModelV1StreamPart } from 'ai';

type LanguageModelV1FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown';

export const FORTZ_RESPONSES_URL =
  'https://fortz-ai-resource.services.ai.azure.com/api/projects/fortz-ai/openai/v1/responses';

/** Deployment id Azure expects (display name can differ). */
export const FORTZ_DEPLOYMENT_MODEL = 'gpt-6-luna';

type ResponsesContentPart = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string };
type ResponsesMessage = { role: 'user' | 'assistant'; content: string | ResponsesContentPart[] };

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function imageDataUrl(part: Record<string, unknown>): string | undefined {
  const image = part.image;
  const mimeType =
    typeof part.mimeType === 'string' && /^image\/(?:png|jpeg|webp|gif)$/i.test(part.mimeType)
      ? part.mimeType
      : 'image/png';

  if (typeof image === 'string') {
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(image)) {
      return image;
    }

    if (/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      return `data:${mimeType};base64,${image}`;
    }
  }

  if (image instanceof Uint8Array) {
    return `data:${mimeType};base64,${bytesToBase64(image)}`;
  }

  if (image instanceof ArrayBuffer) {
    return `data:${mimeType};base64,${bytesToBase64(new Uint8Array(image))}`;
  }

  if (
    image instanceof URL &&
    image.protocol === 'data:' &&
    /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(image.href)
  ) {
    return image.href;
  }

  return undefined;
}

function convertMessageContent(content: LanguageModelV1Prompt[number]['content']): string | ResponsesContentPart[] {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts: ResponsesContentPart[] = [];

  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    if ('text' in part && typeof (part as { text?: string }).text === 'string') {
      parts.push({ type: 'input_text', text: (part as { text: string }).text });
    } else if ('image' in part) {
      const dataUrl = imageDataUrl(part as unknown as Record<string, unknown>);

      if (dataUrl) {
        parts.push({ type: 'input_image', image_url: dataUrl });
      }
    }
  }

  if (!parts.some((part) => part.type === 'input_image')) {
    return parts
      .filter((part): part is Extract<ResponsesContentPart, { type: 'input_text' }> => part.type === 'input_text')
      .map((part) => part.text)
      .join('\n');
  }

  return parts;
}

function convertPrompt(prompt: LanguageModelV1Prompt): {
  instructions?: string;
  input: ResponsesMessage[] | string;
} {
  const instructionsParts: string[] = [];
  const input: ResponsesMessage[] = [];

  for (const message of prompt) {
    const content = convertMessageContent(message.content);
    const hasContent = typeof content === 'string' ? Boolean(content.trim()) : content.length > 0;

    if (!hasContent) {
      continue;
    }

    if (message.role === 'system') {
      if (typeof content === 'string') {
        instructionsParts.push(content.trim());
      } else {
        instructionsParts.push(
          content
            .filter((part): part is Extract<ResponsesContentPart, { type: 'input_text' }> => part.type === 'input_text')
            .map((part) => part.text)
            .join('\n'),
        );
      }

      continue;
    }

    if (message.role === 'user' || message.role === 'assistant') {
      input.push({ role: message.role, content });
    }
  }

  return {
    instructions: instructionsParts.length > 0 ? instructionsParts.join('\n\n') : undefined,
    input:
      input.length === 1 && input[0].role === 'user' && typeof input[0].content === 'string' ? input[0].content : input,
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

function applyGenerationSettings(body: Record<string, unknown>, options: LanguageModelV1CallOptions, modelId: string) {
  body.max_output_tokens =
    typeof options.maxTokens === 'number' && Number.isFinite(options.maxTokens)
      ? Math.max(1, Math.floor(options.maxTokens))
      : 16384;

  // Omit temperature for GPT-6 deployments because some reasoning variants reject overrides.
  if (/^gpt-6(?:-|$)/i.test(modelId)) {
    return;
  }

  body.temperature = typeof options.temperature === 'number' ? options.temperature : 0.85;
}

export function createAzureResponsesModel(
  apiKey: string,
  modelId: string = FORTZ_DEPLOYMENT_MODEL,
  responsesUrl: string = FORTZ_RESPONSES_URL,
): LanguageModelV1 {
  const resolvedModel =
    !modelId || modelId === 'fortz-ai' || modelId === 'Fortz AI' || modelId === 'gpt-oss-120b'
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

      applyGenerationSettings(body, options, resolvedModel);

      const response = await fetch(responsesUrl, {
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
        const message =
          json?.error?.message || json?.message || rawText || `Azure Responses error (${response.status})`;
        const requestId = response.headers.get('apim-request-id') || response.headers.get('x-ms-request-id');
        const requestLabel = requestId ? ` (request ID ${requestId})` : '';

        throw new Error(`Azure Responses API HTTP ${response.status}${requestLabel}: ${message}`);
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

      applyGenerationSettings(body, options, resolvedModel);

      const response = await fetch(responsesUrl, {
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
        const requestId = response.headers.get('apim-request-id') || response.headers.get('x-ms-request-id');

        try {
          const parsed = JSON.parse(rawText);
          message = parsed?.error?.message || parsed?.message || message;
        } catch {
          // keep message
        }

        const requestLabel = requestId ? ` (request ID ${requestId})` : '';

        throw new Error(`Azure Responses stream HTTP ${response.status}${requestLabel}: ${message}`);
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
                } else if (event?.type === 'response.text.delta' && typeof event.delta === 'string') {
                  enqueue({ type: 'text-delta', textDelta: event.delta });
                } else if (event?.type === 'response.output_text.delta' && typeof event.delta?.text === 'string') {
                  enqueue({ type: 'text-delta', textDelta: event.delta.text });
                } else if (event?.type === 'response.completed' || event?.type === 'response.done') {
                  usage = {
                    promptTokens: event?.response?.usage?.input_tokens ?? usage.promptTokens,
                    completionTokens: event?.response?.usage?.output_tokens ?? usage.completionTokens,
                  };

                  if (
                    event?.response?.status === 'incomplete' ||
                    event?.response?.incomplete_details?.reason === 'max_output_tokens' ||
                    event?.response?.status_details?.reason === 'max_output_tokens'
                  ) {
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

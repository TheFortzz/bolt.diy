import { jsonSchema, streamText, type CoreMessage } from 'ai';
import type { AgentModel, AgentModelEvent, AgentModelRequest } from '@cline/shared';

const MAX_EMPTY_TURN_RETRIES = 2;

/**
 * Output budget per Cline agent turn. The old 8000-token ceiling capped every
 * write_file call at ~600 lines, so full games were physically impossible and
 * large files were truncated mid-write (broken games). 32000 fits the Fortz
 * model ceiling (32768); per-model caps are applied by the caller.
 */
export const CLINE_TURN_MAX_TOKENS = 32000;

function isEmptyModelResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /model returned empty response|no output generated|empty model response|empty response/i.test(message);
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Adapt Bolt's configured AI-SDK model/provider to Cline's AgentModel contract. */
export function createBoltAgentModel(boltModel: unknown, maxTurnTokens: number = CLINE_TURN_MAX_TOKENS): AgentModel {
  return {
    async *stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> {
      const tools = Object.fromEntries(request.tools.map((definition) => [definition.name, {
        description: definition.description,
        parameters: jsonSchema(definition.inputSchema as any),
      }]));

      for (let attempt = 0; attempt <= MAX_EMPTY_TURN_RETRIES; attempt++) {
        let hasUsableOutput = false;
        let finishEmitted = false;
        let retryEmptyTurn = false;

        try {
          const result = await streamText({
            model: boltModel as any,
            system: request.systemPrompt,
            messages: toCoreMessages(request.messages),
            tools: tools as any,
            // Cline runs are tool-driven. Without a required choice many models
            // answer with prose and stop without calling a workspace tool.
            toolChoice: 'required',
            maxSteps: 1,
            maxTokens: maxTurnTokens,
            temperature: 0.3,
            abortSignal: request.signal,
          });

          for await (const part of result.fullStream as AsyncIterable<any>) {
            if (request.signal?.aborted) {
              yield { type: 'finish', reason: 'aborted' };
              return;
            }

            if (part.type === 'text-delta') {
              const text = String(part.textDelta || '');
              if (text.trim()) {
                hasUsableOutput = true;
                yield { type: 'text-delta', text };
              }
            } else if (part.type === 'reasoning') {
              yield { type: 'reasoning-delta', text: part.text };
            } else if (part.type === 'tool-call') {
              hasUsableOutput = true;
              yield {
                type: 'tool-call-delta',
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                inputText: JSON.stringify(part.args ?? {}),
              };
            } else if (part.type === 'finish') {
              const finishReason = normalizeFinishReason(part.finishReason);
              const retryableEmptyFinish = !hasUsableOutput && finishReason === 'stop';

              if (retryableEmptyFinish && attempt < MAX_EMPTY_TURN_RETRIES) {
                retryEmptyTurn = true;
                break;
              }

              if (retryableEmptyFinish) {
                yield {
                  type: 'finish',
                  reason: 'error',
                  error: `Model returned empty response after ${attempt + 1} attempts.`,
                  errorRetryable: true,
                };
                return;
              }

              finishEmitted = true;
              yield {
                type: 'usage',
                usage: {
                  inputTokens: part.usage?.promptTokens || 0,
                  outputTokens: part.usage?.completionTokens || 0,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                },
              };
              yield { type: 'finish', reason: finishReason };
            } else if (part.type === 'error') {
              const message = part.error instanceof Error ? part.error.message : String(part.error || 'Provider request failed.');
              if (!hasUsableOutput && isEmptyModelResponse(message) && attempt < MAX_EMPTY_TURN_RETRIES) {
                retryEmptyTurn = true;
                break;
              }

              finishEmitted = true;
              yield {
                type: 'finish',
                reason: 'error',
                error: message,
                errorRetryable: true,
              };
              return;
            }
          }

          if (finishEmitted) return;

          if (!retryEmptyTurn) {
            if (!hasUsableOutput && attempt < MAX_EMPTY_TURN_RETRIES) {
              retryEmptyTurn = true;
            } else if (!hasUsableOutput) {
              yield {
                type: 'finish',
                reason: 'error',
                error: `Model returned empty response after ${attempt + 1} attempts.`,
                errorRetryable: true,
              };
              return;
            } else {
              yield { type: 'finish', reason: 'stop' };
              return;
            }
          }
        } catch (error) {
          if (request.signal?.aborted) {
            yield { type: 'finish', reason: 'aborted' };
            return;
          }
          if (!isEmptyModelResponse(error) || attempt >= MAX_EMPTY_TURN_RETRIES) {
            yield {
              type: 'finish',
              reason: 'error',
              error: error instanceof Error ? error.message : 'Provider request failed.',
              errorRetryable: true,
            };
            return;
          }
          retryEmptyTurn = true;
        }

        if (retryEmptyTurn) {
          const delayMs = 450 * (attempt + 1);
          yield {
            type: 'text-delta',
            text: `The model returned an empty turn. Retrying in ${(delayMs / 1000).toFixed(1)}s (${attempt + 1}/${MAX_EMPTY_TURN_RETRIES})…\n`,
          };
          if (!(await waitForRetry(delayMs, request.signal))) {
            yield { type: 'finish', reason: 'aborted' };
            return;
          }
        }
      }
    },
  };
}

function normalizeFinishReason(reason: string): 'stop' | 'tool-calls' | 'max-tokens' | 'content-filter' | 'aborted' | 'error' {
  if (reason === 'tool-calls') return 'tool-calls';
  if (reason === 'length') return 'max-tokens';
  if (reason === 'content-filter') return 'content-filter';
  return 'stop';
}

function toCoreMessages(messages: AgentModelRequest['messages']): CoreMessage[] {
  return messages.map((message) => {
    const parts = message.content as Array<Record<string, any>>;

    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: parts.filter((part) => part.type === 'tool-result').map((part) => ({
          type: 'tool-result' as const,
          toolCallId: String(part.toolCallId),
          toolName: String(part.toolName),
          result: part.output,
          isError: Boolean(part.isError),
        })),
      };
    }

    if (message.role === 'assistant') {
      const content: any[] = [];
      for (const part of parts) {
        if (part.type === 'text') content.push({ type: 'text', text: String(part.text || '') });
        else if (part.type === 'tool-call') {
          content.push({
            type: 'tool-call',
            toolCallId: String(part.toolCallId),
            toolName: String(part.toolName),
            args: part.input,
          });
        }
      }
      return {
        role: 'assistant',
        content,
      };
    }

    return {
      role: 'user',
      content: parts.filter((part) => part.type === 'text').map((part) => ({
        type: 'text' as const,
        text: String(part.text || ''),
      })),
    };
  }) as CoreMessage[];
}

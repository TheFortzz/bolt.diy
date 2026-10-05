import { jsonSchema, streamText, type CoreMessage } from 'ai';
import type { AgentModel, AgentModelEvent, AgentModelRequest } from '@cline/shared';

/** Adapt Bolt's configured AI-SDK model/provider to Cline's AgentModel contract. */
export function createBoltAgentModel(boltModel: unknown): AgentModel {
  return {
    async *stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> {
      const tools = Object.fromEntries(request.tools.map((definition) => [definition.name, {
        description: definition.description,
        parameters: jsonSchema(definition.inputSchema as any),
      }]));

      const result = await streamText({
        model: boltModel as any,
        system: request.systemPrompt,
        messages: toCoreMessages(request.messages),
        tools: tools as any,
        // Cline runs are tool-driven. Without a required choice many models
        // answer with prose ("plan ready") and stop without executing even one
        // workspace tool, leaving Bolt's editor and file tree untouched.
        toolChoice: 'required',
        maxSteps: 1,
        maxTokens: 8000,
        temperature: 0.3,
        abortSignal: request.signal,
      });

      let finishEmitted = false;
      try {
        for await (const part of result.fullStream as AsyncIterable<any>) {
          if (part.type === 'text-delta') {
            yield { type: 'text-delta', text: part.textDelta };
          } else if (part.type === 'reasoning') {
            yield { type: 'reasoning-delta', text: part.text };
          } else if (part.type === 'tool-call') {
            yield {
              type: 'tool-call-delta',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              inputText: JSON.stringify(part.args ?? {}),
            };
          } else if (part.type === 'finish') {
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
            yield { type: 'finish', reason: normalizeFinishReason(part.finishReason) };
          } else if (part.type === 'error') {
            finishEmitted = true;
            yield {
              type: 'finish',
              reason: 'error',
              error: part.error instanceof Error ? part.error.message : String(part.error || 'Provider request failed.'),
              errorRetryable: true,
            };
          }
        }
      } catch (error) {
        finishEmitted = true;
        yield {
          type: 'finish',
          reason: 'error',
          error: error instanceof Error ? error.message : 'Provider request failed.',
          errorRetryable: true,
        };
      }

      if (!finishEmitted) yield { type: 'finish', reason: 'stop' };
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

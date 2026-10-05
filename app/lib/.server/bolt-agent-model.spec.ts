import { Agent, createTool } from '@cline/agents';
import { describe, expect, it } from 'vitest';
import { createBoltAgentModel } from './bolt-agent-model';

function fakeLanguageModel(observed: { toolChoice?: unknown }) {
  let call = 0;
  return {
    specificationVersion: 'v1',
    provider: 'test',
    modelId: 'tool-loop-test',
    defaultObjectGenerationMode: undefined,
    async doStream(options: any) {
      observed.toolChoice = options.mode?.toolChoice;
      call++;
      const parts =
        call === 1
          ? [
              {
                type: 'tool-call' as const,
                toolCallType: 'function' as const,
                toolCallId: 'write-call-1',
                toolName: 'write_file',
                args: JSON.stringify({ path: 'game.js', content: 'requestAnimationFrame(() => {});' }),
              },
              {
                type: 'finish' as const,
                finishReason: 'tool-calls' as const,
                usage: { promptTokens: 12, completionTokens: 6 },
              },
            ]
          : [
              { type: 'text-delta' as const, textDelta: 'Game files updated.' },
              {
                type: 'finish' as const,
                finishReason: 'stop' as const,
                usage: { promptTokens: 20, completionTokens: 4 },
              },
            ];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
        rawCall: { rawPrompt: [], rawSettings: {} },
      };
    },
  } as any;
}

describe('Bolt Cline model adapter', () => {
  it('routes structured Cline tool calls through Bolt model provider streaming', async () => {
    const writtenFiles: Record<string, string> = {};
    const observed: { toolChoice?: unknown } = {};
    const writeFile = createTool({
      name: 'write_file',
      description: 'Write an approved project file.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      execute: async ({ path, content }: { path: string; content: string }) => {
        writtenFiles[path] = content;
        return { success: true, path };
      },
    });

    const agent = new Agent({
      model: createBoltAgentModel(fakeLanguageModel(observed)),
      systemPrompt: 'Use tools to edit files, then summarize.',
      tools: [writeFile],
      maxIterations: 3,
    });
    const result = await agent.run('Create game.js');

    expect(result.status).toBe('completed');
    expect(observed.toolChoice).toMatchObject({ type: 'required' });
    expect(writtenFiles['game.js']).toBe('requestAnimationFrame(() => {});');
    expect(result.outputText).toContain('Game files updated.');
  });

  it('waits and retries an empty model turn before returning a real tool call', async () => {
    let calls = 0;
    const model = {
      specificationVersion: 'v1',
      provider: 'test',
      modelId: 'empty-then-tool',
      defaultObjectGenerationMode: undefined,
      async doStream() {
        calls++;
        const parts = calls === 1
          ? [{ type: 'finish' as const, finishReason: 'stop' as const, usage: { promptTokens: 8, completionTokens: 0 } }]
          : [
              {
                type: 'tool-call' as const,
                toolCallType: 'function' as const,
                toolCallId: 'write-after-retry',
                toolName: 'write_file',
                args: JSON.stringify({ path: 'game.js', content: 'function start() {}' }),
              },
              { type: 'finish' as const, finishReason: 'tool-calls' as const, usage: { promptTokens: 9, completionTokens: 12 } },
            ];
        return {
          stream: new ReadableStream({
            start(controller) {
              for (const part of parts) controller.enqueue(part);
              controller.close();
            },
          }),
          rawCall: { rawPrompt: [], rawSettings: {} },
        };
      },
    } as any;

    const events = [];
    const agentModel = createBoltAgentModel(model);
    for await (const event of await agentModel.stream({
      systemPrompt: 'Use the write_file tool.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Build the game.' }] }],
      tools: [{
        name: 'write_file',
        description: 'Write an approved file.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
      }],
      signal: new AbortController().signal,
    } as any)) {
      events.push(event);
    }

    expect(calls).toBe(2);
    expect(events.some((event: any) => event.type === 'tool-call-delta' && event.toolName === 'write_file')).toBe(true);
    expect(events.some((event: any) => event.type === 'finish' && event.reason === 'error')).toBe(false);
  });
});

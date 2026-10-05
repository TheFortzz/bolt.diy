import { Agent, createTool } from '@cline/agents';
import { describe, expect, it } from 'vitest';
import { createBoltAgentModel } from './bolt-agent-model';

function fakeLanguageModel() {
  let call = 0;
  return {
    specificationVersion: 'v1',
    provider: 'test',
    modelId: 'tool-loop-test',
    defaultObjectGenerationMode: undefined,
    async doStream() {
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
      model: createBoltAgentModel(fakeLanguageModel()),
      systemPrompt: 'Use tools to edit files, then summarize.',
      tools: [writeFile],
      maxIterations: 3,
    });
    const result = await agent.run('Create game.js');

    expect(result.status).toBe('completed');
    expect(writtenFiles['game.js']).toBe('requestAnimationFrame(() => {});');
    expect(result.outputText).toContain('Game files updated.');
  });
});

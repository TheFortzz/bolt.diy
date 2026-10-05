import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAzureChatCompletionsModel } from '~/lib/.server/llm/azure-chat-completions-model';

describe('Azure Chat Completions model adapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends a standard Chat Completions request with Foundry bearer authentication', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
        { status: 200 },
      ),
    );
    const model = createAzureChatCompletionsModel(
      'test-key',
      'gpt-6-luna',
      'https://example.test/openai/v1/chat/completions',
    );

    const result = await model.doGenerate({
      prompt: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Say ok.' },
      ],
      maxTokens: 64,
      temperature: 0.2,
      abortSignal: new AbortController().signal,
    } as any);

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;

    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/openai/v1/chat/completions');
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['api-key']).toBeUndefined();
    expect(request).toEqual({
      model: 'gpt-6-luna',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Say ok.' },
      ],
      stream: false,
      max_completion_tokens: 64,
      reasoning_effort: 'low',
    });
    expect(result.text).toBe('ok');
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 1 });
  });

  it('uses low reasoning effort for fast generation and maximum token headroom', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'plan' } }] }), { status: 200 }),
      );
    const model = createAzureChatCompletionsModel(
      'test-key',
      'gpt-6-luna',
      'https://example.test/openai/v1/chat/completions',
    );

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'Design a complete game.' }],
      maxTokens: 6000,
      abortSignal: new AbortController().signal,
    } as any);

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request.reasoning_effort).toBe('low');
  });

  it('maps reference images to Chat Completions image_url parts', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'seen' } }] }), { status: 200 }),
      );
    const model = createAzureChatCompletionsModel(
      'test-key',
      'gpt-6-luna',
      'https://example.test/openai/v1/chat/completions',
    );

    await model.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this.' },
            { type: 'image', image: 'YWJj', mimeType: 'image/jpeg' },
          ],
        },
      ],
      maxTokens: 64,
      abortSignal: new AbortController().signal,
    } as any);

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);

    expect(request.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this.' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWJj' } },
        ],
      },
    ]);
  });

  it('converts streamed Chat Completions deltas into language model stream parts', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
            '',
          ].join('\n'),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );
    const model = createAzureChatCompletionsModel(
      'test-key',
      'gpt-6-luna',
      'https://example.test/openai/v1/chat/completions',
    );

    const result = await model.doStream({
      prompt: [{ role: 'user', content: 'Say hello.' }],
      maxTokens: 64,
      abortSignal: new AbortController().signal,
    } as any);
    const parts = [];
    const reader = result.stream.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      parts.push(value);
    }

    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(parts).toContainEqual({ type: 'text-delta', textDelta: 'hello' });
    expect(parts).toContainEqual({
      type: 'finish',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  });

  it('sends structured Cline tools and maps non-streaming tool calls', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call-read',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"index.html"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const model = createAzureChatCompletionsModel(
      'test-key',
      'gpt-6-luna',
      'https://example.test/openai/v1/chat/completions',
    );
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'Inspect index.html.' }],
      maxTokens: 128,
      mode: {
        type: 'regular',
        tools: [
          {
            type: 'function',
            name: 'read_file',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
          },
        ],
        toolChoice: { type: 'auto' },
      },
      abortSignal: new AbortController().signal,
    } as any);

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      },
    ]);
    expect(request.tool_choice).toBe('auto');
    expect(result.finishReason).toBe('tool-calls');
    expect(result.toolCalls).toEqual([
      {
        toolCallType: 'function',
        toolCallId: 'call-read',
        toolName: 'read_file',
        args: '{"path":"index.html"}',
      },
    ]);
  });

  it('accumulates Azure streamed function arguments into a Cline tool call', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-read","type":"function","function":{"name":"read_file","arguments":"{\\\"path\\\":\\\""}}]},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"index.html\\\"}"}}]},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
            'data: [DONE]',
            '',
          ].join('\n'),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );
    const model = createAzureChatCompletionsModel(
      'test-key',
      'gpt-6-luna',
      'https://example.test/openai/v1/chat/completions',
    );
    const result = await model.doStream({
      prompt: [{ role: 'user', content: 'Inspect index.html.' }],
      maxTokens: 128,
      mode: {
        type: 'regular',
        tools: [
          {
            type: 'function',
            name: 'read_file',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
          },
        ],
        toolChoice: { type: 'auto' },
      },
      abortSignal: new AbortController().signal,
    } as any);
    const parts = [];
    const reader = result.stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    expect(parts).toContainEqual({
      type: 'tool-call',
      toolCallType: 'function',
      toolCallId: 'call-read',
      toolName: 'read_file',
      args: '{"path":"index.html"}',
    });
    expect(parts).toContainEqual(expect.objectContaining({ type: 'finish', finishReason: 'tool-calls' }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

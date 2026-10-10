import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClineAgent } from '~/lib/runtime/cline-bridge';

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;

  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(chunks[index++]));
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('runClineAgent stream reliability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flushes a trailing result frame that arrives without a final newline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"type":"status","payload":{"message":"hi"}}\n\n',
          'data: {"type":"result","payload":{"summary":"done","status":"completed"}}',
        ]),
      ),
    );

    const events: string[] = [];
    const result = await runClineAgent(
      { prompt: 'build', files: {} },
      {
        onEvent: (event) => events.push(event.type),
      },
    );

    expect(events).toEqual(['status', 'result']);
    expect(result.type).toBe('result');
    expect(result.payload.summary).toBe('done');
  });

  it('throws a clear incomplete-stream error when the SSE ends without result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(['data: {"type":"status","payload":{"message":"working"}}\n\n', 'data: [DONE]\n\n']),
      ),
    );

    await expect(
      runClineAgent({ prompt: 'build', files: {} }, { onEvent: () => undefined }),
    ).rejects.toThrow(/stream ended without a result/i);
  });

  it('surfaces fatal_error events instead of silently ending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(['data: {"type":"fatal_error","payload":{"error":"model overloaded"}}\n\n']),
      ),
    );

    await expect(
      runClineAgent({ prompt: 'build', files: {} }, { onEvent: () => undefined }),
    ).rejects.toThrow(/model overloaded/i);
  });
});

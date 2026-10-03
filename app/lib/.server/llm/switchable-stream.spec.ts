import { describe, expect, it } from 'vitest';
import SwitchableStream from './switchable-stream';

describe('SwitchableStream', () => {
  it('sends a protocol error frame and cleanly closes when an upstream continuation fails', async () => {
    const stream = new SwitchableStream();
    const encoder = new TextEncoder();
    await stream.switchSource(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('0:"partial file"\n'));
          controller.close();
        },
      }),
    );

    const reader = stream.readable.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('partial file');

    stream.fail(new Error('upstream connection lost'));

    const remaining: string[] = [];

    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      remaining.push(new TextDecoder().decode(chunk.value));
    }

    expect(remaining.join('')).toContain('3:"upstream connection lost"');
    expect(remaining.join('')).toContain('d:{"finishReason":"stop"}');
  });

  it('redacts bearer credentials in stream errors', async () => {
    const stream = new SwitchableStream();
    const reader = stream.readable.getReader();
    stream.fail(new Error('Request failed with Bearer abcdefghijklmnop-secret'));

    const frames: string[] = [];

    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      frames.push(new TextDecoder().decode(chunk.value));
    }

    expect(frames.join('')).toContain('Bearer [redacted]');
    expect(frames.join('')).not.toContain('abcdefghijklmnop-secret');
  });
});

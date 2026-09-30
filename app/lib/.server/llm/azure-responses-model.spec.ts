import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAzureResponsesModel } from '~/lib/.server/llm/azure-responses-model';

describe('Azure Responses model adapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserves reference images as Responses API input_image parts', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: 'A visual reference.' }), { status: 200 }));
    const model = createAzureResponsesModel('test-key', 'gpt-6-luna', 'https://example.test/responses');

    await model.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Use this image as visual direction.' },
            { type: 'image', image: 'YWJj', mimeType: 'image/jpeg' },
          ],
        },
      ],
      maxTokens: 1000,
      temperature: 0.4,
      abortSignal: new AbortController().signal,
    } as any);

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request.max_output_tokens).toBe(1000);
    expect(request).not.toHaveProperty('temperature');
    expect(request.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Use this image as visual direction.' },
          { type: 'input_image', image_url: 'data:image/jpeg;base64,YWJj' },
        ],
      },
    ]);
  });

  it('keeps the requested output limit and sampling temperature for standard models', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: 'ok' }), { status: 200 }));
    const model = createAzureResponsesModel('test-key', 'gpt-4.1', 'https://example.test/responses');

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'Say ok.' }],
      maxTokens: 2000,
      temperature: 0.2,
      abortSignal: new AbortController().signal,
    } as any);

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request.max_output_tokens).toBe(2000);
    expect(request.temperature).toBe(0.2);
  });
});

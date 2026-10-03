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
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(request.max_output_tokens).toBe(1000);
    expect(request).not.toHaveProperty('temperature');
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['api-key']).toBeUndefined();
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

  it('uses high reasoning effort for long game-build budgets', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: 'complete plan' }), { status: 200 }));
    const model = createAzureResponsesModel('test-key', 'gpt-6-luna', 'https://example.test/responses');

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'Design a substantial game.' }],
      maxTokens: 6000,
      abortSignal: new AbortController().signal,
    } as any);

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request.reasoning).toEqual({ effort: 'high' });
  });

  it('preserves the Azure status and request ID for configuration diagnostics', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid subscription key.' } }), {
        status: 401,
        headers: { 'apim-request-id': 'azure-request-test' },
      }),
    );

    const model = createAzureResponsesModel('test-key', 'gpt-6-luna', 'https://example.test/responses');

    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: 'Say ok.' }],
        maxTokens: 32,
        abortSignal: new AbortController().signal,
      } as any),
    ).rejects.toThrow('Azure Responses API HTTP 401 (request ID azure-request-test): Invalid subscription key.');
  });
});

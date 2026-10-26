import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({ text: 'low-poly hovercar, night city track, drifting controls' }),
}));
vi.mock('~/lib/.server/llm/model', () => ({ getModel: vi.fn(() => ({})) }));

import { generatePublishThumbnail, safePublishThumbnailError } from './publish-thumbnail';

describe('publish cover art', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the configured Cloudflare endpoint and returns only image data', async () => {
    const base64 = Buffer.from('fake-png-image').toString('base64');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: base64 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await generatePublishThumbnail(
      {
        'tunbnailmaker-url': 'https://thumbnail.example.test/flux',
        'tunbnailmaker-key': 'test-only-secret',
      },
      {
        title: 'Neon Drift',
        genre: 'Racing',
        description: 'A neon highway game about drifting.',
        gameContext: 'low-poly hovercar, night city track, drifting controls',
      },
    );

    expect(fetchMock.mock.calls[0][0]).toBe('https://thumbnail.example.test/flux');
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-only-secret',
    );

    const prompt = JSON.parse(fetchMock.mock.calls[0][1]?.body as string).prompt as string;
    expect(prompt).toContain('family-friendly racing');
    expect(prompt).not.toContain('low-poly hovercar');
    expect(prompt).not.toContain('Neon Drift');

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.width).toBe(896);
    expect(body.height).toBe(504);
    expect(body.disable_pup).toBe(true);
    expect(body.output_format).toBe('jpeg');
    expect(result).toBe(`data:image/png;base64,${base64}`);
    expect(result).not.toContain('test-only-secret');
  });

  it('uses game references and avoids trademark names in generated prompts', async () => {
    const base64 = Buffer.from('fake-jpeg-image').toString('base64');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: base64 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await generatePublishThumbnail(
      {
        'tunbnailmaker-url': 'https://thumbnail.example.test/flux',
        'tunbnailmaker-key': 'test-only-secret',
      },
      {
        title: 'Minecraft F1',
        genre: 'Racing',
        description: 'A block-building Formula 1 game.',
        prompt: '',
        visualFacts: 'pixel car on a track',
        gameContext: '',
        referenceImages: [
          `data:image/png;base64,${Buffer.from('reference-image-data-with-enough-bytes').toString('base64')}`,
        ],
      },
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.input_image).toBe(Buffer.from('reference-image-data-with-enough-bytes').toString('base64'));
    expect(body.prompt).toContain('Reference image 1');
    expect(body.prompt).not.toMatch(/minecraft|formula\s*1|\bf1\b/i);
  });

  it('stops immediately on an Azure RAI policy rejection', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Content violated RAI policy' } }), { status: 400 }),
      );

    await expect(
      generatePublishThumbnail(
        {
          'tunbnailmaker-url': 'https://thumbnail.example.test/flux',
          'tunbnailmaker-key': 'test-only-secret',
        },
        {
          title: 'An arbitrary title',
          genre: 'Action',
          description: 'This text is not forwarded to the image prompt.',
          prompt: 'This prompt is also not forwarded.',
          visualFacts: 'Nor is source code.',
          gameContext: '',
          referenceImages: [`data:image/png;base64,${Buffer.from('safe-reference-image-data').toString('base64')}`],
        },
      ),
    ).rejects.toThrow('status 400');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.prompt).not.toContain('arbitrary title');
    expect(body.prompt).not.toContain('not forwarded');
  });

  it('does not call the provider if no Cloudflare secret is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const result = await generatePublishThumbnail({}, { title: 'Untitled', genre: 'Action', description: '' });

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redacts provider credentials from any surfaced error', () => {
    const error = safePublishThumbnailError(new Error('Bearer top-secret key=top-secret'), 'top-secret');
    expect(error).not.toContain('top-secret');
    expect(error).toContain('[redacted]');
  });
});

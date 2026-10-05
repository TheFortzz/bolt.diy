import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePublishThumbnail } from './publish-thumbnail';

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
      { title: 'Neon Drift', genre: 'Racing', description: 'A neon highway game about drifting.' },
    );

    expect(fetchMock.mock.calls[0][0]).toBe('https://thumbnail.example.test/flux');
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer test-only-secret');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).prompt).toContain('Neon Drift');
    expect(result).toBe(`data:image/png;base64,${base64}`);
    expect(result).not.toContain('test-only-secret');
  });

  it('does not call the provider if no Cloudflare secret is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const result = await generatePublishThumbnail({}, { title: 'Untitled', genre: 'Action', description: '' });

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

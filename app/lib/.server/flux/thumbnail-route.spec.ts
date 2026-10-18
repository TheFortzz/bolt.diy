import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/.server/flux/publish-thumbnail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/.server/flux/publish-thumbnail')>();
  return { ...actual, generatePublishThumbnail: vi.fn() };
});

import { action } from '~/routes/api.generate-thumbnail';
import { generatePublishThumbnail } from './publish-thumbnail';

describe('generate-thumbnail route fallback', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a fallback signal instead of HTTP 502 when FLUX is unavailable', async () => {
    vi.mocked(generatePublishThumbnail).mockRejectedValueOnce(new Error('FLUX API status 502: upstream unavailable'));
    const url = 'https://studio.example.test/api/generate-thumbnail';
    const request = new Request(url, {
      method: 'POST',
      headers: { Origin: 'https://studio.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Neon Drift', genre: 'Racing', description: '', gameContext: '' }),
    });
    const response = await action({
      request,
      params: {},
      context: {
        cloudflare: {
          env: {
            'tunbnailmaker-key': 'test-only-key',
            'tunbnailmaker-url': 'https://image.example.test/flux',
          },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ fallback: true });
  });
});

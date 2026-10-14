import { describe, expect, it, vi } from 'vitest';
import { assetRecordSchema, type AssetRecord } from '~/lib/assets/asset-schema';
import { createVisionAssetEnricher } from './vision-analysis';

function record(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return assetRecordSchema.parse({
    id: 'assets:f1',
    appwrite: { bucketId: 'assets', fileId: 'f1' },
    originalName: 'hero_ship.png',
    remotePath: '',
    mimeType: 'image/png',
    sizeOriginal: 4,
    role: 'asset',
    dimension: '2d',
    category: 'other',
    format: 'png',
    dependencies: [],
    intelligence: {
      description: '2D image in png format; filename suggests hero, ship.',
      tags: ['hero', 'ship'],
      source: 'filename',
      confidence: 0.3,
      perspective: 'any',
    },
    available: true,
    discoveredAt: '2026-01-01T00:00:00.000Z',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as AssetRecord;
}

function modelResult(text: string) {
  return { text } as never;
}

describe('createVisionAssetEnricher', () => {
  it('enriches the actual image bytes and marks the result vision-sourced', async () => {
    const generate = vi.fn(async (_request: unknown) =>
      modelResult(
        JSON.stringify({
          description: 'A blue spacecraft viewed from above, with transparent surroundings.',
          tags: ['spaceship', 'blue', 'top-down', 'transparent'],
          confidence: 0.92,
          category: 'character',
          perspective: 'topdown',
        }),
      ),
    );
    const enrich = createVisionAssetEnricher({
      env: {} as Env,
      provider: 'OpenAI',
      model: 'vision-model',
      resolveModel: () => ({ mock: true }),
      generate: generate as never,
      now: () => '2026-10-14T00:00:00.000Z',
    });
    const result = await enrich(record(), Uint8Array.from([137, 80, 78, 71]));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.category).toBe('character');
    expect(result.intelligence).toMatchObject({
      source: 'vision',
      confidence: 0.92,
      perspective: 'topdown',
      visionAnalyzedAt: '2026-10-14T00:00:00.000Z',
    });

    const request = generate.mock.calls[0][0] as unknown as {
      messages: Array<{ content: Array<{ type: string; image?: string }> }>;
    };
    expect(request.messages[0].content.some((part) => part.type === 'image' && part.image)).toBe(true);
  });

  it('does not call a vision model for unknown formats or oversized images', async () => {
    const generate = vi.fn(async (_request: unknown) => modelResult('{}'));
    const enrich = createVisionAssetEnricher({
      env: {} as Env,
      provider: 'OpenAI',
      model: 'vision-model',
      resolveModel: () => ({}),
      generate: generate as never,
    });

    expect(await enrich(record({ format: 'unknown' }), Uint8Array.from([1]))).toEqual({});
    expect(await enrich(record(), new Uint8Array(8 * 1024 * 1024 + 1))).toEqual({});
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not invent a category when the model returns malformed JSON', async () => {
    const enrich = createVisionAssetEnricher({
      env: {} as Env,
      provider: 'OpenAI',
      model: 'vision-model',
      resolveModel: () => ({}),
      generate: (async (_request: unknown) => modelResult('This looks like maybe a ship?')) as never,
    });

    expect(await enrich(record(), Uint8Array.from([137, 80, 78, 71]))).toEqual({});
  });

  it('keeps a preview labelled as a preview in the model instruction', async () => {
    const generate = vi.fn(async (_request: unknown) =>
      modelResult(
        JSON.stringify({
          description: 'A rendered wooden crate.',
          tags: ['crate'],
          confidence: 0.85,
          category: 'prop',
          perspective: 'any',
        }),
      ),
    );
    const enrich = createVisionAssetEnricher({
      env: {} as Env,
      provider: 'OpenAI',
      model: 'vision-model',
      resolveModel: () => ({}),
      generate: generate as never,
    });

    const result = await enrich(record({ role: 'preview', dimension: 'data' }), Uint8Array.from([137, 80, 78, 71]));
    const request = generate.mock.calls[0][0] as unknown as { messages: Array<{ content: Array<{ text?: string }> }> };
    const instruction = request.messages[0].content.find((part) => part.text)?.text || '';

    expect(instruction).toContain('preview image');
    expect(result.category).toBe('prop');
    expect(result.intelligence?.source).toBe('vision');
  });
});

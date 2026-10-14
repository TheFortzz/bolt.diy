import { describe, expect, it } from 'vitest';
import { assetCatalogueSchema } from '~/lib/assets/asset-schema';
import { loadAssetCatalogue, resetCatalogueCache, writeCatalogueToKv } from './catalogue-store';

const validCatalogue = assetCatalogueSchema.parse([
  {
    id: 'assets:f1',
    appwrite: { bucketId: 'assets', fileId: 'f1' },
    originalName: 'hero.png',
    remotePath: '',
    mimeType: 'image/png',
    sizeOriginal: 100,
    role: 'asset',
    dimension: '2d',
    category: 'sprite',
    format: 'png',
    dependencies: [],
    intelligence: {
      description: 'hero sprite',
      tags: ['hero'],
      source: 'vision',
      confidence: 0.95,
      perspective: 'any',
    },
    available: true,
    discoveredAt: '2026-01-01T00:00:00.000Z',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
  },
]);

describe('Cloudflare KV catalogue delivery', () => {
  it('loads and validates the catalogue from the Pages KV binding', async () => {
    resetCatalogueCache();

    const result = await loadAssetCatalogue(
      {
        ASSET_CATALOGUE_KV: {
          get: async (key) => (key === 'asset-catalogue.json' ? JSON.stringify(validCatalogue) : null),
        },
      },
      async () => {
        throw new Error('filesystem must not be used when KV is bound');
      },
    );

    expect(result.available).toBe(true);
    expect(result.catalogue).toHaveLength(1);
  });

  it('prefers the Cloudflare KV binding over local filesystem', async () => {
    resetCatalogueCache();

    let filesystemRead = false;
    const result = await loadAssetCatalogue(
      { ASSET_CATALOGUE_KV: { get: async () => JSON.stringify(validCatalogue) } },
      async () => {
        filesystemRead = true;
        return '[]';
      },
    );

    expect(result.available).toBe(true);
    expect(filesystemRead).toBe(false);
  });

  it('reports a missing KV entry explicitly', async () => {
    resetCatalogueCache();

    const result = await loadAssetCatalogue({ ASSET_CATALOGUE_KV: { get: async () => null } }, async () => '[]');

    expect(result.available).toBe(false);
    expect(result.reason).toContain('Cloudflare KV');
  });

  it('backs up the previous KV entry before replacing it', async () => {
    const values = new Map([['asset-catalogue.json', '["old"]']]);
    let clock = 1234;
    const kv = {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => {
        values.set(key, value);
      },
    };

    const result = await writeCatalogueToKv(kv, validCatalogue, 'asset-catalogue.json', () => clock++);

    expect(result.written).toBe(true);
    expect(result.backupKey).toBe('asset-catalogue.json.1234.bak');
    expect(values.get(result.backupKey!)).toBe('["old"]');
    expect(JSON.parse(values.get('asset-catalogue.json')!)).toHaveLength(1);
  });

  it('refuses an empty KV write so a failed scan cannot clear the deployed index', async () => {
    const writes: string[] = [];
    const result = await writeCatalogueToKv(
      {
        get: async () => '["existing"]',
        put: async (key) => {
          writes.push(key);
        },
      },
      [],
    );

    expect(result.written).toBe(false);
    expect(writes).toEqual([]);
  });
});

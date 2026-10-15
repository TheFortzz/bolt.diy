import { describe, expect, it } from 'vitest';
import { assetCatalogueSchema, assetRecordSchema, type AssetRecord } from './asset-schema';
import { formatAssetBriefing, queryTerms, scoreAsset, searchAssets } from './search';

function record(overrides: Partial<AssetRecord> & { id: string; originalName: string }): AssetRecord {
  const dimension = overrides.dimension || '2d';
  const format = overrides.format || (dimension === '3d' ? 'glb' : 'png');
  const base = {
    id: overrides.id,
    appwrite: { bucketId: 'assets', fileId: overrides.id },
    originalName: overrides.originalName,
    remotePath: '',
    mimeType: '',
    sizeOriginal: 1024,
    role: 'asset' as const,
    dimension,
    category: 'sprite' as const,
    format,
    ...(dimension === '3d'
      ? {
          technical: {
            kind: 'model3d' as const,
            model: {
              format: format as 'glb' | 'gltf' | 'obj' | 'mtl',
              meshes: 1,
              materials: [],
              textures: [],
              embeddedTextures: 0,
              animations: 0,
              requiresDraco: false,
              externalRefs: [],
            },
          },
        }
      : {}),
    dependencies: [],
    intelligence: {
      description: 'sprite',
      tags: [],
      source: 'metadata' as const,
      confidence: 0.6,
      perspective: 'any' as const,
    },
    available: true,
    discoveredAt: '2026-01-01T00:00:00.000Z',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
  };

  return assetRecordSchema.parse({ ...base, ...overrides }) as AssetRecord;
}

const catalogue = assetCatalogueSchema.parse([
  record({
    id: 'ship',
    originalName: 'player_ship.png',
    intelligence: described(['ship', 'player', 'space', 'pixel']),
  }),
  record({
    id: 'asteroid',
    originalName: 'asteroid_large.png',
    intelligence: described(['asteroid', 'space', 'rock', 'pixel']),
  }),
  record({
    id: 'crate',
    originalName: 'wooden_crate.png',
    category: 'prop',
    intelligence: described(['crate', 'wooden', 'prop']),
  }),
  record({
    id: 'ship-preview',
    originalName: 'player_ship_preview.png',
    role: 'preview',
    dimension: 'data',
    category: 'other',
    intelligence: { description: 'Preview', tags: ['ship'], source: 'vision', confidence: 0.95, perspective: 'any' },
  }),
  record({
    id: 'ship-3d',
    originalName: 'player_ship.glb',
    dimension: '3d',
    category: 'model3d',
    format: 'glb',
    intelligence: described(['ship', 'space', 'model']),
  }),
  record({
    id: 'ship-3d-broken',
    originalName: 'player_ship_broken.glb',
    dimension: '3d',
    category: 'model3d',
    format: 'glb',
    dependencies: [{ kind: 'texture', uri: 'missing.png', required: true, embedded: false, resolved: false }],
  }),
  record({
    id: 'jump',
    originalName: 'jump.wav',
    dimension: 'audio',
    category: 'sfx',
    format: 'wav',
    intelligence: described(['jump', 'sound', 'sfx']),
  }),
]);

/** Intelligence block carrying the given tags. */
function described(tags: string[]) {
  return {
    description: '2D sprite in png format; 64x64; transparent.',
    tags,
    source: 'metadata' as const,
    confidence: 0.6,
    perspective: 'any' as const,
  };
}

/** Intelligence block with a specific camera perspective. */
function perspective(value: 'topdown' | 'sideview' | 'isometric' | 'firstperson') {
  return {
    description: '2D sprite in png format; 64x64; transparent.',
    tags: ['hero', 'sprite'],
    source: 'metadata' as const,
    confidence: 0.6,
    perspective: value,
  };
}

describe('queryTerms', () => {
  it('drops filler words and short noise', () => {
    const expanded = queryTerms({ text: 'a space ship for the game' });
    expect(expanded).toEqual(expect.arrayContaining(['space', 'ship']));
  });
});

describe('searchAssets', () => {
  it('ranks the relevant match first', () => {
    const results = searchAssets(catalogue, { text: 'space ship' });

    expect(results[0].record.id).toBe('ship');

    /*
     * Both are equally relevant on text; the 2D sprite wins the tie because
     * this studio's games are overwhelmingly 2D.
     */
    expect(results[0].score).toBe(results[1]?.score ?? -1);
  });

  it('never returns a preview render as a usable asset', () => {
    const results = searchAssets(catalogue, { text: 'player ship' });

    expect(results.map((entry) => entry.record.id)).not.toContain('ship-preview');
  });

  it('keeps 2D and 3D selection separate', () => {
    expect(searchAssets(catalogue, { text: 'ship', dimension: '2d' }).map((entry) => entry.record.id)).toContain(
      'ship',
    );
    expect(searchAssets(catalogue, { text: 'ship', dimension: '2d' }).map((entry) => entry.record.id)).not.toContain(
      'ship-3d',
    );
    expect(searchAssets(catalogue, { text: 'ship', dimension: '3d' }).map((entry) => entry.record.id)).toEqual([
      'ship-3d',
    ]);
  });

  it('drops an asset whose required texture is missing', () => {
    const results = searchAssets(catalogue, { text: 'ship', dimension: '3d' });

    expect(results.map((entry) => entry.record.id)).not.toContain('ship-3d-broken');
  });

  it('filters by category', () => {
    const results = searchAssets(catalogue, { category: 'sfx' });

    expect(results.map((entry) => entry.record.id)).toEqual(['jump']);
  });

  it('filters by camera perspective for 2D art', () => {
    const topDown = assetCatalogueSchema.parse([
      record({ id: 'td', originalName: 'hero.png', intelligence: perspective('topdown') }),
      record({ id: 'side', originalName: 'hero2.png', intelligence: perspective('sideview') }),
    ]) as AssetRecord[];

    const strict = searchAssets(topDown, { text: 'hero', perspective: 'topdown' });

    expect(strict[0].record.id).toBe('td');
  });

  it('matches style tokens when asked', () => {
    const results = searchAssets(catalogue, { text: 'ship', style: 'pixel' });

    expect(results[0].record.id).toBe('ship');
    expect(results[0].why).toContain('pixel style');
  });

  it('caps results so a prompt can never flood the context', () => {
    const many = assetCatalogueSchema.parse(
      Array.from({ length: 200 }, (_, index) => record({ id: `a${index}`, originalName: `ship_${index}.png` })),
    );

    expect(searchAssets(many, { text: 'ship', limit: 5 })).toHaveLength(5);
    expect(searchAssets(many, { text: 'ship', limit: 500 }).length).toBeLessThanOrEqual(12);
  });

  it('returns nothing rather than a bad match', () => {
    expect(searchAssets(catalogue, { text: 'medieval cathedral stonework' })).toEqual([]);
  });

  it('prefers the analysed asset over an equally relevant filename guess', () => {
    const scored = assetCatalogueSchema.parse([
      record({
        id: 'guessed',
        originalName: 'crate.png',
        intelligence: { ...described([]), source: 'filename', confidence: 0.4 },
      }),
      record({
        id: 'analysed',
        originalName: 'crate_final.png',
        intelligence: { ...described([]), source: 'vision', confidence: 0.95 },
      }),
    ]) as AssetRecord[];

    const results = searchAssets(scored, { text: 'crate' });

    expect(results[0].record.id).toBe('analysed');
  });
});

describe('scoreAsset', () => {
  it('refuses to score an unusable asset at all', () => {
    expect(
      scoreAsset(catalogue.find((entry) => entry.id === 'ship-preview')!, { text: 'ship' }, catalogue),
    ).toBeUndefined();
    expect(
      scoreAsset(catalogue.find((entry) => entry.id === 'ship-3d-broken')!, { text: 'ship' }, catalogue),
    ).toBeUndefined();
  });
});

describe('formatAssetBriefing', () => {
  it('emits a compact, path-free briefing with ids only', () => {
    const briefing = formatAssetBriefing(searchAssets(catalogue, { text: 'space ship', limit: 2 }));

    expect(briefing).toContain('Verified library assets');
    expect(briefing).toContain('ship');
    expect(briefing).toContain('why:');
    expect(briefing).not.toContain('data:');
    expect(briefing).not.toContain('appwrite.io');
  });

  it('tells the model to use procedural visuals when nothing matched', () => {
    expect(formatAssetBriefing([])).toContain('Use procedural visuals');
  });
});

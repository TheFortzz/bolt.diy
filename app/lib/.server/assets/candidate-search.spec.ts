import { describe, expect, it } from 'vitest';
import {
  assetCatalogueSchema,
  assetRecordSchema,
  type AssetCatalogue,
  type AssetRecord,
} from '~/lib/assets/asset-schema';
import {
  approveLibrarySelections,
  destinationPathFor,
  findLibraryCandidates,
  formatCandidateBriefing,
} from './candidate-search';
import { catalogueGaps, catalogueSummary, loadAssetCatalogue, resetCatalogueCache } from './catalogue-store';

function record(overrides: Partial<AssetRecord> & { id: string; originalName: string }): AssetRecord {
  const dimension = overrides.dimension || '2d';
  const format = overrides.format || (dimension === '3d' ? 'glb' : 'png');

  return assetRecordSchema.parse({
    appwrite: { bucketId: 'assets', fileId: overrides.id },
    remotePath: '',
    mimeType: '',
    sizeOriginal: 1024,
    role: 'asset',
    dimension,
    category: 'sprite',
    format,
    ...(dimension === '3d'
      ? {
          technical: {
            kind: 'model3d',
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
    intelligence: { description: 'asset', tags: [], source: 'metadata', confidence: 0.6, perspective: 'any' },
    available: true,
    discoveredAt: '2026-01-01T00:00:00.000Z',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as AssetRecord;
}

const catalogue = assetCatalogueSchema.parse([
  record({
    id: 'assets:ship',
    originalName: 'space/player_ship.png',
    intelligence: {
      description: 'player ship sprite',
      tags: ['ship', 'space', 'player'],
      source: 'metadata',
      confidence: 0.7,
      perspective: 'any',
    },
  }),
  record({
    id: 'assets:crate',
    originalName: 'props/wooden_crate.png',
    category: 'prop',
    intelligence: {
      description: 'wooden crate prop',
      tags: ['crate', 'wooden'],
      source: 'metadata',
      confidence: 0.6,
      perspective: 'any',
    },
  }),
  record({
    id: 'assets:shipview',
    originalName: 'space/player_ship_preview.png',
    role: 'preview',
    dimension: 'data',
    category: 'other',
    intelligence: {
      description: 'Preview of the ship',
      tags: ['ship'],
      source: 'vision',
      confidence: 0.9,
      perspective: 'any',
    },
  }),
  record({
    id: 'assets:model',
    originalName: 'models/crate.glb',
    dimension: '3d',
    category: 'model3d',
    format: 'glb',
    mimeType: 'model/gltf-binary',
    dependencies: [{ kind: 'texture', uri: 'crate_albedo.png', required: true, embedded: false, resolved: true }],
  }),
]) as AssetCatalogue;

describe('loadAssetCatalogue', () => {
  it('degrades cleanly when there is no catalogue at all', async () => {
    resetCatalogueCache();

    const result = await loadAssetCatalogue({}, async () => {
      throw new Error('ENOENT');
    });

    expect(result.available).toBe(false);
    expect(result.catalogue).toEqual([]);
    expect(result.reason).toContain('No asset catalogue');
  });

  it('reports corrupt JSON instead of throwing', async () => {
    resetCatalogueCache();

    const result = await loadAssetCatalogue({}, async () => '{not json');

    expect(result.available).toBe(false);
    expect(result.reason).toContain('not valid JSON');
  });

  it('reports schema failures instead of serving a bad index', async () => {
    resetCatalogueCache();

    const result = await loadAssetCatalogue({}, async () => JSON.stringify([{ id: 'x' }]));

    expect(result.available).toBe(false);
    expect(result.reason).toContain('failed validation');
  });

  it('keeps dependency records in the catalogue while candidate search filters previews', async () => {
    resetCatalogueCache();

    const result = await loadAssetCatalogue({}, async () => JSON.stringify(catalogue));

    expect(result.available).toBe(true);
    expect(result.catalogue.map((entry) => entry.id)).toEqual([
      'assets:ship',
      'assets:crate',
      'assets:shipview',
      'assets:model',
    ]);
    expect(findLibraryCandidates(result.catalogue, { text: 'ship', limit: 10 }).candidates.map((entry) => entry.id)).not.toContain(
      'assets:shipview',
    );
  });
});

describe('catalogueSummary / catalogueGaps', () => {
  it('counts by dimension and category', () => {
    const summary = catalogueSummary(catalogue);

    expect(summary.total).toBe(4);
    expect(summary['2d/prop']).toBe(1);
    expect(summary['3d/model3d']).toBe(1);
  });

  it('names the exact reason an asset cannot ship', () => {
    const broken = assetCatalogueSchema.parse([
      ...catalogue,
      record({
        id: 'assets:broken',
        originalName: 'models/broken.gltf',
        dimension: '3d',
        category: 'model3d',
        format: 'gltf',
        dependencies: [{ kind: 'texture', uri: 'gone.png', required: true, embedded: false, resolved: false }],
      }),
    ]) as AssetCatalogue;

    const gap = catalogueGaps(broken).find((entry) => entry.id === 'assets:broken');

    expect(gap?.reason).toContain('gone.png');
  });
});

describe('destinationPathFor', () => {
  it('flattens the storage path into a safe game path', () => {
    expect(destinationPathFor(catalogue[0])).toBe('assets/space/player_ship.png');
    expect(destinationPathFor(catalogue[2])).toBe('assets/space/player_ship_preview.png');
  });
});

describe('findLibraryCandidates', () => {
  it('returns relevant, usable candidates with exact ids and paths', () => {
    const { candidates } = findLibraryCandidates(catalogue, { text: 'player ship', limit: 5 });

    expect(candidates[0].id).toBe('assets:ship');
    expect(candidates[0].path).toBe('assets/space/player_ship.png');
  });

  it('never offers a preview as a candidate', () => {
    const { candidates } = findLibraryCandidates(catalogue, { text: 'ship', limit: 10 });

    expect(candidates.map((entry) => entry.id)).not.toContain('assets:shipview');
  });

  it('ships a 3D model together with its external texture', () => {
    const withTexture = assetCatalogueSchema.parse([
      ...catalogue,
      record({ id: 'assets:albedo', originalName: 'models/crate_albedo.png' }),
    ]) as AssetCatalogue;

    const { candidates } = findLibraryCandidates(withTexture, { text: 'crate', dimension: '3d' });
    const model = candidates.find((candidate) => candidate.id === 'assets:model');

    expect(model?.group).toEqual(['assets/models/crate_albedo.png']);
  });

  it('excludes paths the workspace already contains', () => {
    const { candidates } = findLibraryCandidates(catalogue, {
      text: 'crate',
      excludePaths: ['assets/props/wooden_crate.png'],
    });

    expect(candidates.map((entry) => entry.path)).not.toContain('assets/props/wooden_crate.png');
  });

  it('never proposes the same destination twice', () => {
    const twins = assetCatalogueSchema.parse([
      record({
        id: 'assets:a',
        originalName: 'a/dup.png',
        intelligence: {
          description: 'dup sprite',
          tags: ['dup'],
          source: 'metadata',
          confidence: 0.6,
          perspective: 'any',
        },
      }),
      record({
        id: 'assets:b',
        originalName: 'b/dup.png',
        intelligence: {
          description: 'dup sprite',
          tags: ['dup'],
          source: 'metadata',
          confidence: 0.6,
          perspective: 'any',
        },
      }),
    ]) as AssetCatalogue;

    const { candidates } = findLibraryCandidates(twins, { text: 'dup', limit: 10 });

    expect(new Set(candidates.map((entry) => entry.path)).size).toBe(candidates.length);
  });

  it('keeps the shortlist short so a prompt can never flood', () => {
    const many = assetCatalogueSchema.parse(
      Array.from({ length: 60 }, (_, index) =>
        record({
          id: `assets:m${index}`,
          originalName: `space/ship_${index}.png`,
          intelligence: {
            description: 'ship sprite',
            tags: ['ship'],
            source: 'metadata',
            confidence: 0.6,
            perspective: 'any',
          },
        }),
      ),
    ) as AssetCatalogue;

    expect(findLibraryCandidates(many, { text: 'ship', limit: 100 }).candidates.length).toBeLessThanOrEqual(12);
  });

  it('returns nothing when nothing matches, so the plan falls back to procedural art', () => {
    expect(findLibraryCandidates(catalogue, { text: 'medieval cathedral stonework', limit: 5 }).candidates).toEqual([]);
  });

  it('approves only selected ids, and sources paths and groups from the verified candidates', () => {
    const offered = findLibraryCandidates(catalogue, { text: 'player ship crate', limit: 5 }).candidates;
    const selected = approveLibrarySelections(
      [{ id: offered[0].id }, { id: 'hallucinated:id' }, { id: offered[0].id }],
      offered,
      { engine: 'canvas2d' },
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe(offered[0].id);
    expect(selected[0].path).toBe(offered[0].path);
  });

  it('does not approve 3D models for a canvas2d blueprint', () => {
    const offered = findLibraryCandidates(catalogue, { text: 'crate', dimension: '3d' }).candidates;
    const selected = approveLibrarySelections(
      offered.map(({ id }) => ({ id })),
      offered,
      { engine: 'canvas2d' },
    );

    expect(offered[0].requiredEngine).toBe('webgl');
    expect(selected).toEqual([]);
  });

  it('approves the model and its complete group for a WebGL plan', () => {
    const withTexture = assetCatalogueSchema.parse([
      ...catalogue,
      record({ id: 'assets:albedo', originalName: 'models/crate_albedo.png' }),
    ]) as AssetCatalogue;
    const offered = findLibraryCandidates(withTexture, { text: 'crate', dimension: '3d' }).candidates;
    const selected = approveLibrarySelections(
      offered.map(({ id }) => ({ id })),
      offered,
      { engine: 'webgl' },
    );

    expect(selected[0]?.group).toEqual(['assets/models/crate_albedo.png']);
  });

  it('rejects a candidate whose destination collides with an existing workspace file', () => {
    const offered = findLibraryCandidates(catalogue, { text: 'ship' }).candidates;
    const selected = approveLibrarySelections(
      offered.map(({ id }) => ({ id })),
      offered,
      {
        engine: 'canvas2d',
        existingPaths: ['assets/space/player_ship.png'],
      },
    );

    expect(selected.map((entry) => entry.path)).not.toContain('assets/space/player_ship.png');
  });
});

describe('formatCandidateBriefing', () => {
  it('emits exact ids and paths and no credentials or URLs', () => {
    const { candidates } = findLibraryCandidates(catalogue, { text: 'player ship', limit: 3 });
    const briefing = formatCandidateBriefing(candidates, 'build a space shooter');

    expect(briefing).toContain('LIBRARY CANDIDATES');
    expect(briefing).toContain('id=assets:ship');
    expect(briefing).toContain('path=assets/space/player_ship.png');
    expect(briefing).toContain('build a space shooter');
    expect(briefing).not.toContain('appwrite');
    expect(briefing).not.toContain('standard_');
  });

  it('produces nothing at all when there are no candidates', () => {
    expect(formatCandidateBriefing([], 'anything')).toBe('');
  });
});

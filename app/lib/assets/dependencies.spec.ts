import { describe, expect, it } from 'vitest';
import { assetCatalogueSchema, assetRecordSchema, type AssetRecord } from './asset-schema';
import {
  checkCompatibility,
  filterUsableAssets,
  linkModelPreviews,
  matchDependency,
  requiredFetchGroup,
  resolveCatalogueDependencies,
} from './dependencies';

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
      description: 'asset',
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

describe('dependency matching', () => {
  it('matches an exact relative path', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({ id: 'a', originalName: 'crate.png', remotePath: 'textures/crate.png' }),
      record({ id: 'b', originalName: 'crate_normal.png', remotePath: 'textures/crate_normal.png' }),
    ]);

    expect(matchDependency(catalogue, 'textures/crate.png')?.id).toBe('a');
  });

  it('matches a dependency against a folder-prefixed catalogue filename', () => {
    /*
     * Appwrite stores the folder inside the file name, so the reference
     * "crate_albedo.png" must still find "models/crate_albedo.png".
     */
    const catalogue = assetCatalogueSchema.parse([
      record({ id: 'tex', originalName: 'models/crate_albedo.png', remotePath: 'models' }),
    ]);

    expect(matchDependency(catalogue, 'crate_albedo.png')?.id).toBe('tex');
  });

  it('falls back to a unique basename match', () => {
    const catalogue = assetCatalogueSchema.parse([record({ id: 'a', originalName: 'crate.png' })]);

    expect(matchDependency(catalogue, './nested/crate.png')?.id).toBe('a');
  });

  it('refuses to guess when the basename is ambiguous', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({ id: 'a', originalName: 'crate.png', remotePath: 'wood/crate.png' }),
      record({ id: 'b', originalName: 'crate.png', remotePath: 'stone/crate.png' }),
    ]);

    expect(matchDependency(catalogue, 'crate.png')).toBeUndefined();
  });
});

describe('catalogue dependency resolution', () => {
  it('resolves a complete model + texture group', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({
        id: 'model',
        originalName: 'crate.gltf',
        dimension: '3d',
        category: 'model3d',
        format: 'gltf',
        remotePath: 'models/crate.gltf',
        dependencies: [
          { kind: 'model', uri: 'crate.bin', required: true, embedded: false, resolved: false },
          { kind: 'texture', uri: 'crate_albedo.png', required: true, embedded: false, resolved: false },
        ],
      }),
      record({
        id: 'bin',
        originalName: 'crate.bin',
        dimension: 'data',
        category: 'other',
        format: 'bin',
        remotePath: 'models/crate.bin',
      }),
      record({ id: 'tex', originalName: 'crate_albedo.png', remotePath: 'models/crate_albedo.png' }),
    ]);

    const resolved = resolveCatalogueDependencies(catalogue);
    const model = resolved.find((entry) => entry.id === 'model');

    expect(model?.dependencies.every((dependency) => dependency.resolved)).toBe(true);
    expect(checkCompatibility(model!, resolved).usable).toBe(true);
    expect(
      requiredFetchGroup(model!, resolved)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(['bin', 'model', 'tex']);
  });

  it('leaves an unresolvable reference broken instead of binding the wrong file', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({
        id: 'model',
        originalName: 'crate.gltf',
        dimension: '3d',
        category: 'model3d',
        format: 'gltf',
        dependencies: [
          { kind: 'texture', uri: 'missing_albedo.png', required: true, embedded: false, resolved: false },
        ],
      }),
    ]);

    const resolved = resolveCatalogueDependencies(catalogue);
    const report = checkCompatibility(resolved[0], resolved);

    expect(report.usable).toBe(false);
    expect(report.blocking[0]).toContain('missing_albedo.png');
  });

  it('never refetches an embedded texture', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({
        id: 'model',
        originalName: 'crate.glb',
        dimension: '3d',
        category: 'model3d',
        format: 'glb',
        dependencies: [{ kind: 'texture', uri: 'bufferView:4', required: true, embedded: true, resolved: false }],
      }),
    ]);

    const resolved = resolveCatalogueDependencies(catalogue);

    expect(resolved[0].dependencies[0].resolved).toBe(true);
    expect(requiredFetchGroup(resolved[0], resolved).map((entry) => entry.id)).toEqual(['model']);
    expect(checkCompatibility(resolved[0], resolved).usable).toBe(true);
  });

  it('does not mutate the input catalogue', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({
        id: 'model',
        originalName: 'crate.gltf',
        dimension: '3d',
        category: 'model3d',
        format: 'gltf',
        dependencies: [{ kind: 'texture', uri: 'tex.png', required: true, embedded: false, resolved: false }],
      }),
      record({ id: 'tex', originalName: 'tex.png' }),
    ]);
    const snapshot = JSON.stringify(catalogue);

    resolveCatalogueDependencies(catalogue);

    expect(JSON.stringify(catalogue)).toBe(snapshot);
  });

  it('warns about Draco-compressed geometry without blocking it', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({
        id: 'model',
        originalName: 'robot.glb',
        dimension: '3d',
        category: 'model3d',
        format: 'glb',
        technical: {
          kind: 'model3d',
          model: {
            format: 'glb',
            meshes: 2,
            materials: ['Steel'],
            textures: ['bufferView:1'],
            embeddedTextures: 1,
            animations: 1,
            requiresDraco: true,
            externalRefs: [],
          },
        },
      }),
    ]);

    const report = checkCompatibility(catalogue[0], catalogue);

    expect(report.usable).toBe(true);
    expect(report.warnings.join(' ')).toContain('Draco');
  });
});

describe('model preview linking', () => {
  it('links a matching preview PNG to its model and keeps it out of the asset pool', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({ id: 'model', originalName: 'crate.glb', dimension: '3d', category: 'model3d', format: 'glb' }),
      record({
        id: 'preview',
        originalName: 'crate.png',
        role: 'preview',
        dimension: 'data',
        category: 'other',
        intelligence: {
          description: 'Preview render',
          tags: [],
          source: 'vision',
          confidence: 0.9,
          perspective: 'any',
        },
      }),
    ]);

    const linked = linkModelPreviews(catalogue);
    const preview = linked.find((entry) => entry.id === 'preview');

    expect(preview?.dependencies).toEqual([
      { kind: 'preview', uri: 'model', required: false, embedded: false, resolved: true },
    ]);
    expect(preview?.intelligence.description).toContain('crate.glb');

    const { usable } = filterUsableAssets(linked);

    expect(usable.map((entry) => entry.id)).toEqual(['model']);
  });

  it('leaves an unrelated preview image alone', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({ id: 'model', originalName: 'crate.glb', dimension: '3d', category: 'model3d', format: 'glb' }),
      record({
        id: 'preview',
        originalName: 'hero.png',
        role: 'preview',
        dimension: 'data',
        category: 'other',
        intelligence: { description: 'Preview', tags: [], source: 'vision', confidence: 0.8, perspective: 'any' },
      }),
    ]);

    expect(linkModelPreviews(catalogue).find((entry) => entry.id === 'preview')?.dependencies).toHaveLength(0);
  });
});

describe('filterUsableAssets', () => {
  it('separates usable assets from unusable ones with a stated reason', () => {
    const catalogue = assetCatalogueSchema.parse([
      record({ id: 'good', originalName: 'hero.png' }),
      record({ id: 'dead', originalName: 'gone.png', available: false, unavailableReason: 'HTTP 404' }),
      record({
        id: 'broken-model',
        originalName: 'crate.gltf',
        dimension: '3d',
        category: 'model3d',
        format: 'gltf',
        dependencies: [{ kind: 'texture', uri: 'nope.png', required: true, embedded: false, resolved: false }],
      }),
    ]);

    const { usable, rejected } = filterUsableAssets(catalogue);

    expect(usable.map((entry) => entry.id)).toEqual(['good']);
    expect(rejected.map((entry) => entry.id).sort()).toEqual(['broken-model', 'dead']);
    expect(rejected.find((entry) => entry.id === 'dead')?.reasons[0]).toContain('HTTP 404');
  });
});

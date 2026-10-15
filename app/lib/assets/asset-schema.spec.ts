import { describe, expect, it } from 'vitest';
import { assetRecordSchema, isAssetUsable, missingDependencies, stableAssetId, type AssetRecord } from './asset-schema';

/**
 * Plain (unvalidated) record so tests can construct deliberately invalid
 * shapes. `validRecord()` is the parsing counterpart.
 */
function baseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: stableAssetId('assets', 'file-1'),
    appwrite: { bucketId: 'assets', fileId: 'file-1', bucketName: 'assets' },
    originalName: 'crate.png',
    remotePath: 'props/crate.png',
    mimeType: 'image/png',
    sizeOriginal: 1024,
    role: 'asset',
    dimension: '2d',
    category: 'sprite',
    format: 'png',
    technical: { kind: 'image', image: { width: 128, height: 128, hasAlpha: true, frames: 1, tileGrid: null } },
    dependencies: [],
    intelligence: {
      description: '2D sprite in png format; 128x128; transparent.',
      tags: ['2d', 'sprite', 'crate'],
      source: 'metadata',
      confidence: 0.65,
      perspective: 'any',
    },
    available: true,
    discoveredAt: '2026-01-01T00:00:00.000Z',
    lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function validRecord(overrides: Record<string, unknown> = {}): AssetRecord {
  return assetRecordSchema.parse(baseRecord(overrides)) as AssetRecord;
}

describe('assetRecordSchema', () => {
  it('keeps provenance, licensing and original metadata intact', () => {
    const record = validRecord({
      originalName: 'Rusted Crate FINAL v2.png',
      checksum: 'sha256:' + 'a'.repeat(64),
      licensing: { name: 'CC-BY-4.0', url: 'https://example.com/license', attributionRequired: true },
    });

    expect(record.originalName).toBe('Rusted Crate FINAL v2.png');
    expect(record.checksum).toBe('sha256:' + 'a'.repeat(64));
    expect(record.licensing?.attributionRequired).toBe(true);
    expect(record.appwrite.bucketId).toBe('assets');
  });

  it('rejects technical metadata that contradicts the declared dimension', () => {
    const result = assetRecordSchema.safeParse(
      baseRecord({
        dimension: 'audio',
        technical: { kind: 'image', image: { width: 8, height: 8, hasAlpha: false, frames: 1, tileGrid: null } },
      }),
    );

    expect(result.success).toBe(false);
  });

  it('forbids a preview from masquerading as a usable asset', () => {
    const result = assetRecordSchema.safeParse(
      baseRecord({
        role: 'preview',
        dimension: '3d',
        category: 'model3d',
        intelligence: {
          description: 'Crate render',
          tags: ['crate'],
          source: 'filename',
          confidence: 0.9,
          perspective: 'any',
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it('caps unreviewed preview confidence so it never claims certainty', () => {
    const overconfident = assetRecordSchema.safeParse(
      baseRecord({
        role: 'preview',
        dimension: 'data',
        category: 'other',
        format: 'png',
        technical: undefined,
        intelligence: {
          description: 'Preview of crate',
          tags: ['preview'],
          source: 'filename',
          confidence: 0.9,
          perspective: 'any',
        },
      }),
    );
    expect(overconfident.success).toBe(false);

    const calibrated = assetRecordSchema.safeParse(
      baseRecord({
        role: 'preview',
        dimension: 'data',
        category: 'other',
        format: 'png',
        technical: undefined,
        intelligence: {
          description: 'Preview of crate',
          tags: ['preview'],
          source: 'filename',
          confidence: 0.4,
          perspective: 'any',
        },
      }),
    );
    expect(calibrated.success).toBe(true);
  });

  it('requires a reason for an unavailable asset', () => {
    const result = assetRecordSchema.safeParse(baseRecord({ available: false }));

    expect(result.success).toBe(false);
    expect(assetRecordSchema.safeParse(baseRecord({ available: false, unavailableReason: 'HTTP 404' })).success).toBe(
      true,
    );
  });

  it('drops unknown keys instead of storing unvalidated junk', () => {
    const result = assetRecordSchema.safeParse({ ...baseRecord(), sneaky: 'value' });

    expect(result.success).toBe(false);
  });
});

describe('usability', () => {
  it('treats a resolvable dependency chain as usable', () => {
    const record = validRecord({
      dependencies: [
        { kind: 'texture', uri: 'textures/crate.png', required: true, embedded: false, resolved: true },
        { kind: 'texture', uri: 'textures/crate_bump.png', required: true, embedded: false, resolved: true },
      ],
    });

    expect(isAssetUsable(record)).toBe(true);
    expect(missingDependencies(record)).toHaveLength(0);
  });

  it('blocks an asset whose required dependency is missing', () => {
    const record = validRecord({
      dependencies: [{ kind: 'texture', uri: 'textures/gone.png', required: true, embedded: false, resolved: false }],
    });

    expect(isAssetUsable(record)).toBe(false);
    expect(missingDependencies(record).map((entry) => entry.uri)).toEqual(['textures/gone.png']);
  });

  it('never re-fetches an embedded texture', () => {
    const record = validRecord({
      dimension: '3d',
      category: 'model3d',
      format: 'glb',
      technical: undefined,
      dependencies: [{ kind: 'texture', uri: 'bufferView:3', required: true, embedded: true, resolved: false }],
    });

    expect(isAssetUsable(record)).toBe(true);
    expect(missingDependencies(record)).toHaveLength(0);
  });

  it('does not offer a supporting data file as a standalone game asset', () => {
    const data = validRecord({
      originalName: 'crate.bin',
      dimension: 'data',
      category: 'other',
      format: 'bin',
      technical: undefined,
    });

    expect(isAssetUsable(data)).toBe(false);
  });

  it('never treats a preview as usable', () => {
    const record = validRecord({
      role: 'preview',
      dimension: 'data',
      category: 'other',
      technical: undefined,
      intelligence: {
        description: 'Preview render of crate.glb',
        tags: ['preview'],
        source: 'vision',
        confidence: 0.9,
        perspective: 'any',
      },
    });

    expect(isAssetUsable(record)).toBe(false);
  });
});

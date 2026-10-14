import { describe, expect, it } from 'vitest';
import { buildAssetCatalogue, writeCatalogueSafely } from './catalogue-builder';
import type { AssetLibraryConfig } from '~/lib/.server/assets/asset-library-client';
import { assetCatalogueSchema, type AssetRecord } from './asset-schema';
import { checkCompatibility, searchAssets } from './index';

const encoder = new TextEncoder();

const config: AssetLibraryConfig = {
  endpoint: 'https://fra.cloud.appwrite.io/v1',
  projectId: '6a83071d00217ab38269',
  bucketId: 'assets',
  apiKey: 'standard_test_key_value',
};

function pngBytes(width: number, height: number, colorType = 6): Uint8Array {
  const push = (type: string, payload: number[]) => {
    const length = payload.length;

    return [
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
      ...encoder.encode(type),
      ...payload,
      0,
      0,
      0,
      0,
    ];
  };

  const chunks = [
    push('IHDR', [
      (width >>> 24) & 0xff,
      (width >>> 16) & 0xff,
      (width >>> 8) & 0xff,
      width & 0xff,
      (height >>> 24) & 0xff,
      (height >>> 16) & 0xff,
      (height >>> 8) & 0xff,
      height & 0xff,
      8,
      colorType,
      0,
      0,
      0,
    ]),
    push('IEND', []),
  ];

  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat()]);
}

function glbBytes(document: unknown): Uint8Array {
  const json = encoder.encode(JSON.stringify(document));
  const padded = new Uint8Array(Math.ceil(json.length / 4) * 4);
  padded.set(json);

  const total = 12 + 8 + padded.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  out.set(encoder.encode('glTF'), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, padded.length, true);
  out.set(encoder.encode('JSON'), 16);
  out.set(padded, 20);

  return out;
}

/** Fake Appwrite serving a fixed file set. */
function fakeAppwrite(files: Array<{ id: string; name: string; bytes: Uint8Array }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);

    // Collection listing: /storage/buckets/<b>/files?projectId=...
    if (/\/files\?/.test(url) || url.endsWith('/files')) {
      return new Response(
        JSON.stringify({
          files: files.map((entry) => ({
            $id: entry.id,
            name: entry.name,
            sizeOriginal: entry.bytes.byteLength,
            mimeType: '',
            $createdAt: '2026-01-01T00:00:00.000Z',
            $updatedAt: '2026-01-01T00:00:00.000Z',
          })),
        }),
      );
    }

    const match = /\/files\/([^/?]+)/.exec(url);
    const id = match ? decodeURIComponent(match[1]) : '';
    const file = files.find((entry) => entry.id === id);

    if (!file) {
      return new Response('{"message":"Not found"}', { status: 404 });
    }

    return new Response(file.bytes, { status: 200 });
  }) as unknown as typeof fetch;
}

function listOnly(names: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);

    if (!/\/files\?/.test(url) && !url.endsWith('/files')) {
      return new Response(new Uint8Array([1]), { status: 200 });
    }

    return new Response(
      JSON.stringify({
        files: names.map((name, index) => ({ $id: `f${index}`, name, sizeOriginal: 10, mimeType: '' })),
      }),
    );
  }) as unknown as typeof fetch;
}

describe('buildAssetCatalogue', () => {
  it('probes a real bucket and produces validated, searchable records', async () => {
    const files = [
      { id: 'f1', name: 'props/wooden_crate.png', bytes: pngBytes(256, 256) },
      { id: 'f2', name: 'space/ship_preview.png', bytes: pngBytes(512, 512) },
      { id: 'f3', name: 'models/crate.glb', bytes: glbBytes({ asset: { version: '2.0' }, meshes: [{}] }) },
    ];

    const report = await buildAssetCatalogue({ config, fetchImpl: fakeAppwrite(files), dryRun: true });

    expect(report.filesSeen).toBe(3);
    expect(assetCatalogueSchema.safeParse(report.records).success).toBe(true);

    const crate = report.records.find((record) => record.originalName.endsWith('wooden_crate.png'));
    expect(crate?.dimension).toBe('2d');
    expect(crate?.remotePath).toBe('props');
    expect(crate?.technical?.kind).toBe('image');

    const preview = report.records.find((record) => record.originalName.endsWith('ship_preview.png'));
    expect(preview?.role).toBe('preview');
    expect(preview?.dimension).toBe('data');

    const model = report.records.find((record) => record.originalName.endsWith('crate.glb'));
    expect(model?.dimension).toBe('3d');

    expect(report.previewCount).toBe(1);
  });

  it('never returns a preview as a selectable asset', async () => {
    const files = [
      { id: 'f1', name: 'ship.png', bytes: pngBytes(64, 64) },
      { id: 'f2', name: 'ship_preview.png', bytes: pngBytes(512, 512) },
    ];

    const report = await buildAssetCatalogue({ config, fetchImpl: fakeAppwrite(files) });
    const results = searchAssets(report.records, { text: 'ship', limit: 10 });

    expect(results.map((entry) => entry.record.role)).not.toContain('preview');
  });

  it('resolves a model texture group end to end', async () => {
    const gltf = encoder.encode(
      JSON.stringify({
        asset: { version: '2.0' },
        meshes: [{}],
        images: [{ uri: 'crate_albedo.png' }],
      }),
    );
    const files = [
      { id: 'f1', name: 'models/crate.gltf', bytes: gltf },
      { id: 'f2', name: 'models/crate_albedo.png', bytes: pngBytes(256, 256) },
    ];

    const report = await buildAssetCatalogue({ config, fetchImpl: fakeAppwrite(files) });
    const model = report.records.find((record) => record.originalName.endsWith('crate.gltf'));

    expect(model?.dependencies[0]?.resolved).toBe(true);
    expect(checkCompatibility(model!, report.records).usable).toBe(true);
  });

  it('reports an unusable model instead of shipping it silently', async () => {
    const gltf = encoder.encode(
      JSON.stringify({ asset: { version: '2.0' }, meshes: [{}], images: [{ uri: 'gone.png' }] }),
    );
    const files = [{ id: 'f1', name: 'models/crate.gltf', bytes: gltf }];

    const report = await buildAssetCatalogue({ config, fetchImpl: fakeAppwrite(files) });

    expect(report.unusable).toHaveLength(1);
    expect(report.unusable[0].reasons.join(' ')).toContain('gone.png');
  });

  it('stops at maxFiles and says so', async () => {
    const report = await buildAssetCatalogue({
      config,
      maxFiles: 1,
      fetchImpl: listOnly(['a.png', 'b.png', 'c.png']),
      dryRun: true,
    });

    expect(report.filesSeen).toBe(1);
    expect(report.warnings.join(' ')).toContain('maxFiles');
  });

  it('surfaces an auth blocker instead of writing an empty catalogue', async () => {
    const fetchImpl = (async () =>
      new Response('{"message":"unauthorized"}', { status: 401 })) as unknown as typeof fetch;
    const report = await buildAssetCatalogue({ config, fetchImpl });

    expect(report.blockers[0]?.code).toBe('unauthorized');
    expect(report.records).toHaveLength(0);
  });

  it('applies vision enrichment when available and survives when it throws', async () => {
    const files = [{ id: 'f1', name: 'crate.png', bytes: pngBytes(64, 64) }];

    const enriched = await buildAssetCatalogue({
      config,
      fetchImpl: fakeAppwrite(files),
      enrich: async () => ({
        intelligence: { source: 'vision', confidence: 0.95, description: 'A wooden crate.' },
      }),
    });
    expect(enriched.records[0].intelligence.source).toBe('vision');

    const resilient = await buildAssetCatalogue({
      config,
      fetchImpl: fakeAppwrite(files),
      enrich: async () => {
        throw new Error('vision service down');
      },
    });
    expect(resilient.records).toHaveLength(1);
    expect(resilient.records[0].intelligence.source).not.toBe('vision');
  });

  it('records a file it could not download as unreadable, not absent', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);

      if (!/\/files\?/.test(url) && !url.endsWith('/files')) {
        return new Response('nope', { status: 500 });
      }

      return new Response(JSON.stringify({ files: [{ $id: 'f1', name: 'big.png', sizeOriginal: 99 }] }));
    }) as unknown as typeof fetch;

    const report = await buildAssetCatalogue({ config, fetchImpl });

    expect(report.unreadable).toHaveLength(1);
    expect(report.unreadable[0].originalName).toBe('big.png');
  });

  it('preserves licensing and reviewed metadata when re-indexing the same bytes', async () => {
    const files = [{ id: 'f1', name: 'crate.png', bytes: pngBytes(64, 64) }];
    const first = await buildAssetCatalogue({ config, fetchImpl: fakeAppwrite(files) });
    const previous = first.records.map((record) => ({
      ...record,
      licensing: { name: 'CC-BY-4.0', attributionRequired: true },
      intelligence: {
        ...record.intelligence,
        source: 'vision' as const,
        confidence: 0.98,
        description: 'A hand-painted crate.',
      },
    }));

    const second = await buildAssetCatalogue({ config, fetchImpl: fakeAppwrite(files), previousCatalogue: previous });

    expect(second.records[0].licensing?.name).toBe('CC-BY-4.0');
    expect(second.records[0].intelligence.description).toBe('A hand-painted crate.');
    expect(second.records[0].intelligence.source).toBe('vision');
  });

  it('keeps a previously catalogued file as unavailable instead of deleting its metadata', async () => {
    const previous = assetCatalogueSchema.parse([
      {
        id: 'assets:f-gone',
        appwrite: { bucketId: 'assets', fileId: 'f-gone' },
        originalName: 'rare/old_model.glb',
        remotePath: 'rare',
        mimeType: 'model/gltf-binary',
        sizeOriginal: 200,
        role: 'asset',
        dimension: '3d',
        category: 'model3d',
        format: 'glb',
        dependencies: [],
        intelligence: {
          description: 'Verified old model',
          tags: ['rare'],
          source: 'manual',
          confidence: 1,
          perspective: 'any',
        },
        licensing: { name: 'Keep this license' },
        available: true,
        discoveredAt: '2025-01-01T00:00:00.000Z',
        lastVerifiedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);
    const report = await buildAssetCatalogue({ config, fetchImpl: listOnly([]), previousCatalogue: previous });
    const retained = report.records.find((record) => record.id === 'assets:f-gone');

    expect(retained?.available).toBe(false);
    expect(retained?.unavailableReason).toContain('not present');
    expect(retained?.intelligence.description).toBe('Verified old model');
    expect(retained?.licensing?.name).toBe('Keep this license');
  });
});

describe('writeCatalogueSafely', () => {
  const oneRecord = assetCatalogueSchema.parse([
    {
      id: 'assets:f1',
      appwrite: { bucketId: 'assets', fileId: 'f1' },
      originalName: 'crate.png',
      remotePath: '',
      mimeType: 'image/png',
      sizeOriginal: 10,
      role: 'asset',
      dimension: '2d',
      category: 'sprite',
      format: 'png',
      dependencies: [],
      intelligence: { description: 'x', tags: [], source: 'metadata', confidence: 0.5, perspective: 'any' },
      available: true,
      discoveredAt: '2026-01-01T00:00:00.000Z',
      lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    },
  ]) as AssetRecord[];

  it('refuses to write an empty catalogue so a failed run cannot wipe a good one', async () => {
    const writeFile = async () => {
      throw new Error('should not write');
    };

    const result = await writeCatalogueSafely('/tmp/x.json', [], { writeFile });

    expect(result.written).toBe(false);
    expect(result.reason).toContain('empty');
  });

  it('backs up the previous catalogue before overwriting', async () => {
    const written: Record<string, string> = {};

    const result = await writeCatalogueSafely('/tmp/catalogue.json', oneRecord, {
      readFile: async () => '[{"old":true}]',
      writeFile: async (path, data) => {
        written[path] = data;
      },
    });

    expect(result.written).toBe(true);
    expect(result.backupPath).toContain('catalogue.json.');
    expect(written[result.backupPath!]).toBe('[{"old":true}]');
    expect(JSON.parse(written['/tmp/catalogue.json'])[0].originalName).toBe('crate.png');
  });

  it('writes cleanly on a first run with no backup', async () => {
    const written: Record<string, string> = {};

    const result = await writeCatalogueSafely('/tmp/catalogue.json', oneRecord, {
      readFile: async () => {
        throw new Error('ENOENT');
      },
      writeFile: async (path, data) => {
        written[path] = data;
      },
    });

    expect(result.written).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(Object.keys(written)).toEqual(['/tmp/catalogue.json']);
  });
});

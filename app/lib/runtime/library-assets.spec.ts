import { describe, expect, it } from 'vitest';
import { materializeLibraryAssets } from './library-assets';
import { generatedAssets } from '~/lib/stores/generated-assets';
import { blueprintSchema, type Blueprint } from '~/lib/harness/blueprint';

const encoder = new TextEncoder();

function glbBytes(document: unknown): Uint8Array {
  const json = encoder.encode(JSON.stringify(document));
  const padded = new Uint8Array(Math.ceil(json.length / 4) * 4);
  padded.set(json);

  const total = 12 + 8 + padded.length;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(padded, 20);

  return bytes;
}

function parseGlbJson(bytes: Uint8Array): Record<string, any> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);

  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)).replace(/[\u0000\u0020]+$/, ''));
}

function fakeWebcontainer(options: { failOn?: string } = {}) {
  const files = new Map<string, Uint8Array>();

  return {
    files,
    api: {
      fs: {
        mkdir: async () => undefined,
        writeFile: async (path: string, data: Uint8Array) => {
          if (options.failOn === path) {
            throw new Error(`disk full writing ${path}`);
          }

          files.set(path, data);
        },
        readdir: async (path: string) => {
          const prefix = path.endsWith('/') ? path : `${path}/`;
          return [...files.keys()]
            .filter((candidate) => candidate.startsWith(prefix))
            .map((candidate) => ({ name: candidate.slice(prefix.length).split('/')[0] }))
            .filter((entry, index, all) => all.findIndex((other) => other.name === entry.name) === index);
        },
        rm: async (path: string) => {
          files.delete(path);
        },
      },
    },
  };
}

function okResponse(payload: unknown) {
  return { ok: true, json: async () => payload } as unknown as Response;
}

function testBlueprint(
  libraryAssets: Array<{ id: string; path: string; group?: string[]; dimension?: '2d' | '3d'; category?: string }>,
): Blueprint {
  return blueprintSchema.parse({
    title: 'Test game',
    summary: 'Game for library asset tests',
    engine: 'webgl',
    systems: ['World', 'Rendering'],
    fileOperations: [
      { path: 'index.html', operation: 'create', purpose: 'HTML game shell', expectedHash: null },
      { path: 'game.js', operation: 'create', purpose: 'Game entry point', expectedHash: null },
    ],
    assetOperations: [],
    libraryAssets: libraryAssets.map((asset) => ({
      id: asset.id,
      path: asset.path,
      dimension: asset.dimension || '2d',
      category: asset.category || 'sprite',
      group: asset.group || [],
    })),
    scriptOrder: ['game.js'],
    acceptanceCriteria: ['Game starts', 'Controls work', 'Assets load'],
    schemaVersion: '1.0',
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: 'library-assets-test',
    baseRevision: `sha256:${'a'.repeat(64)}`,
    manifest: [],
    verification: {
      scenarios: ['startup', 'controls', 'restart', 'resize'],
      minimumSimulationSteps: 45,
      requireDiagnostics: true,
      requireWebGL: true,
    },
    budgets: { assetAttempts: 1, maximumSourceBytes: 4 * 1024 * 1024, maximumResponseSegments: 64 },
  });
}

const blueprint = testBlueprint([
  { id: 'assets:ship', path: 'assets/player_ship.png' },
  { id: 'assets:model', path: 'assets/crate.glb', group: ['assets/crate_albedo.png'] },
]);

describe('materializeLibraryAssets', () => {
  it('does nothing at all when the plan selects no library assets', async () => {
    const container = fakeWebcontainer();
    const result = await materializeLibraryAssets({
      blueprint: testBlueprint([]),
      executionToken: 'test-token',
      webcontainer: container.api,
      fetchImpl: (async () => {
        throw new Error('must not fetch');
      }) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.written).toEqual([]);
  });

  it('writes every returned file into the workspace', async () => {
    const container = fakeWebcontainer();

    const result = await materializeLibraryAssets({
      blueprint,
      executionToken: 'test-token',
      webcontainer: container.api,
      fetchImpl: (async () =>
        okResponse({
          ok: true,
          files: [
            {
              id: 'assets:ship',
              path: 'assets/player_ship.png',
              mimeType: 'image/png',
              base64: btoa('PNG'),
              byteLength: 3,
            },
            {
              id: 'assets:model',
              path: 'assets/crate.glb',
              mimeType: 'model/gltf-binary',
              base64: btoa('GLB'),
              byteLength: 3,
            },
          ],
        })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.written.map((entry) => entry.path)).toEqual(['assets/player_ship.png', 'assets/crate.glb']);
    expect(container.files.has('assets/player_ship.png')).toBe(true);
    expect(container.files.has('assets/crate.glb')).toBe(true);
  });

  it('reports non-inlinable assets rather than pretending they preview', async () => {
    const container = fakeWebcontainer();

    const result = await materializeLibraryAssets({
      blueprint,
      executionToken: 'test-token',
      webcontainer: container.api,
      fetchImpl: (async () =>
        okResponse({
          ok: true,
          files: [
            {
              id: 'assets:ship',
              path: 'assets/player_ship.png',
              mimeType: 'image/png',
              base64: btoa('PNG'),
              byteLength: 3,
            },
            {
              id: 'assets:model',
              path: 'assets/crate.glb',
              mimeType: 'model/gltf-binary',
              base64: btoa('GLB'),
              byteLength: 3,
            },
          ],
        })) as unknown as typeof fetch,
    });

    // model/gltf-binary is a valid data: source, so it is inlined, not skipped.
    expect(result.notInlinable).toEqual([]);
  });

  it('degrades gracefully when the library is unavailable instead of failing the build', async () => {
    const container = fakeWebcontainer();

    const result = await materializeLibraryAssets({
      blueprint,
      executionToken: 'test-token',
      webcontainer: container.api,
      fetchImpl: (async () => okResponse({ ok: false, error: 'No asset catalogue' })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No asset catalogue');
    expect(container.files.size).toBe(0);
  });

  it('degrades gracefully when the network fails', async () => {
    const result = await materializeLibraryAssets({
      blueprint,
      executionToken: 'test-token',
      webcontainer: fakeWebcontainer().api,
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('offline');
  });

  it('rolls back every written file when one write fails, leaving no half group', async () => {
    const container = fakeWebcontainer({ failOn: 'assets/crate.glb' });

    const result = await materializeLibraryAssets({
      blueprint,
      executionToken: 'test-token',
      webcontainer: container.api,
      fetchImpl: (async () =>
        okResponse({
          ok: true,
          files: [
            {
              id: 'assets:ship',
              path: 'assets/player_ship.png',
              mimeType: 'image/png',
              base64: btoa('PNG'),
              byteLength: 3,
            },
            {
              id: 'assets:model',
              path: 'assets/crate.glb',
              mimeType: 'model/gltf-binary',
              base64: btoa('GLB'),
              byteLength: 3,
            },
          ],
        })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);

    // The texture that was written first must not survive the failed group.
    expect(container.files.size).toBe(0);
  });

  it('refuses to overwrite any existing workspace file before writing the group', async () => {
    const container = fakeWebcontainer();
    container.files.set('assets/player_ship.png', new Uint8Array([9]));

    const result = await materializeLibraryAssets({
      blueprint,
      executionToken: 'test-token',
      webcontainer: container.api,
      fetchImpl: (async () =>
        okResponse({
          ok: true,
          files: [
            {
              id: 'assets:ship',
              path: 'assets/player_ship.png',
              mimeType: 'image/png',
              base64: btoa('new'),
              byteLength: 3,
            },
            {
              id: 'assets:model',
              path: 'assets/crate.glb',
              mimeType: 'model/gltf-binary',
              base64: btoa('GLB'),
              byteLength: 3,
            },
          ],
        })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Refusing to overwrite');
    expect(Array.from(container.files.get('assets/player_ship.png')!)).toEqual([9]);
    expect(container.files.has('assets/crate.glb')).toBe(false);
  });

  it('converts base64 payloads to real bytes on disk', async () => {
    const container = fakeWebcontainer();

    await materializeLibraryAssets({
      blueprint: testBlueprint([{ id: 'assets:ship', path: 'assets/hero.png' }]),
      executionToken: 'test-token',
      webcontainer: container.api,
      fetchImpl: (async () =>
        okResponse({
          ok: true,
          files: [
            {
              id: 'assets:ship',
              path: 'assets/hero.png',
              mimeType: 'image/png',
              base64: btoa(String.fromCharCode(137, 80, 78, 71)),
              byteLength: 4,
            },
          ],
        })) as unknown as typeof fetch,
    });

    expect(Array.from(container.files.get('assets/hero.png')!)).toEqual([137, 80, 78, 71]);
  });

  it('rewrites glTF sidecar texture URIs to data URLs before writing the model', async () => {
    const container = fakeWebcontainer();
    const gltf = encoder.encode(JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'crate_albedo.png' }] }));
    const textureBase64 = btoa('texture-bytes');

    const result = await materializeLibraryAssets({
      blueprint: testBlueprint([
        { id: 'assets:model', path: 'assets/models/crate.gltf', group: ['assets/models/crate_albedo.png'] },
      ]),
      executionToken: 'test-token',
      webcontainer: container.api,
      fetchImpl: (async () =>
        okResponse({
          ok: true,
          files: [
            {
              id: 'assets:model',
              path: 'assets/models/crate.gltf',
              mimeType: 'model/gltf+json',
              base64: btoa(String.fromCharCode(...gltf)),
              byteLength: gltf.length,
            },
            {
              id: 'assets:texture',
              path: 'assets/models/crate_albedo.png',
              mimeType: 'image/png',
              base64: textureBase64,
              byteLength: textureBase64.length,
            },
          ],
        })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);

    const model = generatedAssets.get()['assets/models/crate.gltf'];
    const json = JSON.parse(atob(model.dataUrl.split(',')[1]));
    expect(json.images[0].uri).toBe(`data:image/png;base64,${textureBase64}`);
    expect(json.images[0].uri).not.toBe('crate_albedo.png');
  });

  it('rewrites external GLB textures and updates the container length', async () => {
    const container = fakeWebcontainer();
    const glb = glbBytes({ asset: { version: '2.0' }, images: [{ uri: 'textures/albedo.png' }] });
    const textureBase64 = btoa('texture-bytes');

    const result = await materializeLibraryAssets({
      blueprint: testBlueprint([
        { id: 'assets:model', path: 'assets/models/crate.glb', group: ['assets/models/textures/albedo.png'] },
      ]),
      executionToken: 'test-token',
      webcontainer: container.api,
      fetchImpl: (async () =>
        okResponse({
          ok: true,
          files: [
            {
              id: 'assets:model',
              path: 'assets/models/crate.glb',
              mimeType: 'model/gltf-binary',
              base64: btoa(String.fromCharCode(...glb)),
              byteLength: glb.length,
            },
            {
              id: 'assets:texture',
              path: 'assets/models/textures/albedo.png',
              mimeType: 'image/png',
              base64: textureBase64,
              byteLength: textureBase64.length,
            },
          ],
        })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);

    const model = generatedAssets.get()['assets/models/crate.glb'];
    const bytes = Uint8Array.from(atob(model.dataUrl.split(',')[1]), (character) => character.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(8, true)).toBe(bytes.byteLength);
    expect(parseGlbJson(bytes).images[0].uri).toBe(`data:image/png;base64,${textureBase64}`);
  });
});

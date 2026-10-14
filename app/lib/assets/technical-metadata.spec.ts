import { describe, expect, it } from 'vitest';
import {
  checksumBytes,
  detectTileGrid,
  extractAudioMetadata,
  extractImageMetadata,
  extractModel3d,
  extractTechnicalMetadata,
  readGlbJson,
  sniffFormat,
} from './technical-metadata';

const encoder = new TextEncoder();

function bytesOf(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** Minimal but structurally valid PNG with the given IHDR fields. */
function pngBytes(options: {
  width: number;
  height: number;
  colorType?: number;
  chunks?: Array<[string, number[]]>;
}): Uint8Array {
  const chunks: Array<[string, number[]]> = [
    [
      'IHDR',
      [
        (options.width >>> 24) & 0xff,
        (options.width >>> 16) & 0xff,
        (options.width >>> 8) & 0xff,
        options.width & 0xff,
        (options.height >>> 24) & 0xff,
        (options.height >>> 16) & 0xff,
        (options.height >>> 8) & 0xff,
        options.height & 0xff,
        8,
        options.colorType ?? 6,
        0,
        0,
        0,
      ],
    ],
    ...(options.chunks ?? []),
    ['IEND', []],
  ];

  const size = 8 + chunks.reduce((total, [, payload]) => total + 12 + payload.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;

  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  offset = 8;

  for (const [type, payload] of chunks) {
    const length = payload.length;
    out.set([(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff], offset);
    offset += 4;
    out.set(encoder.encode(type), offset);
    offset += 4;
    out.set(payload, offset);
    offset += payload.length;

    const crc = new Uint8Array(4);
    out.set(crc, offset);
    offset += 4;
  }

  return out;
}

/** GLB container with only a JSON chunk — enough for structural probing. */
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

function wavBytes(seconds: number, sampleRate = 8000, channels = 1): Uint8Array {
  const dataBytes = Math.round(seconds * sampleRate * channels) * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);

  out.set(encoder.encode('RIFF'), 0);
  view.setUint32(4, 36 + dataBytes, true);
  out.set(encoder.encode('WAVE'), 8);
  out.set(encoder.encode('fmt '), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  out.set(encoder.encode('data'), 36);
  view.setUint32(40, dataBytes, true);

  return out;
}

describe('sniffFormat', () => {
  it('trusts magic bytes over the extension', () => {
    expect(sniffFormat(pngBytes({ width: 8, height: 8 }), 'lies.glb')).toBe('png');
    expect(sniffFormat(glbBytes({ asset: { version: '2.0' } }), 'model.gltf')).toBe('glb');
  });

  it('falls back to the extension when there is no signature', () => {
    expect(sniffFormat(encoder.encode('# a wave file'), 'sound.wav')).toBe('wav');
    expect(sniffFormat(encoder.encode('v 1 0 0 0'), 'mesh.obj')).toBe('obj');
  });

  it('reports unknown rather than guessing an unsupported container', () => {
    expect(sniffFormat(encoder.encode('random bytes'), 'mystery.dat')).toBe('unknown');
  });

  it('detects APNG animation control separately from a still PNG', () => {
    expect(sniffFormat(pngBytes({ width: 8, height: 8 }), 'a.png')).toBe('png');
    expect(sniffFormat(pngBytes({ width: 8, height: 8, chunks: [['acTL', [0, 0, 0, 6]]] }), 'a.png')).toBe('apng');
  });
});

describe('image metadata', () => {
  it('reads dimensions and alpha from IHDR', () => {
    const metadata = extractImageMetadata(pngBytes({ width: 256, height: 128, colorType: 6 }), 'hero.png');

    expect(metadata).toMatchObject({ width: 256, height: 128, hasAlpha: true, frames: 1 });
  });

  it('reports an opaque PNG without alpha', () => {
    const metadata = extractImageMetadata(pngBytes({ width: 64, height: 64, colorType: 2 }), 'bg.png');

    expect(metadata?.hasAlpha).toBe(false);
  });

  it('honours a tRNS transparency chunk on a palette image', () => {
    const metadata = extractImageMetadata(
      pngBytes({ width: 64, height: 64, colorType: 3, chunks: [['tRNS', [0, 0, 0, 0]]] }),
      'sprite.png',
    );

    expect(metadata?.hasAlpha).toBe(true);
  });

  it('counts APNG frames', () => {
    const metadata = extractImageMetadata(
      pngBytes({ width: 32, height: 32, chunks: [['acTL', [0, 0, 0, 12]]] }),
      'anim.png',
    );

    expect(metadata?.frames).toBe(12);
  });

  it('reads a GIF logical screen and its frame count', () => {
    const gif = bytesOf(
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61, // GIF89a
      0x40,
      0x00,
      0x20,
      0x00,
      0x00,
      0x00,
      0x00, // 64x32 logical screen
      0x21,
      0xf9,
      0x04,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // graphic control
      0x2c,
      0x00,
      0x00,
      0x00,
      0x00,
      0x40,
      0x00,
      0x20,
      0x00,
      0x00,
      0x00, // image descriptor
      0x02,
      0x02,
      0x44,
      0x01,
      0x00, // LZW data
      0x3b,
    );

    expect(extractImageMetadata(gif, 'walk.gif')).toMatchObject({ width: 64, height: 32, frames: 1 });
  });

  it('reads an SVG viewBox and treats the canvas as transparent', () => {
    const svg = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"></svg>');
    const metadata = extractImageMetadata(svg, 'banner.svg');

    expect(metadata).toMatchObject({ width: 64, height: 32, hasAlpha: true });
  });

  it('returns nothing for unrecognised bytes instead of inventing dimensions', () => {
    expect(extractImageMetadata(encoder.encode('not an image at all'), 'x.png')).toBeUndefined();
  });
});

describe('tile grid detection', () => {
  it('reports a low-confidence grid for an exact power-of-two sheet', () => {
    const grid = detectTileGrid({ width: 512, height: 512, hasAlpha: true, frames: 1, tileGrid: null });

    expect(grid).toEqual({ columns: 8, rows: 8, confidence: 0.35 });
  });

  it('refuses to invent a grid for an ordinary square image', () => {
    expect(detectTileGrid({ width: 300, height: 300, hasAlpha: true, frames: 1, tileGrid: null })).toBeNull();
  });

  it('refuses a grid when the aspect ratio is a single row', () => {
    expect(detectTileGrid({ width: 512, height: 64, hasAlpha: true, frames: 1, tileGrid: null })).toBeNull();
  });
});

describe('3D model metadata and dependencies', () => {
  it('separates embedded textures from external references in a GLB', () => {
    const glb = glbBytes({
      asset: { version: '2.0' },
      meshes: [{ name: 'Crate' }],
      materials: [{ name: 'Wood' }],
      animations: [],
      images: [{ bufferView: 3, mimeType: 'image/png' }, { uri: 'textures/crate_albedo.png' }],
      extensionsRequired: ['KHR_draco_mesh_compression'],
    });

    expect(readGlbJson(glb)).toBeDefined();

    const analysis = extractModel3d(glb, 'crate.glb');

    expect(analysis?.metadata.format).toBe('glb');
    expect(analysis?.metadata.meshes).toBe(1);
    expect(analysis?.metadata.materials).toEqual(['Wood']);
    expect(analysis?.metadata.embeddedTextures).toBe(1);
    expect(analysis?.metadata.externalRefs).toEqual(['textures/crate_albedo.png']);
    expect(analysis?.metadata.requiresDraco).toBe(true);
    expect(analysis?.dependencies).toEqual([
      { kind: 'texture', uri: 'textures/crate_albedo.png', required: true, embedded: false, resolved: false },
    ]);
  });

  it('finds external buffer and texture references in a .gltf document', () => {
    const gltf = encoder.encode(
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'crate.bin' }],
        images: [{ uri: 'crate_albedo.png' }],
      }),
    );

    const analysis = extractModel3d(gltf, 'crate.gltf');

    expect(analysis?.metadata.externalRefs).toEqual(expect.arrayContaining(['crate.bin', 'crate_albedo.png']));
    expect(analysis?.dependencies.some((entry) => entry.kind === 'model' && entry.uri === 'crate.bin')).toBe(true);
  });

  it('links an OBJ to its material library', () => {
    const obj = encoder.encode(['mtllib crate.mtl', 'o Body', 'v 0 0 0', 'usemtl Wood', ''].join('\n'));
    const analysis = extractModel3d(obj, 'crate.obj');

    expect(analysis?.metadata.format).toBe('obj');
    expect(analysis?.metadata.meshes).toBe(1);
    expect(analysis?.dependencies).toEqual([
      { kind: 'material', uri: 'crate.mtl', required: true, embedded: false, resolved: false },
    ]);
  });

  it('reads image references out of an MTL file', () => {
    const mtl = encoder.encode(
      ['newmtl Wood', 'Kd 1 1 1', 'map_Kd wood_diffuse.png', 'norm wood_normal.png', ''].join('\n'),
    );
    const analysis = extractModel3d(mtl, 'crate.mtl');

    expect(analysis?.metadata.format).toBe('mtl');
    expect(analysis?.metadata.textures).toEqual(['wood_diffuse.png', 'wood_normal.png']);
    expect(analysis?.dependencies.every((entry) => entry.kind === 'texture')).toBe(true);
  });

  it('treats inline base64 images as embedded, not as a fetch', () => {
    const gltf = encoder.encode(
      JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'data:image/png;base64,AAAA' }] }),
    );

    const analysis = extractModel3d(gltf, 'inline.gltf');

    expect(analysis?.metadata.embeddedTextures).toBe(1);
    expect(analysis?.metadata.externalRefs).toHaveLength(0);
    expect(analysis?.dependencies).toHaveLength(0);
  });

  it('returns nothing for a truncated GLB rather than a partial model', () => {
    expect(extractModel3d(bytesOf(0x47, 0x4c, 0x54, 0x46, 0x02, 0x00), 'broken.glb')).toBeUndefined();
  });
});

describe('audio metadata', () => {
  it('reads WAV duration, sample rate and channels from the chunks', () => {
    const metadata = extractAudioMetadata(wavBytes(1, 8000, 1), 'hit.wav');

    expect(metadata?.durationSeconds).toBe(1);
    expect(metadata?.sampleRate).toBe(8000);
    expect(metadata?.channels).toBe(1);
  });

  it('returns nulls instead of guesses for formats it cannot measure', () => {
    const metadata = extractAudioMetadata(encoder.encode('ID3fake mp3 payload'), 'x.mp3');

    expect(metadata).toBeUndefined();
  });
});

describe('extractTechnicalMetadata', () => {
  it('routes each container to the right metadata kind', () => {
    expect(extractTechnicalMetadata(pngBytes({ width: 16, height: 16 }), 'a.png')?.kind).toBe('image');
    expect(extractTechnicalMetadata(glbBytes({ asset: { version: '2.0' } }), 'a.glb')?.kind).toBe('model3d');
    expect(extractTechnicalMetadata(wavBytes(0.5), 'a.wav')?.kind).toBe('audio');
  });

  it('produces no metadata for a file it cannot identify', () => {
    expect(extractTechnicalMetadata(encoder.encode('mystery'), 'mystery.bin')).toBeUndefined();
  });
});

describe('checksumBytes', () => {
  it('hashes with the sha256 prefix the harness uses', async () => {
    const checksum = await checksumBytes(encoder.encode('fortz'));

    expect(checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await checksumBytes(encoder.encode('fortz'))).toBe(checksum);
  });
});

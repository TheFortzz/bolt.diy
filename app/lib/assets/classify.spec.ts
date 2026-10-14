import { describe, expect, it } from 'vitest';
import { classifyAsset, detectCategory, detectPerspective, detectRole, tokenizeName } from './classify';
import { extractTechnicalMetadata } from './technical-metadata';

const encoder = new TextEncoder();

function pngBytes(width: number, height: number, colorType = 6): Uint8Array {
  const chunks: number[] = [];
  const push = (type: string, payload: number[]) => {
    const length = payload.length;
    chunks.push((length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
    chunks.push(...encoder.encode(type), ...payload, 0, 0, 0, 0);
  };

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
  ]);
  push('IEND', []);

  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks]);
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

describe('role detection', () => {
  it('never lets a preview render pass as an asset', () => {
    expect(detectRole('crate_preview.png').role).toBe('preview');
    expect(detectRole('spritesheet_thumbnail.png').role).toBe('preview');
    expect(detectRole('models/robot/render_01.png', 'models/robot').role).toBe('preview');
    expect(detectRole('contact-sheet.jpg').role).toBe('preview');
  });

  it('keeps real models and sheets classified as assets', () => {
    expect(detectRole('crate.glb').role).toBe('asset');
    expect(detectRole('hero_atlas.png').role).toBe('asset');
    expect(detectRole('crate_texture.png').role).toBe('asset');
  });

  it('treats an unremarkable filename as a low-confidence asset', () => {
    const { role, confidence } = detectRole('untitled_04.png');

    expect(role).toBe('asset');
    expect(confidence).toBeLessThan(0.5);
  });
});

describe('name analysis', () => {
  it('drops extension noise and digits from tokens', () => {
    expect(tokenizeName('hero_ship_v2.png')).toEqual(['hero', 'ship']);
  });

  it('reads perspective and purpose from naming', () => {
    expect(detectPerspective(['topdown', 'rpg', 'tiles'])).toBe('topdown');
    expect(detectPerspective(['sideview', 'platformer'])).toBe('sideview');
    expect(detectCategory(['wooden', 'crate', 'prop'])).toBe('prop');
    expect(detectCategory(['hit', 'sound'])).toBe('sfx');
  });

  it('returns undefined instead of inventing a purpose', () => {
    expect(detectCategory(['zzz', 'qqq'])).toBeUndefined();
  });
});

describe('classifyAsset', () => {
  it('uses real pixel facts over the filename for image category', () => {
    const result = classifyAsset({
      originalName: 'hero.png',
      bytes: pngBytes(512, 512),
    });

    // 512x512 with a detected 8x8 grid is a sheet, whatever the name says.
    expect(result.category).toBe('spritesheet');
    expect(result.technical?.kind).toBe('image');
    expect(result.intelligence.source).toBe('metadata');
  });

  it('labels an opaque wide image as a background', () => {
    const result = classifyAsset({ originalName: 'sky.png', bytes: pngBytes(1024, 512, 2) });

    expect(result.category).toBe('background');
  });

  it('marks a small transparent image as a particle', () => {
    const result = classifyAsset({ originalName: 'muzzle.png', bytes: pngBytes(128, 128) });

    expect(result.category).toBe('particle');
  });

  it('classifies a 3D model and separates embedded from external textures', () => {
    const result = classifyAsset({
      originalName: 'crate.glb',
      bytes: glbBytes({
        asset: { version: '2.0' },
        meshes: [{}],
        materials: [{ name: 'Wood' }],
        images: [{ bufferView: 2 }, { uri: 'textures/crate.png' }],
      }),
    });

    expect(result.dimension).toBe('3d');
    expect(result.category).toBe('model3d');
    expect(result.technical?.kind === 'model3d' && result.technical.model.embeddedTextures).toBe(1);
    expect(result.technical?.kind === 'model3d' && result.technical.model.externalRefs).toEqual(['textures/crate.png']);
  });

  it('classifies an MTL as a material, not as a model', () => {
    const result = classifyAsset({
      originalName: 'crate.mtl',
      bytes: encoder.encode('newmtl Wood\nmap_Kd wood.png\n'),
    });

    expect(result.category).toBe('material');
  });

  it('classifies audio and fonts by format', () => {
    expect(classifyAsset({ originalName: 'jump.wav', bytes: encoder.encode('RIFF') }).category).toBe('sfx');
    expect(classifyAsset({ originalName: 'theme.ogg', bytes: encoder.encode('OggS') }).category).toBe('music');
    expect(classifyAsset({ originalName: 'title.ttf', bytes: encoder.encode('\x00\x01\x00\x00') }).category).toBe(
      'font',
    );
  });

  it('demotes a preview to an inert data record that can never be selected', () => {
    const result = classifyAsset({ originalName: 'crate_preview.png', bytes: pngBytes(512, 512) });

    expect(result.role).toBe('preview');
    expect(result.dimension).toBe('data');
    expect(result.category).toBe('other');
    expect(result.intelligence.description).toContain('Not a usable game asset');
  });

  it('states filename guesses as guesses', () => {
    const result = classifyAsset({ originalName: 'mystery_wooden_crate.png' });

    expect(result.intelligence.source).toBe('filename');
    expect(result.intelligence.description).toContain('filename suggests:');
    expect(result.intelligence.confidence).toBeLessThan(0.6);
  });

  it('never claims a purpose it cannot support', () => {
    const result = classifyAsset({ originalName: 'untitled_04.png' });

    // No bytes, no naming signal: `other` is the honest category, not a guess.
    expect(result.category).toBe('other');
    expect(result.intelligence.confidence).toBeLessThan(0.5);
    expect(result.intelligence.source).toBe('filename');
  });

  it('agrees with the technical metadata probe', () => {
    const bytes = pngBytes(256, 256);
    const technical = extractTechnicalMetadata(bytes, 'tile.png');

    expect(classifyAsset({ originalName: 'tile.png', bytes, technical }).technical).toEqual(technical);
  });
});

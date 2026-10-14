import {
  type AssetDependency,
  type AssetFormat,
  type AssetTechnicalMetadata,
  type AudioTechnicalMetadata,
  type ImageTechnicalMetadata,
  type ModelTechnicalMetadata,
} from './asset-schema';

/**
 * Byte-level technical probing for library assets.
 *
 * Everything here is derived from the actual bytes — never from the filename.
 * When a value cannot be established it is returned as null / absent rather
 * than guessed, because a wrong dimension or a missing dependency is far more
 * expensive downstream than an honest "unknown".
 */

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';

  for (let i = start; i < start + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }

  return out;
}

const KNOWN_EXTENSIONS = new Set<string>([
  'png',
  'apng',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'svg',
  'bmp',
  'ktx2',
  'glb',
  'gltf',
  'obj',
  'mtl',
  'fbx',
  'wav',
  'mp3',
  'ogg',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'json',
  'bin',
  'txt',
]);

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }

  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Canonical container format for a file, from magic bytes first, extension second. */
export function sniffFormat(bytes: Uint8Array, fileName: string): AssetFormat {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return detectPngAnimation(bytes) ? 'apng' : 'png';
  }

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'jpg';
  }

  if (ascii(bytes, 0, 4) === 'RIFF') {
    const form = ascii(bytes, 8, 4);

    if (form === 'WEBP') {
      return 'webp';
    }

    if (form === 'WAVE') {
      return 'wav';
    }
  }

  if (startsWith(bytes, [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'ktx2';
  }

  if (startsWith(bytes, [0x67, 0x6c, 0x54, 0x46])) {
    return 'glb';
  }

  if (ascii(bytes, 0, 4) === 'OggS') {
    return 'ogg';
  }

  if (startsWith(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return 'mp3';
  }

  if (ascii(bytes, 4, 4) === 'ftyp') {
    return 'unknown';
  }

  if (ascii(bytes, 0, 4) === 'wOFF' || ascii(bytes, 0, 4) === 'wOF2') {
    return 'woff';
  }

  if (ascii(bytes, 0, 4) === 'OTTO') {
    return 'otf';
  }

  if (startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) || ascii(bytes, 0, 4) === 'true') {
    return 'ttf';
  }

  if (ascii(bytes, 0, 5) === '<?xml' || ascii(bytes, 0, 4) === '<svg') {
    return 'svg';
  }

  if (ascii(bytes, 0, 2) === 'BM') {
    return 'bmp';
  }

  if (ascii(bytes, 0, 3) === 'GIF') {
    return 'gif';
  }

  const extension = (fileName.split('.').pop() || '').toLowerCase();

  if (!KNOWN_EXTENSIONS.has(extension)) {
    return 'unknown';
  }

  // Normalise aliases onto the canonical format names.
  return (extension === 'jpeg' ? 'jpg' : extension) as AssetFormat;
}

/** True when a PNG carries an `acTL` chunk (APNG animation control). */
function detectPngAnimation(bytes: Uint8Array): boolean {
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = viewOf(bytes).getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);

    if (type === 'acTL') {
      return true;
    }

    if (type === 'IDAT' || type === 'IEND') {
      return false;
    }

    // Guard against a corrupt length sending us into an infinite walk.
    if (!Number.isFinite(length) || length < 0) {
      return false;
    }

    offset += 12 + length;
  }

  return false;
}

function parsePng(bytes: Uint8Array): ImageTechnicalMetadata | undefined {
  const view = viewOf(bytes);

  if (bytes.length < 33) {
    return undefined;
  }

  const width = view.getUint32(16);
  const height = view.getUint32(20);

  // Byte 24 is bit depth; alpha is decided purely by the colour type and tRNS.
  const colorType = bytes[25];

  if (!width || !height) {
    return undefined;
  }

  let hasAlpha = colorType === 4 || colorType === 6;
  let frames = 1;
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);

    if (!Number.isFinite(length) || length < 0) {
      break;
    }

    if (type === 'tRNS') {
      hasAlpha = true;
    }

    if (type === 'acTL' && offset + 12 <= bytes.length) {
      frames = Math.max(1, view.getUint32(offset + 8));
    }

    if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  return { width, height, hasAlpha, frames, tileGrid: null };
}

/**
 * Guess a uniform sprite grid for a power-of-two sheet.
 *
 * Reported ONLY when the grid is mathematically exact (equal power-of-two
 * cells, at least a 2x2 sheet, cells no smaller than 64px) and always at low
 * confidence - an ordinary square sprite must never be relabelled a sheet.
 */
export function detectTileGrid(metadata: ImageTechnicalMetadata): ImageTechnicalMetadata['tileGrid'] {
  const { width, height } = metadata;

  const isPowerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;

  if (width < 256 || height < 256 || !isPowerOfTwo(width) || !isPowerOfTwo(height)) {
    return null;
  }

  for (const cell of [64, 32]) {
    if (width % cell !== 0 || height % cell !== 0) {
      continue;
    }

    const columns = width / cell;
    const rows = height / cell;

    if (columns < 2 || rows < 2 || columns * rows > 4096) {
      continue;
    }

    return { columns, rows, confidence: 0.35 };
  }

  return null;
}

function parseGif(bytes: Uint8Array): ImageTechnicalMetadata | undefined {
  if (bytes.length < 13) {
    return undefined;
  }

  const view = viewOf(bytes);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);

  if (!width || !height) {
    return undefined;
  }

  // Walk the block stream so frames are counted structurally, not guessed.
  let offset = 13;
  let frames = 0;
  let hasAlpha = false;

  if ((bytes[10] & 0x80) !== 0) {
    offset += 3 * (1 << ((bytes[10] & 0x07) + 1));
  }

  while (offset < bytes.length) {
    const marker = bytes[offset];

    if (marker === 0x3b) {
      break;
    }

    if (marker === 0x21) {
      const label = bytes[offset + 1];
      offset += 2;

      if (label === 0xf9 && offset + 1 < bytes.length) {
        hasAlpha = true;
      }

      while (offset < bytes.length && bytes[offset] !== 0) {
        offset += bytes[offset] + 1;
      }

      offset += 1;
      continue;
    }

    if (marker === 0x2c) {
      const packed = bytes[offset + 9];

      if ((packed & 0x80) !== 0) {
        offset += 3 * (1 << ((packed & 0x07) + 1));
      }

      offset += 10;
      frames += 1;
      offset += 1; // LZW minimum code size

      while (offset < bytes.length && bytes[offset] !== 0) {
        offset += bytes[offset] + 1;
      }

      offset += 1;
      continue;
    }

    offset += 1;
  }

  return { width, height, hasAlpha, frames: Math.max(1, frames), tileGrid: null };
}

function parseJpeg(bytes: Uint8Array): ImageTechnicalMetadata | undefined {
  const view = viewOf(bytes);
  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];

    // SOF0/1/2/3/5/6/7/9/10/11/13/14/15 carry the frame header.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      const components = bytes[offset + 9];

      if (!width || !height) {
        return undefined;
      }

      // JPEG has no alpha channel; 4 components means CMYK/YCCK, not transparency.
      void components;

      return { width, height, hasAlpha: false, frames: 1, tileGrid: null };
    }

    offset += 2 + view.getUint16(offset + 2);
  }

  return undefined;
}

function parseWebp(bytes: Uint8Array): ImageTechnicalMetadata | undefined {
  const view = viewOf(bytes);

  if (bytes.length < 30) {
    return undefined;
  }

  const chunk = ascii(bytes, 12, 4);

  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    const flags = bytes[20];

    return {
      width,
      height,
      hasAlpha: (flags & 0x10) !== 0,
      frames: (flags & 0x02) !== 0 ? 2 : 1, // ANIM chunk presence = animated
      tileGrid: null,
    };
  }

  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;

    return { width, height, hasAlpha: true, frames: 1, tileGrid: null };
  }

  if (chunk === 'VP8 ') {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
      hasAlpha: false,
      frames: 1,
      tileGrid: null,
    };
  }

  return undefined;
}

function parseBmp(bytes: Uint8Array): ImageTechnicalMetadata | undefined {
  const view = viewOf(bytes);

  if (bytes.length < 30) {
    return undefined;
  }

  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bitsPerPixel = view.getUint16(28, true);

  return {
    width: Math.abs(width),
    height: Math.abs(rawHeight),
    hasAlpha: bitsPerPixel === 32,
    frames: 1,
    tileGrid: null,
  };
}

function parseSvg(text: string): ImageTechnicalMetadata | undefined {
  const viewBox = text.match(/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i);
  const widthAttr = text.match(/\bwidth\s*=\s*["']([\d.]+)/i);
  const heightAttr = text.match(/\bheight\s*=\s*["']([\d.]+)/i);

  const width = viewBox ? Math.round(Number(viewBox[1])) : widthAttr ? Math.round(Number(widthAttr[1])) : 0;
  const height = viewBox ? Math.round(Number(viewBox[2])) : heightAttr ? Math.round(Number(heightAttr[1])) : 0;

  if (!width || !height) {
    return undefined;
  }

  // An SVG canvas is transparent unless the document paints a background.
  return { width, height, hasAlpha: true, frames: 1, tileGrid: null };
}

/** Probe any supported image container. Returns undefined when unrecognised. */
export function extractImageMetadata(bytes: Uint8Array, fileName: string): ImageTechnicalMetadata | undefined {
  const format = sniffFormat(bytes, fileName);

  let metadata: ImageTechnicalMetadata | undefined;

  if (format === 'png' || format === 'apng') {
    metadata = parsePng(bytes);
  } else if (format === 'gif') {
    metadata = parseGif(bytes);
  } else if (format === 'jpg') {
    metadata = parseJpeg(bytes);
  } else if (format === 'webp') {
    metadata = parseWebp(bytes);
  } else if (format === 'bmp') {
    metadata = parseBmp(bytes);
  } else if (format === 'svg') {
    metadata = parseSvg(textDecoder.decode(bytes));
  }

  if (!metadata) {
    return undefined;
  }

  return { ...metadata, tileGrid: detectTileGrid(metadata) };
}

/** Pull the glTF JSON document out of a GLB container. */
export function readGlbJson(bytes: Uint8Array): Record<string, unknown> | undefined {
  if (!startsWith(bytes, [0x67, 0x6c, 0x54, 0x46]) || bytes.length < 20) {
    return undefined;
  }

  const view = viewOf(bytes);
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = ascii(bytes, offset + 4, 4);

    if (chunkType === 'JSON') {
      const end = Math.min(offset + 8 + chunkLength, bytes.length);
      let endText = end;

      /*
       * The spec pads the JSON chunk with spaces; many exporters pad with NUL.
       * Both must be trimmed or JSON.parse rejects the document.
       */
      while (endText > offset + 8 && (bytes[endText - 1] === 0x00 || bytes[endText - 1] === 0x20)) {
        endText -= 1;
      }

      try {
        return JSON.parse(textDecoder.decode(bytes.subarray(offset + 8, endText))) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }

    offset += 8 + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }

  return undefined;
}

interface GltfAnalysis {
  metadata: ModelTechnicalMetadata;
  dependencies: AssetDependency[];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function analyseGltf(document: Record<string, unknown>): GltfAnalysis {
  const images = asArray<Record<string, unknown>>(document.images);
  const materials = asArray<Record<string, unknown>>(document.materials);
  const buffers = asArray<Record<string, unknown>>(document.buffers);
  const animations = asArray<unknown>(document.animations);
  const meshes = asArray<unknown>(document.meshes);
  const extensionsRequired = asArray<string>(document.extensionsRequired);

  const externalRefs = new Set<string>();
  const textures: string[] = [];
  let embeddedTextures = 0;

  for (const image of images) {
    const uri = typeof image.uri === 'string' ? image.uri : undefined;

    if (uri && uri.startsWith('data:')) {
      // Inline base64 payload: genuinely embedded.
      embeddedTextures += 1;
      textures.push(`data:${String(image.mimeType || 'image/png')}`);
      continue;
    }

    if (image.bufferView !== undefined) {
      embeddedTextures += 1;
      textures.push(`bufferView:${String(image.bufferView)}`);
      continue;
    }

    if (uri) {
      externalRefs.add(uri);
      textures.push(uri);
    }
  }

  for (const buffer of buffers) {
    const uri = typeof buffer.uri === 'string' ? buffer.uri : undefined;

    if (uri && !uri.startsWith('data:')) {
      externalRefs.add(uri);
    }
  }

  const dependencies: AssetDependency[] = Array.from(externalRefs).map((uri) => ({
    kind: (imageExtensions.some((extension) => uri.toLowerCase().endsWith(extension)) ? 'texture' : 'model') as
      | 'texture'
      | 'model',
    uri,
    required: true,
    embedded: false,
    resolved: false,
  }));

  return {
    metadata: {
      format: 'gltf',
      meshes: meshes.length,
      materials: materials
        .map((material) => (typeof material.name === 'string' ? material.name : ''))
        .filter(Boolean)
        .slice(0, 512),
      textures: textures.slice(0, 512),
      embeddedTextures,
      animations: animations.length,
      requiresDraco: extensionsRequired.includes('KHR_draco_mesh_compression'),
      externalRefs: Array.from(externalRefs),
    },
    dependencies,
  };
}

const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.basis', '.tga'];

const materialTextureDirectives = [
  'map_Kd',
  'map_Ka',
  'map_Ks',
  'map_Ke',
  'map_Ns',
  'map_d',
  'map_bump',
  'bump',
  'norm',
  'norm_',
  'disp',
  'decal',
  'refl',
];

function analyseMtl(text: string): { textures: string[]; refs: string[] } {
  const textures = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const [directive, ...rest] = line.split(/\s+/);

    if (!directive || !rest.length) {
      continue;
    }

    if (materialTextureDirectives.includes(directive)) {
      textures.add(rest.join(' '));
    }
  }

  return { textures: Array.from(textures), refs: Array.from(textures) };
}

function analyseObj(text: string): { materialLibraries: string[]; meshes: number } {
  const materialLibraries = new Set<string>();
  let meshes = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith('mtllib ')) {
      for (const entry of line.slice(7).trim().split(/\s+/)) {
        if (entry) {
          materialLibraries.add(entry);
        }
      }
    } else if (line.startsWith('o ') || line.startsWith('g ')) {
      meshes += 1;
    }
  }

  return { materialLibraries: Array.from(materialLibraries), meshes };
}

/**
 * Probe a 3D asset and report BOTH its technical metadata and the exact files
 * it needs. Texture references are separated into embedded (already inside the
 * container — never fetch these again) and external.
 */
export function extractModel3d(
  bytes: Uint8Array,
  fileName: string,
): { metadata: ModelTechnicalMetadata; dependencies: AssetDependency[] } | undefined {
  const format = sniffFormat(bytes, fileName);
  const lower = fileName.toLowerCase();

  if (format === 'glb') {
    const document = readGlbJson(bytes);

    if (!document) {
      return undefined;
    }

    const analysis = analyseGltf(document);

    return { ...analysis, metadata: { ...analysis.metadata, format: 'glb' } };
  }

  if (format === 'gltf' || lower.endsWith('.gltf')) {
    try {
      const document = JSON.parse(textDecoder.decode(bytes)) as Record<string, unknown>;

      return analyseGltf(document);
    } catch {
      return undefined;
    }
  }

  if (format === 'obj' || lower.endsWith('.obj')) {
    const text = textDecoder.decode(bytes);
    const { materialLibraries, meshes } = analyseObj(text);

    return {
      metadata: {
        format: 'obj',
        meshes,
        materials: [],
        textures: [],
        embeddedTextures: 0,
        animations: 0,
        requiresDraco: false,
        externalRefs: materialLibraries,
      },
      dependencies: materialLibraries.map((uri) => ({
        kind: 'material' as const,
        uri,
        required: true,
        embedded: false,
        resolved: false,
      })),
    };
  }

  if (format === 'mtl' || lower.endsWith('.mtl')) {
    const { textures, refs } = analyseMtl(textDecoder.decode(bytes));

    return {
      metadata: {
        format: 'mtl',
        meshes: 0,
        materials: [],
        textures,
        embeddedTextures: 0,
        animations: 0,
        requiresDraco: false,
        externalRefs: refs,
      },
      dependencies: refs.map((uri) => ({
        kind: 'texture' as const,
        uri,
        required: true,
        embedded: false,
        resolved: false,
      })),
    };
  }

  return undefined;
}

function parseWav(bytes: Uint8Array): AudioTechnicalMetadata | undefined {
  const view = viewOf(bytes);
  let offset = 12;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitsPerSample = 16;
  let dataBytes = 0;

  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);

    if (id === 'fmt ' && offset + 24 <= bytes.length) {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true) || 16;
    } else if (id === 'data') {
      dataBytes = size;
    }

    offset += 8 + size + (size % 2);
  }

  if (!sampleRate || !channels) {
    return undefined;
  }

  // dataBytes counts raw sample bytes; a frame is one sample per channel.
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const duration =
    bytesPerFrame > 0 && dataBytes > 0 ? Number((dataBytes / (sampleRate * bytesPerFrame)).toFixed(3)) : null;

  return { durationSeconds: duration, sampleRate, channels };
}

function parseOggDuration(bytes: Uint8Array): number | null {
  let lastGranule = 0;
  let offset = 0;
  let sampleRate = 0;

  while (offset + 27 <= bytes.length) {
    if (ascii(bytes, offset, 4) !== 'OggS') {
      break;
    }

    const granule = viewOf(bytes).getUint32(offset + 6, true);
    lastGranule = Math.max(lastGranule, granule);

    const segmentCount = bytes[offset + 26];
    let segmentTotal = 0;
    const tableStart = offset + 27;

    for (let i = 0; i < segmentCount && tableStart + i < bytes.length; i++) {
      segmentTotal += bytes[tableStart + i];
    }

    if (!sampleRate) {
      // Vorbis identification header: sample rate sits 12 bytes into the payload.
      if (ascii(bytes, tableStart + segmentCount, 8) === 'vorbis') {
        sampleRate = viewOf(bytes).getUint32(tableStart + segmentCount + 12, true);
      }
    }

    offset = tableStart + segmentCount + segmentTotal;
  }

  return sampleRate > 0 && lastGranule > 0 ? Number((lastGranule / sampleRate).toFixed(3)) : null;
}

function parseMp3Duration(bytes: Uint8Array): number | null {
  let offset = 0;

  if (ascii(bytes, 0, 3) === 'ID3') {
    // ID3v2 size is 4 synchsafe bytes.
    offset =
      10 + (((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f));
  }

  const bitrateTable: Record<number, number> = {
    1: 32,
    2: 40,
    3: 48,
    4: 56,
    5: 64,
    6: 80,
    7: 96,
    8: 112,
    9: 128,
    10: 160,
    11: 192,
    12: 224,
    13: 256,
    14: 320,
  };
  const sampleRateTable: Record<number, number[]> = {
    3: [44100, 48000, 32000], // MPEG-1
    2: [22050, 24000, 16000], // MPEG-2
    0: [11025, 12000, 8000], // MPEG-2.5
  };

  while (offset + 4 < bytes.length) {
    if (bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0) {
      const versionBits = (bytes[offset + 1] >> 3) & 0x03;
      const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
      const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
      const bitrate = bitrateTable[bitrateIndex];
      const sampleRate = sampleRateTable[versionBits]?.[sampleRateIndex];

      if (bitrate && sampleRate && sampleRateIndex !== 3) {
        return Number((((bytes.length - offset) * 8) / (bitrate * 1000)).toFixed(3));
      }
    }

    offset += 1;
  }

  return null;
}

/** Probe audio containers. Returns nulls (not guesses) for unknown fields. */
export function extractAudioMetadata(bytes: Uint8Array, fileName: string): AudioTechnicalMetadata | undefined {
  const format = sniffFormat(bytes, fileName);

  if (format === 'wav') {
    return parseWav(bytes);
  }

  if (format === 'ogg') {
    const durationSeconds = parseOggDuration(bytes);
    return durationSeconds === null ? undefined : { durationSeconds, sampleRate: null, channels: null };
  }

  if (format === 'mp3') {
    const durationSeconds = parseMp3Duration(bytes);
    return durationSeconds === null ? undefined : { durationSeconds, sampleRate: null, channels: null };
  }

  return undefined;
}

/** One entry point for the catalogue builder: probe whatever this file is. */
export function extractTechnicalMetadata(bytes: Uint8Array, fileName: string): AssetTechnicalMetadata | undefined {
  const image = extractImageMetadata(bytes, fileName);

  if (image) {
    return { kind: 'image', image };
  }

  const model = extractModel3d(bytes, fileName);

  if (model) {
    return { kind: 'model3d', model: model.metadata };
  }

  const audio = extractAudioMetadata(bytes, fileName);

  if (audio) {
    return { kind: 'audio', audio };
  }

  return undefined;
}

/** SHA-256 of the bytes, formatted as the `sha256:<hex>` used across the harness. */
export async function checksumBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `sha256:${hex}`;
}

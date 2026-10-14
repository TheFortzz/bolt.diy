import {
  type AssetCategory,
  type AssetDependency,
  type AssetDimension,
  type AssetFormat,
  type AssetIntelligence,
  type AssetRole,
  type AssetTechnicalMetadata,
  ASSET_FORMATS,
} from './asset-schema';
import { extractTechnicalMetadata, sniffFormat } from './technical-metadata';

/**
 * Turn a single remote file into a classified catalogue record.
 *
 * Two rules drive everything here:
 *  1. A preview render is NOT an asset. It must never be selected for a game
 *     just because it looks right, so role is decided before category and
 *     previews are structurally excluded from the asset pool.
 *  2. Never invent purpose. Text derived from a filename is a hypothesis and is
 *     recorded with source `filename` and a low confidence, so ranking can
 *     discount it instead of presenting it as fact.
 */

/** Filename/path tokens that mark a file as documentation ABOUT something. */
const PREVIEW_NAME_PATTERN =
  /(^|[._\-/])(preview|thumb|thumbnail|screenshot|screen_shot|render|rendered|poster|cover|catalog|catalogue|contact[_-]?sheet|turntable|sheet|view|angle|orthographic|bake|baked)([._\-/]|$)/i;

/** Tokens that mean "the real thing" even if they look preview-ish. */
const ASSET_NAME_PATTERN = /(^|[._\-/])(model|mesh|texture|material|atlas|tileset|spritesheet|sprite)([._\-/]|$)/i;

const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'obj', 'mtl', 'fbx']);
const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg']);
const FONT_EXTENSIONS = new Set(['ttf', 'otf', 'woff', 'woff2']);

/** Extensions the classifier treats as raster/vector 2D image content. */
export const IMAGE_EXTENSIONS = new Set(['png', 'apng', 'webp', 'gif', 'bmp', 'svg']);

const PERSPECTIVE_KEYWORDS: Array<[RegExp, AssetIntelligence['perspective']]> = [
  [/\b(top[\s_-]?down|topdown|td|overhead|bird[_-]?s[_-]?eye)\b/i, 'topdown'],
  [/\b(side[\s_-]?view|side[_-]?scroller|sidescroll|side|platformer)\b/i, 'sideview'],
  [/\b(isometric|iso|isometry|2\.5d|dimetric)\b/i, 'isometric'],
  [/\b(first[\s_-]?person|fps|fpv)\b/i, 'firstperson'],
];

const CATEGORY_KEYWORDS: Array<[RegExp, AssetCategory]> = [
  [/\b(spritesheet|sprite[\s_-]?sheet|atlas)\b/i, 'spritesheet'],
  [/\b(tileset|tile[\s_-]?set|tiles?)\b/i, 'tile'],
  [/\b(top[\s_-]?down|topdown)\b/i, 'topdown'],
  [/\b(character|hero|player|enemy|npc|unit|creature)\b/i, 'character'],
  [/\b(background|bg|backdrop|skybox|panorama|environment)\b/i, 'background'],
  [/\b(ui|hud|button|panel|icon|menu|frame|cursor|badge)\b/i, 'ui'],
  [/\b(particle|spark|smoke|fire|flame|explosion|muzzle|trail|effect|fx)\b/i, 'effect'],
  [/\b(material|mat)\b/i, 'material'],
  [/\b(texture|tex|diffuse|normal[\s_-]?map|roughness|albedo)\b/i, 'texture'],
  [/\b(anim|animation|walk|run|attack|death|idle)\b/i, 'animation'],
  [/\b(music|bgm|loop|theme|track)\b/i, 'music'],
  [/\b(sfx|sfx_?|sound|whoosh|hit|explosion[\s_-]?sfx|click|jump|shot)\b/i, 'sfx'],
  [/\b(ambience|ambient|wind|rain|loop[\s_-]?amb)\b/i, 'ambience'],
  [/\b(font|typeface|ttf)\b/i, 'font'],
  [/\b(prop|item|weapon|pickup|coin|potion|barrel|crate)\b/i, 'prop'],
  [/\b(sprite)\b/i, 'sprite'],
];

/** Lowercase alphanumeric tokens from a filename/path, minus extension noise. */
export function tokenizeName(name: string): string[] {
  const stem = name.replace(/\.[a-z0-9]+$/i, '');

  return Array.from(
    new Set(
      stem
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(
          (token) => token.length > 2 && !/^\d+$/.test(token) && !['png', 'jpg', 'jpeg', 'glb', 'gltf'].includes(token),
        ),
    ),
  );
}

/**
 * Role from the filename/path alone. This is the single most important guard in
 * the system: picking a preview PNG instead of its model is a silent,
 * game-breaking mistake.
 */
export function detectRole(originalName: string, remotePath = ''): { role: AssetRole; confidence: number } {
  const haystack = `${remotePath}/${originalName}`;

  /*
   * Preview markers WIN over asset words: `spritesheet_thumbnail.png` is a
   * thumbnail of a spritesheet, never the usable sheet itself. Getting this
   * backwards is how a model preview gets loaded as the model.
   */
  if (PREVIEW_NAME_PATTERN.test(haystack)) {
    return { role: 'preview', confidence: 0.9 };
  }

  if (ASSET_NAME_PATTERN.test(haystack)) {
    return { role: 'asset', confidence: 0.7 };
  }

  return { role: 'asset', confidence: 0.4 };
}

/** Camera perspective implied by naming, defaulting to `any` when unknown. */
export function detectPerspective(tokens: string[]): AssetIntelligence['perspective'] {
  for (const [pattern, perspective] of PERSPECTIVE_KEYWORDS) {
    if (pattern.test(tokens.join(' '))) {
      return perspective;
    }
  }

  return 'any';
}

/** Purpose inferred from naming. `null` means "unknown" — never a guess. */
export function detectCategory(tokens: string[]): AssetCategory | undefined {
  const haystack = tokens.join(' ');

  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(haystack)) {
      return category;
    }
  }

  return undefined;
}

function dimensionFromFormat(format: AssetFormat): AssetDimension | undefined {
  if (MODEL_EXTENSIONS.has(format)) {
    return '3d';
  }

  if (AUDIO_EXTENSIONS.has(format)) {
    return 'audio';
  }

  if (FONT_EXTENSIONS.has(format)) {
    return 'font';
  }

  if (IMAGE_EXTENSIONS.has(format)) {
    return '2d';
  }

  return undefined;
}

/**
 * Category for 2D images uses real pixel facts first (a uniform grid means a
 * sheet; a wide image with no alpha is a background), and only then names.
 */
function categoryFromImage(
  technical: Extract<AssetTechnicalMetadata, { kind: 'image' }>,
  namedCategory: AssetCategory | undefined,
): AssetCategory {
  const { image } = technical;
  const ratio = image.width / Math.max(1, image.height);

  /*
   * Pixel evidence outranks the low-confidence grid hint: a large opaque wide
   * image is a background whether or not its size divides into cells.
   */
  if (!image.hasAlpha && image.width >= 512 && ratio >= 1.6) {
    return 'background';
  }

  if (image.tileGrid) {
    return 'spritesheet';
  }

  if (image.frames > 1) {
    return 'animation';
  }

  if (namedCategory) {
    // A named background that is actually a small square is probably a mislabel.
    if (namedCategory === 'background' && ratio > 1.8 && image.width >= 512) {
      return 'background';
    }

    if (namedCategory === 'ui' && image.width <= 512 && image.height <= 512) {
      return 'ui';
    }

    if (namedCategory === 'effect' && image.width <= 256 && image.height <= 256 && image.hasAlpha) {
      return 'particle';
    }

    return namedCategory;
  }

  if (image.hasAlpha && image.width <= 256 && image.height <= 256) {
    return 'particle';
  }

  return 'sprite';
}

function categoryFromModel(format: AssetFormat, namedCategory: AssetCategory | undefined): AssetCategory {
  if (format === 'mtl' || namedCategory === 'material') {
    return 'material';
  }

  if (namedCategory === 'texture') {
    return 'texture';
  }

  return 'model3d';
}

export interface ClassifyInput {
  originalName: string;
  remotePath?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  technical?: AssetTechnicalMetadata;
}

export interface Classification {
  role: AssetRole;
  dimension: AssetDimension;
  category: AssetCategory;
  format: AssetFormat;
  technical?: AssetTechnicalMetadata;
  dependencies: AssetDependency[];
  intelligence: AssetIntelligence;
}

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  sprite: '2D sprite',
  spritesheet: '2D sprite sheet',
  tile: '2D tile',
  topdown: 'top-down asset',
  character: 'character art',
  prop: 'prop',
  ui: 'UI element',
  background: 'background',
  particle: 'particle',
  effect: 'visual effect',
  model3d: '3D model',
  material: '3D material',
  texture: 'texture',
  animation: 'animation frames',
  sfx: 'sound effect',
  music: 'music',
  ambience: 'ambience loop',
  font: 'font',
  other: 'asset',
};

/**
 * Classify one file. `bytes` are optional: without them the record is still
 * usable but is explicitly marked low-confidence filename intelligence.
 */
export function classifyAsset(input: ClassifyInput): Classification {
  const { originalName, remotePath = '', bytes } = input;
  const format = bytes ? sniffFormat(bytes, originalName) : sniffFormat(new Uint8Array(0), originalName);
  const tokens = tokenizeName(originalName);
  const namedCategory = detectCategory(tokens);
  const { role, confidence: roleConfidence } = detectRole(originalName, remotePath);

  // Prefer caller-supplied metadata; otherwise probe the bytes when we have them.
  const technical = input.technical ?? (bytes ? extractTechnicalMetadata(bytes, originalName) : undefined);

  const dimension = technical?.kind
    ? technical.kind === 'image'
      ? '2d'
      : technical.kind === 'model3d'
        ? '3d'
        : 'audio'
    : (dimensionFromFormat(format) ?? 'data');

  // Previews are documentation: force them to the inert data dimension.
  const effectiveDimension: AssetDimension = role === 'asset' ? dimension : 'data';
  const category: AssetCategory =
    role !== 'asset'
      ? 'other'
      : technical?.kind === 'image'
        ? categoryFromImage(technical, namedCategory)
        : technical?.kind === 'model3d' || MODEL_EXTENSIONS.has(format)
          ? categoryFromModel(format as AssetFormat, namedCategory)
          : (namedCategory ?? (dimension === 'audio' ? 'sfx' : dimension === 'font' ? 'font' : 'other'));

  let confidence = roleConfidence * 0.5;
  let source: AssetIntelligence['source'] = 'filename';

  if (technical) {
    source = 'metadata';
    confidence = Math.max(confidence, 0.45);
  }

  if (namedCategory) {
    confidence = Math.min(1, confidence + 0.2);
  }

  if (role !== 'asset') {
    confidence = roleConfidence;
  }

  // A preview is only trustworthy about its own role, never about its subject.
  const description = buildDescription({ role, dimension: effectiveDimension, category, format, tokens, technical });

  return {
    role,
    dimension: effectiveDimension,
    category,
    format: ASSET_FORMATS.includes(format) ? format : 'unknown',
    technical,
    dependencies: [],
    intelligence: {
      description,
      tags: buildTags({ tokens, category, dimension: effectiveDimension, technical }),
      source,
      confidence: Number(confidence.toFixed(2)),
      perspective: role === 'asset' ? detectPerspective(tokens) : 'any',
    },
  };
}

function buildDescription(input: {
  role: AssetRole;
  dimension: AssetDimension;
  category: AssetCategory;
  format: AssetFormat;
  tokens: string[];
  technical?: AssetTechnicalMetadata;
}): string {
  if (input.role !== 'asset') {
    return `Preview/documentation image for "${input.tokens.join(' ') || 'unnamed subject'}". Not a usable game asset.`;
  }

  const facts: string[] = [`${CATEGORY_LABELS[input.category]} in ${input.format} format`];

  if (input.technical?.kind === 'image') {
    const { image } = input.technical;
    facts.push(`${image.width}x${image.height}`);
    facts.push(image.hasAlpha ? 'transparent' : 'opaque');

    if (image.frames > 1) {
      facts.push(`${image.frames} frames`);
    }

    if (image.tileGrid) {
      facts.push(
        `${image.tileGrid.columns}x${image.tileGrid.rows} grid at ${Math.round(image.tileGrid.confidence * 100)}% confidence`,
      );
    }
  }

  if (input.technical?.kind === 'model3d') {
    const { model } = input.technical;
    facts.push(`${model.meshes} mesh(es), ${model.materials.length} material(s)`);

    if (model.embeddedTextures > 0) {
      facts.push(`${model.embeddedTextures} embedded texture(s)`);
    }

    if (model.externalRefs.length > 0) {
      facts.push(`${model.externalRefs.length} external reference(s)`);
    }

    if (model.requiresDraco) {
      facts.push('requires Draco compression');
    }
  }

  if (input.technical?.kind === 'audio') {
    const { audio } = input.technical;

    if (audio.durationSeconds !== null) {
      facts.push(`${audio.durationSeconds}s`);
    }

    if (audio.channels) {
      facts.push(`${audio.channels === 1 ? 'mono' : 'stereo'}`);
    }
  }

  // The subject is a naming hypothesis, so it is stated as one.
  const subject = input.tokens.filter((token) => token.length > 2).slice(0, 6);

  if (subject.length > 0) {
    facts.push(`filename suggests: ${subject.join(', ')}`);
  }

  return facts.join('; ') + '.';
}

function buildTags(input: {
  tokens: string[];
  category: AssetCategory;
  dimension: AssetDimension;
  technical?: AssetTechnicalMetadata;
}): string[] {
  const tags = new Set<string>([input.dimension, input.category, ...input.tokens.slice(0, 12)]);

  if (input.technical?.kind === 'image') {
    tags.add(input.technical.image.hasAlpha ? 'transparent' : 'opaque');

    if (input.technical.image.frames > 1) {
      tags.add('animated');
    }

    if (input.technical.image.tileGrid) {
      tags.add('grid');
    }
  }

  if (input.technical?.kind === 'model3d') {
    tags.add(input.technical.model.format);

    if (input.technical.model.embeddedTextures > 0) {
      tags.add('embedded-textures');
    }

    if (input.technical.model.requiresDraco) {
      tags.add('draco');
    }
  }

  return Array.from(tags).filter(Boolean).slice(0, 40);
}

/**
 * Group a bundle's classification with its extracted model metadata so 3D
 * dependencies travel with the record. Kept separate from `classifyAsset` so a
 * caller can classify without holding bytes in memory.
 */
export function withModelDependencies(classification: Classification, dependencies: AssetDependency[]): Classification {
  return { ...classification, dependencies };
}

import { z } from 'zod';

/**
 * Schema for the Fortz asset library catalogue.
 *
 * This models assets that ALREADY EXIST remotely (Appwrite Storage). It is
 * deliberately separate from `assetOperationSchema` in lib/harness/blueprint.ts,
 * which describes images the FLUX image builder GENERATES during a build. The
 * two must never be merged: generated assets are create-only per build, library
 * assets are read-only and may arrive with dependencies (a .gltf needs its
 * .bin and its textures).
 */

/** Physical/shader dimension of the asset. */
export const ASSET_DIMENSIONS = ['2d', '3d', 'audio', 'font', 'data'] as const;

/**
 * Purpose taxonomy. `preview`/`thumbnail` live in `role`, never here — a
 * preview render is not a usable game asset no matter how good it looks.
 */
export const ASSET_CATEGORIES = [
  'sprite',
  'spritesheet',
  'tile',
  'topdown',
  'character',
  'prop',
  'ui',
  'background',
  'particle',
  'effect',
  'model3d',
  'material',
  'texture',
  'animation',
  'sfx',
  'music',
  'ambience',
  'font',
  'other',
] as const;

/** What the file IS, independent of how useful it looks. */
export const ASSET_ROLES = ['asset', 'preview', 'thumbnail', 'documentation'] as const;

/** Detected container format. `unknown` is a legitimate, non-fabricated answer. */
export const ASSET_FORMATS = [
  'png',
  'apng',
  'jpg',
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
  'unknown',
] as const;

/**
 * Where a description came from. Ordering matters: intelligence is only
 * trustworthy when it came from `manual` or `vision`. Filename-derived text is
 * a guess and must carry low confidence.
 */
export const ASSET_ANALYSIS_SOURCES = ['manual', 'vision', 'metadata', 'filename', 'none'] as const;

/** How a 3D asset depends on another file. */
export const ASSET_DEPENDENCY_KINDS = ['material', 'texture', 'model', 'preview', 'other'] as const;

/** Camera/perspective a 2D asset is drawn for. `any` means it suits all. */
export const ASSET_PERSPECTIVES = ['topdown', 'sideview', 'isometric', 'firstperson', 'any'] as const;

export const assetRoleSchema = z.enum(ASSET_ROLES);
export const assetDimensionSchema = z.enum(ASSET_DIMENSIONS);
export const assetCategorySchema = z.enum(ASSET_CATEGORIES);
export const assetFormatSchema = z.enum(ASSET_FORMATS);
export const assetAnalysisSourceSchema = z.enum(ASSET_ANALYSIS_SOURCES);
export const assetDependencyKindSchema = z.enum(ASSET_DEPENDENCY_KINDS);
export const assetPerspectiveSchema = z.enum(ASSET_PERSPECTIVES);

export type AssetRole = z.infer<typeof assetRoleSchema>;
export type AssetDimension = z.infer<typeof assetDimensionSchema>;
export type AssetCategory = z.infer<typeof assetCategorySchema>;
export type AssetFormat = z.infer<typeof assetFormatSchema>;
export type AssetAnalysisSource = z.infer<typeof assetAnalysisSourceSchema>;
export type AssetPerspective = z.infer<typeof assetPerspectiveSchema>;

/**
 * Stable, content-independent identity. Appwrite file IDs are already unique
 * and immutable, so (bucket, file) is a sufficient key and stays stable even
 * when a display name changes or metadata is re-derived.
 */
export const stableAssetId = (bucketId: string, fileId: string): string => `${bucketId}:${fileId}`;

const checksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** Byte-for-byte probe results. Absent fields mean "not detected", never "infinite". */
export const imageTechnicalMetadataSchema = z
  .object({
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),

    /** PNG colour type 4/6 or JPEG/PNG alpha presence. */
    hasAlpha: z.boolean(),

    /** Animated PNG/GIF frame count; 1 for stills. */
    frames: z.number().int().positive(),

    /**
     * Uniform sprite grid detected from a matching power-of-two sheet.
     * Null when the grid cannot be established with confidence.
     */
    tileGrid: z
      .object({
        columns: z.number().int().positive(),
        rows: z.number().int().positive(),
        confidence: z.number().min(0).max(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const modelTechnicalMetadataSchema = z
  .object({
    format: z.enum(['glb', 'gltf', 'obj', 'mtl']),
    meshes: z.number().int().nonnegative(),
    materials: z.array(z.string().max(120)).max(512),

    /** Texture URIs: embedded buffer views AND external files, as authored. */
    textures: z.array(z.string().max(400)).max(512),

    /** Count of textures carried INSIDE the container (glTF bufferView / GLB BIN). */
    embeddedTextures: z.number().int().nonnegative(),
    animations: z.number().int().nonnegative(),

    /** Compressed-geometry extension in use (glTF `extensionsRequired`). */
    requiresDraco: z.boolean(),

    /** Every URI the file points at outside itself. */
    externalRefs: z.array(z.string().max(400)).max(512),
  })
  .strict();

export const audioTechnicalMetadataSchema = z
  .object({
    durationSeconds: z.number().nonnegative().nullable(),
    sampleRate: z.number().int().positive().nullable(),
    channels: z.number().int().positive().nullable(),
  })
  .strict();

export const assetTechnicalMetadataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), image: imageTechnicalMetadataSchema }).strict(),
  z.object({ kind: z.literal('model3d'), model: modelTechnicalMetadataSchema }).strict(),
  z.object({ kind: z.literal('audio'), audio: audioTechnicalMetadataSchema }).strict(),
]);

export type ImageTechnicalMetadata = z.infer<typeof imageTechnicalMetadataSchema>;
export type ModelTechnicalMetadata = z.infer<typeof modelTechnicalMetadataSchema>;
export type AudioTechnicalMetadata = z.infer<typeof audioTechnicalMetadataSchema>;
export type AssetTechnicalMetadata = z.infer<typeof assetTechnicalMetadataSchema>;

/**
 * One thing this asset needs in order to load. `embedded` dependencies are
 * already inside the file and must NEVER be fetched again; `resolved:false`
 * on a required dependency means the asset is not safely usable yet.
 */
export const assetDependencySchema = z
  .object({
    kind: assetDependencyKindSchema,
    uri: z.string().min(1).max(400),
    required: z.boolean(),
    embedded: z.boolean(),
    resolved: z.boolean(),
  })
  .strict();

export type AssetDependency = z.infer<typeof assetDependencySchema>;
export type AssetDependencyKind = z.infer<typeof assetDependencyKindSchema>;

/** Provenance: exact remote location + the original upload metadata. */
export const assetAppwriteRefSchema = z
  .object({
    bucketId: z.string().min(1).max(64),
    fileId: z.string().min(1).max(64),
    bucketName: z.string().max(64).optional(),
  })
  .strict();

export const assetLicensingSchema = z
  .object({
    name: z.string().max(160).optional(),
    url: z.string().max(400).optional(),
    attributionRequired: z.boolean().optional(),
  })
  .strict();

/**
 * What we believe the asset is FOR. `source` and `confidence` travel with every
 * description so downstream ranking can discount a filename guess and never
 * present it as fact.
 */
export const assetIntelligenceSchema = z
  .object({
    description: z.string().max(600),
    tags: z.array(z.string().min(1).max(40)).max(40),
    source: assetAnalysisSourceSchema,
    confidence: z.number().min(0).max(1),
    perspective: assetPerspectiveSchema.default('any'),
    visionAnalyzedAt: z.string().max(40).optional(),
  })
  .strict();

export const assetRecordSchema = z
  .object({
    id: z.string().min(1).max(200),
    appwrite: assetAppwriteRefSchema,

    /** Preserved verbatim — never rewritten by analysis. */
    originalName: z.string().min(1).max(300),

    /** Folder-relative path when the catalogue builder knows one, else "". */
    remotePath: z.string().max(400).default(''),
    mimeType: z.string().max(160).default(''),
    sizeOriginal: z.number().int().nonnegative().nullable().default(null),
    checksum: checksumSchema.optional(),

    role: assetRoleSchema,
    dimension: assetDimensionSchema,
    category: assetCategorySchema,
    format: assetFormatSchema,

    technical: assetTechnicalMetadataSchema.optional(),
    dependencies: z.array(assetDependencySchema).max(512).default([]),

    intelligence: assetIntelligenceSchema,
    licensing: assetLicensingSchema.optional(),

    /** False when the remote object is missing/unreadable at last check. */
    available: z.boolean(),
    unavailableReason: z.string().max(300).optional(),

    discoveredAt: z.string().max(40),
    lastVerifiedAt: z.string().max(40),
  })
  .strict()
  .superRefine((record, context) => {
    /*
     * A preview/thumbnail is documentation ABOUT something. Letting it carry a
     * usable dimension or an unverified dependency claim is how a model render
     * gets mistaken for the model itself, so forbid it structurally.
     */
    if (record.role !== 'asset') {
      if (record.dimension !== 'data') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dimension'],
          message: `A ${record.role} is not a usable ${record.dimension} asset.`,
        });
      }

      if (record.dependencies.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dependencies'],
          message: `A ${record.role} cannot declare loadable dependencies.`,
        });
      }

      if (record.intelligence.source !== 'manual' && record.intelligence.source !== 'vision') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['intelligence', 'source'],
          message: 'Previews must be labelled from vision or manual review, never guessed from the filename.',
        });
      }
    }

    if (record.available === false && !record.unavailableReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unavailableReason'],
        message: 'Unavailable assets must say why.',
      });
    }

    // A dimension must agree with the probed metadata it carries.
    if (record.technical) {
      const kindToDimension: Record<string, string> = { image: '2d', model3d: '3d', audio: 'audio' };

      if (kindToDimension[record.technical.kind] !== record.dimension) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['technical'],
          message: `${record.technical.kind} metadata contradicts dimension ${record.dimension}.`,
        });
      }
    }
  });

export type AssetIntelligence = z.infer<typeof assetIntelligenceSchema>;
export type AssetLicensing = z.infer<typeof assetLicensingSchema>;
export type AssetAppwriteRef = z.infer<typeof assetAppwriteRefSchema>;
export type AssetRecord = z.infer<typeof assetRecordSchema>;

export const assetCatalogueSchema = z.array(assetRecordSchema);

export type AssetCatalogue = z.infer<typeof assetCatalogueSchema>;

/**
 * True when the asset can be handed to a game without a follow-up fetch:
 * real file, present remotely, and every required dependency resolved.
 */
export function isAssetUsable(record: AssetRecord): boolean {
  if (!record.available || record.role !== 'asset') {
    return false;
  }

  return record.dependencies.every((dependency) => !dependency.required || dependency.resolved || dependency.embedded);
}

/** Required-but-unresolved dependencies: the reason an asset is unusable. */
export function missingDependencies(record: AssetRecord): AssetDependency[] {
  return record.dependencies.filter(
    (dependency) => dependency.required && !dependency.resolved && !dependency.embedded,
  );
}

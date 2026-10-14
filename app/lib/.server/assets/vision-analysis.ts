import { generateText } from 'ai';
import { getModel } from '~/lib/.server/llm/model';
import {
  assetCategorySchema,
  assetPerspectiveSchema,
  type AssetCategory,
  type AssetPerspective,
  type AssetRecord,
} from '~/lib/assets/asset-schema';
import type { AssetVisionEnrichment } from '~/lib/assets/catalogue-builder';

/**
 * Optional visual-AI enrichment for a catalogue scan.
 *
 * This function is deliberately an explicit opt-in: it calls the configured
 * model provider, but never the Appwrite key, and is not run for every file on
 * every game build. Feed it from the one-time/index-update job. Filenames are
 * given as weak context only; the image itself is the evidence, and the model
 * is allowed to return `other` with low confidence.
 */
export interface VisionAnalysisOptions {
  env: Env;
  provider: string;
  model: string;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, { baseUrl?: string }>;
  now?: () => string;

  /** Injectable provider for offline tests. */
  generate?: typeof generateText;
  resolveModel?: () => unknown;
}

const outputSchema = {
  description: (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 600,
  tags: (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.length <= 40 &&
    value.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 40),
  confidence: (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1,
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return btoa(binary);
}

function mimeFor(record: AssetRecord): string | undefined {
  switch (record.format) {
    case 'png':
    case 'apng':
      return 'image/png';
    case 'jpg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return undefined;
  }
}

function parseOutput(text: string):
  | {
      description: string;
      tags: string[];
      confidence: number;
      category: AssetCategory;
      perspective: AssetPerspective;
    }
  | undefined {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>;

    if (
      !outputSchema.description(value.description) ||
      !outputSchema.tags(value.tags) ||
      !outputSchema.confidence(value.confidence) ||
      !assetCategorySchema.safeParse(value.category).success ||
      !assetPerspectiveSchema.safeParse(value.perspective).success
    ) {
      return undefined;
    }

    return {
      description: value.description,
      tags: value.tags,
      confidence: value.confidence,
      category: value.category as AssetCategory,
      perspective: value.perspective as AssetPerspective,
    };
  } catch {
    return undefined;
  }
}

/** Create an enrichment callback for `buildAssetCatalogue`. */
export function createVisionAssetEnricher(options: VisionAnalysisOptions) {
  const generate = options.generate || generateText;

  return async (record: AssetRecord, bytes: Uint8Array): Promise<AssetVisionEnrichment> => {
    const mimeType = mimeFor(record);

    /*
     * No MIME guessed from visual-looking filenames, no SVG/script payloads
     * sent to the model, and no oversized images in a vision request.
     */
    if (!mimeType || bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
      return {};
    }

    const model = options.resolveModel
      ? options.resolveModel()
      : getModel(options.provider, options.model, options.env, options.apiKeys, options.providerSettings as never);
    const result = await generate({
      model: model as never,
      system:
        'You are a careful game-asset librarian. Describe only what is visibly present. Do not infer a role, game genre, license, animation or sprite-sheet layout unless the image itself clearly supports it. If uncertain, choose category "other", perspective "any", and confidence <= 0.4. Return exactly one JSON object with description, tags, confidence, category, perspective.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Inspect this actual ${record.role === 'preview' ? 'model preview image' : 'game image asset'}. Original filename (weak clue only): ${record.originalName}. If it is a preview render, describe it as a preview, never as a usable model. Return JSON with description (<=600 chars), tags (<=40 short strings), confidence (0..1), category (${assetCategorySchema.options.join('|')}), and perspective (${assetPerspectiveSchema.options.join('|')}).`,
            },
            { type: 'image', image: bytesToBase64(bytes), mimeType },
          ],
        },
      ],
      maxTokens: 600,
      temperature: 0.1,
    } as never);

    const parsed = parseOutput(result.text);

    if (!parsed) {
      return {};
    }

    /*
     * Technical category wins over the visual model when the file is a 3D
     * container, audio, font, or a metadata-confirmed spritesheet/animation.
     * Vision only resolves semantic purpose inside the correct dimension.
     */
    const category =
      record.dimension === '3d' && record.format !== 'mtl'
        ? 'model3d'
        : record.dimension === 'audio'
          ? record.category
          : parsed.category;

    return {
      category,
      intelligence: {
        description: parsed.description,
        tags: parsed.tags,
        source: 'vision',
        confidence: parsed.confidence,
        perspective: record.dimension === '2d' ? parsed.perspective : 'any',
        visionAnalyzedAt: (options.now || (() => new Date().toISOString()))(),
      },
    };
  };
}

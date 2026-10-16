import { z } from 'zod';
import { generateFluxImage, getConfiguredFluxEndpoint, getFluxApiKey } from './flux-client';

export const publishThumbnailInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  genre: z.string().trim().max(40).default('ACTION'),
  description: z.string().trim().max(1200).default(''),
  gameContext: z.string().trim().max(4000).default(''),
}).strict();

export type PublishThumbnailInput = z.input<typeof publishThumbnailInputSchema>;

export function safePublishThumbnailError(error: unknown, apiKey?: string) {
  const raw = error instanceof Error ? error.message : String(error || 'Image provider failed.');
  const redacted = apiKey ? raw.split(apiKey).join('[redacted]') : raw;
  return redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:api[_-]?key|token|secret)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 320);
}

/** Generate publish cover art server-side; provider credentials never reach the browser. */
export async function generatePublishThumbnail(
  env: Record<string, unknown> | undefined,
  input: PublishThumbnailInput,
) {
  const apiKey = getFluxApiKey(env);
  if (!apiKey) return undefined;
  const endpoint = getConfiguredFluxEndpoint(env);
  if (!endpoint) {
    throw new Error('The thumbnail-maker endpoint secret is not available in this Cloudflare environment.');
  }

  const prompt = [
    'Create polished, cinematic 16:9 key art for a browser video game cover.',
    `Game concept: ${input.title}. Genre: ${input.genre || 'ACTION'}.`,
    input.description ? `Gameplay and visual mood: ${input.description}` : '',
    input.gameContext ? `Actual game mechanics, setting, and visual assets from its source: ${input.gameContext}` : '',
    'Create original key art that clearly depicts this specific game and its actual characters, setting, and gameplay; use the provided source context rather than generic genre imagery. Use a strong central subject, layered depth, rich lighting, and professional composition.',
    'No text, letters, logos, watermarks, interface panels, borders, or device mockups.',
  ].filter(Boolean).join(' ');
  const generated = await generateFluxImage(
    { prompt, isSprite: false, width: 1024, height: 576, timeoutMs: 50000 },
    apiKey,
    endpoint,
  );

  if (!generated.ok || !generated.base64) {
    throw new Error(safePublishThumbnailError(generated.error || 'No image was returned.', apiKey));
  }
  return `data:${generated.contentType || 'image/png'};base64,${generated.base64}`;
}

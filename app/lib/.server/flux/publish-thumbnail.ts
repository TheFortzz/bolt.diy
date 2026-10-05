import { z } from 'zod';
import { generateFluxImage, getFluxApiKey, getFluxEndpoint } from './flux-client';

export const publishThumbnailInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  genre: z.string().trim().max(40).default('ACTION'),
  description: z.string().trim().max(1200).default(''),
}).strict();

export type PublishThumbnailInput = z.infer<typeof publishThumbnailInputSchema>;

/** Generate publish cover art server-side; provider credentials never reach the browser. */
export async function generatePublishThumbnail(
  env: Record<string, unknown> | undefined,
  input: PublishThumbnailInput,
) {
  const apiKey = getFluxApiKey(env);
  if (!apiKey) return undefined;

  const prompt = [
    'Create polished, cinematic 16:9 key art for a browser video game cover.',
    `Game concept: ${input.title}. Genre: ${input.genre || 'ACTION'}.`,
    input.description ? `Gameplay and visual mood: ${input.description}` : '',
    'Show a recognizable central subject and environment that clearly match this specific game, with layered depth, rich lighting, and professional composition.',
    'No text, letters, logos, watermarks, interface panels, borders, or device mockups.',
  ].filter(Boolean).join(' ');
  const generated = await generateFluxImage(
    { prompt, isSprite: false, width: 1024, height: 576, timeoutMs: 50000 },
    apiKey,
    getFluxEndpoint(env),
  );

  if (!generated.ok || !generated.base64) return undefined;
  return `data:${generated.contentType || 'image/png'};base64,${generated.base64}`;
}

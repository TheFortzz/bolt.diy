import { z } from 'zod';
import { generateFluxImage, getConfiguredFluxEndpoint, getFluxApiKey } from './flux-client';

export const publishThumbnailInputSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    genre: z.string().trim().max(40).default('ACTION'),
    description: z.string().trim().max(1200).default(''),

    /** Optional art direction from the game's creator; skips the AI brief for speed. */
    prompt: z.string().trim().max(600).default(''),

    /** Structured facts mined from the actual game files (preferred, fast). */
    visualFacts: z.string().trim().max(2400).default(''),

    /** Legacy free-form context used by older Studio clients. */
    gameContext: z.string().trim().max(12_000).default(''),

    /** Up to four base64 reference images (data URI prefix optional). */
    referenceImages: z.array(z.string().trim().max(3_500_000)).max(4).default([]),
  })
  .strict();

export type PublishThumbnailInput = z.input<typeof publishThumbnailInputSchema>;

export function safePublishThumbnailError(error: unknown, apiKey?: string) {
  const raw = error instanceof Error ? error.message : String(error || 'Image provider failed.');
  const redacted = apiKey ? raw.split(apiKey).join('[redacted]') : raw;

  return redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:api[_-]?key|token|secret)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 320);
}

/*
 * FLUX happily renders trademarks when a prompt contains them (and the prompt
 * upsampler invents poster logos even when it doesn't). The cover is supposed
 * to show the game, not a third-party brand, so trade names become neutral
 * genre language before they reach the provider.
 */
const BRAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bformula\s*1\b|\bf1\b/gi, 'open-wheel racing'],
  [/\bminecraft\b/gi, 'block-building'],
  [/\bmario\s*kart\b|\bmariokart\b/gi, 'kart racing'],
  [/\bmario\b/gi, 'platformer'],
  [/\bpok[eé]mon\b|\bpikachu\b/gi, 'creature-collecting'],
  [/\bgrand\s+theft\s+auto\b|\bgta\b/gi, 'open-world crime'],
  [/\bfortnite\b/gi, 'battle royale'],
  [/\broblox\b/gi, 'sandbox'],
  [/\bpac[-\s]?man\b/gi, 'maze chase'],
  [/\btetris\b/gi, 'falling-block puzzle'],
  [/\bsonic\b/gi, 'speed platformer'],
  [/\bzelda\b/gi, 'fantasy adventure'],
  [/\bcall\s+of\s+duty\b/gi, 'military shooter'],
  [/\bamong\s+us\b/gi, 'social deduction'],
  [/\bsubway\s+surfers\b/gi, 'endless runner'],
  [/\bcandy\s+crush\b/gi, 'match-3'],
  [/\bclash\s+of\s+clans\b/gi, 'base-building strategy'],
  [/\bangry\s+birds\b/gi, 'slingshot physics'],
  [/\bplants\s+vs\.?\s+zombies\b/gi, 'lane defense'],
  [/\bleague\s+of\s+legends\b/gi, 'fantasy MOBA'],
  [/\bvalorant\b/gi, 'tactical shooter'],
  [/\boverwatch\b/gi, 'hero shooter'],
  [/\bapex\s+legends\b/gi, 'battle royale'],
  [/\bneed\s+for\s+speed\b/gi, 'street racing'],
  [/\bgran\s+turismo\b|\bforza\b/gi, 'sim racing'],
  [
    /\bstar\s+wars\b|\bmarvel\b|\bdc\s+comics\b|\bdisney\b|\bpixar\b|\bnintendo\b|\bplaystation\b|\bxbox\b|\bsega\b|\bcapcom\b|\brockstar\b|\bepic\s+games\b|\briot\s+games\b|\bblizzard\b|\bactivision\b|\bea\s+sports\b/gi,
    'original',
  ],
  [
    /\bspider[-\s]?man\b|\bbatman\b|\bsuperman\b|\bavengers\b|\bharry\s+potter\b|\blord\s+of\s+the\s+rings\b|\bgame\s+of\s+thrones\b|\bstranger\s+things\b|\bsquid\s+game\b/gi,
    'original',
  ],
];

function sanitizeCoverText(value: string) {
  let output = String(value || '');

  for (const [pattern, replacement] of BRAND_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }

  return output.replace(/\s+/g, ' ').trim();
}

function referenceDirective(count: number) {
  if (count <= 0) {
    return '';
  }

  if (count === 1) {
    return 'Reference image 1 is the game’s actual world. Match its art style, setting, palette, and main subject.';
  }

  return 'Reference image 1 is the game’s actual world; image 2 is its player character. Match their art style, setting, palette, and design.';
}

/** Build publish cover art server-side; provider credentials never reach the browser. */
export async function generatePublishThumbnail(env: Record<string, unknown> | undefined, input: PublishThumbnailInput) {
  const apiKey = getFluxApiKey(env);

  if (!apiKey) {
    return undefined;
  }

  const endpoint = getConfiguredFluxEndpoint(env);

  if (!endpoint) {
    throw new Error('The thumbnail-maker endpoint secret is not available in this Cloudflare environment.');
  }

  /*
   * The Studio sends only actual game image assets, never arbitrary source
   * code or enemy/boss art, through image safety screening.
   */
  const references = (input.referenceImages || [])
    .map((image) =>
      String(image || '')
        .trim()
        .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
        .replace(/\s/g, ''),
    )
    .filter((image) => image.length > 32)
    .slice(0, 2);

  const requestedGenre = sanitizeCoverText(input.genre || 'ACTION')
    .slice(0, 40)
    .toLowerCase();
  const cleanGenre = /^(action|adventure|puzzle|rpg|racing)$/.test(requestedGenre) ? requestedGenre : 'action';

  /*
   * Ask for an in-game cinematic moment, not a "cover" or "poster". Poster
   * language makes the model draw title lettering and layout frames. The local
   * composer adds the real title afterwards.
   */
  const prompt = [
    `Create one original, polished, family-friendly ${cleanGenre} video-game scene.`,
    referenceDirective(references.length),
    'Show one clear in-game moment with a readable main subject, layered depth, and cinematic lighting. Use supplied game images as visual references, not source text.',
    'Full-bleed 16:9 illustration. No words, letters, numbers, logos, watermarks, UI, borders, or poster layout.',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1100);

  const shared = {
    prompt,
    isSprite: false,
    width: 896,
    height: 504,
    timeoutMs: 12_000,
    maxAttempts: 2,
    retryDelayMs: 300,

    /*
     * Critical: the upsampler is what writes "F1"/"MINECRAFT" into otherwise
     * text-free prompts. Keep the exact prompt we authored.
     */
    disablePromptUpsampling: true,
    outputFormat: 'jpeg' as const,
  };

  const generated = await generateFluxImage({ ...shared, referenceImages: references }, apiKey, endpoint);
  const firstError = generated.error || 'unknown FLUX error';

  if (!generated.ok || !generated.base64) {
    const detail = generated.error || firstError || 'No image was returned.';
    throw new Error(safePublishThumbnailError(detail, apiKey));
  }

  return `data:${generated.contentType || 'image/jpeg'};base64,${generated.base64}`;
}

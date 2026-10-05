/**
 * FLUX.2-pro Image Asset Client
 *
 * Security: Read API keys only from Cloudflare secrets/environment variables.
 * Never hardcode, log, or commit it. If missing, retain existing rendering behavior.
 */

export const FLUX_ENDPOINT =
  'https://thefortz-ai.services.ai.azure.com/providers/blackforestlabs/v1/flux-2-pro';

type FluxEnvironment = Record<string, unknown>;

function firstEnvironmentValue(env: FluxEnvironment | undefined, keys: string[], processKeys: string[] = []) {
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  if (typeof process !== 'undefined') {
    for (const key of processKeys) {
      const value = process.env?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }

  return undefined;
}

function ensureFluxApiVersion(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (/\/providers\/blackforestlabs\/v1\//i.test(url.pathname) && !url.searchParams.has('api-version')) {
      url.searchParams.set('api-version', 'preview');
    }
    return url.toString();
  } catch {
    return endpoint;
  }
}

export interface FluxGenerationOptions {
  prompt: string;
  isSprite?: boolean;
  width?: number;
  height?: number;
  timeoutMs?: number;
}

export interface FluxGenerationResult {
  ok: boolean;
  base64?: string;
  buffer?: Uint8Array;
  contentType?: string;
  error?: string;
  skipped?: boolean;
}

/**
 * Reads the FLUX API key strictly from Cloudflare bindings or environment.
 * NEVER hardcodes, logs, or commits the key.
 */
export function getFluxApiKey(env?: Record<string, any>): string | undefined {
  return firstEnvironmentValue(
    env,
    ['tunbnailmaker-key', 'thumbnailmaker-key', 'THUMBNAILMAKER_KEY', 'FLUX_API_KEY'],
    ['TUNBNAILMAKER_KEY', 'THUMBNAILMAKER_KEY', 'FLUX_API_KEY'],
  );
}

/** Read the image endpoint from Cloudflare bindings; never accept client-supplied URLs. */
export function getFluxEndpoint(env?: Record<string, any>): string {
  return ensureFluxApiVersion(firstEnvironmentValue(
    env,
    ['tunbnailmaker-url', 'thumbnailmaker-url', 'THUMBNAILMAKER_URL', 'FLUX_ENDPOINT'],
    ['TUNBNAILMAKER_URL', 'THUMBNAILMAKER_URL', 'FLUX_ENDPOINT'],
  ) || FLUX_ENDPOINT);
}

/**
 * Enhances a sprite prompt to explicitly request transparent backgrounds for game assets.
 */
export function formatFluxPrompt(prompt: string, isSprite = true): string {
  const cleanPrompt = prompt.trim().replace(/\s+/g, ' ');

  if (!isSprite) {
    return cleanPrompt;
  }

  // Ensure prompt explicitly commands transparent backgrounds for 2D game sprites
  const transparentDirectives =
    '2D video game sprite, isolated on pure transparent background, clean alpha channel, pixel-perfect crisp borders, no background, no shadows, single asset centered, PNG transparency';

  if (cleanPrompt.toLowerCase().includes('transparent background')) {
    return `${cleanPrompt}, ${transparentDirectives}`;
  }

  return `${cleanPrompt}, isolated on transparent background, ${transparentDirectives}`;
}

/**
 * Parses the response from Azure Black Forest Labs FLUX.2-pro endpoint.
 * Supports b64_json payloads, image URLs, and direct base64 fields.
 */
export async function parseFluxResponse(res: Response): Promise<FluxGenerationResult> {
  if (!res.ok) {
    let errorDetail = '';
    try {
      const errJson: any = await res.json();
      errorDetail = errJson?.error?.message || errJson?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text().catch(() => '');
    }

    return {
      ok: false,
      error: `FLUX API status ${res.status}: ${errorDetail.slice(0, 200)}`,
    };
  }

  let json: any;
  try {
    json = await res.json();
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to parse FLUX response as JSON: ${err?.message || 'Invalid JSON'}`,
    };
  }

  // Extract base64 image data from common Azure BFL FLUX response schemas
  let b64: string | undefined =
    json?.data?.[0]?.b64_json ||
    json?.images?.[0]?.b64_json ||
    json?.image ||
    json?.b64_json ||
    json?.sample;

  // Extract image URL if returned instead of base64
  const imageUrl: string | undefined =
    json?.data?.[0]?.url ||
    json?.images?.[0]?.url ||
    json?.url;

  if (!b64 && imageUrl && typeof imageUrl === 'string') {
    try {
      const imageFetchRes = await fetch(imageUrl);
      if (imageFetchRes.ok) {
        const arrayBuf = await imageFetchRes.arrayBuffer();
        const buffer = new Uint8Array(arrayBuf as ArrayBuffer);
        b64 = Buffer.from(buffer).toString('base64');

        return {
          ok: true,
          base64: b64,
          buffer,
          contentType: 'image/png',
        };
      }
    } catch (fetchErr: any) {
      return {
        ok: false,
        error: `Failed to download image from URL: ${fetchErr?.message || 'Network error'}`,
      };
    }
  }

  if (b64 && typeof b64 === 'string') {
    const cleanB64 = b64.replace(/^data:image\/\w+;base64,/, '').trim();
    const buffer = Uint8Array.from(Buffer.from(cleanB64, 'base64'));

    return {
      ok: true,
      base64: cleanB64,
      buffer,
      contentType: 'image/png',
    };
  }

  return {
    ok: false,
    error: 'No image data or URL found in FLUX API response payload',
  };
}

/**
 * Generates an image through the FLUX.2-pro deployment.
 * Handles timeouts, network issues, and transparent background formatting.
 */
export async function generateFluxImage(
  options: FluxGenerationOptions,
  apiKey?: string,
  endpoint = FLUX_ENDPOINT,
): Promise<FluxGenerationResult> {
  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      error: 'The image-generation secret is not configured in the server environment.',
    };
  }

  const {
    prompt,
    isSprite = true,
    width = 512,
    height = 512,
    timeoutMs = 45000,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const formattedPrompt = formatFluxPrompt(prompt, isSprite);

  try {
    const res = await fetch(ensureFluxApiVersion(endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'FLUX.2-pro',
        prompt: formattedPrompt,
        width,
        height,
        output_format: 'png',
      }),
      signal: controller.signal,
    });

    return await parseFluxResponse(res);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        ok: false,
        error: `FLUX request timed out after ${timeoutMs}ms`,
      };
    }

    return {
      ok: false,
      error: `FLUX request failed: ${err?.message || 'Network error'}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

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
export function getConfiguredFluxEndpoint(env?: Record<string, any>): string | undefined {
  const endpoint = firstEnvironmentValue(
    env,
    ['tunbnailmaker-url', 'thumbnailmaker-url', 'THUMBNAILMAKER_URL', 'FLUX_ENDPOINT'],
    ['TUNBNAILMAKER_URL', 'THUMBNAILMAKER_URL', 'FLUX_ENDPOINT'],
  );
  return endpoint ? ensureFluxApiVersion(endpoint) : undefined;
}

/** Backward-compatible endpoint for existing FLUX asset generation. */
export function getFluxEndpoint(env?: Record<string, any>): string {
  return getConfiguredFluxEndpoint(env) || ensureFluxApiVersion(FLUX_ENDPOINT);
}

/**
 * Enhances a sprite prompt with an opaque green key matte; the client removes it for sprites.
 */
export function formatFluxPrompt(prompt: string, isSprite = true): string {
  const cleanPrompt = prompt.trim().replace(/\s+/g, ' ');

  if (!isSprite) {
    return cleanPrompt;
  }

  // FLUX.2-pro returns opaque images, so request a flat matte for client-side keying.
  const spriteDirectives =
    'isolated 2D video game sprite, full object centered, clean crisp silhouette, flat uniform pure green screen background RGB 0 255 0. Keep every part of the subject clearly different from the green matte: do not use green or lime paint, windows, lights, reflections, glow, or green edge pixels on the object. Use a contrasting red, orange, yellow, blue, black, or white subject palette. Separate the silhouette from the matte with a thin dark outline. No scenery, ground plane, or cast shadow outside the object';

  return `${cleanPrompt}, ${spriteDirectives}`;
}

/**
 * Parses the response from Azure Black Forest Labs FLUX.2-pro endpoint.
 * Supports b64_json payloads, image URLs, and direct base64 fields.
 */
export async function parseFluxResponse(res: Response): Promise<FluxGenerationResult> {
  if (!res.ok) {
    let errorDetail = '';
    try {
      const body = await res.text();
      try {
        const errJson = JSON.parse(body);
        errorDetail = errJson?.error?.message || errJson?.message || body;
      } catch {
        errorDetail = body;
      }
    } catch {
      errorDetail = '';
    }

    return {
      ok: false,
      error: `FLUX API status ${res.status}: ${errorDetail.slice(0, 200)}`,
    };
  }

  const responseType = res.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (responseType?.startsWith('image/')) {
    const buffer = new Uint8Array((await res.arrayBuffer()) as ArrayBuffer);
    if (!buffer.byteLength) return { ok: false, error: 'FLUX returned an empty image.' };

    return {
      ok: true,
      base64: Buffer.from(buffer).toString('base64'),
      buffer,
      contentType: responseType,
    };
  }

  let json: any;
  try {
    json = JSON.parse(await res.text());
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to parse FLUX response as JSON: ${err?.message || 'Invalid JSON'}`,
    };
  }

  const imageKeys = /image|b64|base64|output|sample|result|data|payload|binary|bytes|artifact/i;
  const findImagePayload = (value: unknown, parentKey = '', depth = 0): { base64?: string; url?: string; contentType?: string } | undefined => {
    if (depth > 12 || value == null) return undefined;

    if (typeof value === 'string') {
      const dataUrl = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
      if (dataUrl) return { base64: dataUrl[2].replace(/\s/g, ''), contentType: dataUrl[1].toLowerCase() };
      if (/^https?:\/\//i.test(value)) return { url: value };

      const compact = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
      if ((imageKeys.test(parentKey) || compact.length >= 128) && /^[a-z0-9+/]+={0,2}$/i.test(compact) && compact.length > 8) {
        return { base64: compact };
      }
      return undefined;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findImagePayload(item, parentKey, depth + 1);
        if (found) return found;
      }
      return undefined;
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const contentType = typeof record.content_type === 'string'
        ? record.content_type
        : typeof record.contentType === 'string'
          ? record.contentType
        : typeof record.mime_type === 'string'
          ? record.mime_type
          : typeof record.mimeType === 'string'
            ? record.mimeType
            : undefined;
      const orderedKeys = Object.keys(record).sort((left, right) => Number(imageKeys.test(right)) - Number(imageKeys.test(left)));
      for (const key of orderedKeys) {
        const found = findImagePayload(record[key], key, depth + 1);
        if (found) return { ...found, contentType: found.contentType || contentType };
      }
    }

    return undefined;
  };

  const imagePayload = findImagePayload(json);
  if (imagePayload?.url) {
    try {
      const imageFetchRes = await fetch(imagePayload.url, { signal: AbortSignal.timeout(20000) });
      if (!imageFetchRes.ok) return { ok: false, error: `Could not download FLUX image (HTTP ${imageFetchRes.status}).` };
      const buffer = new Uint8Array((await imageFetchRes.arrayBuffer()) as ArrayBuffer);
      if (!buffer.byteLength) return { ok: false, error: 'FLUX image URL returned an empty image.' };

      return {
        ok: true,
        base64: Buffer.from(buffer).toString('base64'),
        buffer,
        contentType: imageFetchRes.headers.get('Content-Type')?.split(';')[0] || 'image/png',
      };
    } catch (fetchErr: any) {
      return {
        ok: false,
        error: `Failed to download image from URL: ${fetchErr?.message || 'Network error'}`,
      };
    }
  }

  if (imagePayload?.base64) {
    const cleanB64 = imagePayload.base64.trim();
    const buffer = Uint8Array.from(Buffer.from(cleanB64, 'base64'));
    if (!buffer.byteLength) return { ok: false, error: 'FLUX returned an empty encoded image.' };

    return {
      ok: true,
      base64: cleanB64,
      buffer,
      contentType: imagePayload.contentType || 'image/png',
    };
  }

  const providerError = json?.error?.message || json?.error || json?.message;
  if (providerError) {
    return { ok: false, error: `FLUX returned an error: ${String(providerError).slice(0, 240)}` };
  }

  const fields = json && typeof json === 'object' ? Object.keys(json).slice(0, 12).join(', ') : typeof json;
  return {
    ok: false,
    error: `FLUX response contained no image payload (top-level fields: ${fields || 'none'}).`,
  };
}

/**
 * Generates an image through the FLUX.2-pro deployment.
 * Handles timeouts, network issues, and sprite green-screen prompt formatting.
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

import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { ZodError } from 'zod';
import {
  publishThumbnailInputSchema,
  generatePublishThumbnail,
  safePublishThumbnailError,
} from '~/lib/.server/flux/publish-thumbnail';
import { getConfiguredFluxEndpoint, getFluxApiKey } from '~/lib/.server/flux/flux-client';

const THUMBNAIL_LIMIT = 6;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const thumbnailRequests = new Map<string, { startedAt: number; count: number }>();

function allowThumbnailRequest(ip: string, now = Date.now()) {
  for (const [key, entry] of thumbnailRequests) {
    if (now - entry.startedAt >= RATE_WINDOW_MS) {
      thumbnailRequests.delete(key);
    }
  }

  const current = thumbnailRequests.get(ip);

  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    thumbnailRequests.set(ip, { startedAt: now, count: 1 });
    return true;
  }

  if (current.count >= THUMBNAIL_LIMIT) {
    return false;
  }

  current.count++;

  return true;
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, { status: 405 });
  }

  const requestUrl = new URL(request.url);

  if (request.headers.get('Origin') !== requestUrl.origin) {
    return json({ error: 'Thumbnail requests must come from this Studio.' }, { status: 403 });
  }

  const env = context.cloudflare?.env as unknown as Record<string, unknown> | undefined;

  if (!getFluxApiKey(env) || !getConfiguredFluxEndpoint(env)) {
    return json(
      { fallback: true, error: 'AI cover secrets are unavailable; use a local cover.' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'local';

  if (!allowThumbnailRequest(ip)) {
    return json(
      { fallback: true, error: 'AI cover generation is rate-limited; use a local cover.' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const input = publishThumbnailInputSchema.parse(await request.json());
    const dataUrl = await generatePublishThumbnail(env, input);

    if (!dataUrl) {
      return json(
        { fallback: true, error: 'The AI cover generator returned no image; use a local cover.' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return json({ dataUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ZodError) {
      return json({ error: 'The game details are invalid for cover generation.' }, { status: 400 });
    }

    return json(
      {
        fallback: true,
        error: `AI cover generation failed; use a local cover. ${safePublishThumbnailError(error, getFluxApiKey(env))}`,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

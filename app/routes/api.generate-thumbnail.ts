import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { ZodError } from 'zod';
import { publishThumbnailInputSchema, generatePublishThumbnail } from '~/lib/.server/flux/publish-thumbnail';
import { getFluxApiKey } from '~/lib/.server/flux/flux-client';

const THUMBNAIL_LIMIT = 6;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const thumbnailRequests = new Map<string, { startedAt: number; count: number }>();

function allowThumbnailRequest(ip: string, now = Date.now()) {
  for (const [key, entry] of thumbnailRequests) {
    if (now - entry.startedAt >= RATE_WINDOW_MS) thumbnailRequests.delete(key);
  }

  const current = thumbnailRequests.get(ip);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    thumbnailRequests.set(ip, { startedAt: now, count: 1 });
    return true;
  }

  if (current.count >= THUMBNAIL_LIMIT) return false;
  current.count++;
  return true;
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, { status: 405 });

  const requestUrl = new URL(request.url);
  if (request.headers.get('Origin') !== requestUrl.origin) {
    return json({ error: 'Thumbnail requests must come from this Studio.' }, { status: 403 });
  }

  const env = context.cloudflare?.env as unknown as Record<string, unknown> | undefined;
  if (!getFluxApiKey(env)) {
    return json({ error: 'AI cover generation is not configured; a local cover will be used.' }, { status: 503 });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!allowThumbnailRequest(ip)) {
    return json({ error: 'Too many cover-art requests. Try again later.' }, { status: 429 });
  }

  try {
    const input = publishThumbnailInputSchema.parse(await request.json());
    const dataUrl = await generatePublishThumbnail(env, input);
    if (!dataUrl) {
      return json({ error: 'The AI cover generator did not return an image; a local cover will be used.' }, { status: 502 });
    }

    return json({ dataUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ZodError) {
      return json({ error: 'The game details are invalid for cover generation.' }, { status: 400 });
    }

    return json({ error: 'The AI cover generator failed; a local cover will be used.' }, { status: 502 });
  }
}

import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { z } from 'zod';
import { getFluxApiKey, generateFluxImage } from '~/lib/.server/flux/flux-client';
import { blueprintSchema } from '~/lib/harness/blueprint';
import { getHarnessSecret, requireSameOrigin, verifyCapability } from '~/lib/.server/harness/capabilities';

interface AssetResult {
  ok: boolean;
  assets: Array<{ id: string; fileName: string; base64: string }>;
  updatedFiles: Record<string, string>;
  error?: string;
}

// Coalesces retries in one worker instance. A durable distributed job ledger is
// still required for exactly-once billing across deployments/restarts.
const jobs = new Map<string, { expiresAt: number; result: Promise<AssetResult> }>();

export async function loader({ context }: LoaderFunctionArgs) {
  return json({ available: Boolean(getFluxApiKey(context.cloudflare?.env)) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function action({ context, request }: ActionFunctionArgs) {
  try {
    requireSameOrigin(request);
    const input = z.object({ approvedBlueprint: blueprintSchema, executionToken: z.string().max(4096) }).strict().parse(await request.json());
    const env = context.cloudflare.env;
    const blueprint = await verifyCapability(input.executionToken, input.approvedBlueprint, 'execute', getHarnessSecret(env), new URL(request.url).origin);
    const apiKey = getFluxApiKey(env);

    if (!apiKey && blueprint.assetOperations.length) {
      return json({ ok: false, error: 'The approved Image Builder is unavailable. Request a new procedural-visual plan.' }, { status: 503 });
    }
    for (const [id, job] of jobs) {
      if (job.expiresAt < Date.now()) {
        jobs.delete(id);
      }
    }
    if (!jobs.has(blueprint.id)) {
      if (jobs.size >= 100) {
        return json({ ok: false, error: 'Image Builder queue is full. Try again later.' }, { status: 429 });
      }
      const result = (async (): Promise<AssetResult> => {
        const assets: AssetResult['assets'] = [];

        // Bounded sequential generation avoids bursting the image provider.
        for (const operation of blueprint.assetOperations) {
          const image = await generateFluxImage({
            prompt: operation.prompt,
            isSprite: operation.kind === 'sprite' || operation.kind === 'ui',
            width: operation.width,
            height: operation.height,
            timeoutMs: 35000,
          }, apiKey!);

          if (!image.ok || !image.base64) {
            return { ok: false, assets: [], updatedFiles: {}, error: `Could not generate ${operation.path}: ${image.error || 'No image returned'}` };
          }
          assets.push({ id: operation.id, fileName: operation.path, base64: image.base64 });
        }

        return { ok: true, assets, updatedFiles: {} };
      })().catch((error: unknown): AssetResult => ({ ok: false, assets: [], updatedFiles: {}, error: (error as Error).message }));
      jobs.set(blueprint.id, { expiresAt: Date.now() + 35 * 60 * 1000, result });
    }

    return json(await jobs.get(blueprint.id)!.result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return json({ ok: false, error: `Approved asset request required: ${(error as Error).message}` }, { status: 409 });
  }
}

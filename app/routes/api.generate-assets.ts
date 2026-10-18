import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { z } from 'zod';
import { getFluxApiKey, getFluxEndpoint, generateFluxImage } from '~/lib/.server/flux/flux-client';
import { blueprintSchema } from '~/lib/harness/blueprint';
import { getHarnessSecret, requireSameOrigin, verifyCapability } from '~/lib/.server/harness/capabilities';

interface AssetResult {
  ok: boolean;
  assets: Array<{ id: string; fileName: string; kind: 'sprite' | 'background' | 'ui'; base64: string }>;
  updatedFiles: Record<string, string>;
  error?: string;
}

// Coalesces retries in one worker instance. A durable distributed job ledger is
// still required for exactly-once billing across deployments/restarts.
const jobs = new Map<string, { expiresAt: number; result: Promise<AssetResult> }>();

export async function loader({ context }: LoaderFunctionArgs) {
  return json(
    { available: Boolean(getFluxApiKey(context.cloudflare?.env)) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function action({ context, request }: ActionFunctionArgs) {
  try {
    requireSameOrigin(request);
    const input = z
      .object({ approvedBlueprint: blueprintSchema, executionToken: z.string().max(4096) })
      .strict()
      .parse(await request.json());
    const env = context.cloudflare.env;
    const blueprint = await verifyCapability(
      input.executionToken,
      input.approvedBlueprint,
      'execute',
      await getHarnessSecret(env),
      new URL(request.url).origin,
    );
    const apiKey = getFluxApiKey(env);
    const endpoint = getFluxEndpoint(env);

    if (!apiKey && blueprint.assetOperations.length) {
      return json(
        { ok: false, error: 'The approved Image Builder is unavailable. Request a new procedural-visual plan.' },
        { status: 503 },
      );
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
        const assets: Array<AssetResult['assets'][number] | undefined> = new Array(blueprint.assetOperations.length);
        const failures: string[] = [];

        /*
         * Up to four images must finish inside one edge request, so generate
         * with a small bounded pool instead of strictly one-at-a-time: two
         * concurrent renders halve the wall time without bursting the provider
         * into rate limits (which used to surface as a 504 gateway timeout).
         */
        const poolSize = Math.min(2, blueprint.assetOperations.length);
        let cursor = 0;

        const worker = async () => {
          while (cursor < blueprint.assetOperations.length) {
            const index = cursor++;
            const operation = blueprint.assetOperations[index];
            const image = await generateFluxImage(
              {
                prompt: operation.prompt,
                isSprite: operation.kind === 'sprite',
                width: operation.width,
                height: operation.height,
                timeoutMs: 30000,
                // Same transient provider failures hit asset renders; retry
                // inside a hard 40s cap so queued batches still make progress.
                deadlineMs: 40000,
              },
              apiKey!,
              endpoint,
            );

            if (!image.ok || !image.base64) {
              failures.push(`Could not generate ${operation.path}: ${image.error || 'No image returned'}`);
              continue;
            }

            assets[index] = { id: operation.id, fileName: operation.path, kind: operation.kind, base64: image.base64 };
          }
        };

        await Promise.all(Array.from({ length: poolSize }, () => worker()));

        const completed = assets.filter(Boolean) as AssetResult['assets'];
        return {
          ok: completed.length > 0 || blueprint.assetOperations.length === 0,
          assets: completed,
          updatedFiles: {},
          error: failures.length ? failures.join(' ').slice(0, 1200) : undefined,
        };
      })().catch(
        (error: unknown): AssetResult => ({ ok: false, assets: [], updatedFiles: {}, error: (error as Error).message }),
      );
      jobs.set(blueprint.id, { expiresAt: Date.now() + 35 * 60 * 1000, result });
    }

    const job = jobs.get(blueprint.id)!;
    const result = await job.result;
    if (!result.ok) jobs.delete(blueprint.id);
    return json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return json({ ok: false, error: `Approved asset request required: ${(error as Error).message}` }, { status: 409 });
  }
}

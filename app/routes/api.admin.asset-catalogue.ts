import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { z } from 'zod';
import { buildAssetCatalogue } from '~/lib/assets/catalogue-builder';
import { assetCatalogueSchema } from '~/lib/assets/asset-schema';
import { loadAssetCatalogue, writeCatalogueToKv } from '~/lib/.server/assets/catalogue-store';
import { createVisionAssetEnricher } from '~/lib/.server/assets/vision-analysis';
import { resolveAssetLibraryConfig } from '~/lib/.server/assets/asset-library-client';
import { requireSameOrigin } from '~/lib/.server/harness/capabilities';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '~/utils/constants';

/**
 * Explicit, authenticated asset-catalogue maintenance endpoint.
 *
 * POST `{ "dryRun": true }` reports counts, unavailable files and dependency
 * errors without writing anything. Only `{ "dryRun": false }` writes, and
 * then only to the catalogue KV entry (with a timestamped backup) — never to
 * Appwrite Storage. This route is deliberately not wired to the game build or
 * the browser UI; it is an operator maintenance action.
 */

const requestSchema = z
  .object({
    dryRun: z.boolean().default(true),
    maxFiles: z.number().int().min(1).max(1000).default(500),
    analyzeImages: z.boolean().default(false),
  })
  .strict();

function sameSecret(expected: string, actual: string): boolean {
  if (expected.length !== actual.length || expected.length === 0) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < expected.length; index++) {
    mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }

  return mismatch === 0;
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Use POST.' }, { status: 405 });
  }

  try {
    requireSameOrigin(request);
  } catch {
    return json({ ok: false, error: 'Cross-origin catalogue operations are not allowed.' }, { status: 403 });
  }

  const env = context.cloudflare.env;
  const adminToken = env.ASSET_CATALOGUE_ADMIN_TOKEN || '';
  const authorization = request.headers.get('Authorization') || '';
  const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!adminToken || !sameSecret(adminToken, suppliedToken)) {
    return json(
      {
        ok: false,
        error: adminToken
          ? 'A valid asset-catalogue admin token is required.'
          : 'ASSET_CATALOGUE_ADMIN_TOKEN is not configured in the server environment.',
      },
      { status: adminToken ? 403 : 503 },
    );
  }

  let input: z.infer<typeof requestSchema>;

  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return json({ ok: false, error: 'Invalid catalogue request.' }, { status: 400 });
  }

  const appwrite = resolveAssetLibraryConfig(env);

  if (!appwrite.ok) {
    return json({ ok: false, error: appwrite.blocker.message, code: appwrite.blocker.code }, { status: 503 });
  }

  const previousResult = await loadAssetCatalogue(env);
  const previous = previousResult.available ? previousResult.catalogue : [];
  let visionAttempts = 0;
  let visionFailures = 0;
  let visionDisabled = false;
  const visionEnricher = input.analyzeImages
    ? createVisionAssetEnricher({
        env,
        provider: DEFAULT_PROVIDER.name,
        model: DEFAULT_MODEL,
      })
    : undefined;

  const report = await buildAssetCatalogue({
    config: appwrite.data,
    dryRun: input.dryRun,
    maxFiles: input.maxFiles,
    maxPages: 20,
    previousCatalogue: previous,
    ...(visionEnricher
      ? {
          enrich: async (record, bytes) => {
            /*
             * Cost-bounded vision pass per scan. Remaining files retain
             * filename/metadata confidence rather than unbounded model calls.
             */
            if (
              visionDisabled ||
              !['png', 'apng', 'jpg', 'webp', 'gif'].includes(record.format) ||
              visionAttempts >= 50
            ) {
              return {};
            }

            visionAttempts += 1;

            try {
              return await visionEnricher(record, bytes);
            } catch {
              visionFailures += 1;
              visionDisabled = true;

              return {};
            }
          },
        }
      : {}),
  });

  if (report.blockers.length > 0) {
    return json(
      { ok: false, error: report.blockers[0].message, blockers: report.blockers },
      { status: report.blockers[0].httpStatus || 502 },
    );
  }

  let write: { written: boolean; backupKey?: string; reason?: string } | undefined;

  if (!input.dryRun) {
    const kv = env.ASSET_CATALOGUE_KV;

    if (!kv?.put) {
      return json(
        {
          ok: false,
          error:
            'ASSET_CATALOGUE_KV is not bound to this Pages project. Dry-run completed, but publishing the index requires the KV binding.',
          report: {
            filesSeen: report.filesSeen,
            records: report.records.length,
            counts: report.counts,
            unusable: report.unusable,
            unreadable: report.unreadable,
          },
        },
        { status: 503 },
      );
    }

    const validated = assetCatalogueSchema.safeParse(report.records);

    if (!validated.success) {
      return json({ ok: false, error: 'The built catalogue failed final validation.' }, { status: 500 });
    }

    write = await writeCatalogueToKv(kv, validated.data);

    if (!write.written) {
      return json({ ok: false, error: write.reason || 'Catalogue write was refused.' }, { status: 500 });
    }
  }

  return json(
    {
      ok: true,
      dryRun: input.dryRun,
      filesSeen: report.filesSeen,
      records: report.records.length,
      previews: report.previewCount,
      counts: report.counts,
      unusable: report.unusable,
      unreadable: report.unreadable,
      warnings: [
        ...report.warnings,
        ...(input.analyzeImages && visionFailures > 0
          ? [
              `Vision analysis failed on the first request; remaining images retained non-vision metadata (${visionFailures} failure).`,
            ]
          : []),
        ...(input.analyzeImages && visionAttempts >= 50
          ? ['Vision analysis stopped at the 50-image per-run budget.']
          : []),
      ],
      write,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

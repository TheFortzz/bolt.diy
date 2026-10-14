import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { z } from 'zod';
import { getHarnessSecret, requireSameOrigin, verifyCapability } from '~/lib/.server/harness/capabilities';
import { blueprintSchema } from '~/lib/harness/blueprint';
import { loadAssetCatalogue } from '~/lib/.server/assets/catalogue-store';
import {
  fetchAssetBytes,
  resolveAssetLibraryConfig,
  type AssetLibraryBlocker,
} from '~/lib/.server/assets/asset-library-client';
import { destinationPathFor } from '~/lib/.server/assets/candidate-search';
import { requiredFetchGroup } from '~/lib/assets/dependencies';

/**
 * Materialise approved library assets into a game.
 *
 * The Appwrite key is used HERE, on the server, and never crosses to the
 * browser. The client receives base64 payloads for exactly the catalogue ids
 * it was approved to use — it cannot ask for an arbitrary file, because ids
 * are resolved against the validated catalogue and anything unknown is
 * refused before a single byte is read.
 */

const MAX_ASSETS = 24;

/** Whole-bundle ceiling: a handful of 3D models with textures adds up fast. */
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_SINGLE_BYTES = 48 * 1024 * 1024;

const requestSchema = z
  .object({
    ids: z.array(z.string().min(1).max(200)).min(1).max(MAX_ASSETS),
    approvedBlueprint: blueprintSchema,
    executionToken: z.string().max(4096),
  })
  .strict();

interface AssetPayload {
  id: string;
  path: string;

  /** Ids that must ship with this one (a model's materials/textures). */
  group: string[];
  mimeType: string;
  base64: string;
  byteLength: number;
}

function blockerResponse(blocker: AssetLibraryBlocker, status: number) {
  return json({ ok: false, error: blocker.message, code: blocker.code }, { status });
}

export async function loader({ context }: LoaderFunctionArgs) {
  const catalogue = await loadAssetCatalogue(context.cloudflare?.env as never);

  return json(
    {
      ok: true,
      available: catalogue.available,
      reason: catalogue.reason,
      summary: catalogue.available ? { count: catalogue.catalogue.length } : undefined,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Use POST.' }, { status: 405 });
  }

  try {
    requireSameOrigin(request);
  } catch {
    return json({ ok: false, error: 'Cross-origin asset requests are not allowed.' }, { status: 403 });
  }

  const env = context.cloudflare.env as unknown as Record<string, string | undefined>;

  let input: z.infer<typeof requestSchema>;

  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  /*
   * The server-bound key can read the whole bucket. Require the same signed
   * execute capability used by the build route and restrict requested ids to
   * the libraryAssets the user explicitly approved in that plan.
   */
  let approvedBlueprint;

  try {
    approvedBlueprint = await verifyCapability(
      input.executionToken,
      input.approvedBlueprint,
      'execute',
      await getHarnessSecret(context.cloudflare.env),
      new URL(request.url).origin,
    );
  } catch {
    return json({ ok: false, error: 'A valid approved-build capability is required.' }, { status: 403 });
  }

  const approvedIds = new Set(approvedBlueprint.libraryAssets.map((asset) => asset.id));
  const forbidden = input.ids.filter((id) => !approvedIds.has(id));

  if (forbidden.length > 0) {
    return json({ ok: false, error: 'Requested asset ids are outside the approved blueprint.' }, { status: 403 });
  }

  // The catalogue is the allowlist: only assets a plan could legitimately use.
  const catalogue = await loadAssetCatalogue(env as never);

  if (!catalogue.available) {
    return blockerResponse(
      {
        code: 'not-found',
        message: catalogue.reason || 'No asset catalogue is available, so no library assets can be fetched.',
      },
      404,
    );
  }

  const config = resolveAssetLibraryConfig(env as never);

  if (!config.ok) {
    return blockerResponse(config.blocker, 503);
  }

  /*
   * Expand each requested id into its full fetch group so a model never
   * arrives without the external textures its material references. Embedded
   * textures are already inside the model and are not fetched again.
   */
  const wanted = new Map<string, { group: string[]; path: string; mimeType: string }>();
  const unknown: string[] = [];

  for (const id of input.ids) {
    const record = catalogue.catalogue.find((entry) => entry.id === id);

    if (!record) {
      unknown.push(id);
      continue;
    }

    for (const member of requiredFetchGroup(record, catalogue.catalogue)) {
      const key = member.id;

      if (wanted.has(key)) {
        continue;
      }

      wanted.set(key, {
        group: [],
        path: destinationPathFor(member),
        mimeType: member.mimeType || '',
      });
    }

    wanted.set(record.id, {
      group: requiredFetchGroup(record, catalogue.catalogue)
        .filter((entry) => entry.id !== record.id)
        .map(destinationPathFor),
      path: destinationPathFor(record),
      mimeType: record.mimeType || '',
    });
  }

  if (unknown.length > 0) {
    return json(
      {
        ok: false,
        error: `These asset ids are not in the verified catalogue: ${unknown.slice(0, 6).join(', ')}.`,
        code: 'invalid-file-id',
      },
      { status: 400 },
    );
  }

  const files: AssetPayload[] = [];
  let totalBytes = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  for (const [id, meta] of wanted) {
    const result = await fetchAssetBytes(config.data, id.split(':')[1] || id, {
      maxBytes: MAX_SINGLE_BYTES,
    });

    if (!result.ok) {
      failures.push({ id, reason: result.blocker.message });
      continue;
    }

    const bytes = result.data;
    totalBytes += bytes.byteLength;

    if (totalBytes > MAX_TOTAL_BYTES) {
      return json(
        { ok: false, error: 'The selected assets exceed the per-build transfer limit.', code: 'too-large' },
        { status: 413 },
      );
    }

    let binary = '';
    const chunk = 0x8000;

    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }

    files.push({
      id,
      path: meta.path,
      group: meta.group,
      mimeType: meta.mimeType,
      base64: btoa(binary),
      byteLength: bytes.byteLength,
    });
  }

  if (failures.length > 0) {
    return json(
      {
        ok: false,
        error: `The approved asset group is incomplete; required files could not be fetched: ${failures
          .slice(0, 6)
          .map((failure) => failure.id)
          .join(', ')}. The build should use procedural fallbacks instead.`,
        code: 'dependency-unavailable',
      },
      { status: 424 },
    );
  }

  return json({ ok: true, files, failures }, { headers: { 'Cache-Control': 'no-store' } });
}

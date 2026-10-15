import { assetCatalogueSchema, type AssetCatalogue, type AssetRecord } from '~/lib/assets/asset-schema';
import { isAssetUsable } from '~/lib/assets/asset-schema';
import { checkCompatibility } from '~/lib/assets/dependencies';

/**
 * Server-side catalogue store.
 *
 * The catalogue is produced by `buildAssetCatalogue` and lives on disk. This
 * module only READS it, validates it, and hands out a bounded shortlist.
 *
 * When no catalogue file exists the store reports `available: false` with a
 * reason, and every caller degrades to procedural visuals — the studio behaves
 * exactly as it did before the library existed. That is deliberate: a missing
 * catalogue must never be able to break a build.
 */

export interface CatalogueLoadResult {
  available: boolean;
  catalogue: AssetCatalogue;

  /** Operator-facing explanation when unavailable. */
  reason?: string;
  path?: string;
}

export interface AssetCatalogueKv {
  get(key: string, type: 'text'): Promise<string | null>;
  put?(key: string, value: string): Promise<void>;
}

export interface AssetLibraryEnv {
  ASSET_CATALOGUE_PATH?: string;

  /** Optional small dev/test override; never put credentials in this JSON. */
  ASSET_CATALOGUE_JSON?: string;

  /** Cloudflare KV binding for the production catalogue. */
  ASSET_CATALOGUE_KV?: AssetCatalogueKv;
}

const DEFAULT_CATALOGUE_PATH = 'asset-catalogue.json';

let cached: { key: string; result: CatalogueLoadResult } | undefined;

export function resolveCataloguePath(env: AssetLibraryEnv): string {
  return (env.ASSET_CATALOGUE_PATH || '').trim() || DEFAULT_CATALOGUE_PATH;
}

/**
 * Load and validate the catalogue. A malformed file is reported, not thrown:
 * a corrupt index must not take the studio down.
 */
export async function loadAssetCatalogue(
  env: AssetLibraryEnv,
  readFile: (path: string) => Promise<string> = defaultReadFile,
): Promise<CatalogueLoadResult> {
  const path = resolveCataloguePath(env);

  let raw: string | null = null;

  /*
   * Cloudflare Pages cannot read an arbitrary local JSON file at runtime.
   * Prefer a KV binding there; the filesystem fallback is only for local dev.
   */
  if (typeof env.ASSET_CATALOGUE_JSON === 'string' && env.ASSET_CATALOGUE_JSON.trim()) {
    raw = env.ASSET_CATALOGUE_JSON;
  } else if (env.ASSET_CATALOGUE_KV) {
    try {
      raw = await env.ASSET_CATALOGUE_KV.get(path, 'text');
    } catch {
      raw = null;
    }
  } else {
    try {
      raw = await readFile(path);
    } catch {
      raw = null;
    }
  }

  if (!raw) {
    const reason = env.ASSET_CATALOGUE_KV
      ? `No asset catalogue found in Cloudflare KV key "${path}".`
      : `No asset catalogue at ${path}.`;
    cached = { key: path, result: { available: false, catalogue: [], reason } };

    return cached.result;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    cached = {
      key: path,
      result: { available: false, catalogue: [], reason: `Asset catalogue at ${path} is not valid JSON.` },
    };

    return cached.result;
  }

  const validated = assetCatalogueSchema.safeParse(parsed);

  if (!validated.success) {
    cached = {
      key: path,
      result: {
        available: false,
        catalogue: [],
        reason: `Asset catalogue at ${path} failed validation (${validated.error.issues.length} issues).`,
      },
    };

    return cached.result;
  }

  /*
   * Keep every record in the in-memory catalogue: non-loadable .bin/texture
   * sidecars are still required to resolve a parent model's dependency group,
   * and previews/unavailable entries preserve provenance. Candidate search
   * calls `checkCompatibility` and `isAssetUsable`, so none can be selected as
   * a standalone game asset.
   */
  const hasUsableAssets = validated.data.some(isAssetUsable);
  const result: CatalogueLoadResult = { available: hasUsableAssets, catalogue: validated.data, path };

  if (!result.available) {
    result.reason = `Asset catalogue at ${path} contains no usable assets.`;
  }

  cached = { key: path, result };

  return result;
}

/** Test seam: drop the memoised catalogue. */
export function resetCatalogueCache(): void {
  cached = undefined;
}

function defaultReadFile(path: string): Promise<string> {
  return import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
}

/** Summary counts for the Blueprint card and for operator diagnostics. */
export function catalogueSummary(catalogue: AssetCatalogue): Record<string, number> {
  const counts: Record<string, number> = { total: catalogue.length };

  for (const record of catalogue) {
    counts[`${record.dimension}/${record.category}`] = (counts[`${record.dimension}/${record.category}`] || 0) + 1;
  }

  return counts;
}

/** Records that exist but cannot ship, with the exact reason. */
export function catalogueGaps(catalogue: AssetCatalogue): Array<{ id: string; originalName: string; reason: string }> {
  return catalogue
    .filter((record) => !isAssetUsable(record))
    .map((record) => ({
      id: record.id,
      originalName: record.originalName,
      reason: record.available
        ? checkCompatibility(record, catalogue).blocking.join('; ')
        : (record.unavailableReason ?? 'remote file unavailable'),
    }));
}

/** Look a record up by its stable id. */
export function findAssetById(catalogue: AssetCatalogue, id: string): AssetRecord | undefined {
  return catalogue.find((record) => record.id === id);
}

/**
 * Publish a validated catalogue into the Cloudflare KV binding used by the
 * Pages runtime. Preserve the prior version under a timestamped backup key
 * before replacing the live value; empty catalogues are refused.
 */
export async function writeCatalogueToKv(
  kv: {
    get(key: string, type?: 'text'): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  },
  catalogue: AssetCatalogue,
  key = DEFAULT_CATALOGUE_PATH,
  now = Date.now,
): Promise<{ written: boolean; backupKey?: string; reason?: string }> {
  const validated = assetCatalogueSchema.safeParse(catalogue);

  if (!validated.success || validated.data.length === 0) {
    return { written: false, reason: 'Refusing to publish an empty or invalid catalogue to KV.' };
  }

  const previous = await kv.get(key);
  let backupKey: string | undefined;

  if (previous) {
    backupKey = `${key}.${now()}.bak`;
    await kv.put(backupKey, previous);
  }

  await kv.put(key, JSON.stringify(validated.data));

  return { written: true, backupKey };
}

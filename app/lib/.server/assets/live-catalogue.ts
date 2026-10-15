import { assetCatalogueSchema, type AssetCatalogue, type AssetRecord } from '~/lib/assets/asset-schema';
import { resolveAssetLibraryConfig } from './asset-library-client';
import { buildAssetCatalogue } from '~/lib/assets/catalogue-builder';
import { queryTerms } from '~/lib/assets/search';

export async function buildLiveAssetCatalogue(
  env: { APPWRITE_API_KEY?: string; APPWRITE_ENDPOINT?: string; APPWRITE_PROJECT_ID?: string; APPWRITE_ASSETS_BUCKET_ID?: string },
  queryText: string,
): Promise<AssetCatalogue> {
  const config = resolveAssetLibraryConfig(env);
  if (!config.ok) return [];

  const terms = Array.from(new Set(queryTerms({ text: queryText }).map((term) => term.toLowerCase())))
    .filter((term) => term.length > 2)
    .slice(0, 6);

  const termsToSearch = terms.length > 0 ? terms : [queryText.toLowerCase().trim()].filter(Boolean);
  const records = new Map<string, AssetRecord>();

  for (const term of termsToSearch) {
    try {
      const report = await buildAssetCatalogue({
        config: config.data,
        dryRun: true,
        maxFiles: 100,
        maxPages: 2,
        search: term,
        probe: false,
      });

      for (const record of report.records) {
        if (!records.has(record.id)) {
          records.set(record.id, record);
        }
      }
    } catch {
      // best-effort: keep any already-collected assets.
    }
  }

  const validated = assetCatalogueSchema.safeParse(Array.from(records.values()));
  return validated.success ? validated.data : Array.from(records.values());
}

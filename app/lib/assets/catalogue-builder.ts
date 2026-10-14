import {
  assetCatalogueSchema,
  type AssetCatalogue,
  type AssetRecord,
  type AssetTechnicalMetadata,
  stableAssetId,
} from './asset-schema';
import { classifyAsset } from './classify';
import { checksumBytes, extractModel3d, extractTechnicalMetadata } from './technical-metadata';
import { checkCompatibility, linkModelPreviews, resolveCatalogueDependencies } from './dependencies';
import {
  type AssetLibraryBlocker,
  type AssetLibraryConfig,
  fetchAssetBytes,
  listAssetFiles,
} from '~/lib/.server/assets/asset-library-client';

/**
 * Build the asset catalogue from Appwrite Storage.
 *
 * Safety properties, in order of importance:
 *  - READ-ONLY. Nothing here creates, deletes, overwrites or re-uploads a
 *    remote file. The only writes are to the local catalogue file, and those
 *    are guarded by `writeCatalogueSafely`.
 *  - Bounded. Page count, file count and per-file byte size are all capped, so
 *    a huge bucket cannot turn into an unbounded scan or a Worker OOM.
 *  - Honest. An asset whose bytes cannot be probed is recorded with
 *    `available: true` but no technical metadata and lower confidence, rather
 *    than being given invented facts.
 */

export interface CatalogueBuildOptions {
  config: AssetLibraryConfig;

  /** Report what would happen; write nothing. */
  dryRun?: boolean;
  maxFiles?: number;
  maxPages?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;

  /** Injectable clock for deterministic records. */
  now?: () => string;

  /**
   * Optional enrichment (e.g. vision analysis). Receives the probed record and
   * bytes; throwing is treated as "no enrichment" so a flaky analyser never
   * loses the catalogue.
   */
  enrich?: (record: AssetRecord, bytes: Uint8Array) => Promise<AssetVisionEnrichment>;

  /** Existing catalogue records are merged/preserved, never silently dropped. */
  previousCatalogue?: AssetCatalogue;
}

export interface CatalogueBuildReport {
  dryRun: boolean;
  filesSeen: number;
  records: AssetCatalogue;

  /** Files that exist remotely but can never be loaded as-is. */
  unusable: Array<{ id: string; originalName: string; reasons: string[] }>;

  /** Files that could not be read at all. */
  unreadable: Array<{ id: string; originalName: string; reason: string }>;
  previewCount: number;
  counts: Record<string, number>;

  /** Non-fatal problems worth surfacing in a report. */
  warnings: string[];
  blockers: AssetLibraryBlocker[];
}

export interface AssetVisionEnrichment {
  category?: AssetRecord['category'];
  intelligence?: Partial<AssetRecord['intelligence']>;
}

/** Derive a folder-relative path so dependency matching can use real paths. */
function remotePathFor(fileName: string): string {
  const segments = fileName.split('/').filter(Boolean);

  return segments.length > 1 ? segments.slice(0, -1).join('/') : '';
}

async function probeOne(
  options: CatalogueBuildOptions,
  file: { id: string; name: string; sizeOriginal: number; mimeType: string },
): Promise<AssetRecord | undefined> {
  const stamp = (options.now ?? (() => new Date().toISOString()))();
  const id = stableAssetId(options.config.bucketId, file.id);

  const downloaded = await fetchAssetBytes(options.config, file.id, {
    maxBytes: options.maxBytes,
    fetchImpl: options.fetchImpl,
  });

  if (!downloaded.ok) {
    return undefined;
  }

  const bytes = downloaded.data;
  const technical: AssetTechnicalMetadata | undefined = extractTechnicalMetadata(bytes, file.name);
  const model = extractModel3d(bytes, file.name);

  const classification = classifyAsset({
    originalName: file.name,
    remotePath: remotePathFor(file.name),
    bytes,
    technical,
  });

  const checksum = await checksumBytes(bytes).catch(() => undefined);

  const base: AssetRecord = {
    id,
    appwrite: { bucketId: options.config.bucketId, fileId: file.id },
    originalName: file.name,
    remotePath: remotePathFor(file.name),
    mimeType: file.mimeType,
    sizeOriginal: file.sizeOriginal || bytes.byteLength,
    checksum,
    role: classification.role,
    dimension: classification.dimension,
    category: classification.category,
    format: classification.format,
    technical,
    dependencies: model?.dependencies ?? [],
    intelligence: classification.intelligence,
    available: true,
    discoveredAt: stamp,
    lastVerifiedAt: stamp,
  } as AssetRecord;

  if (!options.enrich) {
    return base;
  }

  try {
    const extra = await options.enrich(base, bytes);

    return {
      ...base,
      category: extra.category || base.category,
      intelligence: { ...base.intelligence, ...(extra.intelligence || {}) },
    } as AssetRecord;
  } catch {
    // Enrichment is optional: keep the probed record rather than lose the file.
    return base;
  }
}

export async function buildAssetCatalogue(options: CatalogueBuildOptions): Promise<CatalogueBuildReport> {
  const maxFiles = options.maxFiles ?? 500;
  const warnings: string[] = [];
  const blockers: AssetLibraryBlocker[] = [];
  const unreadable: Array<{ id: string; originalName: string; reason: string }> = [];

  const listed = await listAssetFiles(options.config, {
    limit: 100,
    maxPages: options.maxPages ?? 10,
    fetchImpl: options.fetchImpl,
  });

  if (!listed.ok) {
    return {
      dryRun: Boolean(options.dryRun),
      filesSeen: 0,
      records: [],
      unusable: [],
      unreadable: [],
      previewCount: 0,
      counts: {},
      warnings,
      blockers: [listed.blocker],
    };
  }

  const files = listed.data.files.slice(0, maxFiles);
  const previousById = new Map((options.previousCatalogue || []).map((record) => [record.id, record]));
  const seenIds = new Set<string>();

  if (listed.data.files.length > maxFiles) {
    warnings.push(`Stopped at ${maxFiles} of ${listed.data.files.length} files (raise maxFiles to index more).`);
  }

  const records: AssetRecord[] = [];

  for (const file of files) {
    const id = stableAssetId(options.config.bucketId, file.id);
    seenIds.add(id);

    // Previews and documentation are indexed for context, never as loadable art.
    const record = await probeOne(options, file);

    if (!record) {
      const previous = previousById.get(id);
      unreadable.push({
        id: file.id,
        originalName: file.name,
        reason: 'bytes could not be read within the probing limit',
      });

      if (previous) {
        records.push({
          ...previous,
          available: false,
          unavailableReason: 'Could not read remote bytes during the latest catalogue scan.',
          lastVerifiedAt: (options.now ?? (() => new Date().toISOString()))(),
        });
      }

      continue;
    }

    const previous = previousById.get(id);
    const contentUnchanged = Boolean(previous?.checksum && previous.checksum === record.checksum);
    const preserveReviewed =
      contentUnchanged && (previous?.intelligence.source === 'manual' || previous?.intelligence.source === 'vision');

    records.push({
      ...record,
      discoveredAt: previous?.discoveredAt || record.discoveredAt,
      licensing: previous?.licensing,
      intelligence: preserveReviewed ? previous!.intelligence : record.intelligence,
    });
  }

  /*
   * Keep records from the previous index if they were not present in a
   * completed bucket listing. Mark them unavailable rather than deleting
   * metadata, license terms, hashes or dependency history. A paginated/limited
   * scan cannot prove an unseen file was deleted, so only complete scans do
   * this.
   */
  const scanComplete = !listed.data.nextCursor && listed.data.files.length <= maxFiles;

  if (scanComplete) {
    for (const previous of options.previousCatalogue || []) {
      if (seenIds.has(previous.id)) {
        continue;
      }

      records.push({
        ...previous,
        available: false,
        unavailableReason: 'File was not present in the latest complete bucket listing.',
        lastVerifiedAt: (options.now ?? (() => new Date().toISOString()))(),
      });
    }
  }

  /*
   * Order matters: resolve dependencies first (so a texture is known to
   * exist), then link previews to their models.
   */
  const withDependencies = resolveCatalogueDependencies(records);
  const linked = linkModelPreviews(withDependencies);
  const validated = assetCatalogueSchema.safeParse(linked);

  const finalRecords: AssetCatalogue = validated.success ? validated.data : linked;

  if (!validated.success && options.dryRun) {
    warnings.push(`${validated.error.issues.length} record(s) failed schema validation and were kept unvalidated.`);
  }

  const unusable: CatalogueBuildReport['unusable'] = [];

  for (const record of finalRecords) {
    const report = checkCompatibility(record, finalRecords);

    if (record.available && !report.usable) {
      unusable.push({ id: record.id, originalName: record.originalName, reasons: report.blocking });
    }
  }

  /*
   * Failed downloads and missing listings are already represented in
   * `unreadable` and as `available: false` records; avoid a second remote
   * request that could turn a useful partial scan into an exception.
   */

  const counts: Record<string, number> = {};

  for (const record of finalRecords) {
    const key = `${record.dimension}/${record.category}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  return {
    dryRun: Boolean(options.dryRun),
    filesSeen: files.length,
    records: finalRecords,
    unusable,
    unreadable,
    previewCount: finalRecords.filter((record) => record.role !== 'asset').length,
    counts,
    warnings,
    blockers,
  };
}

/**
 * Write the catalogue with a timestamped backup of whatever was there before.
 * Refuses to write an empty catalogue, so a transient listing failure can
 * never wipe a good index.
 */
export async function writeCatalogueSafely(
  filePath: string,
  catalogue: AssetCatalogue,
  io: { readFile?: (path: string) => Promise<string>; writeFile: (path: string, data: string) => Promise<void> },
): Promise<{ written: boolean; backupPath?: string; reason?: string }> {
  if (catalogue.length === 0) {
    return { written: false, reason: 'Refusing to write an empty catalogue.' };
  }

  const read = io.readFile ?? ((path: string) => import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8')));

  let backupPath: string | undefined;

  try {
    const existing = await read(filePath);
    backupPath = `${filePath}.${Date.now()}.bak`;

    await io.writeFile(backupPath, existing);
  } catch {
    // No previous catalogue — first run.
  }

  await io.writeFile(filePath, `${JSON.stringify(catalogue, null, 2)}\n`);

  return { written: true, backupPath };
}

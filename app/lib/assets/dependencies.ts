import {
  type AssetCatalogue,
  type AssetDependency,
  type AssetRecord,
  isAssetUsable,
  missingDependencies,
} from './asset-schema';
import { IMAGE_EXTENSIONS } from './classify';

/**
 * 3D dependency resolution.
 *
 * A model is rarely one file. A `.gltf` needs its `.bin` and its textures; an
 * `.obj` needs its `.mtl` and that material's images. Two failure modes are
 * actively harmful and both are handled here:
 *
 *  - Refetching a texture that is ALREADY EMBEDDED in the container. Embedded
 *    textures are marked `embedded` so the fetch planner skips them entirely.
 *  - Treating the model's preview PNG as the model. Previews carry role
 *    `preview` and are excluded from selection; `linkModelPreviews` instead
 *    records the relationship so a renderer can show it without loading it as
 *    geometry.
 */

/** Normalise a relative reference for matching against catalogue filenames. */
function normalizeRef(ref: string): string {
  return ref.replace(/\\/g, '/').replace(/^\.\//, '').split('#')[0].split('?')[0].trim().toLowerCase();
}

/** Filename portion of a reference path. */
function basename(ref: string): string {
  const normalized = normalizeRef(ref);
  return normalized.split('/').pop() || normalized;
}

/**
 * Match a dependency URI against catalogue entries.
 *
 * Matching is deliberately conservative: an exact basename match is required
 * when it is unique in the catalogue, otherwise we report "not found" rather
 * than binding the wrong texture to a material.
 */
export function matchDependency(catalogue: AssetCatalogue, uri: string): AssetRecord | undefined {
  const wanted = normalizeRef(uri);
  const wantedBase = basename(uri);

  if (!wantedBase) {
    return undefined;
  }

  const exactPath = catalogue.filter((record) => normalizeRef(record.remotePath || record.originalName) === wanted);

  if (exactPath.length === 1) {
    return exactPath[0];
  }

  const byBase = catalogue.filter((record) => normalizeRef(record.originalName) === wantedBase);

  return byBase.length === 1 ? byBase[0] : undefined;
}

/**
 * Resolve every declared dependency of every record against the catalogue.
 * Returns NEW records — inputs are never mutated, so a failed run can be
 * discarded and the previous catalogue file kept as a backup.
 */
export function resolveCatalogueDependencies(catalogue: AssetCatalogue): AssetCatalogue {
  return catalogue.map((record) => {
    if (record.dependencies.length === 0) {
      return record;
    }

    const dependencies: AssetDependency[] = record.dependencies.map((dependency) => {
      if (dependency.embedded) {
        // Already inside this file: satisfied, and never a separate fetch.
        return { ...dependency, resolved: true };
      }

      const match = matchDependency(catalogue, dependency.uri);

      return { ...dependency, resolved: Boolean(match?.available) };
    });

    return { ...record, dependencies };
  });
}

/**
 * Link preview images to the models they depict.
 *
 * A `preview.png` sitting beside `crate.glb` with a matching stem is metadata
 * ABOUT the crate, not the crate. Linking it both documents the relationship
 * and keeps it out of the geometry pool via its `preview` role.
 */
export function linkModelPreviews(catalogue: AssetCatalogue): AssetCatalogue {
  const models = catalogue.filter((record) => record.dimension === '3d' && record.role === 'asset');

  if (models.length === 0) {
    return catalogue;
  }

  const modelStems = new Map<string, AssetRecord>();

  for (const model of models) {
    const stem = basename(model.originalName).replace(/\.[a-z0-9]+$/i, '');
    const folder = normalizeRef(model.remotePath || '')
      .split('/')
      .slice(0, -1)
      .join('/');

    modelStems.set(`${folder}/${stem}`, model);
  }

  return catalogue.map((record) => {
    /*
     * Previews are stored with the inert `data` dimension (the schema forbids
     * them claiming a usable dimension), so the guard has to key on the FILE
     * being an image instead.
     */
    if (record.role !== 'preview' || !IMAGE_EXTENSIONS.has(record.format)) {
      return record;
    }

    const stem = basename(record.originalName).replace(/\.[a-z0-9]+$/i, '');
    const folder = normalizeRef(record.remotePath || '')
      .split('/')
      .slice(0, -1)
      .join('/');
    const owner = modelStems.get(`${folder}/${stem}`);

    if (!owner) {
      return record;
    }

    return {
      ...record,
      dependencies: [
        {
          kind: 'preview' as const,
          uri: owner.id,
          required: false,
          embedded: false,
          resolved: true,
        },
      ],
      intelligence: {
        ...record.intelligence,
        description: `Preview render of ${owner.originalName}. Not loadable geometry — load ${owner.originalName} instead.`,
        tags: Array.from(new Set([...record.intelligence.tags, 'model-preview'])).slice(0, 40),
      },
    };
  });
}

/**
 * The complete set of files that must be fetched together for one asset.
 *
 * Returns embedded references EXCLUDED (they ship inside the main file) and
 * required-but-unresolved references INCLUDED so a caller can decide between
 * fetching them and rejecting the asset.
 */
export function requiredFetchGroup(record: AssetRecord, catalogue: AssetCatalogue): AssetRecord[] {
  if (record.role !== 'asset') {
    return [];
  }

  const group: AssetRecord[] = [record];

  for (const dependency of record.dependencies) {
    if (dependency.embedded || dependency.kind === 'preview') {
      continue;
    }

    if (!dependency.required) {
      continue;
    }

    const match = matchDependency(catalogue, dependency.uri);

    if (match && match.available && !group.some((entry) => entry.id === match.id)) {
      group.push(match);
    }
  }

  return group;
}

/**
 * Compatibility report for one asset: can it ship as-is?
 * `blocking` names the exact reason so the planner can pick another asset
 * instead of silently shipping something that cannot load.
 */
export interface CompatibilityReport {
  usable: boolean;
  blocking: string[];
  warnings: string[];
  fetchGroupSize: number;
}

export function checkCompatibility(record: AssetRecord, catalogue: AssetCatalogue): CompatibilityReport {
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!record.available) {
    blocking.push(`remote file unavailable${record.unavailableReason ? `: ${record.unavailableReason}` : ''}`);
  }

  if (record.role !== 'asset') {
    blocking.push(`role is "${record.role}", not a loadable asset`);
  }

  const missing = missingDependencies(record);

  if (missing.length > 0) {
    blocking.push(`missing required dependencies: ${missing.map((entry) => entry.uri).join(', ')}`);
  }

  if (record.technical?.kind === 'model3d' && record.technical.model.requiresDraco) {
    warnings.push('geometry is Draco-compressed and needs a Draco decoder at runtime');
  }

  if (record.technical?.kind === 'model3d' && record.technical.model.externalRefs.length > 0) {
    warnings.push(`references external files: ${record.technical.model.externalRefs.join(', ')}`);
  }

  const fetchGroupSize = requiredFetchGroup(record, catalogue).length;

  return {
    usable: isAssetUsable(record) && blocking.length === 0,
    blocking,
    warnings,
    fetchGroupSize,
  };
}

/**
 * Drop records that can never load, returning a reason per dropped id so the
 * catalogue report is explicit instead of silently smaller.
 */
export function filterUsableAssets(catalogue: AssetCatalogue): {
  usable: AssetCatalogue;
  rejected: Array<{ id: string; reasons: string[] }>;
} {
  const usable: AssetCatalogue = [];
  const rejected: Array<{ id: string; reasons: string[] }> = [];

  for (const record of catalogue) {
    const report = checkCompatibility(record, catalogue);

    if (report.usable) {
      usable.push(record);
    } else {
      rejected.push({ id: record.id, reasons: report.blocking });
    }
  }

  return { usable, rejected };
}

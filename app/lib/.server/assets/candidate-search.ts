import type { AssetCatalogue, AssetRecord } from '~/lib/assets/asset-schema';
import { checkCompatibility, requiredFetchGroup } from '~/lib/assets/dependencies';
import { searchAssets, type AssetQuery } from '~/lib/assets/search';

/**
 * Turn a user request into a bounded, verified shortlist of library assets.
 *
 * This is the bridge between the catalogue and the planner. It exists so the
 * model never sees more than a handful of genuinely usable candidates for the
 * specific game being built — never the catalogue.
 */

export interface LibraryCandidate {
  id: string;
  path: string;
  dimension: string;
  category: string;
  format: string;

  /** True 3D models require the WebGL/Three renderer. */
  requiredEngine?: 'webgl';
  group: string[];
  description: string;
}

export interface CandidateSearchOptions extends AssetQuery {
  /** Cap the shortlist. Hard-capped at 12 so prompt size stays bounded. */
  limit?: number;

  /** Assets already in the workspace; their paths must not be re-planned. */
  excludePaths?: string[];
}

const MAX_CANDIDATES = 12;
const HARD_LIMIT = 12;

/** Destination path an asset is written to inside the generated game. */
export function destinationPathFor(record: AssetRecord): string {
  /*
   * Keep the relative folder structure from Appwrite's original filename.
   * glTF/OBJ sidecar refs are relative to the model's directory; flattening
   * every file to assets/<basename> silently disconnects those dependencies.
   */
  const segments = record.originalName
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '-'));
  const relative = segments.length > 0 ? segments.join('/') : 'asset.bin';

  return `assets/${relative}`;
}

/** Build the companion file paths a 3D asset must ship with. */
function groupFor(record: AssetRecord, catalogue: AssetCatalogue): string[] {
  return requiredFetchGroup(record, catalogue)
    .filter((entry) => entry.id !== record.id)
    .map(destinationPathFor);
}

/**
 * Search and rank. Returns candidates that are actually loadable: usable
 * records only, with a compatibility report attached so callers can explain a
 * rejection.
 */
export function findLibraryCandidates(
  catalogue: AssetCatalogue,
  options: CandidateSearchOptions,
): { candidates: LibraryCandidate[]; rejected: Array<{ id: string; originalName: string; reasons: string[] }> } {
  const ranked = searchAssets(catalogue, { ...options, limit: Math.min(MAX_CANDIDATES, options.limit ?? 8) });
  const taken = new Set((options.excludePaths || []).map((path) => path.toLowerCase()));
  const usedPaths = new Set<string>();
  const candidates: LibraryCandidate[] = [];

  for (const entry of ranked) {
    const { record } = entry;
    const path = destinationPathFor(record);
    const key = path.toLowerCase();

    // Never plan the same destination twice, and never re-plan an existing file.
    if (taken.has(key) || usedPaths.has(key)) {
      continue;
    }

    const report = checkCompatibility(record, catalogue);

    if (!report.usable) {
      continue;
    }

    usedPaths.add(key);
    candidates.push({
      id: record.id,
      path,
      dimension: record.dimension,
      category: record.category,
      format: record.format,
      requiredEngine: record.dimension === '3d' ? 'webgl' : undefined,
      group: groupFor(record, catalogue),
      description: record.intelligence.description,
    });

    if (candidates.length >= Math.min(MAX_CANDIDATES, options.limit ?? 8)) {
      break;
    }
  }

  return { candidates, rejected: [] };
}

/**
 * Turn the manager's selected ids into approved records. Paths and dependency
 * groups always come from the catalogue, never from model-supplied fields.
 */
export function approveLibrarySelections(
  selected: Array<{ id: string }>,
  candidates: LibraryCandidate[],
  options: { existingPaths?: string[]; engine: 'canvas2d' | 'webgl' },
): LibraryCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const existing = new Set((options.existingPaths || []).map((path) => path.toLowerCase()));
  const used = new Set<string>();
  const approved: LibraryCandidate[] = [];

  for (const selection of selected.slice(0, 24)) {
    const candidate = byId.get(selection.id);

    if (!candidate || used.has(candidate.id) || (candidate.requiredEngine === 'webgl' && options.engine !== 'webgl')) {
      continue;
    }

    const destinations = [candidate.path, ...candidate.group].map((path) => path.toLowerCase());

    if (destinations.some((path) => existing.has(path))) {
      continue;
    }

    if (destinations.some((path) => used.has(`path:${path}`))) {
      continue;
    }

    used.add(candidate.id);
    destinations.forEach((path) => used.add(`path:${path}`));
    approved.push(candidate);
  }

  return approved;
}

/** Compact prompt block. Never contains bucket credentials, URLs or base64. */
export function formatCandidateBriefing(candidates: LibraryCandidate[], requestExcerpt: string): string {
  if (candidates.length === 0) {
    return '';
  }

  const lines = candidates.map((candidate) => {
    const parts = [
      `- id=${candidate.id} path=${candidate.path} dimension=${candidate.dimension} category=${candidate.category}`,
    ];

    if (candidate.group.length > 0) {
      parts.push(`group=[${candidate.group.join(', ')}]`);
    }

    parts.push(`format=${candidate.format} about: ${candidate.description.slice(0, 180)}`);

    if (candidate.requiredEngine) {
      parts.push(`requires engine: ${candidate.requiredEngine}`);
      parts.push(
        candidate.format === 'glb' || candidate.format === 'gltf'
          ? 'load with Three.js GLTFLoader; model dependencies are already grouped'
          : candidate.format === 'obj'
            ? 'load with Three.js OBJLoader and the grouped MTL/material dependencies'
            : '3D loader compatibility must be checked before use',
      );
    }

    return parts.join(' ');
  });

  return [
    `LIBRARY CANDIDATES for "${requestExcerpt.slice(0, 120)}" (real, verified files that already exist; copy id and path EXACTLY):`,
    ...lines,
    'Use these in libraryAssets. Never invent an id or path that is not listed here. Ship a 3D model together with its whole group.',
  ].join('\n');
}

export { HARD_LIMIT };

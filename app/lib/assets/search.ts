import {
  type AssetCatalogue,
  type AssetCategory,
  type AssetDimension,
  type AssetRecord,
  isAssetUsable,
} from './asset-schema';
import { checkCompatibility } from './dependencies';

/**
 * Catalogue search for the generator.
 *
 * The rule that shapes this module: the model must never receive the whole
 * catalogue. Search returns a short ranked shortlist per task, so context stays
 * bounded no matter how large the library grows.
 */

export interface AssetQuery {
  /** Free text: "space shooter ship", "wooden crate", "jump sound". */
  text?: string;

  /** Hard filters. Omitted means "any". */
  category?: AssetCategory;
  dimension?: AssetDimension;

  /** For 2D art: prefer art drawn for this camera. */
  perspective?: 'topdown' | 'sideview' | 'isometric' | 'firstperson';

  /** Restrict to one visual style token (e.g. "pixel", "realistic"). */
  style?: string;

  /** Maximum results. Hard-capped so a prompt can never flood the context. */
  limit?: number;
}

export interface RankedAsset {
  record: AssetRecord;
  score: number;

  /** Human-readable justification, shown in the Blueprint card. */
  why: string;
  fetchGroupSize: number;
}

const MAX_RESULTS = 12;

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'for',
  'with',
  'and',
  'of',
  'in',
  'on',
  'to',
  'game',
  'asset',
  'sprite',
  'image',
  'texture',
  'model',
]);

/** Meaningful lowercase query terms. */
export function queryTerms(query: AssetQuery): string[] {
  const text = (query.text || '').toLowerCase();

  return Array.from(new Set(text.split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !STOP_WORDS.has(term))));
}

function tokenSetMatch(terms: string[], tokens: string[]): { matched: string[] } {
  const haystack = new Set(tokens);

  return { matched: terms.filter((term) => haystack.has(term)) };
}

/**
 * Score one record against a query.
 *
 * Weighted so that *usable* beats *relevant*: an exact-name match that cannot
 * load (missing texture, dead remote file) must never outrank a slightly less
 * perfect match that actually works.
 */
export function scoreAsset(record: AssetRecord, query: AssetQuery, catalogue: AssetCatalogue): RankedAsset | undefined {
  const report = checkCompatibility(record, catalogue);

  if (!isAssetUsable(record)) {
    return undefined;
  }

  const terms = queryTerms(query);
  const tokens = [
    ...record.intelligence.tags,

    // Description, filename AND relative path all count as searchable text.
    ...record.intelligence.description.toLowerCase().split(/[^a-z0-9]+/),
    ...record.originalName.toLowerCase().split(/[^a-z0-9]+/),
    ...(record.remotePath || '').toLowerCase().split(/[^a-z0-9]+/),
  ];

  const { matched } = tokenSetMatch(terms, tokens);
  const reasons: string[] = [];

  let score = 0;

  if (terms.length > 0 && matched.length === 0) {
    /*
     * Nothing in the query actually appears in this asset: no match, however
     * confident the record's own metadata happens to be.
     */
    return undefined;
  }

  if (matched.length > 0) {
    const coverage = matched.length / Math.max(1, terms.length);
    score += coverage * 5;
    reasons.push(`matches ${matched.join(', ')}`);
  }

  // Filename match is a stronger signal than a description word.
  const nameTokens = record.originalName.toLowerCase().split(/[^a-z0-9]+/);

  for (const term of terms) {
    if (nameTokens.includes(term)) {
      score += 1.5;
      break;
    }
  }

  if (query.category && record.category === query.category) {
    score += 3;
    reasons.push(`category ${record.category}`);
  } else if (query.category) {
    score -= 1.5;
  }

  if (query.dimension && record.dimension === query.dimension) {
    score += 2;
    reasons.push(`${record.dimension} content`);
  } else if (query.dimension) {
    // Hard filter upstream; this is defensive.
    return undefined;
  }

  if (query.perspective) {
    if (record.intelligence.perspective === query.perspective) {
      score += 2;
      reasons.push(`${query.perspective} perspective`);
    } else if (record.intelligence.perspective === 'any') {
      score += 0.5;
    } else {
      score -= 2;
      reasons.push(`drawn for ${record.intelligence.perspective}, not ${query.perspective}`);
    }
  }

  if (query.style) {
    const style = query.style.toLowerCase();

    if (tokens.some((token) => token === style || token.startsWith(style))) {
      score += 2;
      reasons.push(`${query.style} style`);
    }
  }

  // Trust but discount: filename guesses must not outrank analysed assets.
  score += record.intelligence.confidence * 1.5;

  if (record.intelligence.source === 'vision') {
    reasons.push('vision-analysed');
  }

  // Fewer files to fetch is better, all else equal.
  if (report.fetchGroupSize > 1) {
    score -= (report.fetchGroupSize - 1) * 0.25;
    reasons.push(`needs ${report.fetchGroupSize} files`);
  }

  if (score <= 0) {
    return undefined;
  }

  return {
    record,
    score: Number(score.toFixed(3)),
    why: reasons.length > 0 ? reasons.join('; ') : 'category match',
    fetchGroupSize: report.fetchGroupSize,
  };
}

/** Ranked, de-duplicated search across the catalogue. Bounded output. */
export function searchAssets(catalogue: AssetCatalogue, query: AssetQuery): RankedAsset[] {
  const limit = Math.max(1, Math.min(MAX_RESULTS, query.limit ?? 6));

  const scored: RankedAsset[] = [];

  for (const record of catalogue) {
    if (query.dimension && record.dimension !== query.dimension) {
      continue;
    }

    if (query.category && record.category !== query.category) {
      continue;
    }

    const result = scoreAsset(record, query, catalogue);

    if (result) {
      scored.push(result);
    }
  }

  const dimensionPreference: Record<string, number> = { '2d': 0, '3d': 1, audio: 2, font: 3, data: 4 };

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const rankA = dimensionPreference[a.record.dimension] ?? 9;
    const rankB = dimensionPreference[b.record.dimension] ?? 9;

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    return a.record.originalName.localeCompare(b.record.originalName);
  });

  // One record per id; keep the strongest.
  const seen = new Set<string>();
  const results: RankedAsset[] = [];

  for (const candidate of scored) {
    if (seen.has(candidate.record.id)) {
      continue;
    }

    seen.add(candidate.record.id);
    results.push(candidate);

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

/**
 * Condense ranked results for a model prompt: id, path, what it is, why, and
 * how many files must ship together. No base64, no bucket credentials, no
 * raw Appwrite URLs — the model only needs the destination path it must use.
 */
export function formatAssetBriefing(ranked: RankedAsset[]): string {
  if (ranked.length === 0) {
    return 'No library asset matched this request. Use procedural visuals.';
  }

  const lines = ranked.map((entry) => {
    const { record } = entry;
    const bits = [
      `- ${record.id}`,
      `  use as: ${record.category} (${record.dimension})`,
      `  confidence: ${record.intelligence.confidence} (${record.intelligence.source})`,
      `  why: ${entry.why}`,
    ];

    if (entry.fetchGroupSize > 1) {
      bits.push(`  ships as a group of ${entry.fetchGroupSize} files — reference all of them`);
    }

    if (record.dependencies.some((dependency) => !dependency.resolved && !dependency.embedded)) {
      bits.push('  MISSING dependencies — do not select');
    }

    return bits.join('\n');
  });

  return ['Verified library assets (already uploaded; reference by id, never invent a path):', ...lines].join('\n');
}

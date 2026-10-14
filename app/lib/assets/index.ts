export {
  ASSET_ANALYSIS_SOURCES,
  ASSET_CATEGORIES,
  ASSET_DEPENDENCY_KINDS,
  ASSET_DIMENSIONS,
  ASSET_FORMATS,
  ASSET_PERSPECTIVES,
  ASSET_ROLES,
  assetCatalogueSchema,
  assetRecordSchema,
  isAssetUsable,
  missingDependencies,
  stableAssetId,
  type AssetCategory,
  type AssetDependency,
  type AssetDimension,
  type AssetFormat,
  type AssetIntelligence,
  type AssetRecord,
  type AssetRole,
  type AssetTechnicalMetadata,
} from './asset-schema';

export {
  checkCompatibility,
  filterUsableAssets,
  linkModelPreviews,
  matchDependency,
  requiredFetchGroup,
  resolveCatalogueDependencies,
  type CompatibilityReport,
} from './dependencies';

export { formatAssetBriefing, queryTerms, scoreAsset, searchAssets, type AssetQuery, type RankedAsset } from './search';

export {
  classifyAsset,
  detectCategory,
  detectPerspective,
  detectRole,
  tokenizeName,
  IMAGE_EXTENSIONS,
} from './classify';

export {
  checksumBytes,
  extractAudioMetadata,
  extractImageMetadata,
  extractModel3d,
  extractTechnicalMetadata,
  readGlbJson,
  sniffFormat,
} from './technical-metadata';

export {
  buildAssetCatalogue,
  writeCatalogueSafely,
  type CatalogueBuildOptions,
  type CatalogueBuildReport,
} from './catalogue-builder';

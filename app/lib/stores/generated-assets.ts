import { map } from 'nanostores';

export interface GeneratedAsset {
  id: string;
  path: string;
  dataUrl: string;
  byteLength: number;
}

// Binary payloads stay out of agent context; the preview uses these URLs only.
export const generatedAssets = map<Record<string, GeneratedAsset>>({});

function normalizeAssetReference(value: string): string {
  let path = value.trim();

  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep malformed percent-encoded references as-is.
  }

  path = path
    .replace(/[?#].*$/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  return path;
}

export function inlineGeneratedAssetUrls(html: string, assets: Record<string, GeneratedAsset>) {
  const urls = new Map<string, string>();

  for (const asset of Object.values(assets)) {
    urls.set(normalizeAssetReference(asset.path), asset.dataUrl);
  }

  const replacePath = (rawPath: string) => urls.get(normalizeAssetReference(rawPath));

  let output = html.replace(/([\"'`])([^\"'`\n]+)\1/g, (match, quote: string, path: string) => {
    const url = replacePath(path);
    return url ? `${quote}${url}${quote}` : match;
  });

  output = output.replace(/url\(\s*([\"']?)([^\"'()\s]+)\1\s*\)/gi, (match, _quote: string, path: string) => {
    const url = replacePath(path);
    return url ? `url(\"${url}\")` : match;
  });

  return output;
}

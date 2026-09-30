import { map } from 'nanostores';

export interface GeneratedAsset {
  id: string;
  path: string;
  dataUrl: string;
  byteLength: number;
}

// Binary payloads stay out of agent context; the preview uses these URLs only.
export const generatedAssets = map<Record<string, GeneratedAsset>>({});

export function inlineGeneratedAssetUrls(html: string, assets: Record<string, GeneratedAsset>) {
  const urls = new Map<string, string>();

  for (const asset of Object.values(assets)) {
    urls.set(asset.path, asset.dataUrl);
    urls.set(`/${asset.path}`, asset.dataUrl);
    urls.set(`./${asset.path}`, asset.dataUrl);
  }

  return html
    .replace(/(["'`])([^"'`\n]+)\1/g, (match, quote: string, path: string) => {
      const url = urls.get(path);

      return url ? `${quote}${url}${quote}` : match;
    })
    .replace(/url\(\s*([^\s"'()]+)\s*\)/g, (match, path: string) => {
      const url = urls.get(path);

      return url ? `url("${url}")` : match;
    });
}

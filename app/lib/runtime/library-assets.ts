import { generatedAssets } from '~/lib/stores/generated-assets';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import nodePath from 'node:path';
import type { Blueprint } from '~/lib/harness/blueprint';

/**
 * Materialise approved library assets into the game workspace.
 *
 * Runs in the same `preparing-assets` phase as image generation, BEFORE any
 * code is written, so the builder sees real files at real paths. Mirrors the
 * generated-asset contract:
 *  - create-only (never overwrite a file the game already has)
 *  - roll back everything already written if one file fails
 *  - register in the file tree so the preview, the build gate and the verifier
 *    can all see the asset exists
 *
 * Images additionally get a data URL so the blob-URL preview iframe can render
 * them. Other types (audio, 3D) are written to disk and registered; the preview
 * cannot inline a GLB today, so they are reported rather than silently missing.
 */

export interface MaterializeResult {
  ok: boolean;
  written: Array<{ id: string; path: string; byteLength: number }>;

  /** Assets present on disk but not inlinable in the preview iframe. */
  notInlinable: string[];
  failed: Array<{ id: string; reason: string }>;
  error?: string;
}

export interface MaterializeOptions {
  messageId?: string;
  blueprint: Blueprint;
  executionToken: string;

  // Structural subset of WebContainer's fs: keeps this unit-testable.
  webcontainer: {
    fs: {
      mkdir: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
      writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
      readdir: (path: string, options: { withFileTypes: true }) => Promise<Array<{ name: string }>>;
      rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<unknown>;
    };
  };
  fetchImpl?: typeof fetch;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;

  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }

  return btoa(binary);
}

function normalizeAssetPath(path: string): string {
  const parts: string[] = [];

  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }

  return parts.join('/');
}

function resolveAssetUri(
  modelPath: string,
  uri: string,
  byPath: Map<string, string>,
  byName: Map<string, string>,
): string | undefined {
  if (/^(?:data:|https?:|blob:)/i.test(uri)) {
    return undefined;
  }

  let clean = uri;

  try {
    clean = decodeURIComponent(uri);
  } catch {
    // Keep the original text when it contains malformed percent-encoding.
  }

  const parent = modelPath.slice(0, modelPath.lastIndexOf('/'));
  const exact = byPath.get(normalizeAssetPath(`${parent}/${clean}`)) || byPath.get(normalizeAssetPath(clean));

  if (exact) {
    return exact;
  }

  const basename = normalizeAssetPath(clean).split('/').pop() || '';

  return byName.get(basename);
}

function replaceGltfUris(
  document: Record<string, unknown>,
  modelPath: string,
  byPath: Map<string, string>,
  byName: Map<string, string>,
): Record<string, unknown> {
  for (const field of ['images', 'buffers']) {
    const entries = document[field];

    if (!Array.isArray(entries)) {
      continue;
    }

    document[field] = entries.map((entry) => {
      if (!entry || typeof entry !== 'object' || typeof (entry as Record<string, unknown>).uri !== 'string') {
        return entry;
      }

      const item = entry as Record<string, unknown>;
      const dataUrl = resolveAssetUri(modelPath, item.uri as string, byPath, byName);

      return dataUrl ? { ...item, uri: dataUrl } : item;
    });
  }

  return document;
}

/**
 * Rewrite external glTF/GLB buffer and texture references to data URLs before
 * storing them. Their sidecars are already fetched as one verified group; a
 * data URL model has no hierarchical base from which relative URIs can resolve,
 * so leaving `textures/foo.png` inside it would still break every GLTFLoader.
 */
function inlineGltfDependencies(
  files: Array<{ path: string; mimeType?: string; base64: string; byteLength: number }>,
): void {
  const byPath = new Map<string, string>();
  const basenameBuckets = new Map<string, string[]>();

  for (const file of files) {
    const dataUrl = `data:${file.mimeType || 'application/octet-stream'};base64,${file.base64}`;
    const path = normalizeAssetPath(file.path);

    byPath.set(path, dataUrl);

    const basename = path.split('/').pop() || path;
    const matches = basenameBuckets.get(basename) || [];
    matches.push(dataUrl);
    basenameBuckets.set(basename, matches);
  }

  const byName = new Map<string, string>();

  for (const [name, matches] of basenameBuckets) {
    if (matches.length === 1) {
      byName.set(name, matches[0]);
    }
  }

  for (const file of files) {
    const lower = file.path.toLowerCase();

    if (lower.endsWith('.gltf')) {
      try {
        const document = JSON.parse(new TextDecoder().decode(base64ToBytes(file.base64))) as Record<string, unknown>;
        const rewritten = replaceGltfUris(document, file.path, byPath, byName);
        const bytes = new TextEncoder().encode(JSON.stringify(rewritten));
        file.base64 = bytesToBase64(bytes);
        file.byteLength = bytes.byteLength;
        file.mimeType = 'model/gltf+json';
      } catch {
        // Keep the original asset, and let the actual parser/preview surface the error.
      }
    } else if (lower.endsWith('.glb')) {
      try {
        const input = base64ToBytes(file.base64);
        const view = new DataView(input.buffer, input.byteOffset, input.byteLength);

        if (input.length < 20 || view.getUint32(0, true) !== 0x46546c67) {
          continue;
        }

        const chunks: Array<{ type: number; bytes: Uint8Array }> = [];
        let offset = 12;
        let changed = false;

        while (offset + 8 <= input.length) {
          const length = view.getUint32(offset, true);
          const type = view.getUint32(offset + 4, true);

          if (offset + 8 + length > input.length) {
            break;
          }

          let chunk = input.slice(offset + 8, offset + 8 + length);

          if (type === 0x4e4f534a) {
            const text = new TextDecoder().decode(chunk).replace(/[\u0000\u0020]+$/, '');
            const document = JSON.parse(text) as Record<string, unknown>;
            const rewritten = replaceGltfUris(document, file.path, byPath, byName);
            const encoded = new TextEncoder().encode(JSON.stringify(rewritten));
            const paddedLength = Math.ceil(encoded.length / 4) * 4;
            chunk = new Uint8Array(paddedLength).fill(0x20);
            chunk.set(encoded);
            changed = true;
          }

          chunks.push({ type, bytes: chunk });
          offset += 8 + length;
          offset += (4 - (length % 4)) % 4;
        }

        if (changed) {
          const total = 12 + chunks.reduce((size, chunk) => size + 8 + chunk.bytes.length, 0);
          const output = new Uint8Array(total);
          const outputView = new DataView(output.buffer);
          outputView.setUint32(0, 0x46546c67, true);
          outputView.setUint32(4, 2, true);
          outputView.setUint32(8, total, true);

          let writeOffset = 12;

          for (const chunk of chunks) {
            outputView.setUint32(writeOffset, chunk.bytes.length, true);
            outputView.setUint32(writeOffset + 4, chunk.type, true);
            output.set(chunk.bytes, writeOffset + 8);
            writeOffset += 8 + chunk.bytes.length;
          }

          file.base64 = bytesToBase64(output);
          file.byteLength = output.byteLength;
        }
      } catch {
        // Keep original GLB bytes rather than rejecting an otherwise useful asset.
      }
    }
  }
}

export async function materializeLibraryAssets(options: MaterializeOptions): Promise<MaterializeResult> {
  const wanted = options.blueprint.libraryAssets || [];

  if (wanted.length === 0) {
    return { ok: true, written: [], notInlinable: [], failed: [] };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const ids = wanted.map((asset) => asset.id);

  let payload: {
    ok: boolean;
    files?: Array<Record<string, unknown>>;
    failures?: Array<{ id: string; reason: string }>;
    error?: string;
    code?: string;
  };

  try {
    const response = await doFetch('/api/asset-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, approvedBlueprint: options.blueprint, executionToken: options.executionToken }),
    });

    payload = (await response.json()) as typeof payload;
  } catch (error) {
    return {
      ok: false,
      written: [],
      notInlinable: [],
      failed: [],
      error: `Could not reach the asset library: ${(error as Error).message}`,
    };
  }

  if (!payload.ok) {
    return {
      ok: false,
      written: [],
      notInlinable: [],
      failed: [],
      error: payload.error || 'The asset library refused the request.',
    };
  }

  const files = (payload.files || []) as Array<{
    id: string;
    path: string;
    group?: string[];
    mimeType?: string;
    base64: string;
    byteLength: number;
  }>;

  if (files.length === 0) {
    return { ok: true, written: [], notInlinable: [], failed: payload.failures || [] };
  }

  const approvedPaths = new Set(
    wanted.flatMap((asset) => [asset.path, ...(asset.group || [])]).map((path) => normalizeAssetPath(path)),
  );
  const seenPaths = new Set<string>();
  let payloadBytes = 0;

  for (const file of files) {
    if (file.path.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')) {
      return {
        ok: false,
        written: [],
        notInlinable: [],
        failed: [],
        error: `Refusing unsafe library asset path: ${file.path}`,
      };
    }

    const path = normalizeAssetPath(file.path);

    if (!/^assets\/[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').some((part) => part === '.' || part === '..')) {
      return {
        ok: false,
        written: [],
        notInlinable: [],
        failed: [],
        error: `Refusing unsafe library asset path: ${file.path}`,
      };
    }

    if (!approvedPaths.has(path) || seenPaths.has(path)) {
      return {
        ok: false,
        written: [],
        notInlinable: [],
        failed: [],
        error: `Server returned an unapproved or duplicate asset path: ${path}`,
      };
    }

    seenPaths.add(path);
    payloadBytes += file.byteLength;
  }

  if (payloadBytes > 24 * 1024 * 1024) {
    return {
      ok: false,
      written: [],
      notInlinable: [],
      failed: [],
      error: 'The library asset group exceeds the 24 MB per-build limit.',
    };
  }

  inlineGltfDependencies(files);

  const written: MaterializeResult['written'] = [];
  const notInlinable: string[] = [];
  const writtenPaths: string[] = [];
  const registeredPaths: Array<{ path: string; absolute: string }> = [];

  try {
    /*
     * Create directories, then preflight EVERY destination before the first
     * write. Library assets are create-only and may never overwrite a project
     * file (even if its path appeared after the plan was approved).
     */
    for (const file of files) {
      await options.webcontainer.fs
        .mkdir(nodePath.posix.dirname(file.path), { recursive: true })
        .catch(() => undefined);
    }

    for (const file of files) {
      const parent = nodePath.posix.dirname(file.path);
      const basename = nodePath.posix.basename(file.path);
      const entries = await options.webcontainer.fs.readdir(parent, { withFileTypes: true }).catch(() => []);

      if (entries.some((entry) => entry.name === basename)) {
        return {
          ok: false,
          written: [],
          notInlinable: [],
          failed: [{ id: file.id, reason: `Refusing to overwrite existing project asset ${file.path}` }],
          error: `Refusing to overwrite existing project asset: ${file.path}`,
        };
      }
    }

    for (const file of files) {
      const bytes = base64ToBytes(file.base64);
      const mime = file.mimeType || '';
      const absolute = nodePath.posix.join(WORK_DIR, file.path);

      /*
       * Include the current path before the write: a failed write may have
       * left a partial file in the WebContainer.
       */
      writtenPaths.push(file.path);
      await options.webcontainer.fs.writeFile(file.path, bytes);
      written.push({ id: file.id, path: file.path, byteLength: file.byteLength });

      /*
       * Register EVERY asset with its real data URL, not just images: a
       * `data:` URL is a valid source for Image, Audio and fetch (GLTFLoader),
       * so this makes sprites, sounds and models all work in the preview and
       * survive publishing. `notInlinable` only tracks assets with no usable
       * mime, which genuinely cannot be inlined.
       */
      const hasUsableMime =
        /^(image|audio|video|model|font)\/[a-z0-9.+-]+$/i.test(mime) || /application\/(octet-stream|json)/i.test(mime);

      generatedAssets.setKey(file.path, {
        id: file.id,
        path: file.path,
        dataUrl: `data:${mime || 'application/octet-stream'};base64,${file.base64}`,
        byteLength: file.byteLength,
      });

      if (!hasUsableMime) {
        notInlinable.push(file.path);
      }

      workbenchStore.files.setKey(absolute, { type: 'file', content: '', isBinary: true });
      registeredPaths.push({ path: file.path, absolute });
    }
  } catch (error) {
    // Roll back so a partial asset group never survives.
    for (const path of writtenPaths) {
      await options.webcontainer.fs.rm(path, { force: true }).catch(() => undefined);
    }

    const rolledBack = new Set(registeredPaths.map((entry) => entry.path));
    generatedAssets.set(
      Object.fromEntries(Object.entries(generatedAssets.get()).filter(([path]) => !rolledBack.has(path))),
    );

    const absoluteRolledBack = new Set(registeredPaths.map((entry) => entry.absolute));
    workbenchStore.files.set(
      Object.fromEntries(Object.entries(workbenchStore.files.get()).filter(([path]) => !absoluteRolledBack.has(path))),
    );

    return {
      ok: false,
      written: [],
      notInlinable: [],
      failed: [{ id: 'materialize', reason: (error as Error).message }],
      error: `Writing library assets failed: ${(error as Error).message}`,
    };
  }

  return { ok: true, written, notInlinable, failed: payload.failures || [] };
}

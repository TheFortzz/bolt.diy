/**
 * Client-Side Asset Generator
 *
 * Coordinates FLUX.2-pro image generation with WebContainer filesystem writes
 * and game code updates, ensuring strict shape-rendering fallback resilience.
 */

import { getWebContainer } from '~/lib/webcontainer';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import * as nodePath from 'node:path';
import { createScopedLogger } from '~/utils/logger';
import { generatedAssets } from '~/lib/stores/generated-assets';
import { startActivity, updateActivity } from '~/lib/stores/activity';
import type { Blueprint } from '~/lib/harness/blueprint';

const logger = createScopedLogger('AssetGenerator');

export interface GenerateProjectAssetsOptions {
  messageId?: string;
  approvedBlueprint?: Blueprint;
  executionToken?: string;
  userPrompt?: string;
  model?: string;
  provider?: string;
  apiKeys?: Record<string, string>;
}

export interface AssetGenerationStatus {
  ok: boolean;
  skipped?: boolean;
  generatedCount?: number;
  error?: string;
  updatedPaths?: string[];
}

export function validateAssetPath(path: string): string {
  if (
    !/^assets\/[a-zA-Z0-9_./-]+\.png$/.test(path) ||
    path.split('/').some((part) => !part || part === '..' || part === '.')
  ) {
    throw new Error(`Unsafe generated asset path: ${path}`);
  }

  return path;
}

const MAX_GENERATED_ASSET_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodeGeneratedPng(base64: string, path: string): Uint8Array {
  const cleanBase64 = base64.replace(/^data:image\/png;base64,/i, '').replace(/\s/g, '');
  const maxEncodedLength = Math.ceil(MAX_GENERATED_ASSET_BYTES / 3) * 4;

  if (
    !cleanBase64 ||
    cleanBase64.length > maxEncodedLength ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cleanBase64)
  ) {
    throw new Error(`Generated image data is not valid bounded base64: ${path}`);
  }

  let binary: string;

  try {
    binary = atob(cleanBase64);
  } catch {
    throw new Error(`Generated image data could not be decoded: ${path}`);
  }

  if (binary.length > MAX_GENERATED_ASSET_BYTES || binary.length < 33) {
    throw new Error(`Generated PNG has an invalid size: ${path}`);
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error(`Invalid PNG image: ${path}`);
  }

  const headerType = String.fromCharCode(...bytes.subarray(12, 16));
  const endType = String.fromCharCode(...bytes.subarray(bytes.length - 8, bytes.length - 4));

  if (headerType !== 'IHDR' || endType !== 'IEND') {
    throw new Error(`Generated image has an incomplete PNG structure: ${path}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);

  if (!width || !height || width > 8192 || height > 8192) {
    throw new Error(`Generated PNG dimensions are invalid: ${path}`);
  }

  // Image providers may return a different supported resolution than requested.
  // Keep the valid image; game renderers scale assets to their planned display size.

  return bytes;
}

function isMissingFileError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /(?:ENOENT|no such file|not found)/i.test(message);
}

/**
 * Checks if FLUX.2-pro asset generation is enabled and configured in the environment.
 */
export async function isFluxAssetGenerationAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/generate-assets', { signal: AbortSignal.timeout(8000) });

    if (!res.ok) {
      return false;
    }

    const data: any = await res.json();

    return Boolean(data?.available);
  } catch {
    return false;
  }
}

/**
 * Runs the complete FLUX.2-pro asset generation pipeline for the current project.
 * Returns failures to the verification gate; unavailable optional generation is explicitly skipped.
 */
export async function generateProjectAssets(
  options: GenerateProjectAssetsOptions = {},
): Promise<AssetGenerationStatus> {
  try {
    if (options.approvedBlueprint && options.approvedBlueprint.assetOperations.length === 0) {
      return { ok: true, skipped: true, generatedCount: 0, updatedPaths: [] };
    }

    // 1. Check if FLUX_API_KEY is available in the environment
    const available = await isFluxAssetGenerationAvailable();

    if (!available) {
      if (options.approvedBlueprint?.assetOperations.length) {
        return { ok: false, error: 'The approved image service is unavailable.' };
      }

      logger.info('FLUX_API_KEY is not configured in the environment; retaining existing shape rendering.');

      return { ok: true, skipped: true };
    }

    const webcontainer = await getWebContainer();

    // 2. Collect current project code files from WebContainer
    const filesRecord: Record<string, string> = {};
    const rootFiles = await webcontainer.fs.readdir('.', { withFileTypes: true }).catch(() => []);

    for (const dirent of rootFiles) {
      if (
        dirent.isFile() &&
        (dirent.name.endsWith('.js') || dirent.name.endsWith('.html') || dirent.name.endsWith('.css'))
      ) {
        try {
          const content = await webcontainer.fs.readFile(dirent.name, 'utf-8');
          filesRecord[dirent.name] = content;
        } catch {
          /* ignore */
        }
      }
    }

    if (!options.approvedBlueprint && Object.keys(filesRecord).length === 0) {
      return { ok: true, skipped: true };
    }

    // 3. Call server pipeline endpoint to select elements, invoke FLUX.2-pro, and update code
    const res = await fetch('/api/generate-assets', {
      method: 'POST',
      signal: AbortSignal.timeout(180000),
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        options.approvedBlueprint
          ? {
              approvedBlueprint: options.approvedBlueprint,
              executionToken: options.executionToken,
            }
          : {
              userPrompt: options.userPrompt,
              files: filesRecord,
              model: options.model,
              provider: options.provider,
              apiKeys: options.apiKeys,
            },
      ),
    });

    if (!res.ok) {
      return { ok: false, error: `API status ${res.status}` };
    }

    const data: any = await res.json();

    if (!data.ok) {
      if (data.skipped) {
        return { ok: true, skipped: true };
      }

      return { ok: false, error: data.error || 'Asset generation failed' };
    }

    const assets: Array<{ id: string; fileName: string; base64: string }> = Array.isArray(data.assets)
      ? data.assets
      : [];
    const updatedFiles: Record<string, string> =
      data.updatedFiles && typeof data.updatedFiles === 'object' ? data.updatedFiles : {};
    const expectedOperations = options.approvedBlueprint?.assetOperations;
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();

    if (expectedOperations) {
      if (
        assets.length !== expectedOperations.length ||
        expectedOperations.some(
          (operation) => !assets.some((asset) => asset.id === operation.id && asset.fileName === operation.path),
        )
      ) {
        throw new Error('Image Builder returned assets outside the approved blueprint.');
      }

      if (Object.keys(updatedFiles).length) {
        throw new Error('The Image Builder cannot edit source files.');
      }
    }

    const preparedAssets = assets.map((asset) => {
      if (
        !asset ||
        typeof asset.id !== 'string' ||
        typeof asset.fileName !== 'string' ||
        typeof asset.base64 !== 'string'
      ) {
        throw new Error('Image Builder returned an incomplete asset record.');
      }

      const path = validateAssetPath(asset.fileName);

      if (seenIds.has(asset.id) || seenPaths.has(path)) {
        throw new Error(`Image Builder returned duplicate asset id or path: ${path}`);
      }

      seenIds.add(asset.id);
      seenPaths.add(path);

      const base64 = asset.base64.replace(/^data:image\/png;base64,/i, '').replace(/\s/g, '');
      const bytes = decodeGeneratedPng(base64, path);

      return { ...asset, path, base64, bytes };
    });

    if (preparedAssets.length === 0 && Object.keys(updatedFiles).length === 0) {
      return { ok: true, skipped: true, generatedCount: 0 };
    }

    /*
     * Validate every destination before the first write. The integrator may only
     * update existing source files submitted in this request.
     */
    for (const [path, content] of Object.entries(updatedFiles)) {
      if (!(path in filesRecord) || typeof content !== 'string') {
        throw new Error(`Asset integrator attempted an unapproved source path: ${path}`);
      }
    }

    // Generated assets are create-only. Check the whole batch before touching the workspace.
    for (const asset of preparedAssets) {
      const parent = nodePath.posix.dirname(asset.path);
      const name = nodePath.posix.basename(asset.path);
      let exists = false;

      try {
        const entries = await webcontainer.fs.readdir(parent, { withFileTypes: true });
        exists = entries.some((entry: any) => (typeof entry === 'string' ? entry : entry.name) === name);
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
      }

      if (exists) {
        throw new Error(`Refusing to overwrite existing game asset: ${asset.path}`);
      }
    }

    // 4. Write all validated PNGs, and roll back newly created files if any write fails.
    await webcontainer.fs.mkdir('assets', { recursive: true }).catch(() => {});

    const writtenPaths: string[] = [];
    const startedPaths: string[] = [];
    let currentPath: string | undefined;

    try {
      for (const asset of preparedAssets) {
        currentPath = asset.path;

        if (options.messageId) {
          startActivity(
            options.messageId,
            `assets:write:${asset.path}`,
            `Adding ${asset.path}`,
            `Added ${asset.path}`,
            'running',
            asset.path,
          );
          startedPaths.push(asset.path);
        }

        await webcontainer.fs.mkdir(nodePath.posix.dirname(asset.path), { recursive: true });
        await webcontainer.fs.writeFile(asset.path, asset.bytes);
        writtenPaths.push(asset.path);
        currentPath = undefined;
      }
    } catch (error) {
      const rollbackPaths = new Set([...writtenPaths, ...(currentPath ? [currentPath] : [])]);

      for (const path of rollbackPaths) {
        try {
          await webcontainer.fs.rm(path);
        } catch (rollbackError) {
          logger.warn(`Could not roll back generated asset ${path}:`, (rollbackError as Error).message);
        }
      }

      if (options.messageId) {
        for (const path of startedPaths) {
          updateActivity(options.messageId, `assets:write:${path}`, path === currentPath ? 'failed' : 'aborted');
        }
      }

      throw error;
    }

    for (const asset of preparedAssets) {
      generatedAssets.setKey(asset.path, {
        id: asset.id,
        path: asset.path,
        dataUrl: `data:image/png;base64,${asset.base64}`,
        byteLength: asset.bytes.length,
      });

      if (options.messageId) {
        updateActivity(options.messageId, `assets:write:${asset.path}`, 'complete');
      }

      const absolutePath = nodePath.posix.join(WORK_DIR, asset.path);

      if (workbenchStore.files) {
        const parts = asset.path.split('/');

        for (let i = 1; i < parts.length; i++) {
          const folderPath = nodePath.posix.join(WORK_DIR, ...parts.slice(0, i));
          workbenchStore.files.setKey(folderPath, { type: 'folder' });
        }
        workbenchStore.files.setKey(absolutePath, { type: 'file', content: '', isBinary: true });
      }
    }

    // 5. Update relevant game code to load and draw images with shape fallback preserved
    for (const [filePath, content] of Object.entries(updatedFiles)) {
      const stepId = `assets:integrate:${filePath}`;

      if (options.messageId) {
        startActivity(
          options.messageId,
          stepId,
          `Integrating images in ${filePath}`,
          `Integrated images in ${filePath}`,
          'running',
          filePath,
        );
      }

      try {
        await webcontainer.fs.writeFile(filePath, content);

        const absolutePath = nodePath.posix.join(WORK_DIR, filePath);

        if (workbenchStore.files) {
          workbenchStore.files.setKey(absolutePath, {
            type: 'file',
            content,
            isBinary: false,
          });
        }

        if (options.messageId) {
          updateActivity(options.messageId, stepId, 'complete');
        }
      } catch (codeErr) {
        if (options.messageId) {
          updateActivity(options.messageId, stepId, 'failed');
        }

        throw codeErr;
      }
    }

    if (workbenchStore.files) {
      workbenchStore.setDocuments(workbenchStore.files.get());
    }

    return {
      ok: true,
      generatedCount: assets.length,
      updatedPaths: Object.keys(updatedFiles),
    };
  } catch (error: any) {
    logger.warn('Asset generation failed:', error?.message);
    return {
      ok: false,
      error: error?.message || 'Unexpected asset generation error',
    };
  }
}

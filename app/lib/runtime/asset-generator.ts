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

/**
 * Checks if FLUX.2-pro asset generation is enabled and configured in the environment.
 */
export async function isFluxAssetGenerationAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/generate-assets', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
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
      body: JSON.stringify(options.approvedBlueprint ? {
        approvedBlueprint: options.approvedBlueprint,
        executionToken: options.executionToken,
      } : {
        userPrompt: options.userPrompt,
        files: filesRecord,
        model: options.model,
        provider: options.provider,
        apiKeys: options.apiKeys,
      }),
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

    const assets: Array<{ id: string; fileName: string; base64: string }> = data.assets || [];
    const updatedFiles: Record<string, string> = data.updatedFiles || {};
    if (options.approvedBlueprint) {
      const expected = options.approvedBlueprint.assetOperations;
      if (assets.length !== expected.length || assets.some((asset) => !expected.some((operation) => operation.id === asset.id && operation.path === asset.fileName))) {
        throw new Error('Image Builder returned assets outside the approved blueprint.');
      }
      if (Object.keys(updatedFiles).length) {
        throw new Error('The Image Builder cannot edit source files.');
      }
    }

    if (assets.length === 0) {
      return { ok: true, skipped: true, generatedCount: 0 };
    }

    // Validate every destination before the first write. The integrator may only
    // update existing source files submitted in this request.
    for (const asset of assets) {
      validateAssetPath(asset.fileName);
    }

    for (const [path, content] of Object.entries(updatedFiles)) {
      if (!(path in filesRecord) || typeof content !== 'string') {
        throw new Error(`Asset integrator attempted an unapproved source path: ${path}`);
      }
    }

    // 4. Save generated image files under the game project's /assets/ directory
    await webcontainer.fs.mkdir('assets', { recursive: true }).catch(() => {});

    for (const asset of assets) {
      try {
        const cleanPath = validateAssetPath(asset.fileName);
        const stepId = `assets:write:${cleanPath}`;
        if (options.messageId) {
          startActivity(options.messageId, stepId, `Adding ${cleanPath}`, `Added ${cleanPath}`, 'running', cleanPath);
        }
        const binaryString = atob(asset.base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
          throw new Error(`Invalid PNG image: ${cleanPath}`);
        }

        await webcontainer.fs.mkdir(nodePath.posix.dirname(cleanPath), { recursive: true });
        // Write binary PNG to WebContainer
        await webcontainer.fs.writeFile(cleanPath, bytes);
        generatedAssets.setKey(cleanPath, {
          id: asset.id,
          path: cleanPath,
          dataUrl: `data:image/png;base64,${asset.base64}`,
          byteLength: bytes.length,
        });
        if (options.messageId) {
          updateActivity(options.messageId, stepId, 'complete');
        }

        // Register in workbench filesStore map
        const absolutePath = nodePath.posix.join(WORK_DIR, cleanPath);
        if (workbenchStore.files) {
          // Register intermediate folder segments so assets/ folder appears in FileTree
          const parts = cleanPath.split('/');
          for (let i = 1; i < parts.length; i++) {
            const folderPath = nodePath.posix.join(WORK_DIR, ...parts.slice(0, i));
            workbenchStore.files.setKey(folderPath, { type: 'folder' });
          }

          workbenchStore.files.setKey(absolutePath, {
            type: 'file',
            content: '',
            isBinary: true,
          });
        }
      } catch (assetErr) {
        if (options.messageId) {
          updateActivity(options.messageId, `assets:write:${asset.fileName}`, 'failed');
        }
        throw assetErr;
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

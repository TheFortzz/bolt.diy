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

const logger = createScopedLogger('AssetGenerator');

export interface GenerateProjectAssetsOptions {
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
}

/**
 * Checks if FLUX.2-pro asset generation is enabled and configured in the environment.
 */
export async function isFluxAssetGenerationAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/generate-assets');
    if (!res.ok) return false;
    const data: any = await res.json();
    return Boolean(data?.available);
  } catch {
    return false;
  }
}

/**
 * Runs the complete FLUX.2-pro asset generation pipeline for the current project.
 * Isolated and resilient: asset errors or timeouts NEVER break the build.
 */
export async function generateProjectAssets(
  options: GenerateProjectAssetsOptions = {},
): Promise<AssetGenerationStatus> {
  try {
    // 1. Check if FLUX_API_KEY is available in the environment
    const available = await isFluxAssetGenerationAvailable();
    if (!available) {
      logger.info('FLUX_API_KEY is not configured in the environment; retaining existing shape rendering.');
      return { ok: true, skipped: true };
    }

    const webcontainer = await getWebContainer();

    // 2. Collect current project code files from WebContainer
    const filesRecord: Record<string, string> = {};
    const rootFiles = await webcontainer.fs.readdir('.', { withFileTypes: true }).catch(() => []);

    for (const dirent of rootFiles) {
      if (dirent.isFile() && (dirent.name.endsWith('.js') || dirent.name.endsWith('.html') || dirent.name.endsWith('.css'))) {
        try {
          const content = await webcontainer.fs.readFile(dirent.name, 'utf-8');
          filesRecord[dirent.name] = content;
        } catch {
          /* ignore */
        }
      }
    }

    if (Object.keys(filesRecord).length === 0) {
      return { ok: true, skipped: true };
    }

    // 3. Call server pipeline endpoint to select elements, invoke FLUX.2-pro, and update code
    const res = await fetch('/api/generate-assets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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

    if (assets.length === 0) {
      return { ok: true, skipped: true, generatedCount: 0 };
    }

    // 4. Save generated image files under the game project's /assets/ directory
    await webcontainer.fs.mkdir('assets', { recursive: true }).catch(() => {});

    for (const asset of assets) {
      try {
        const cleanPath = asset.fileName.replace(/^[/\\]+/, '');
        const binaryString = atob(asset.base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Write binary PNG to WebContainer
        await webcontainer.fs.writeFile(cleanPath, bytes);

        // Register in workbench filesStore map
        const absolutePath = nodePath.posix.join(WORK_DIR, cleanPath);
        const filesStore = (workbenchStore as any)._filesStore || (workbenchStore as any).filesStore;
        if (filesStore?.files) {
          // Register intermediate folder segments so assets/ folder appears in FileTree
          const parts = cleanPath.split('/');
          for (let i = 1; i < parts.length; i++) {
            const folderPath = nodePath.posix.join(WORK_DIR, ...parts.slice(0, i));
            filesStore.files.setKey(folderPath, { type: 'folder' });
          }

          filesStore.files.setKey(absolutePath, {
            type: 'file',
            content: '',
            isBinary: true,
          });
        }
      } catch (assetErr) {
        logger.warn(`Failed to write asset ${asset.fileName}:`, assetErr);
      }
    }

    // 5. Update relevant game code to load and draw images with shape fallback preserved
    for (const [filePath, content] of Object.entries(updatedFiles)) {
      try {
        await webcontainer.fs.writeFile(filePath, content);

        const absolutePath = nodePath.posix.join(WORK_DIR, filePath);
        const filesStore = (workbenchStore as any)._filesStore || (workbenchStore as any).filesStore;
        if (filesStore?.files) {
          filesStore.files.setKey(absolutePath, {
            type: 'file',
            content,
            isBinary: false,
          });
        }
      } catch (codeErr) {
        logger.warn(`Failed to apply updated code for ${filePath}:`, codeErr);
      }
    }

    return {
      ok: true,
      generatedCount: assets.length,
    };
  } catch (error: any) {
    // Isolated error containment: asset failures must never break the build
    logger.warn('Non-fatal asset generation error caught:', error?.message);
    return {
      ok: false,
      error: error?.message || 'Unexpected asset generation error',
    };
  }
}

import { workbenchStore } from '~/lib/stores/workbench';
import { runActivityStep, startActivity, updateActivity } from '~/lib/stores/activity';
import { generateProjectAssets, type GenerateProjectAssetsOptions } from '~/lib/runtime/asset-generator';
import { validateBuild, validationState } from '~/lib/runtime/build-validator';
import { auditGameModuleGraph } from '~/lib/runtime/static-preview';

/** Validate the final code AND asset integration, never the pre-asset build. */
export async function verifyGameBuild(messageId: string, options: GenerateProjectAssetsOptions = {}) {
  validationState.set({ status: 'checking', detail: 'Preparing images and final game checks…' });

  /*
   * Deterministic module-wiring audit first: a named import its target file
   * does not top-level export crashes the game no matter how clean the rest
   * of the build is — fail fast with the exact file+symbol instead of a raw
   * TypeError from somewhere deep in the preview.
   */
  const sourceFiles: Array<{ path: string; content: string }> = [];

  for (const [path, dirent] of Object.entries(workbenchStore.files.get())) {
    if (dirent?.type === 'file' && typeof dirent.content === 'string' && dirent.content) {
      sourceFiles.push({ path, content: dirent.content });
    }
  }

  const wiring = auditGameModuleGraph(sourceFiles);

  if (wiring.length > 0) {
    const detail = `Broken module wiring: ${wiring.map((entry) => `${entry.file} → ${entry.detail}`).join('. ')}`;
    startActivity(messageId, 'validation:wiring', 'Module wiring check failed', detail, 'failed');
    validationState.set({ status: 'failed', detail });

    return { ok: false as const, error: detail };
  }

  // Managed runs already generated their approved assets before the Editor.
  if (options.approvedBlueprint) {
    return validateBuild(messageId, [], options.approvedBlueprint.verification);
  }

  try {
    await workbenchStore.waitForExecutionQueue();

    const artifact = workbenchStore.artifacts.get()[messageId];
    const actions = artifact ? Object.values(artifact.runner.actions.get()) : [];

    // Do not spend on assets for a response that failed to produce complete files.
    if (
      !artifact?.closed ||
      !actions.some((action) => action.type === 'file') ||
      actions.some(
        (action) =>
          action.status === 'failed' ||
          action.status === 'aborted' ||
          (action.type !== 'start' && action.status === 'pending') ||
          (action.type === 'file' && !action.executed),
      )
    ) {
      return await validateBuild(messageId);
    }

    const result = await runActivityStep(
      messageId,
      'assets:generate',
      'Preparing game images',
      async () => {
        const assets = await generateProjectAssets({ ...options, messageId });

        if (!assets.ok) {
          throw new Error(`Image integration failed: ${assets.error || 'Unknown image error'}`);
        }

        return assets;
      },
      'Image preparation finished',
    );

    if (result.skipped) {
      startActivity(
        messageId,
        'assets:skipped',
        'No generated images added; checking existing visuals',
        undefined,
        'complete',
      );
    }

    return await validateBuild(messageId, result.updatedPaths);
  } catch (error) {
    const detail = (error as Error).message || 'Game pipeline failed';
    updateActivity(messageId, 'assets:generate', 'failed');
    startActivity(messageId, 'validation:failed', 'Preview check failed', 'Preview check failed', 'failed');
    validationState.set({ status: 'failed', detail });

    return { ok: false, error: detail };
  }
}

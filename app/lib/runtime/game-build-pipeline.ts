import { workbenchStore } from '~/lib/stores/workbench';
import { runActivityStep, startActivity, updateActivity } from '~/lib/stores/activity';
import { generateProjectAssets, type GenerateProjectAssetsOptions } from '~/lib/runtime/asset-generator';
import { validateBuild, validationState } from '~/lib/runtime/build-validator';

/** Validate the final code AND asset integration, never the pre-asset build. */
export async function verifyGameBuild(messageId: string, options: GenerateProjectAssetsOptions = {}) {
  validationState.set({ status: 'checking', detail: 'Preparing images and final game checks…' });

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

import type { PreviewVerificationRequirements } from '~/lib/runtime/preview-probe';
import { runStaticPreviewProbe } from '~/lib/runtime/preview-probe';
import { workbenchStore } from '~/lib/stores/workbench';
import { generatedAssets } from '~/lib/stores/generated-assets';
import { buildFallbackHtml } from '~/lib/runtime/static-preview';

export type PreviewValidationResult = { ok: true } | { ok: false; error: string };

type PreviewValidator = (verification?: PreviewVerificationRequirements) => Promise<PreviewValidationResult>;

let validator: PreviewValidator | undefined;

export function registerPreviewValidator(next: PreviewValidator) {
  validator = next;

  return () => {
    if (validator === next) {
      validator = undefined;
    }
  };
}

export async function validatePreview(
  verification?: PreviewVerificationRequirements,
): Promise<PreviewValidationResult> {
  if (validator) {
    return validator(verification);
  }

  // If Preview component is not currently mounted (e.g. workbench closed or lazy loading),
  // verify static projects directly via the sandboxed iframe probe rather than failing closed.
  const files = workbenchStore.files.get();
  const hasFiles = Object.values(files).some((file) => file?.type === 'file' && Boolean(file.content));

  if (!hasFiles) {
    return { ok: false, error: 'Preview is not mounted; could not verify the build.' };
  }

  const serverUrl = workbenchStore.previews.get().find((preview) => preview.ready)?.baseUrl;
  const projectHasPackage = Object.entries(files).some(
    ([path, file]) => path.endsWith('/package.json') && file?.type === 'file',
  );

  if (serverUrl && projectHasPackage) {
    return {
      ok: false,
      error:
        'Dev-server preview is reachable, but runtime verification needs a browser worker or an authenticated preview bridge. Load events alone cannot verify this build.',
    };
  }

  const fallbackHtml = buildFallbackHtml(files, generatedAssets.get());

  if (!fallbackHtml) {
    return { ok: false, error: 'No runnable preview was produced.' };
  }

  return runStaticPreviewProbe(fallbackHtml, verification);
}

import type { PreviewVerificationRequirements } from '~/lib/runtime/preview-probe';
import { runStaticPreviewProbe } from '~/lib/runtime/preview-probe';
import { workbenchStore } from '~/lib/stores/workbench';
import { generatedAssets } from '~/lib/stores/generated-assets';
import { buildFallbackHtml } from '~/lib/runtime/static-preview';

export type PreviewValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Inbox for live runtime errors posted by the preview iframe
 * (`thefortz-game-error`). The repair loop drains these before every agent
 * attempt, so a game that boots but throws in play actually gets fixed
 * instead of staying broken forever.
 */
const gameErrorInbox: Array<{ message: string; at: number }> = [];
const MAX_INBOX_ERRORS = 20;
const INBOX_TTL_MS = 10 * 60 * 1000;

export function reportPreviewGameError(message: string) {
  const text = String(message || '')
    .slice(0, 2000)
    .trim();

  if (!text) {
    return;
  }

  const now = Date.now();

  while (gameErrorInbox.length > 0 && now - gameErrorInbox[0].at > INBOX_TTL_MS) {
    gameErrorInbox.shift();
  }

  if (gameErrorInbox.some((entry) => entry.message === text)) {
    return;
  }

  gameErrorInbox.push({ message: text, at: now });

  while (gameErrorInbox.length > MAX_INBOX_ERRORS) {
    gameErrorInbox.shift();
  }
}

export function takePreviewGameErrors(): string[] {
  const now = Date.now();
  const fresh = gameErrorInbox.filter((entry) => now - entry.at <= INBOX_TTL_MS).map((entry) => entry.message);
  gameErrorInbox.length = 0;

  return fresh;
}

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

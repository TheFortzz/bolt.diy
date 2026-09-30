import type { PreviewVerificationRequirements } from '~/lib/runtime/preview-probe';

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
  if (!validator) {
    return { ok: false, error: 'Preview is not mounted; could not verify the build.' };
  }

  return validator(verification);
}

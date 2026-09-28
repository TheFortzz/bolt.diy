export type PreviewValidationResult = { ok: true } | { ok: false; error: string };

type PreviewValidator = () => Promise<PreviewValidationResult>;

let validator: PreviewValidator | undefined;

export function registerPreviewValidator(next: PreviewValidator) {
  validator = next;

  return () => {
    if (validator === next) {
      validator = undefined;
    }
  };
}

export async function validatePreview(): Promise<PreviewValidationResult> {
  if (!validator) {
    return { ok: false, error: 'Preview is not mounted; could not verify the build.' };
  }

  return validator();
}

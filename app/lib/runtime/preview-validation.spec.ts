import { afterEach, describe, expect, it } from 'vitest';
import { registerPreviewValidator, validatePreview } from './preview-validation';

let unregister: (() => void) | undefined;
afterEach(() => {
  unregister?.();
  unregister = undefined;
});

describe('preview validation registration', () => {
  it('fails closed when the preview cannot be checked', async () => {
    expect((await validatePreview()).ok).toBe(false);
  });

  it('uses the active validator and unregisters safely', async () => {
    const old = registerPreviewValidator(async () => ({ ok: false, error: 'Old preview' }));
    unregister = registerPreviewValidator(async () => ({ ok: true }));
    old();
    expect(await validatePreview()).toEqual({ ok: true });
    unregister();
    expect((await validatePreview()).ok).toBe(false);
  });
});

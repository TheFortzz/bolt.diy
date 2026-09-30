import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewVerificationRequirements } from './preview-probe';
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

  it('passes the approved verification requirements to the mounted preview', async () => {
    const requirements = {
      scenarios: ['startup', 'controls', 'restart', 'resize'],
      minimumSimulationSteps: 120,
      requireDiagnostics: true,
    } as const;
    let received: PreviewVerificationRequirements | undefined;
    unregister = registerPreviewValidator(async (value) => {
      received = value;

      return { ok: true };
    });

    expect(await validatePreview(requirements)).toEqual({ ok: true });
    expect(received).toEqual(requirements);
  });
});

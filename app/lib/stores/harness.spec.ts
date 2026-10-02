import { describe, expect, it, vi } from 'vitest';
import { harnessState, transitionHarness } from './harness';

describe('harness store transitions', () => {
  it('allows normal progression and auto-repair transitions', () => {
    transitionHarness('idle');
    expect(harnessState.get().phase).toBe('idle');

    transitionHarness('planning', { detail: 'Planning game' });
    expect(harnessState.get().phase).toBe('planning');

    transitionHarness('awaiting-approval', { detail: 'Reviewing plan' });
    expect(harnessState.get().phase).toBe('awaiting-approval');

    transitionHarness('preparing-assets', { detail: 'Preparing images' });
    expect(harnessState.get().phase).toBe('preparing-assets');

    transitionHarness('editing', { detail: 'Writing files' });
    expect(harnessState.get().phase).toBe('editing');

    transitionHarness('verifying', { detail: 'Checking build' });
    expect(harnessState.get().phase).toBe('verifying');

    // Auto-repair transition from verifying back to editing must be allowed
    transitionHarness('editing', { detail: 'Auto-repairing build (1/2)…' });
    expect(harnessState.get().phase).toBe('editing');

    // From editing back to verifying
    transitionHarness('verifying', { detail: 'Checking repaired build' });
    expect(harnessState.get().phase).toBe('verifying');

    // Verified
    transitionHarness('verified', { detail: 'Build verified' });
    expect(harnessState.get().phase).toBe('verified');
  });

  it('logs warning instead of throwing on unexpected transition', () => {
    transitionHarness('idle');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // idle -> verifying is unexpected
    transitionHarness('verifying', { detail: 'Forced verify' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Harness transition warning: unexpected transition idle → verifying'),
    );
    expect(harnessState.get().phase).toBe('verifying');

    warnSpy.mockRestore();
  });
});

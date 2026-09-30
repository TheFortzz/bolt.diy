import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  wait: vi.fn(),
  generate: vi.fn(),
  validate: vi.fn(),
  artifact: {
    closed: true,
    runner: { actions: { get: () => ({ file: { type: 'file', status: 'complete', executed: true } }) } },
  },
}));
vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    waitForExecutionQueue: mocks.wait,
    artifacts: { get: () => ({ build: mocks.artifact }) },
  },
}));
vi.mock('~/lib/runtime/asset-generator', () => ({ generateProjectAssets: mocks.generate }));
vi.mock('~/lib/runtime/build-validator', () => ({ validateBuild: mocks.validate, validationState: { set: vi.fn() } }));

import { verifyGameBuild } from '~/lib/runtime/game-build-pipeline';
import { activitySteps } from '~/lib/stores/activity';

describe('final game verification pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activitySteps.set({});
    mocks.artifact.closed = true;
    mocks.wait.mockResolvedValue(undefined);
    mocks.generate.mockResolvedValue({ ok: true, updatedPaths: ['game.js'] });
    mocks.validate.mockResolvedValue({ ok: true });
  });

  it('waits for files and integrates images before verifying the final source', async () => {
    expect(await verifyGameBuild('build')).toEqual({ ok: true });
    expect(mocks.wait.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0]);
    expect(mocks.generate.mock.invocationCallOrder[0]).toBeLessThan(mocks.validate.mock.invocationCallOrder[0]);
    expect(mocks.validate).toHaveBeenCalledWith('build', ['game.js']);
  });

  it('does not mark a failed image integration as verified', async () => {
    mocks.generate.mockResolvedValue({ ok: false, error: 'Image could not be written' });
    expect((await verifyGameBuild('build')).ok).toBe(false);
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(activitySteps.get().build.find((entry) => entry.id === 'assets:generate')?.status).toBe('failed');
  });

  it('does not generate paid images for an incomplete build', async () => {
    mocks.artifact.closed = false;
    await verifyGameBuild('build');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.validate).toHaveBeenCalledWith('build');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  waitForExecutionQueue: vi.fn(),
  getWebContainer: vi.fn(),
  validatePreview: vi.fn(),
  artifacts: {} as Record<string, unknown>,
}));

vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    waitForExecutionQueue: mocks.waitForExecutionQueue,
    artifacts: { get: () => mocks.artifacts },
  },
}));
vi.mock('~/lib/webcontainer', () => ({ getWebContainer: mocks.getWebContainer }));
vi.mock('./preview-validation', () => ({ validatePreview: mocks.validatePreview }));

import { validateBuild, validationState } from './build-validator';

describe('build validation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waitForExecutionQueue.mockResolvedValue(undefined);
    mocks.validatePreview.mockResolvedValue({ ok: true });
    mocks.getWebContainer.mockResolvedValue({
      workdir: '/home/project',
      fs: { readFile: vi.fn().mockRejectedValue(new Error('No package.json')) },
      spawn: vi.fn(),
    });
    mocks.artifacts = {};
  });

  it('does not pass a failed file action or attempt a preview', async () => {
    mocks.artifacts.build = {
      closed: true,
      runner: { actions: { get: () => ({ file: { type: 'file', status: 'failed', error: 'Write failed' } }) } },
    };
    expect(await validateBuild('build')).toEqual({ ok: false, error: 'Write failed' });
    expect(mocks.waitForExecutionQueue).toHaveBeenCalledOnce();
    expect(mocks.validatePreview).not.toHaveBeenCalled();
    expect(validationState.get().status).toBe('failed');
  });

  it('passes only after source checks and preview succeed', async () => {
    mocks.artifacts.build = {
      closed: true,
      runner: {
        actions: {
          get: () => ({
            file: {
              type: 'file',
              filePath: '/home/project/game.js',
              status: 'complete',
              executed: true,
            },
          }),
        },
      },
    };

    const spawn = vi.fn().mockResolvedValue({
      exit: Promise.resolve(0),
      output: new ReadableStream<string>({
        start(controller) {
          controller.close();
        },
      }),
    });
    mocks.getWebContainer.mockResolvedValue({
      workdir: '/home/project',
      fs: {
        readFile: vi
          .fn()
          .mockImplementation((path: string) =>
            path.endsWith('game.js') ? Promise.resolve('console.log(1)') : Promise.reject(new Error('No package.json')),
          ),
      },
      spawn,
    });
    expect(await validateBuild('build')).toEqual({ ok: true });
    expect(spawn).toHaveBeenCalledWith('node', ['--check', '/home/project/game.js'], { cwd: '/home/project' });
    expect(mocks.validatePreview).toHaveBeenCalledOnce();
    expect(validationState.get().status).toBe('passed');
  });

  it('does not announce success when preview loading fails', async () => {
    mocks.artifacts.build = {
      closed: true,
      runner: {
        actions: {
          get: () => ({
            file: {
              type: 'file',
              filePath: '/home/project/index.html',
              status: 'complete',
              executed: true,
            },
          }),
        },
      },
    };
    mocks.getWebContainer.mockResolvedValue({
      workdir: '/home/project',
      fs: {
        readFile: vi
          .fn()
          .mockImplementation((path: string) =>
            path.endsWith('index.html')
              ? Promise.resolve('<html></html>')
              : Promise.reject(new Error('No package.json')),
          ),
      },
    });
    mocks.validatePreview.mockResolvedValue({ ok: false, error: 'Preview runtime error: broken' });

    expect(await validateBuild('build')).toEqual({ ok: false, error: 'Preview runtime error: broken' });
    expect(validationState.get().status).toBe('failed');
  });
});

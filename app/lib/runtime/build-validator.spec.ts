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

import { validateBuild, validateJavaScriptSyntax, validationState } from './build-validator';
import { activitySteps } from '~/lib/stores/activity';

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
    activitySteps.set({});
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
    expect(activitySteps.get().build.some((step) => step.id === 'validation:result')).toBe(false);
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
    expect(activitySteps.get().build.find((step) => step.id === 'validation:result')?.status).toBe('complete');
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
    expect(activitySteps.get().build.find((step) => step.id === 'validation:preview')?.status).toBe('failed');
  });

  it('normalizes root-leading file paths to project directory and falls back to in-memory syntax check when spawn reports missing file', async () => {
    mocks.artifacts.build = {
      closed: true,
      runner: {
        actions: {
          get: () => ({
            file: {
              type: 'file',
              filePath: '/input.js',
              status: 'complete',
              executed: true,
            },
          }),
        },
      },
    };

    const spawn = vi.fn().mockResolvedValue({
      exit: Promise.resolve(1),
      output: new ReadableStream<string>({
        start(controller) {
          controller.enqueue('node: can\'t open file \'/input.js\': [Errno 2] No such file or directory');
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
            path.endsWith('input.js') ? Promise.resolve('const speed = 10; function drive() { return speed; }') : Promise.reject(new Error('No package.json')),
          ),
      },
      spawn,
    });

    expect(await validateBuild('build')).toEqual({ ok: true });
    expect(spawn).toHaveBeenCalledWith('node', ['--check', '/home/project/input.js'], { cwd: '/home/project' });
    expect(mocks.validatePreview).toHaveBeenCalledOnce();
    expect(validationState.get().status).toBe('passed');
  });

  describe('validateJavaScriptSyntax', () => {
    it('returns undefined for valid JavaScript', () => {
      expect(validateJavaScriptSyntax('const a = 1; function test() { return a + 1; }', 'game.js')).toBeUndefined();
    });

    it('returns error message for syntax errors like missing parentheses', () => {
      expect(validateJavaScriptSyntax('console.log("missing parenthesis"', 'game.js')).toContain('game.js:');
    });

    it('handles top-level await gracefully', () => {
      expect(validateJavaScriptSyntax('await Promise.resolve(42);', 'game.js')).toBeUndefined();
    });

    it('handles import and export statements gracefully', () => {
      const code = `import { foo } from './foo.js';\nexport default function bar() { return foo; }`;
      expect(validateJavaScriptSyntax(code, 'game.js')).toBeUndefined();
    });

    it('handles import.meta gracefully', () => {
      const code = `const url = import.meta.url || '';\nconsole.log(url);`;
      expect(validateJavaScriptSyntax(code, 'game.js')).toBeUndefined();
    });

    it('strips markdown code fences before validating', () => {
      const code = '```javascript\nconst x = 10;\n```';
      expect(validateJavaScriptSyntax(code, 'game.js')).toBeUndefined();
    });
  });
});

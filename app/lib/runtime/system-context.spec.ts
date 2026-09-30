import { describe, expect, it } from 'vitest';
import { compileSystemContext, MAX_SYSTEM_CONTEXT_LENGTH } from '~/lib/runtime/system-context';

describe('SYSTEM_CONTEXT projection', () => {
  it('includes paths, asset metadata, global names, script order and runtime flags without source payloads', () => {
    const context = compileSystemContext(
      {
        '/home/project/index.html': {
          type: 'file',
          isBinary: false,
          content: '<script src="input.js"></script><script src="game.js"></script>',
        },
        '/home/project/game.js': {
          type: 'file',
          isBinary: false,
          content: 'window.Game = class Game {}; const secretValue = "not-for-context";',
        },
        '/home/project/assets/car.png': { type: 'file', isBinary: true, content: '' },
        '/home/project/.env.local': { type: 'file', isBinary: false, content: 'SECRET=never-include' },
      },
      {
        'assets/car.png': {
          id: 'car',
          path: 'assets/car.png',
          byteLength: 128,
          dataUrl: 'data:image/png;base64,never-include',
        },
      },
      { status: 'checking', detail: 'Some diagnostic' },
    );

    expect(context).toContain('window.Game');
    expect(context).toContain('assets/car.png');
    expect(context).toContain('1. "input.js"');
    expect(context).toContain('Validation state: checking');
    expect(context).not.toContain('never-include');
    expect(context).not.toContain('not-for-context');
    expect(context).not.toContain('.env.local');
  });

  it('bounds a large workspace to a predictable token budget', () => {
    const files = Object.fromEntries(
      Array.from({ length: 1000 }, (_, index) => [
        `src/file-${index}.js`,
        { type: 'file' as const, content: '', isBinary: false },
      ]),
    );
    const context = compileSystemContext(files, {}, { status: 'idle', detail: '' });
    expect(context.length).toBeLessThanOrEqual(MAX_SYSTEM_CONTEXT_LENGTH);
    expect(context).toContain('omitted for token budget');
  });
});

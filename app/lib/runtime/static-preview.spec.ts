import { describe, expect, it } from 'vitest';
import { balanceAndCloseJs, injectStaticScripts, resolveStaticPreviewFile } from '~/lib/runtime/static-preview';

describe('static preview file resolution', () => {
  const files = [
    { path: 'game.js', content: 'root entry' },
    { path: 'src/game.js', content: 'nested entry' },
    { path: 'src/lib/physics.js', content: 'physics helper' },
  ];

  it('prefers exact paths and resolves a unique relative suffix', () => {
    expect(resolveStaticPreviewFile(files, 'game.js')?.content).toBe('root entry');
    expect(resolveStaticPreviewFile(files, 'lib/physics.js?version=1')?.content).toBe('physics helper');
  });

  it('does not guess when a basename is ambiguous or a path escapes the project', () => {
    const ambiguous = [
      { path: 'src/foo/game.js', content: 'one' },
      { path: 'lib/foo/game.js', content: 'two' },
    ];

    expect(resolveStaticPreviewFile(ambiguous, 'foo/game.js')).toBeUndefined();
    expect(resolveStaticPreviewFile(files, '../game.js')).toBeUndefined();
  });
});

describe('static preview script assembly', () => {
  it('injects missing dependencies before declared game scripts', () => {
    const html = '<!DOCTYPE html><body><script data-inlined="game.js">startGame();</script></body>';
    const result = injectStaticScripts(html, ['<script data-inlined="physics.js">physics();</script>'], []);

    expect(result.indexOf('physics.js')).toBeLessThan(result.indexOf('game.js'));
    expect(result).toContain('</body>');
  });

  it('keeps unlinked entry files after helpers in a generated shell document', () => {
    const result = injectStaticScripts(
      '<!DOCTYPE html><body><canvas></canvas></body>',
      ['<script data-inlined="utils.js">utils();</script>'],
      ['<script data-inlined="game.js">startGame();</script>'],
    );

    expect(result.indexOf('utils.js')).toBeLessThan(result.indexOf('game.js'));
    expect(result.indexOf('game.js')).toBeLessThan(result.indexOf('</body>'));
  });

  it('adds entry scripts to documents without a body tag', () => {
    const result = injectStaticScripts('<html></html>', [], ['<script data-inlined="game.js"></script>']);

    expect(result).toBe('<html></html>\n<script data-inlined="game.js"></script>');
  });
});

describe('balanceAndCloseJs syntax healing', () => {
  it('returns valid JavaScript untouched', () => {
    const code = 'function init() { console.log("ready"); }';
    expect(balanceAndCloseJs(code)).toBe(code);
  });

  it('heals truncated method arguments list cut off mid-call', () => {
    const broken = 'function draw() {\n  ctx.strokeRect(-8, -8, 16';
    const healed = balanceAndCloseJs(broken);

    expect(() => new Function(healed)).not.toThrow();
    expect(healed).toContain('ctx.strokeRect');
  });

  it('heals cut-off string literal and unclosed function braces', () => {
    const broken = 'function welcome() {\n  const message = "welcome to the game';
    const healed = balanceAndCloseJs(broken);

    expect(() => new Function(healed)).not.toThrow();
  });

  it('heals missing multiplication operator in math expressions like (b-a)t and 2(x+1)', () => {
    const broken = 'const lerp = (a, b, t) => a + (b - a)t;\nconst calc = (x) => 2(x + 1);';
    const healed = balanceAndCloseJs(broken);

    expect(() => new Function(healed)).not.toThrow();
    expect(healed).toContain('(b - a)*t');
    expect(healed).toContain('2*(x + 1)');
  });
});

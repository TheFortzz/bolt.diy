import { describe, expect, it } from 'vitest';
import {
  balanceAndCloseJs,
  buildFallbackHtml,
  ensurePreviewAudioUnlock,
  ensurePreviewStorageShim,
  ensureThreeImportMap,
  inlineLocalModuleBlobImports,
  injectStaticScripts,
  looksLikeEsm,
  normalizeServerPreviewHtml,
  normalizeStudioGameHtml,
  resolveStaticPreviewFile,
  rewriteUnpkgThreeToJsdelivr,
  stripBlockedSdkScripts,
} from '~/lib/runtime/static-preview';

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
  it('does not fake missing DOM nodes, input handlers, or gameplay diagnostics', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content: '<!doctype html><html><head></head><body><canvas id="game"></canvas><script src="game.js"></script></body></html>',
      },
      'game.js': { type: 'file', content: 'requestAnimationFrame(() => {});' },
    });

    expect(html).toBeDefined();
    expect(html).not.toContain('g.InputHandler = class');
    expect(html).not.toContain('document.getElementById = function');
    expect(html).not.toContain('data-bolt-autostub');
    expect(html).not.toContain('diagStep');
    expect(html).not.toContain('var InputHandler = window.InputHandler');
    expect(html).not.toContain('var clamp = window.clamp');
  });

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

describe('studio preview publish parity', () => {
  it('strips Puter.js SDK tags that break sandboxed game init', () => {
    const html =
      '<html><head><script src="https://js.puter.com/v2/"></script></head><body><script>window.puter = {};</script></body></html>';
    const out = stripBlockedSdkScripts(html);

    expect(out).not.toContain('js.puter.com');
    expect(out).not.toContain('window.puter');
    expect(out).toContain('<body>');
  });

  it('rewrites unpkg three.js refs to jsDelivr', () => {
    expect(
      rewriteUnpkgThreeToJsdelivr('<script src="https://unpkg.com/three@0.160.0/build/three.module.js">'),
    ).toContain('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  });

  it('injects a pinned three.js import map for bare imports, once, and respects existing import maps', () => {
    const html =
      '<html><head></head><body><script type="module">import * as THREE from "three";</script></body></html>';
    const out = ensureThreeImportMap(html);

    expect(out).toContain('data-studio-three-importmap');
    expect(out).toContain('three@0.160.0/build/three.module.js');
    expect(ensureThreeImportMap(out)).toBe(out);

    const withMap = '<html><head><script type="importmap">{"imports":{}}</script></head><body></body></html>';
    expect(ensureThreeImportMap(withMap)).toBe(withMap);

    expect(ensureThreeImportMap('<html><head></head><body>plain</body></html>')).not.toContain('importmap');
  });

  it('adds storage shim and audio unlock helpers exactly once', () => {
    const html = '<html><head></head><body><button id="start">Start</button></body></html>';
    const once = normalizeStudioGameHtml(html);

    expect(once).toContain('data-studio-storage-shim');
    expect(once).toContain('data-studio-autostart');
    expect(once).toContain('id="start"');
    expect(normalizeStudioGameHtml(once)).toBe(once);
    expect(ensurePreviewStorageShim(once)).toBe(once);
    expect(ensurePreviewAudioUnlock(once)).toBe(once);
  });

  it('buildFallbackHtml output carries the publish-parity normalization', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head><script src="https://js.puter.com/v2/"></script></head><body><canvas id="game"></canvas><script src="game.js"></script></body></html>',
      },
      'game.js': { type: 'file', content: 'requestAnimationFrame(() => {});' },
    });

    expect(html).toBeDefined();
    expect(html).not.toContain('js.puter.com');
    expect(html).toContain('data-studio-storage-shim');
    expect(html).toContain('data-studio-autostart');
  });

  it('server-embedded normalizer parses as plain JS and matches publish parity', () => {
    // workbench.ts embeds this exact source into the WebContainer static
    // server, so it must contain no TypeScript syntax. Rebuild it here the
    // same way and prove it parses and behaves.
    const embedded = new Function(`return (${normalizeServerPreviewHtml.toString()});`)() as (
      html: string,
    ) => string;

    expect(normalizeServerPreviewHtml.toString()).not.toContain(': string');
    expect(normalizeServerPreviewHtml.toString()).not.toContain('`');
    expect(normalizeServerPreviewHtml.toString()).not.toContain('${');

    const html =
      '<html><head><script src="https://js.puter.com/v2/"></script><script src="https://unpkg.com/three@0.160.0/build/three.module.js"></script></head><body><script type="module">import * as THREE from "three";</script></body></html>';
    const out = embedded(html);

    expect(out).not.toContain('js.puter.com');
    expect(out).toContain('cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
    expect(out).toContain('data-studio-three-importmap');
    expect(out).toContain('data-studio-storage-shim');
    expect(out).toContain('data-studio-autostart');
    expect(embedded(out)).toBe(out);
  });
});

describe('studio preview local module loading', () => {
  const captureBlobs = () => {
    const blobs: Blob[] = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = ((obj: any) => {
      blobs.push(obj as Blob);
      return `blob:test-${blobs.length}`;
    }) as any;
    return {
      blobs,
      restore: () => {
        URL.createObjectURL = original;
      },
    };
  };

  it('rewrites relative ESM imports to blob URLs across nested modules', async () => {
    const { blobs, restore } = captureBlobs();
    try {
      const html =
        '<html><head></head><body><canvas></canvas>' +
        '<script type="module" data-inlined="src/main.js">import { readInput } from "./input.js";\nreadInput();</script>' +
        '</body></html>';
      const out = inlineLocalModuleBlobImports(html, [
        { path: 'src/main.js', content: 'import { readInput } from "./input.js";\nreadInput();' },
        { path: 'src/input.js', content: 'import { clamp } from "./utils.js";\nexport function readInput() { return clamp(1); }' },
        { path: 'src/utils.js', content: 'export function clamp(v) { return v; }' },
      ]);

      expect(out).toContain('from "blob:test-');
      expect(out).not.toContain('"./input.js"');
      // Transitive dependency was bundled too.
      expect(blobs.length).toBeGreaterThanOrEqual(2);
      const texts = await Promise.all(blobs.map((b) => b.text()));
      expect(texts.some((t) => t.includes('readInput'))).toBe(true);
      expect(texts.some((t) => t.includes('blob:test-') && t.includes('clamp'))).toBe(true);
      expect(texts.some((t) => t.includes('export function clamp'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('leaves bare, absolute, and unresolvable specifiers alone', () => {
    const html =
      '<html><head></head><body>' +
      '<script type="module" data-inlined="game.js">import * as THREE from "three";\nimport { x } from "./missing.js";\nconsole.log(THREE, x);</script>' +
      '</body></html>';
    const out = inlineLocalModuleBlobImports(html, [
      { path: 'game.js', content: 'import * as THREE from "three";' },
    ]);

    expect(out).toContain('from "three"');
    expect(out).toContain('"./missing.js"');
    expect(out).not.toContain('blob:');
  });

  it('survives circular imports without hanging', () => {
    const html =
      '<html><head></head><body>' +
      '<script type="module" data-inlined="a.js">import { b } from "./b.js";\nexport const a = b;</script>' +
      '</body></html>';
    const out = inlineLocalModuleBlobImports(html, [
      { path: 'a.js', content: 'import { b } from "./b.js";\nexport const a = b;' },
      { path: 'b.js', content: 'import { a } from "./a.js";\nexport const b = a || 1;' },
    ]);

    expect(out).toContain('blob:');
  });

  it('leaves classic scripts untouched', () => {
    const html =
      '<html><head></head><body>' +
      '<script data-inlined="game.js">var x = "./input.js";</script>' +
      '</body></html>';
    const out = inlineLocalModuleBlobImports(html, [{ path: 'game.js', content: '' }]);

    expect(out).toBe(html);
  });

  it('buildFallbackHtml loads every module file of a multi-file ESM game', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas id="game"></canvas><script type="module" src="src/main.js"></script></body></html>',
      },
      'src/main.js': {
        type: 'file',
        content: 'import { readInput } from "./input.js";\nwindow.started = readInput();',
      },
      'src/input.js': { type: 'file', content: 'export function readInput() { return 1; }' },
    });

    expect(html).toBeDefined();
    expect(html).not.toContain('"./input.js"');
    expect(html).toContain('from "blob:');
  });

  it('detects real module syntax and ignores lookalikes', () => {
    expect(looksLikeEsm('import { a } from "./x.js";\ninit();')).toBe(true);
    expect(looksLikeEsm('import "./polyfill.js";')).toBe(true);
    expect(looksLikeEsm('export function start() {}')).toBe(true);
    expect(looksLikeEsm('export default class Game {}')).toBe(true);
    expect(looksLikeEsm('const m = import.meta.url;')).toBe(false);
    expect(looksLikeEsm('module.exports = { start };')).toBe(false);
    expect(looksLikeEsm('// import this later\nvar label = "press export to save";\nstart();')).toBe(false);
    expect(looksLikeEsm('')).toBe(false);
  });

  it('upgrades classic script tags carrying module syntax so they parse and load', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas id="game"></canvas><script src="src/main.js"></script></body></html>',
      },
      'src/main.js': {
        type: 'file',
        content: 'import { readInput } from "./input.js";\nwindow.started = readInput();',
      },
      'src/input.js': { type: 'file', content: 'export function readInput() { return 1; }' },
    });

    expect(html).toBeDefined();
    expect(html).toContain('type="module"');
    expect(html).not.toContain('"./input.js"');
    expect(html).toContain('from "blob:');
  });

  it('softens a missing export into a namespace default instead of killing boot', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas id="game"></canvas><script type="module" src="src/main.js"></script></body></html>',
      },
      'src/main.js': {
        type: 'file',
        content: 'import { loadPreferences, savePreferences } from "./prefs.js";\nloadPreferences();',
      },
      'src/prefs.js': { type: 'file', content: 'export function savePreferences() {}' },
    });

    expect(html).toBeDefined();
    expect(html).toContain('import * as __fortz_ns_');
    expect(html).toContain('loadPreferences = undefined');
    expect(html).not.toContain('import { loadPreferences');
  });

  it('leaves fully-satisfied imports exactly as written', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas></canvas><script type="module" src="main.js"></script></body></html>',
      },
      'main.js': {
        type: 'file',
        content: 'import Game, { start } from "./game.js";\nnew Game(start);',
      },
      'game.js': { type: 'file', content: 'export function start() {}\nexport default class Game {}' },
    });

    expect(html).toBeDefined();
    expect(html).not.toContain('__fortz_ns_');
    expect(html).toContain('from "blob:');
  });

  it('softens a missing default export while keeping working named imports', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas></canvas><script type="module" src="main.js"></script></body></html>',
      },
      'main.js': {
        type: 'file',
        content: 'import Engine, { tick } from "./engine.js";\nEngine.boot(tick);',
      },
      'engine.js': { type: 'file', content: 'export function tick() {}' },
    });

    expect(html).toBeDefined();
    expect(html).toContain('default: Engine = undefined');
    expect(html).toContain('tick = undefined');
  });
});

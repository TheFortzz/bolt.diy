import { describe, expect, it } from 'vitest';
import {
  auditGameModuleGraph,
  balanceAndCloseJs,
  buildFallbackHtml,
  ensurePreviewAudioUnlock,
  ensurePreviewStorageShim,
  ensurePreviewUrlShim,
  ensureThreeImportMap,
  inlineLocalModuleBlobImports,
  injectStaticScripts,
  looksLikeEsm,
  normalizeServerPreviewHtml,
  normalizeStudioGameHtml,
  resolveStaticPreviewFile,
  resolveStaticPreviewFileLoose,
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

  it('loosely heals folder mistakes to the unique basename match', () => {
    expect(resolveStaticPreviewFileLoose([{ path: 'style.css', content: 'x' }], 'src/style.css')?.path).toBe(
      'style.css',
    );
    expect(resolveStaticPreviewFileLoose([{ path: 'src/app.js', content: 'x' }], 'app.js')?.path).toBe('src/app.js');
  });

  it('loose resolution still refuses ambiguous basenames', () => {
    const ambiguous = [
      { path: 'src/game.js', content: 'one' },
      { path: 'lib/game.js', content: 'two' },
    ];

    expect(resolveStaticPreviewFileLoose(ambiguous, 'game.js')).toBeUndefined();
    expect(resolveStaticPreviewFileLoose(ambiguous, 'deep/nested/game.js')).toBeUndefined();
  });

  it('reports unresolvable references to the parent frame for repair', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas></canvas><script src="src/nope.js"></script></body></html>',
      },
    });

    expect(html).toBeDefined();
    expect(html).toContain('bolt-game-missing-refs');
    expect(html).toContain('Missing file reference:');
    expect(html).toContain('src/nope.js');
  });

  it('names the exact file when a source fails the module syntax audit', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas></canvas><script type="module" src="src/game.js"></script></body></html>',
      },
      'src/game.js': { type: 'file', content: 'import { a, b from "./lib.js";\nexport const c = a + b;\n' },
      'src/lib.js': { type: 'file', content: 'export const a = 1;\nexport const b = 2;\n' },
    });

    expect(html).toBeDefined();
    expect(html).toContain('bolt-game-syntax-issues');
    expect(html).toContain('src/game.js');
    expect(html).toContain('malformed import');
  });

  it('escapes </script> sequences so string content can never truncate an inlined script', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas></canvas><script src="game.js"></script></body></html>',
      },
      'game.js': {
        type: 'file',
        content:
          'const tag = "</script>";\ndocument.addEventListener("DOMContentLoaded", () => {\n  const c = document.querySelector("canvas");\n  if (c) c.focus();\n});\nconsole.log(tag);\n',
      },
    });

    expect(html).toBeDefined();

    /*
     * The raw sequence would end the tag early in the HTML parser; the
     * escaped form is identical JS and safe to serialize.
     */
    expect(html).toContain('<\\/script');
    expect(html).not.toContain('const tag = "</script>";');
    expect(html).not.toContain('bolt-game-syntax-issues');
  });

  it('names a broken inline HTML script in the syntax reporter', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas></canvas><script>const broken = "abc</script></body></html>',
      },
    });

    expect(html).toBeDefined();
    expect(html).toContain('bolt-game-syntax-issues');
    expect(html).toContain('index.html inline script #1');
  });

  it('installs the generated-asset resolver before the game code', () => {
    const html = buildFallbackHtml(
      {
        'index.html': {
          type: 'file',
          content:
            '<!doctype html><html><head></head><body><canvas></canvas><script src="game.js"></script></body></html>',
        },
        'game.js': {
          type: 'file',
          content:
            'const car = new Image();\ncar.src = "assets/car.png";\nfunction frame(){ ctx.drawImage(car, 0, 0); requestAnimationFrame(frame); }\nframe();\n',
        },
        'assets/car.png': { type: 'file', content: '' },
      },
      {
        'assets/car.png': {
          id: 'assets/car.png',
          path: 'assets/car.png',
          dataUrl: 'data:image/png;base64,QUJD',
          byteLength: 3,
        },
      },
    );

    expect(html).toBeDefined();
    expect(html).toContain('data-studio-asset-runtime');
    expect(html).toContain('__STUDIO_ASSETS__');
    // The resolver must exist before any game source so it can patch Image.src.
    expect(html!.indexOf('data-studio-asset-runtime')).toBeLessThan(html!.indexOf('const car = new Image()'));
  });

  it('guards WebAudio params so a non-finite value cannot kill the render loop', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas></canvas><script src="game.js"></script></body></html>',
      },
      'game.js': { type: 'file', content: 'setTimeout(() => {}, 0);\n' },
    });

    expect(html).toBeDefined();
    expect(html).toContain('AudioParam');
    expect(html).toContain('setTargetAtTime');
  });
});

describe('static preview script assembly', () => {
  it('does not fake missing DOM nodes, input handlers, or gameplay diagnostics', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<!doctype html><html><head></head><body><canvas id="game"></canvas><script src="game.js"></script></body></html>',
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

  it('heals truncation without corrupting single-statement control flow', () => {
    const broken = 'function boot() {\n  if (running) update();\n  while (alive) step();\n  const l = (b - a)t;';
    const healed = balanceAndCloseJs(broken);

    // Valid `) update()` / `) step()` bodies must never become `)*update()`.
    expect(healed).not.toContain('*update');
    expect(healed).not.toContain('*step');
    expect(healed).toContain('(b - a)*t');
    expect(() => new Function(healed)).not.toThrow();
  });

  it('never corrupts string or comment content while healing', () => {
    const broken = 'function boot() {\n  const s = "tap) start now";\n  const l = (b - a)t;';
    const healed = balanceAndCloseJs(broken);

    expect(healed).toContain('tap) start now');
    expect(healed).toContain('(b - a)*t');
  });

  it('returns a valid ES module untouched even though new Function cannot parse it', () => {
    const moduleCode = 'import { a } from "./a.js";\nexport function main() {\n  if (a) start();\n}\n';

    expect(balanceAndCloseJs(moduleCode)).toBe(moduleCode);
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

  it('injects the URL base shim so a relative new URL() cannot kill the game', () => {
    const html = '<html><head></head><body><canvas id="game"></canvas></body></html>';
    const once = normalizeStudioGameHtml(html);
    const embedded = new Function(`return (${normalizeServerPreviewHtml.toString()});`)() as (html: string) => string;

    expect(once).toContain('data-studio-url-shim');
    expect(ensurePreviewUrlShim(once)).toBe(once);
    expect(embedded(html)).toContain('data-studio-url-shim');

    /*
     * The emitted shim must be real JavaScript that resolves a base-less
     * relative URL instead of throwing "Failed to construct 'URL': Invalid
     * URL".
     */
    const script = /<script data-studio-url-shim>([\s\S]*?)<\/script>/.exec(once)?.[1];
    expect(script).toBeTruthy();

    const documentStub = {
      baseURI: 'https://bolt-di.pages.dev/',
      referrer: 'https://bolt-di.pages.dev/',
    };
    const locationStub = { href: 'https://bolt-di.pages.dev/' };
    const runShim = new Function('window', 'document', `${script}`) as (
      window: Record<string, unknown>,
      document: unknown,
    ) => void;

    const fakeWindow: Record<string, unknown> = { URL, location: locationStub };
    runShim(fakeWindow, documentStub);

    const ShimmedUrl = fakeWindow.URL as typeof URL;
    expect(new ShimmedUrl('assets/car.png').href).toBe('https://bolt-di.pages.dev/assets/car.png');
    expect(typeof ShimmedUrl.createObjectURL).toBe('function');
    expect(ShimmedUrl.prototype).toBe(URL.prototype);
  });

  it('removes duplicate local script inclusions that can redeclare top-level bindings', () => {
    const html =
      '<html><body><script src="src/core/clock.js"></script><script src="./src/core/clock.js?v=2"></script></body></html>';
    const normalized = normalizeStudioGameHtml(html);
    expect(normalized.match(/src="(?:\.\/)?src\/core\/clock\.js/g)).toHaveLength(1);

    const embedded = new Function(`return (${normalizeServerPreviewHtml.toString()});`)() as (html: string) => string;
    const serverHtml = embedded(html);
    expect(serverHtml.match(/src="(?:\.\/)?src\/core\/clock\.js/g)).toHaveLength(1);
  });

  it('deduplicates the same module after local script tags are inlined', () => {
    const html = buildFallbackHtml({
      'index.html': {
        type: 'file',
        content:
          '<html><body><script src="src/core/clock.js"></script><script src="./src/core/clock.js"></script></body></html>',
      },
      'src/core/clock.js': { type: 'file', content: 'function createFrameClock() { return 1; }' },
    });

    expect(html?.match(/data-inlined="src\/core\/clock\.js"/g)).toHaveLength(1);
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
    expect(html).toContain('bolt-game-watchdog');
    expect(html).toContain('__fortzWatchdogFired');
  });

  it('server-embedded normalizer parses as plain JS and matches publish parity', () => {
    /**
     * workbench.ts embeds this exact source into the WebContainer static
     * server, so it must contain no TypeScript syntax. Rebuild it here the
     * same way and prove it parses and behaves.
     */
    const embedded = new Function(`return (${normalizeServerPreviewHtml.toString()});`)() as (html: string) => string;

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
    expect(out).toContain('data-studio-watchdog');
    expect(out).toContain('__fortzWatchdogFired');
    expect(out).toContain('Preview watchdog: ');
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
        {
          path: 'src/input.js',
          content: 'import { clamp } from "./utils.js";\nexport function readInput() { return clamp(1); }',
        },
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

  it('leaves bare and absolute specifiers alone', () => {
    const html =
      '<html><head></head><body>' +
      '<script type="module" data-inlined="game.js">import * as THREE from "three";\nconst cdn = import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js");\nconsole.log(THREE, cdn);</script>' +
      '</body></html>';
    const out = inlineLocalModuleBlobImports(html, [{ path: 'game.js', content: 'import * as THREE from "three";' }]);

    expect(out).toContain('from "three"');
    expect(out).toContain('"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"');
    expect(out).not.toContain('blob:');
  });

  it('mints a self-naming stub for a relative import no project file matches', async () => {
    const { blobs, restore } = captureBlobs();

    try {
      const content = 'import { boot, launch } from "./missing.js";\nboot(launch);';
      const html =
        '<html><head></head><body><script type="module" data-inlined="game.js">' + content + '</script></body></html>';
      const out = inlineLocalModuleBlobImports(html, [{ path: 'game.js', content }]);

      /*
       * Never ship the raw specifier: it dies against the blob base with
       * "Invalid relative url or base scheme isn't hierarchical".
       */
      expect(out).not.toContain('"./missing.js"');
      expect(out).toContain('blob:');

      const texts = await Promise.all(blobs.map((b) => b.text()));

      expect(texts.some((t) => t.includes('Missing module: ') && t.includes('"missing.js"'))).toBe(true);
      expect(texts.some((t) => t.includes('export const boot = undefined;'))).toBe(true);
      expect(texts.some((t) => t.includes('export const launch = undefined;'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('rewrites side-effect imports, which no import pattern used to match', () => {
    const content = 'import "./polyfill.js";\nimport "./config.js";';
    const html =
      '<html><head></head><body><script type="module" data-inlined="src/main.js">' +
      content +
      '</script></body></html>';
    const out = inlineLocalModuleBlobImports(html, [
      { path: 'src/main.js', content },
      { path: 'src/polyfill.js', content: 'globalThis.__polyfilled = true;' },
      { path: 'src/config.js', content: 'globalThis.__config = { hard: true };' },
    ]);

    expect(out).not.toContain('"./polyfill.js"');
    expect(out).not.toContain('"./config.js"');
    expect(out.match(/import "blob:/g)?.length ?? 0).toBe(2);
  });

  it('rewrites relative imports in an AI-authored inline module script with no data-inlined path', () => {
    const html =
      '<html><head></head><body>' +
      '<script type="module">import { boot } from "./src/boot/launch.js";\nboot();</script>' +
      '</body></html>';
    const out = inlineLocalModuleBlobImports(html, [
      { path: 'src/boot/launch.js', content: 'export function boot() { return 1; }' },
    ]);

    expect(out).toContain('from "blob:');
    expect(out).not.toContain('./src/boot/launch.js');
  });

  it('rewrites dynamic imports inside classic scripts but never their strings', () => {
    const html =
      '<html><head></head><body>' +
      '<script>var note = "load ./lib.js later";\nvar lazy = function () { return import("./lib.js"); };</script>' +
      '</body></html>';
    const out = inlineLocalModuleBlobImports(html, [{ path: 'lib.js', content: 'export const value = 7;' }]);

    expect(out).toContain('import("blob:');
    expect(out).toContain('"load ./lib.js later"');
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

  it('auto-exports a binding the target declares but forgot to export', async () => {
    const { blobs, restore } = captureBlobs();

    try {
      const content = 'import { createRecords } from "./persistence/records.js";\ncreateRecords();';
      const html =
        '<html><head></head><body><script type="module" data-inlined="src/app.js">' +
        content +
        '</script></body></html>';
      const out = inlineLocalModuleBlobImports(html, [
        { path: 'src/app.js', content },
        { path: 'src/persistence/records.js', content: 'function createRecords() { return 1; }\n' },
      ]);

      // The importer keeps its plain import — no throwing stub in the way.
      expect(out).not.toContain('__fortz_missing');

      const texts = await Promise.all(blobs.map((b) => b.text()));
      expect(texts.some((t) => t.includes('export { createRecords }'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('auto-exports a default-exported declaration for a named importer', async () => {
    const { blobs, restore } = captureBlobs();

    try {
      const content = 'import { createProfile } from "./persistence/profile.js";\ncreateProfile();';
      const html =
        '<html><head></head><body><script type="module" data-inlined="src/main.js">' +
        content +
        '</script></body></html>';
      const out = inlineLocalModuleBlobImports(html, [
        { path: 'src/main.js', content },
        {
          path: 'src/persistence/profile.js',
          content: 'export default function createProfile(name) {\n  return { name, xp: 0 };\n}\n',
        },
      ]);

      expect(out).not.toContain('__fortz_missing');

      const texts = await Promise.all(blobs.map((b) => b.text()));
      expect(texts.some((t) => t.includes('export { createProfile }'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('still stubs names that are nowhere declared — without killing the game', () => {
    const { restore } = captureBlobs();

    try {
      const content = 'import { nope } from "./lib.js";\nnope();';
      const html =
        '<html><head></head><body><script type="module" data-inlined="app.js">' + content + '</script></body></html>';
      const out = inlineLocalModuleBlobImports(html, [
        { path: 'app.js', content },
        { path: 'lib.js', content: 'export const other = 1;' },
      ]);

      expect(out).toContain('__fortz_missing');
      expect(out).toContain('does not export it');

      // The stub reports once to the repair inbox instead of throwing.
      expect(out).toContain('thefortz-game-error');
      expect(out).not.toContain('throw new Error');
    } finally {
      restore();
    }
  });

  it('repairs destructured module-scope bindings', async () => {
    const { blobs, restore } = captureBlobs();

    try {
      const content = 'import { readRecord } from "./records.js";\nreadRecord();';
      const html =
        '<html><head></head><body><script type="module" data-inlined="app.js">' + content + '</script></body></html>';
      const out = inlineLocalModuleBlobImports(html, [
        { path: 'app.js', content },
        { path: 'records.js', content: 'const store = { readRecord() {} };\nconst { readRecord } = store;\n' },
      ]);

      expect(out).not.toContain('__fortz_missing');

      const texts = await Promise.all(blobs.map((b) => b.text()));
      expect(texts.some((t) => t.includes('export { readRecord }'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('leaves classic scripts untouched', () => {
    const html =
      '<html><head></head><body>' + '<script data-inlined="game.js">var x = "./input.js";</script>' + '</body></html>';
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
    expect(looksLikeEsm('const m = import.meta.url;')).toBe(true);
    expect(looksLikeEsm('await preloadAssets();\nstart();')).toBe(true);
    expect(looksLikeEsm('module.exports = { start };')).toBe(false);
    expect(looksLikeEsm('// import this later\nvar label = "press export to save";\nstart();')).toBe(false);
    expect(looksLikeEsm('')).toBe(false);
  });

  it('never splices an operator into ASI code while healing a truncated file', () => {
    const truncated = ['update()', 'scoreEl.textContent = score', 'const label = "unterminated'].join('\n');
    const healed = balanceAndCloseJs(truncated);

    /*
     * `update()\nscoreEl` is two valid statements; inserting `*` there turned
     * working code into an invalid assignment target.
     */
    expect(healed).not.toContain(')*');
    expect(healed).toContain('scoreEl.textContent = score');
  });

  it('ships a broken ES module verbatim instead of a truncated prefix', () => {
    const moduleCode = 'import { a } from "./a.js";\n\nexport const value = compute(a';

    /*
     * A module can never parse in `new Function` context; healing would pop
     * statements and ship a silent truncation.
     */
    expect(balanceAndCloseJs(moduleCode)).toBe(moduleCode);
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
    expect(html).toContain('__fortz_missing(');
    expect(html).toContain('"loadPreferences"');
    expect(html).toContain('function __fortz_missing');
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
    expect(html).not.toContain('__fortz_missing');
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
    expect(html).toContain('default: Engine = __fortz_missing(');
    expect(html).toContain('tick = __fortz_missing(');
  });
});

describe('auditGameModuleGraph', () => {
  it('reports a named import the target file never declares', () => {
    const findings = auditGameModuleGraph([
      { path: 'src/main.js', content: 'import { loadSettings } from "./systems/persistence.js";\nloadSettings();' },
      { path: 'src/systems/persistence.js', content: 'export const saveSettings = () => {};\n' },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('src/main.js');
    expect(findings[0].detail).toContain('"loadSettings" is missing from src/systems/persistence.js');
    expect(findings[0].detail).toContain('export function loadSettings');
  });

  it('reports an un-exported top-level declaration as a wiring bug', () => {
    const findings = auditGameModuleGraph([
      { path: 'src/main.js', content: 'import { loadSettings } from "./persistence.js";\nloadSettings();' },
      { path: 'src/persistence.js', content: 'function loadSettings() {\n  return { best: 0 };\n}\n' },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('without the export keyword');
  });

  it('reports a default-exported declaration that importers use by name', () => {
    const findings = auditGameModuleGraph([
      { path: 'src/main.js', content: 'import { loadSettings } from "./persistence.js";\nloadSettings();' },
      {
        path: 'src/persistence.js',
        content: 'export default function loadSettings() {\n  return { best: 0 };\n}\n',
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('without the export keyword');
  });

  it('passes a fully wired project', () => {
    const findings = auditGameModuleGraph([
      {
        path: 'src/main.js',
        content:
          'import { Engine } from "./engine.js";\nimport Game from "./game.js";\nimport * as THREE from "three";\nnew Engine(Game, THREE);',
      },
      { path: 'src/engine.js', content: 'export class Engine {\n  constructor() {}\n}\n' },
      { path: 'src/game.js', content: 'export default class Game {}\n' },
    ]);

    expect(findings).toEqual([]);
  });

  it('flags external packages but never three or URL imports', () => {
    const findings = auditGameModuleGraph([
      {
        path: 'src/main.js',
        content:
          'import { Account } from "appwrite";\nimport { Scene } from "three";\nimport { X } from "https://cdn.example.com/x.js";\nconsole.log(Account, Scene, X);',
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('external package "appwrite"');
    expect(findings[0].detail).not.toContain('three');
  });

  it('flags a default import from a file with no default export', () => {
    const findings = auditGameModuleGraph([
      { path: 'src/main.js', content: 'import Engine from "./engine.js";\nEngine.start();' },
      { path: 'src/engine.js', content: 'export class Engine {\n  start() {}\n}\n' },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('no default export');
  });
});

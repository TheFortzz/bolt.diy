import { describe, expect, it } from 'vitest';
import {
  auditImportStatements,
  probeHtmlInlineScripts,
  probeModuleSyntax,
  validateJavaScriptSyntax,
} from '~/lib/runtime/js-syntax';

describe('validateJavaScriptSyntax', () => {
  it('passes valid classic and module code', () => {
    expect(validateJavaScriptSyntax('const a = 1;\nfunction t() {\n  return a;\n}', 'game.js')).toBeUndefined();
    expect(validateJavaScriptSyntax('import { a } from "./a.js";\nexport const b = a;', 'game.js')).toBeUndefined();
  });

  it('reports a truncated file', () => {
    expect(validateJavaScriptSyntax('const s = "abc', 'game.js')).toContain('game.js');
  });
});

describe('auditImportStatements', () => {
  it('accepts well-formed single-line, multiline, and side-effect imports', () => {
    const code = [
      'import { a, b } from "./x.js";',
      'import {',
      '  c,',
      '  d,',
      '} from "./y.js";',
      'import * as THREE from "three";',
      'import "./side.js";',
      'export const e = a + b + c + d + THREE.REVISION;',
    ].join('\n');

    expect(auditImportStatements(code, 'game.js')).toBeUndefined();
  });

  it('reports the malformed import the ESM sanitizer would otherwise swallow', () => {
    /*
     * `import { a, b from "./x.js";` (missing brace) still matches the
     * lazy sanitize regex, so the parser probe alone false-passes it and
     * the browser later dies with "Invalid or unexpected token".
     */
    const broken = 'import { a, b from "./x.js";\nexport const c = a + b;';

    const error = auditImportStatements(broken, 'src/game.js');

    expect(error).toContain('src/game.js');
    expect(error).toContain('malformed import');
    expect(probeModuleSyntax(broken, 'src/game.js')).toContain('malformed import');
  });

  it('reports an import without a module specifier', () => {
    expect(auditImportStatements('import { a } from ;', 'f.js')).toContain('missing its module specifier');
  });

  it('stays quiet on non-import code', () => {
    expect(auditImportStatements('const importx = 1;\nconsole.log(importx);', 'f.js')).toBeUndefined();
  });
});

describe('probeHtmlInlineScripts', () => {
  it('reports a broken inline script, naming the file and script index', () => {
    const html = '<html><body><script>const broken = "abc</script></body></html>';
    const issue = probeHtmlInlineScripts(html, 'index.html');

    expect(issue).toContain('index.html inline script #1');
  });

  it('accepts valid inline module scripts and skips src and non-JS blocks', () => {
    const html = [
      '<html><head>',
      '<script type="module">import { boot } from "./game.js";\nboot();</script>',
      '<script src="vendor.js"></script>',
      '<script type="application/json">{"a": 1}</script>',
      '</head><body></body></html>',
    ].join('\n');

    expect(probeHtmlInlineScripts(html, 'index.html')).toBeUndefined();
  });
});

/*
 * Shared, dependency-free JavaScript syntax probing. Used by the build
 * validator (node --check's in-memory companion) and by the preview bundler
 * so both layers agree on what "broken" means.
 */

const ASYNC_FUNCTION = Object.getPrototypeOf(async () => {}).constructor;

/** Blank out comments and string/template literals so scans see real code. */
function stripJsLiterals(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\w$])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/**
 * Detect syntax that MUST execute as an ES module: import/export statements,
 * `import.meta`, and top-level await — ignoring strings and comments. A file
 * carrying any of them that ships as a classic `<script>` is a certain
 * SyntaxError and a dead game, so the preview bundler keys type="module" and
 * the strict-mode probe below off this one detector. Line-started await inside
 * an async function may mark a file as ESM; shipping such a file as a module
 * is semantics-preserving, so the false positive is harmless by design.
 */
export function looksLikeEsm(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false;
  }

  const stripped = stripJsLiterals(code);

  return (
    /^\s*import[\s('"{]|^\s*export[\s{*]/m.test(stripped) ||
    /^\s*(?:for\s+await\b|await\s)/m.test(stripped) ||
    /\bimport\.meta\b/.test(stripped)
  );
}

/**
 * Module files run in strict mode with HTML comments banned — sloppy
 * `new Function` (and node --check on CommonJS) happily accepts `with`, octal
 * literals, octal escapes, and `<!--`, so those passed every probe and then
 * died in the browser as an anonymous SyntaxError at a bare document line.
 * Re-probe with a strict prelude so the diagnostic names the file instead.
 *
 * `parseSource` lets the ESM branch strict-probe its import-stripped source
 * while detection and the HTML-comment scan still see the real file.
 */
function strictModuleIssue(code: string, fileName: string, parseSource: string = code): string | undefined {
  if (!looksLikeEsm(code)) {
    return undefined;
  }

  const parse = (prelude: string) => {
    try {
      new Function(prelude + parseSource);
    } catch {
      new ASYNC_FUNCTION(prelude + parseSource);
    }
  };

  try {
    parse('"use strict";\n');
  } catch (strictErr: unknown) {
    if (strictErr instanceof SyntaxError) {
      return `${fileName}: ${(strictErr as Error).message}`;
    }

    return undefined;
  }

  if (/^\s*(?:<!--|-->)/m.test(stripJsLiterals(code))) {
    return `${fileName}: HTML comments are not allowed in module scripts`;
  }

  return undefined;
}

export function validateJavaScriptSyntax(code: string, fileName: string): string | undefined {
  const cleanCode = code.replace(/^```(?:javascript|js|typescript|ts)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  try {
    new Function(cleanCode);
    return undefined;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      const msg = (err as Error).message || '';

      if (
        msg.includes('await is only valid in async functions') ||
        msg.includes('top level bodies of modules') ||
        cleanCode.includes('await ')
      ) {
        try {
          new ASYNC_FUNCTION(cleanCode);

          return strictModuleIssue(cleanCode, fileName);
        } catch (asyncErr: unknown) {
          if (asyncErr instanceof SyntaxError) {
            const asyncMsg = (asyncErr as Error).message || '';

            if (!asyncMsg.includes('import') && !asyncMsg.includes('export') && !asyncMsg.includes('import.meta')) {
              return `${fileName}: ${asyncMsg}`;
            }
          }
        }
      }

      if (
        msg.includes('Cannot use import statement') ||
        msg.includes("Unexpected token 'export'") ||
        msg.includes('export declarations may only appear') ||
        msg.includes('import declarations may only appear') ||
        msg.includes("Cannot use 'import.meta'") ||
        msg.includes('import.meta') ||
        cleanCode.includes('import ') ||
        cleanCode.includes('export ')
      ) {
        try {
          const sanitized = cleanCode
            .replace(/(?:^|\n)\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '\n// import')
            .replace(/(?:^|\n)\s*import\s+['"][^'"]+['"];?/g, '\n// import')
            .replace(/import\.meta/g, '({})')
            .replace(/^\s*export\s+default\s+/gm, 'const __export_default__ = ')
            .replace(/^\s*export\s+(?:async\s+)?function\b/gm, 'function')
            .replace(/^\s*export\s+(?:class|const|let|var)\b/gm, (m) => m.replace('export', ''))
            .replace(/^\s*export\s*\{[^}]*\}\s*;?/gm, '// export')
            .replace(/^\s*export\s+\*\s+from\s+['"][^'"]+['"];?/gm, '// export *');

          const parseSanitized = (prelude: string) => {
            try {
              new Function(prelude + sanitized);
            } catch {
              new ASYNC_FUNCTION(prelude + sanitized);
            }
          };

          /*
           * Throws to the outer catch (named with fileName) when neither the
           * plain nor the async parser accepts the sanitized source.
           */
          parseSanitized('');

          return strictModuleIssue(cleanCode, fileName, sanitized);
        } catch (innerErr: unknown) {
          if (innerErr instanceof SyntaxError) {
            return `${fileName}: ${(innerErr as Error).message}`;
          }

          return undefined;
        }
      }

      return `${fileName}: ${msg}`;
    }

    return undefined;
  }
}

/**
 * The ESM sanitizer inside validateJavaScriptSyntax strips import statements
 * with a lazy regex — a MALFORMED import like `import { a, b from "./x.js";`
 * still matches and gets swallowed, so the probe passes while the browser
 * dies with "Invalid or unexpected token". Audit each import statement's
 * structure (brace balance + module specifier) before the sanitize probe
 * ever runs, so that false-pass becomes a precise diagnostic.
 */
export function auditImportStatements(code: string, fileName: string): string | undefined {
  const lines = code.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Side-effect imports (`import "./x.js";`) have no braces to unbalance.
    if (!/^\s*import\b/.test(line) || /^\s*import\s*['"]/.test(line)) {
      i++;
      continue;
    }

    const chunk: string[] = [];
    let depth = 0;

    while (i < lines.length) {
      const current = lines[i];

      chunk.push(current);
      i++;

      for (const ch of current) {
        if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
        }
      }

      if (depth <= 0 && /["'];?\s*$/.test(current.trim())) {
        break;
      }
    }

    if (depth !== 0) {
      return `${fileName}: malformed import statement — unbalanced braces near "${chunk.join(' ').trim().slice(0, 120)}"`;
    }

    const joined = chunk.join(' ');

    if (!/['"][^'"]+['"]/.test(joined)) {
      return `${fileName}: import statement is missing its module specifier near "${joined.trim().slice(0, 120)}"`;
    }
  }

  return undefined;
}

/** Full in-memory probe: import structure first, then the ESM-aware parser probe. */
export function probeModuleSyntax(code: string, fileName: string): string | undefined {
  return auditImportStatements(code, fileName) ?? validateJavaScriptSyntax(code, fileName);
}

const INLINE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * Probe the inline <script> bodies inside an HTML file with the same module
 * auditor. Inline scripts ship into the preview completely raw, so a broken
 * one boots as an anonymous SyntaxError unless we name it here.
 */
export function probeHtmlInlineScripts(html: string, fileName: string): string | undefined {
  let match: RegExpExecArray | null;
  let index = 0;

  INLINE_SCRIPT_RE.lastIndex = 0;

  while ((match = INLINE_SCRIPT_RE.exec(html)) !== null) {
    const attrs = match[1] || '';
    const body = (match[2] || '').trim();

    if (!body || /\bsrc\s*=/i.test(attrs)) {
      continue;
    }

    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);

    // Only real JavaScript blocks: modules and classic scripts.
    if (typeMatch && !/(?:javascript|module)/i.test(typeMatch[1])) {
      continue;
    }

    index++;

    const issue = probeModuleSyntax(body, `${fileName} inline script #${index}`);

    if (issue) {
      return issue;
    }
  }

  return undefined;
}

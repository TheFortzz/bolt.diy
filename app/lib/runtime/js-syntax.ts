/*
 * Shared, dependency-free JavaScript syntax probing. Used by the build
 * validator (node --check's in-memory companion) and by the preview bundler
 * so both layers agree on what "broken" means.
 */

const ASYNC_FUNCTION = Object.getPrototypeOf(async () => {}).constructor;

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
          return undefined;
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

          try {
            new Function(sanitized);
            return undefined;
          } catch {
            new ASYNC_FUNCTION(sanitized);
            return undefined;
          }
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

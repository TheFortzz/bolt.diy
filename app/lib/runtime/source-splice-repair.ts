/**
 * Repair the quote-swallowing variant of the legacy mid-document splice bug in
 * imported game sources.
 *
 * Byte-offset splices performed by older bundler tools left fragments like:
 *
 *     x.fillText('#%@*+=x '[(r * 3 + k * 5) % 8], …);
 *       →  x.fillText('#%@*+=x
 *          </html>[(r * 3 + k * 5) % 8], …);
 *
 * where the string's closing quote was swallowed and a document stop tag was
 * inserted mid-statement. Such files can never parse (the Studio preview and
 * the publish gate both fail), so games carrying them are dead on arrival.
 *
 * The scanner walks the source with a string/template/comment/regex-aware
 * state machine and, whenever an unterminated plain string hits a newline
 * whose next line starts with a document stop tag, re-closes the string at
 * that point and deletes the fragment leader. Template literals are never
 * diagnosed — newlines are legal inside them and generated games commonly
 * store HTML documents there.
 */
export function repairUnterminatedStringSplices(code: string): { code: string; repaired: number } {
  if (!code) {
    return { code, repaired: 0 };
  }

  if (!code.includes('</html') && !code.includes('</body') && !code.includes('</head')) {
    return { code, repaired: 0 };
  }

  let repaired = 0;
  let out = '';
  const resume: Array<'code' | 'tpl'> = [];
  let mode: 'code' | 'str' | 'tpl' | 'line' | 'block' | 'regex' = 'code';
  let strQuote = '';
  let codeDepth = 0;
  let prevSig = '';
  let i = 0;
  const n = code.length;
  const wordRe = /[A-Za-z0-9_$]/;

  while (i < n) {
    const c = code[i];

    if (mode === 'code') {
      if (c === '/' && code[i + 1] === '/') {
        mode = 'line';
        out += c;
        i++;
        continue;
      }
      if (c === '/' && code[i + 1] === '*') {
        mode = 'block';
        out += c;
        i++;
        continue;
      }
      if (c === "'" || c === '"') {
        mode = 'str';
        strQuote = c;
        out += c;
        prevSig = c;
        i++;
        continue;
      }
      if (c === '`') {
        resume.push('code');
        mode = 'tpl';
        out += c;
        prevSig = '`';
        i++;
        continue;
      }
      if (c === '/' && '([{,;=:?!&|+-*%~^<>'.includes(prevSig)) {
        mode = 'regex';
        prevSig = '/';
        // The re-emit pass only runs when a splice was repaired, so every
        // branch here must append the character it consumes — dropping the
        // regex delimiters would corrupt every regex literal before the
        // splice point (e.g. `replace(/[^/]*$/, "")` losing its slashes).
        out += c;
        i++;
        continue;
      }
      if (c === '{') {
        codeDepth++;
        out += c;
        prevSig = c;
        i++;
        continue;
      }
      if (c === '}') {
        if (codeDepth > 0) {
          codeDepth--;
        } else if (resume.length && resume[resume.length - 1] === 'tpl') {
          resume.pop();
          mode = 'tpl';
        }
        out += c;
        prevSig = c;
        i++;
        continue;
      }
      if (wordRe.test(c)) {
        let j = i;
        while (j < n && wordRe.test(code[j])) {
          j++;
        }
        out += code.slice(i, j);
        prevSig = code[j - 1];
        i = j;
        continue;
      }
      out += c;
      prevSig = c;
      i++;
      continue;
    }

    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
        prevSig = '\n';
      }
      out += c;
      i++;
      continue;
    }

    if (mode === 'block') {
      if (c === '*' && code[i + 1] === '/') {
        mode = 'code';
        out += '*/';
        prevSig = '/';
        i += 2;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    if (mode === 'regex') {
      if (c === '\\') {
        out += code.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '[') {
        out += c;
        i++;
        while (i < n && code[i] !== ']') {
          if (code[i] === '\\') {
            out += code.slice(i, i + 2);
            i += 2;
          } else {
            out += code[i];
            i++;
          }
        }
        out += ']';
        i++;
        continue;
      }
      if (c === '/' || c === '\n') {
        mode = 'code';
        prevSig = '/';
        out += c;
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    if (mode === 'str') {
      if (c === '\\') {
        out += code.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '\n') {
        // Unterminated plain string at end of line — in valid source this can
        // never happen (plain strings cannot span lines), so confirm the
        // splice signature before repairing.
        let k = i + 1;
        while (k < n && (code[k] === ' ' || code[k] === '\t')) {
          k++;
        }
        const tagMatch = /^<\/(?:html|body|head)\b[^>\n]*>/.exec(code.slice(k, k + 128));
        if (tagMatch) {
          repaired++;
          // Re-close the swallowed string at the splice point; drop a stray CR
          // if the fragment's line ending left one inside the string.
          while (out.endsWith('\r') || out.endsWith('\n')) {
            out = out.slice(0, -1);
          }
          out += strQuote;
          mode = 'code';
          strQuote = '';
          prevSig = strQuote;
          i = k + tagMatch[0].length;
          continue;
        }
      }
      if (c === strQuote) {
        mode = 'code';
        strQuote = '';
        prevSig = c;
        out += c;
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    // mode === 'tpl'
    if (c === '\\') {
      out += code.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '$' && code[i + 1] === '{') {
      resume.push('tpl');
      mode = 'code';
      codeDepth = 0;
      prevSig = '{';
      out += '${';
      i += 2;
      continue;
    }
    if (c === '`') {
      mode = resume.pop() || 'code';
      prevSig = '`';
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
    continue;
  }

  if (!repaired) {
    return { code, repaired: 0 };
  }
  return { code: out, repaired };
}

/** Apply the splice repair to every inline <script> body in an HTML document. */
export function repairHtmlScriptBodies(html: string): { html: string; repaired: number } {
  if (!html) {
    return { html, repaired: 0 };
  }

  let total = 0;
  const out = html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (whole, open: string, body: string, close: string) => {
    if (!body || !/['"`]/.test(body)) {
      return whole;
    }
    const r = repairUnterminatedStringSplices(body);
    total += r.repaired;
    return r.repaired ? open + r.code + close : whole;
  });

  return { html: out, repaired: total };
}

/** Repair imported game text sources so corrupted zips land playable in Studio. */
export function repairImportedGameSource(path: string, text: string): string {
  if (!text || !text.includes('</html') && !text.includes('</body') && !text.includes('</head')) {
    return text;
  }

  if (/\.(?:mjs|jsx|tsx?|js)$/i.test(path)) {
    const r = repairUnterminatedStringSplices(text);
    if (r.repaired) {
      console.warn(`[import] repaired ${r.repaired} mid-document splice fragment(s) in ${path}`);
      return r.code;
    }
    return text;
  }

  if (/\.(?:html?|xhtml)$/i.test(path)) {
    const r = repairHtmlScriptBodies(text);
    if (r.repaired) {
      console.warn(`[import] repaired ${r.repaired} mid-document splice fragment(s) in ${path}`);
      return r.html;
    }
    return text;
  }

  return text;
}

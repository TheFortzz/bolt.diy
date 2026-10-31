import { cleanWorkDirRelativePath } from '~/utils/diff';
import { inlineGeneratedAssetUrls, type GeneratedAsset } from '~/lib/stores/generated-assets';
import { buildGeneratedAssetRuntimeScript } from '~/lib/runtime/generated-asset-runtime';
import { looksLikeEsm, probeHtmlInlineScripts, probeModuleSyntax } from '~/lib/runtime/js-syntax';

/*
 * Port ranges served by the Studio's own embedded static servers. The ranges
 * are baked into the server scripts: workbench.ts listens on 4173-4177 and
 * action-runner.ts on 4280-4284. Keep this helper in sync with both
 * templates — the preview UI prefers these ports over a stale leftover
 * dev-server from a previous project so an uploaded game always loads its
 * own files.
 */
const FORTZ_STATIC_PREVIEW_PORT_RANGES: Array<[number, number]> = [
  [4173, 4177],
  [4280, 4284],
];

export function isFortzStaticPreviewPort(port: number): boolean {
  return FORTZ_STATIC_PREVIEW_PORT_RANGES.some(([from, to]) => port >= from && port <= to);
}

/*
 * A literal "</script" inside emitted script content terminates the tag at
 * HTML level even when it sits inside a JS string — the browser then parses
 * a truncated script ("Invalid or unexpected token") that every JS-level
 * probe passes because the file is valid JavaScript on its own. "<\/script"
 * is a valid escape in every JS lexical context where the sequence can
 * legally occur (strings, template literals, comments; regex literals can
 * never contain a raw "</script" because the slash would close them), so
 * neutralize it at serialization time.
 */
function escapeInlineScriptContent(content: string): string {
  return content.replace(/<\/script/gi, '<\\/script');
}

/*
 * JSON embedded directly in a <script> block: escape "<" so a "</script>"
 * inside a diagnostic string can never terminate the reporter early.
 */
function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function insertBeforeBody(html: string, scripts: string) {
  if (!scripts) {
    return html;
  }

  const closingBody = html.toLowerCase().lastIndexOf('</body>');

  if (closingBody === -1) {
    return `${html}\n${scripts}`;
  }

  return `${html.slice(0, closingBody)}\n${scripts}\n${html.slice(closingBody)}`;
}

export type StaticPreviewFile = { path: string; content: string };

/** Resolve local HTML/CSS/JS references without guessing between duplicate basenames. */
export function resolveStaticPreviewFile(files: StaticPreviewFile[], reference: string) {
  const refPath = reference.split(/[?#]/, 1)[0];
  const clean = cleanWorkDirRelativePath(refPath);

  if (!clean || clean.split('/').some((segment) => segment === '..' || segment === '.')) {
    return undefined;
  }

  const exact = files.find((file) => file.path === clean);

  if (exact) {
    return exact;
  }

  const suffixMatches = files.filter((file) => file.path.endsWith(`/${clean}`));

  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

/**
 * Lenient twin used ONLY by the fallback HTML builder (never by validation,
 * which must keep reporting the strict truth). When `src/style.css` names a
 * file that actually lives at `style.css` (or vice versa), an exact match
 * fails and the file would be silently dropped. If exactly one project file
 * shares the basename, that is the intended target — use it.
 */
export function resolveStaticPreviewFileLoose(files: StaticPreviewFile[], reference: string) {
  const exact = resolveStaticPreviewFile(files, reference);

  if (exact) {
    return exact;
  }

  const refPath = reference.split(/[?#]/, 1)[0];
  const base = cleanWorkDirRelativePath(refPath).split('/').pop() || '';

  if (!base || base === '.' || base === '..') {
    return undefined;
  }

  const matches = files.filter((file) => {
    const name = file.path.split('/').pop() || '';

    return name.toLowerCase() === base.toLowerCase();
  });

  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Words that legitimately follow a `)` in valid code (`if (x) return;`,
 * `while (c) break;` …). Healing `) ident` into `)*ident` for these would
 * turn valid code into "Invalid or unexpected token".
 */
const CONTROL_WORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'with', 'do']);

function repairMissingOperators(src: string): string {
  const reservedWords = new Set([
    'instanceof',
    'in',
    'as',
    'typeof',
    'void',
    'delete',
    'yield',
    'await',
    'return',
    'else',
    'do',
    'case',
    'default',
    'throw',
    'break',
    'continue',
    'new',
    'of',
  ]);

  /** Does the `)` at closeIndex close an if/while/for/switch/catch condition? */
  const closesControlParen = (closeIndex: number): boolean => {
    let depth = 0;

    for (let i = closeIndex; i >= 0; i--) {
      const ch = src[i];

      if (ch === ')') {
        depth++;
      } else if (ch === '(') {
        depth--;

        if (depth === 0) {
          const before = src.slice(0, i).match(/([A-Za-z_$][\w$]*)\s*$/);

          return Boolean(before && CONTROL_WORDS.has(before[1]));
        }
      }
    }

    return false;
  };

  /*
   * Only same-line whitespace can be a missing operator: `) ident` with a
   * newline between is Automatic Semicolon Insertion — `update()\nscoreEl.x = 1`
   * is two valid statements, and inserting `*` there corrupts working code
   * into an invalid assignment target (the "Invalid or unexpected token"
   * preview death). Cross-line matches are left verbatim.
   */
  let patched = src.replace(/\)([ \t]*)([a-zA-Z_$][a-zA-Z0-9_$]*)/g, (match, space, ident, offset: number) => {
    if (reservedWords.has(ident)) {
      return match;
    }

    /*
     * `if (x) update();` / `while (c) tick();` — valid single-statement
     * bodies, NOT missing multiplication. Leave them untouched.
     */
    if (closesControlParen(offset)) {
      return match;
    }

    /*
     * What follows the identifier decides: a call `) fn(`, an assignment
     * `) x = …`, a quote, or arithmetic `) x + 1` are all valid
     * continuations — only a genuine expression tail like `(b-a)t;` is a
     * missing operator.
     */
    const after = src.slice(offset + match.length).match(/^\s*([A-Za-z_$(='"`]|\+|-|\*|\/)/);
    const next = after?.[1] || '';

    if (next) {
      return match;
    }

    return `)*${space}${ident}`;
  });

  patched = patched.replace(/(\b\d+)(\s*\()/g, '$1*$2');

  return patched;
}

/**
 * Gracefully balance and close unclosed brackets, braces, and parentheses if a JavaScript file
 * was cut off mid-expression or mid-function, preventing syntax errors in the sandboxed preview.
 */
export function balanceAndCloseJs(code: string): string {
  if (!code || typeof code !== 'string') {
    return code;
  }

  /*
   * Module files (import/export at line start) can NEVER be healed by this
   * function: `new Function` parses them in sloppy function-body context,
   * where every `import` is a hard SyntaxError — so the structural loop
   * below would either return the file untouched (imports at top) or,
   * worse, ship a silently TRUNCATED prefix when plain statements precede
   * the first import. Modules are validated by probeModuleSyntax instead;
   * ship their source verbatim.
   */
  if (looksLikeEsm(code)) {
    return code;
  }

  try {
    new Function(code);
    return code;
  } catch {
    // Attempt healing
  }

  const repaired = repairMissingOperators(code);

  try {
    new Function(repaired);
    return repaired;
  } catch {
    // Continue with structural healing
  }

  const lines = repaired.split('\n');

  while (lines.length > 0) {
    const candidate = lines.join('\n');
    let openBraces = 0;
    let openParens = 0;
    let openBrackets = 0;
    let inString: string | null = null;
    let escape = false;

    for (let i = 0; i < candidate.length; i++) {
      const char = candidate[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (inString) {
        if (char === inString) {
          inString = null;
        }

        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = char;
        continue;
      }

      if (char === '{') {
        openBraces++;
      } else if (char === '}') {
        openBraces = Math.max(0, openBraces - 1);
      } else if (char === '(') {
        openParens++;
      } else if (char === ')') {
        openParens = Math.max(0, openParens - 1);
      } else if (char === '[') {
        openBrackets++;
      } else if (char === ']') {
        openBrackets = Math.max(0, openBrackets - 1);
      }
    }

    let patch = '';

    if (inString) {
      patch += inString;
    }

    if (openBrackets > 0) {
      patch += ']'.repeat(openBrackets);
    }

    if (openParens > 0) {
      patch += ')'.repeat(openParens);
    }

    patch += ';';

    if (openBraces > 0) {
      patch += '\n' + '}'.repeat(openBraces);
    }

    try {
      new Function(candidate + patch);
      return candidate + patch;
    } catch {
      lines.pop();
    }
  }

  return code;
}

/** Keep injected helpers before all document scripts and append an unlinked entry last. */
export function injectStaticScripts(html: string, dependencies: string[], entries: string[]) {
  let result = html;

  if (dependencies.length) {
    const block = dependencies.join('\n');
    const firstScript = /<script\b/i.exec(result);

    if (firstScript?.index !== undefined) {
      result = `${result.slice(0, firstScript.index)}\n${block}\n${result.slice(firstScript.index)}`;
    } else {
      result = insertBeforeBody(result, block);
    }
  }

  return insertBeforeBody(result, entries.join('\n'));
}

export const mathUtilsScript = `<script id="bolt-game-math-utils">
(function() {
  var g = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);

  if (typeof g.vecLength === 'undefined') {
    g.vecLength = function(v, y) {
      if (typeof v === 'number') return Math.hypot(v, y || 0);
      if (!v) return 0;
      return Math.hypot(v.x || 0, v.y || 0, v.z || 0);
    };
  }
  if (typeof g.vecLen === 'undefined') g.vecLen = g.vecLength;
  if (typeof g.magnitude === 'undefined') g.magnitude = g.vecLength;

  if (typeof g.vecNormalize === 'undefined') {
    g.vecNormalize = function(v) {
      var len = g.vecLength(v);
      if (len === 0) return { x: 0, y: 0 };
      return { x: (v.x || 0) / len, y: (v.y || 0) / len };
    };
  }
  if (typeof g.normalize === 'undefined') g.normalize = g.vecNormalize;

  if (typeof g.clamp === 'undefined') {
    g.clamp = function(val, min, max) { return Math.max(min, Math.min(max, val)); };
  }
  if (typeof g.lerp === 'undefined') {
    g.lerp = function(a, b, t) { return a + (b - a) * t; };
  }
  if (typeof g.dist === 'undefined') {
    g.dist = function(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); };
  }
  if (typeof g.distance === 'undefined') g.distance = g.dist;

  if (typeof g.vecDot === 'undefined') {
    g.vecDot = function(a, b) { return (a.x || 0) * (b.x || 0) + (a.y || 0) * (b.y || 0); };
  }
  if (typeof g.dot === 'undefined') g.dot = g.vecDot;

  if (typeof g.randomRange === 'undefined') {
    g.randomRange = function(min, max) { return Math.random() * (max - min) + min; };
  }
  if (typeof g.rand === 'undefined') g.rand = g.randomRange;

  if (typeof g.degToRad === 'undefined') {
    g.degToRad = function(deg) { return deg * Math.PI / 180; };
  }
  if (typeof g.radToDeg === 'undefined') {
    g.radToDeg = function(rad) { return rad * 180 / Math.PI; };
  }

  if (typeof g.vecAdd === 'undefined') {
    g.vecAdd = function(a, b) { return { x: (a.x || 0) + (b.x || 0), y: (a.y || 0) + (b.y || 0) }; };
  }
  if (typeof g.vecSub === 'undefined') {
    g.vecSub = function(a, b) { return { x: (a.x || 0) - (b.x || 0), y: (a.y || 0) - (b.y || 0) }; };
  }
  if (typeof g.vecScale === 'undefined') {
    g.vecScale = function(a, s) { return { x: (a.x || 0) * s, y: (a.y || 0) * s }; };
  }
  if (typeof g.vecMult === 'undefined') g.vecMult = g.vecScale;

  // Safe fallback class stubs to prevent cross-file ReferenceError crashes
  if (typeof g.ParticleSystem === 'undefined') {
    g.ParticleSystem = class ParticleSystem {
      constructor() { this.particles = []; }
      emit() {}
      update() {}
      draw() {}
      render() {}
      clear() {}
      reset() {}
    };
  }
  if (typeof g.ParticleEmitter === 'undefined') {
    g.ParticleEmitter = g.ParticleSystem;
  }
  if (typeof g.AudioController === 'undefined') {
    g.AudioController = class AudioController {
      constructor() { this.muted = false; }
      play() {}
      playEngine() {}
      stopEngine() {}
      playCrash() {}
      playPickup() {}
      playDrift() {}
      playShoot() {}
      playExplosion() {}
      playVictory() {}
    };
  }
  if (typeof g.SoundController === 'undefined') {
    g.SoundController = g.AudioController;
  }
  // Polyfill roundRect on CanvasRenderingContext2D to prevent crashes in drawing code
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h) {
      if (typeof this.rect === 'function') {
        this.rect(x, y, w, h);
      }
      return this;
    };
  }

  // Guard setPointerCapture and releasePointerCapture to prevent synthetic pointer crashes
  if (typeof Element !== 'undefined') {
    if (Element.prototype.setPointerCapture) {
      var origSetPointerCapture = Element.prototype.setPointerCapture;
      Element.prototype.setPointerCapture = function(id) {
        try {
          return origSetPointerCapture.call(this, id);
        } catch(e) {}
      };
    }
    if (Element.prototype.releasePointerCapture) {
      var origReleasePointerCapture = Element.prototype.releasePointerCapture;
      Element.prototype.releasePointerCapture = function(id) {
        try {
          return origReleasePointerCapture.call(this, id);
        } catch(e) {}
      };
    }
  }

  // Resilient WebAudio mock to prevent audio crashes / autoplay errors
  try {
    var MockAudioCtx = class {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
        this.state = 'running';
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 440, setValueAtTime: function() {} },
          connect: function() {},
          start: function() {},
          stop: function() {},
        };
      }
      createGain() {
        return {
          gain: {
            value: 1,
            setValueAtTime: function() {},
            linearRampToValueAtTime: function() {},
            exponentialRampToValueAtTime: function() {},
          },
          connect: function() {},
        };
      }
      close() { return Promise.resolve(); }
      resume() { return Promise.resolve(); }
      suspend() { return Promise.resolve(); }
    };
    if (typeof g.AudioContext === 'undefined') g.AudioContext = MockAudioCtx;
    if (typeof g.webkitAudioContext === 'undefined') g.webkitAudioContext = MockAudioCtx;

    // Guard native OscillatorNode.prototype.type against syntax corruption or invalid enum assignment
    var safeTypes = new Set(['sine', 'square', 'sawtooth', 'triangle']);
    if (typeof OscillatorNode !== 'undefined' && OscillatorNode.prototype) {
      var origTypeDescriptor = Object.getOwnPropertyDescriptor(OscillatorNode.prototype, 'type');
      if (origTypeDescriptor && origTypeDescriptor.set) {
        Object.defineProperty(OscillatorNode.prototype, 'type', {
          get: function() { return origTypeDescriptor.get ? origTypeDescriptor.get.call(this) : 'sine'; },
          set: function(val) {
            try {
              if (typeof val === 'string' && safeTypes.has(val.trim().toLowerCase())) {
                origTypeDescriptor.set.call(this, val.trim().toLowerCase());
              } else {
                origTypeDescriptor.set.call(this, 'sine');
              }
            } catch(e) {}
          },
          configurable: true,
          enumerable: true,
        });
      }
    }
  } catch(e) {}

  /*
   * WebAudio scheduling methods throw a hard TypeError on a non-finite value
   * ("Failed to execute 'setTargetAtTime' on 'AudioParam': The provided float
   * value is non-finite"), and games routinely feed them a NaN speed/volume
   * from an uninitialised runtime value. Left alone, that single throw kills
   * the render loop every frame and the whole game looks broken. Coerce every
   * value, clamp invalid ramps, and above all never throw.
   */
  try {
    if (typeof AudioParam !== 'undefined' && AudioParam.prototype) {
      var finiteOr = function(value, fallback) {
        var number = typeof value === 'number' ? value : Number(value);
        return isFinite(number) ? number : fallback;
      };
      var safeTime = function(value) { return Math.max(0, finiteOr(value, 0)); };
      var guardParam = function(name, positiveOnly) {
        var native = AudioParam.prototype[name];
        if (typeof native !== 'function') return;
        AudioParam.prototype[name] = function(value, startTime) {
          var safeValue = finiteOr(value, 0);
          if (positiveOnly && safeValue <= 0) safeValue = 0.0001;
          try {
            return native.call(this, safeValue, safeTime(startTime));
          } catch (e) {
            return undefined;
          }
        };
      };
      guardParam('setValueAtTime', false);
      guardParam('linearRampToValueAtTime', false);
      guardParam('exponentialRampToValueAtTime', true);

      var nativeSetTarget = AudioParam.prototype.setTargetAtTime;
      if (typeof nativeSetTarget === 'function') {
        AudioParam.prototype.setTargetAtTime = function(target, startTime, timeConstant) {
          var constant = finiteOr(timeConstant, 0.02);
          try {
            return nativeSetTarget.call(this, finiteOr(target, 0), safeTime(startTime), constant > 0 ? constant : 0.02);
          } catch (e) {
            return undefined;
          }
        };
      }

      var nativeCurve = AudioParam.prototype.setValueCurveAtTime;
      if (typeof nativeCurve === 'function') {
        AudioParam.prototype.setValueCurveAtTime = function(values, startTime, duration) {
          var length = finiteOr(duration, 0);
          if (length <= 0) return undefined;
          try {
            return nativeCurve.call(this, values, safeTime(startTime), length);
          } catch (e) {
            return undefined;
          }
        };
      }

      var valueDescriptor = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
      if (valueDescriptor && valueDescriptor.set) {
        Object.defineProperty(AudioParam.prototype, 'value', {
          get: function() { return valueDescriptor.get.call(this); },
          set: function(value) { valueDescriptor.set.call(this, finiteOr(value, 0)); },
          configurable: true,
          enumerable: true,
        });
      }
    }
  } catch(e) {}

  // Do not fabricate diagnostics or missing DOM nodes; validation must exercise the actual game.
})();
</script>`;

const focusHelper = `<script id="bolt-game-focus-helper">
(function() {
  function focusGame() {
    try {
      window.focus();
      const canvas = document.querySelector('canvas');
      if (canvas) {
        if (!canvas.hasAttribute('tabindex')) {
          canvas.setAttribute('tabindex', '0');
        }
        canvas.focus();
      }
    } catch (e) {}
  }
  focusGame();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', focusGame);
  }
  window.addEventListener('load', focusGame);
  window.addEventListener('mouseenter', focusGame);
  window.addEventListener('pointerdown', focusGame, { passive: true });
})();
</script>`;

const errorOverlayScript = `<script id="bolt-game-error-overlay">
(function() {
  function handleErr(msg, err) {
    try {
      console.error('[Game Runtime Error]', msg, err);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'thefortz-game-error', message: String(msg) }, '*');
      }
      var existing = document.getElementById('bolt-error-toast');
      if (!existing && document.body) {
        var el = document.createElement('div');
        el.id = 'bolt-error-toast';
        el.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:9999999;background:rgba(185,28,28,0.96);color:#fff;padding:12px 16px;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,0.5);font-family:monospace;font-size:12px;line-height:1.4;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid #f87171;';
        el.innerHTML = '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;"><strong>⚠️ Game Error:</strong> ' + String(msg).replace(/</g, '&lt;') + '</div><button onclick="this.parentElement.remove()" style="background:#dc2626;color:white;border:none;padding:3px 8px;cursor:pointer;border-radius:2px;font-weight:bold;">Dismiss</button>';
        document.body.appendChild(el);
      }
    } catch(e) {}
  }
  window.addEventListener('error', function(e) { handleErr(e.message, e.error); });
  window.addEventListener('unhandledrejection', function(e) { handleErr(e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled Promise Rejection', e.reason); });
})();
</script>`;

/**
 * Studio preview parity with the published build.
 *
 * The published game goes through a normalization pipeline (Puter.js strip,
 * unpkg three.js rewrite, import map, storage shim, audio unlock). The Studio
 * fallback preview used to skip all of that, so games looked broken in the
 * Studio (dead buttons, no start, silent errors) while the published copy on
 * thefortz.me worked fine. These helpers apply the same normalization to the
 * fallback HTML so both run identically.
 */

/** Strip Puter.js: its SDK opens sockets/headers the sandbox blocks, which can break game init. */
export function stripBlockedSdkScripts(html: string): string {
  let out = html || '';

  out = out.replace(/<script\b[^>]*src=["']https?:\/\/js\.puter\.com[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*src=["']https?:\/\/js\.puter\.com[^"']*["'][^>]*\/?>/gi, '');
  out = out.replace(/<script\b[^>]*>[\s\S]*?puter\.quiet[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*>[\s\S]*?window\.puter[\s\S]*?<\/script>/gi, '');

  return out;
}

/** Rewrite unpkg three.js refs to jsDelivr so sandboxed/credentialless iframes never block them. */
export function rewriteUnpkgThreeToJsdelivr(html: string): string {
  return (html || '').replace(/(https?:)?\/\/unpkg\.com\/three/g, 'https://cdn.jsdelivr.net/npm/three');
}

const PINNED_THREE_MODULE = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const PINNED_THREE_ADDONS = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/';

/**
 * Inject a pinned three.js import map when a module script uses bare `three`
 * imports but the document declares no import map. Without it the module
 * graph fails and no click handler ever gets wired.
 */
export function ensureThreeImportMap(html: string): string {
  if (!html || html.includes('data-studio-three-importmap')) {
    return html;
  }

  const needsThree =
    /(?:from\s+|import\s*\(\s*|import\s+)["']three(?:\/[^"']*)?["']/i.test(html) ||
    /<script\b[^>]*\btype\s*=\s*["']?module\b/i.test(html);

  if (!needsThree) {
    return html;
  }

  const mergedImports: Record<string, string> = {};
  const mergedScopes: Record<string, Record<string, string>> = {};
  const importMapTag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let existingMap = false;
  let match: RegExpExecArray | null;

  while ((match = importMapTag.exec(html))) {
    if (!/\btype\s*=\s*(["']?)importmap\1(?:\s|$)/i.test(match[1])) continue;
    existingMap = true;
    try {
      const parsed = JSON.parse(match[2]) as {
        imports?: Record<string, string>;
        scopes?: Record<string, Record<string, string>>;
      };
      Object.assign(mergedImports, parsed.imports || {});
      for (const [scope, imports] of Object.entries(parsed.scopes || {})) {
        mergedScopes[scope] = { ...(mergedScopes[scope] || {}), ...imports };
      }
    } catch {
      // Drop invalid maps below rather than leave the browser with a broken map.
    }
  }

  // Pin three over stale mappings, while preserving unrelated game entries.
  mergedImports.three = PINNED_THREE_MODULE;
  mergedImports['three/addons/'] = PINNED_THREE_ADDONS;
  const mapJson: { imports: Record<string, string>; scopes?: Record<string, Record<string, string>> } = {
    imports: mergedImports,
  };
  if (Object.keys(mergedScopes).length) mapJson.scopes = mergedScopes;
  const importMap = `<script type="importmap" data-studio-three-importmap>\n${JSON.stringify(mapJson)}\n</script>`;
  const withoutExistingMaps = existingMap
    ? html.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (tag, attributes: string) =>
        /\btype\s*=\s*(["']?)importmap\1(?:\s|$)/i.test(attributes) ? '' : tag,
      )
    : html;

  if (/<head[\s>]/i.test(withoutExistingMaps)) {
    return withoutExistingMaps.replace(/<head[\s>]/i, (m) => `${m}\n${importMap}`);
  }

  return `${importMap}\n${withoutExistingMaps}`;
}

const storageShimScript = `<script data-studio-storage-shim>(function(){function m(){var s={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(s,k)?s[k]:null;},setItem:function(k,v){s[k]=String(v);},removeItem:function(k){delete s[k];},clear:function(){s={};},key:function(i){return Object.keys(s)[i]||null;},get length(){return Object.keys(s).length;}};}var ls=m();var ss=m();function patch(prop,store){try{var cur=window[prop];if(cur&&typeof cur.getItem==="function"){cur.getItem("__probe__");return;}}catch(_){}var targets=[(typeof Window!=="undefined"?Window.prototype:null)];try{if(window&&Object.getPrototypeOf(window))targets.push(Object.getPrototypeOf(window));}catch(_){}if(window)targets.push(window);for(var i=0;i<targets.length;i++){var t=targets[i];if(!t)continue;try{Object.defineProperty(t,prop,{get:function(){return store;},set:function(){},configurable:true,enumerable:true});}catch(e1){try{t[prop]=store;}catch(e2){}}}}patch("localStorage",ls);patch("sessionStorage",ss);})();</script>`;

/**
 * Safe in-memory storage fallback so games calling localStorage keep working
 * when the fallback document runs on an opaque origin (srcdoc without
 * allow-same-origin) instead of throwing SecurityError mid-init.
 */
export function ensurePreviewStorageShim(html: string): string {
  if (!html || html.includes('data-studio-storage-shim')) {
    return html;
  }

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head[\s>]/i, (m) => `${m}${storageShimScript}`);
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html[\s>]/i, (m) => `${m}<head>${storageShimScript}</head>`);
  }

  return storageShimScript + html;
}

const audioUnlockScript = `<script data-studio-autostart>
(function() {
  if (window.__studioAutostartInjected) return;
  window.__studioAutostartInjected = true;

  // Audio unlock helper for browser autoplay policies
  function resumeAudio() {
    try {
      var ctxs = [window.audio, window.audioCtx, window.actx, window.AC, window.__audioCtx];
      ctxs.forEach(function(ac) {
        if (ac && typeof ac.resume === 'function' && ac.state === 'suspended') {
          ac.resume();
        }
      });
    } catch(e) {}
  }

  ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'].forEach(function(ev) {
    window.addEventListener(ev, resumeAudio, { passive: true, once: true });
  });

  // Handle player mute / start messages cleanly without simulating synthetic keys or clicks
  window.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.type === 'FORTZ_AUDIO_MUTE') {
      try {
        var shouldMute = !!e.data.muted;
        var ctxs = [window.audio, window.audioCtx, window.actx, window.AC, window.__audioCtx];
        ctxs.forEach(function(ac) {
          if (ac && typeof ac.suspend === 'function' && shouldMute && ac.state === 'running') {
            ac.suspend();
          } else if (ac && typeof ac.resume === 'function' && !shouldMute && ac.state === 'suspended') {
            ac.resume();
          }
        });
        var audioEls = document.querySelectorAll('audio, video');
        audioEls.forEach(function(el) {
          el.muted = shouldMute;
        });
      } catch(_) {}
    } else if (e.data.type === 'FORTZ_MINI_START' || e.data.type === 'FORTZ_START_GAME') {
      resumeAudio();
      try {
        if (typeof window.startGame === 'function') window.startGame();
      } catch(_) {}
    }
  });
})();
</script>`;

/**
 * Unlock WebAudio on the first real user gesture and honor the player start /
 * mute messages — the same helper the published build receives, so audio and
 * start overlays behave identically in the Studio preview.
 */
export function ensurePreviewAudioUnlock(html: string): string {
  if (!html || html.includes('data-studio-autostart')) {
    return html;
  }

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head[\s>]/i, (m) => `${m}\n${audioUnlockScript}`);
  }

  if (/<body[\s>]/i.test(html)) {
    return html.replace(/<body[\s>]/i, (m) => `${m}\n${audioUnlockScript}`);
  }

  return `${audioUnlockScript}\n${html}`;
}

/**
 * Relative `new URL("assets/x.png")` (no base) throws "Failed to construct
 * 'URL': Invalid URL", and a blob:/srcdoc preview document has no hierarchical
 * base URL to resolve against. Generated games commonly do exactly this in
 * their asset loader, which kills the whole game on boot. Wrap the URL
 * constructor with a base fallback so the call always returns a usable URL and
 * the game can fall back to its procedural shape instead of dying.
 */
const urlShimScript = `<script data-studio-url-shim>(function(){if(window.__studioUrlShim)return;window.__studioUrlShim=true;var NativeURL=window.URL;if(!NativeURL)return;function baseUrl(){var candidates=[];try{candidates.push(document.baseURI);}catch(e){}try{candidates.push(window.location&&window.location.href);}catch(e){}try{candidates.push(document.referrer);}catch(e){}for(var i=0;i<candidates.length;i++){var v=candidates[i];if(typeof v==="string"&&/^[a-z][a-z0-9+.-]*:\\/\\//i.test(v))return v;}return "https://studio.preview.local/";}function StudioURL(url,base){if(arguments.length<2||base===undefined||base===null||base===""){base=baseUrl();}return new NativeURL(url,base);}StudioURL.prototype=NativeURL.prototype;try{StudioURL.createObjectURL=function(blob){return NativeURL.createObjectURL(blob);};}catch(e){}try{StudioURL.revokeObjectURL=function(url){return NativeURL.revokeObjectURL(url);};}catch(e){}try{StudioURL.canParse=function(url,base){if(typeof NativeURL.canParse!=="function")return true;return NativeURL.canParse(url,base===undefined?baseUrl():base);};}catch(e){}try{StudioURL.parse=function(url,base){var b=base===undefined?baseUrl():base;return typeof NativeURL.parse==="function"?NativeURL.parse(url,b):new NativeURL(url,b);};}catch(e){}try{window.URL=StudioURL;}catch(e){}})();</script>`;

export function ensurePreviewUrlShim(html: string): string {
  if (!html || html.includes('data-studio-url-shim')) {
    return html;
  }

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head[\s>]/i, (m) => `${m}\n${urlShimScript}`);
  }

  if (/<body[\s>]/i.test(html)) {
    return html.replace(/<body[\s>]/i, (m) => `${m}\n${urlShimScript}`);
  }

  return `${urlShimScript}\n${html}`;
}

function dedupeScriptSources(html: string): string {
  const seen = new Set<string>();

  return html.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (tag, attributes: string) => {
    const source = /\b(?:src|data-inlined)\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2];
    if (!source) return tag;

    const key = source
      .replace(/&amp;/g, '&')
      .split(/[?#]/, 1)[0]
      .replace(/\\/g, '/')
      .replace(/^(?:\.\/|\/)+/, '')
      .toLowerCase();
    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      return tag;
    }

    return '<!-- duplicate script source omitted -->';
  });
}

/** Run the full publish-parity normalization over Studio fallback HTML. */
export function normalizeStudioGameHtml(html: string): string {
  let out = dedupeScriptSources(html || '');

  out = stripBlockedSdkScripts(out);
  out = rewriteUnpkgThreeToJsdelivr(out);
  out = ensureThreeImportMap(out);
  out = ensurePreviewStorageShim(out);
  out = ensurePreviewUrlShim(out);
  out = ensurePreviewAudioUnlock(out);

  return out;
}

/*
 * Blob URLs minted for inlined local ES modules, oldest generations first.
 * Revoked lazily so the on-screen preview and the last-good standby preview
 * never lose their modules mid-stream.
 */
const moduleBlobGenerations: string[][] = [];

function trackModuleBlobGeneration(urls: string[]) {
  if (urls.length) {
    moduleBlobGenerations.push(urls);
  }

  while (moduleBlobGenerations.length > 2) {
    const stale = moduleBlobGenerations.shift();

    if (stale) {
      for (const url of stale) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* already revoked */
        }
      }
    }
  }
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Detect ES-module syntax in source, ignoring strings and comments. The
 * detector lives in js-syntax.ts so the syntax probes (strict-mode checks for
 * module files) and the preview bundler (type="module" assignment) can never
 * disagree about which files run as modules; re-exported here for callers
 * that have historically imported it from the bundler.
 */
export { looksLikeEsm };

/**
 * Rewrite relative ES-module imports inside inlined module scripts to blob:
 * URLs minted from the actual project files. Separate inline
 * `<script type="module">` blocks cannot resolve `./x.js` against each other
 * inside a blob:/srcdoc iframe ("base scheme isn't hierarchical"), which kills
 * every multi-file module game. Blob URLs preserve real module semantics
 * (named/default/namespace imports, cycles via live bindings) with no
 * bundler. Bare specifiers ('three', CDN URLs) are left for the import map.
 */
/**
 * Everything the module system knows how to extract from a JS file: explicit
 * named exports (declarations and `export { … }` lists), whether a default
 * export exists, and whether any star re-export swallows the rest.
 */
function collectModuleExportNames(content: string): { names: Set<string>; hasDefault: boolean; wildcard: boolean } {
  const names = new Set<string>();
  const decl = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;

  while ((m = decl.exec(content)) !== null) {
    names.add(m[1]);
  }

  const list = /export\s*\{([^}]*)\}/g;

  while ((m = list.exec(content)) !== null) {
    for (const item of m[1].split(',')) {
      const parts = item.trim().split(/\s+as\s+/);
      const exportedName = (parts[1] || parts[0] || '').trim();

      if (/^[A-Za-z_$][\w$]*$/.test(exportedName)) {
        names.add(exportedName);
      }
    }
  }

  return { names, hasDefault: /export\s+default\b/.test(content), wildcard: /export\s*\*/.test(content) };
}

/**
 * Does the file declare `name` as a real module-scope binding (so
 * `export { name };` would be valid for it)? Column-0 keyword declarations
 * (`function x`, `const x`, `export default function x`…) and column-0
 * destructures (`const { a, x } = …`) qualify — the same patterns the blob
 * bundler auto-repairs, so audits and repairs can never disagree.
 */
function declaresModuleScopeBinding(content: string, name: string): boolean {
  const escaped = name.replace(/[$]/g, '\\$&');

  const keywordDecl = new RegExp(
    `^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${escaped}\\b`,
    'm',
  );

  /*
   * Module-scope destructure: `const { a, x } = …` / `const [x] = …` —
   * a real binding that `export { x }` is valid for.
   */
  const destructureDecl = new RegExp(
    `^(?:export\\s+)?(?:const|let|var)\\s+[\\[{][^;\\n]*\\b${escaped}\\b[^;\\n]*[\\]}][^;\\n]*=`,
    'm',
  );

  return keywordDecl.test(content) || destructureDecl.test(content);
}

export type ModuleGraphFinding = { file: string; detail: string };

/**
 * Static module-wiring audit. Every named/default import must resolve to a
 * project file that actually exports the symbol at top level, and local
 * scripts must not depend on external packages the browser cannot resolve.
 *
 * This catches the whole "import parses, game boots, then crashes on
 * undefined" family BEFORE the preview watchdog ever fires, and hands the
 * repair loop a surgical file+symbol diagnostic instead of a raw
 * TypeError from somewhere deep in the game loop.
 */
export function auditGameModuleGraph(files: StaticPreviewFile[]): ModuleGraphFinding[] {
  const findings: ModuleGraphFinding[] = [];
  const jsFiles = files.filter((file) => /\.(?:m?js|jsx)$/.test(file.path) && Boolean(file.content));

  const exportCache = new Map<string, { names: Set<string>; hasDefault: boolean; wildcard: boolean }>();

  const exportsOf = (path: string) => {
    let hit = exportCache.get(path);

    if (!hit) {
      hit = collectModuleExportNames(jsFiles.find((entry) => entry.path === path)?.content || '');
      exportCache.set(path, hit);
    }

    return hit;
  };

  for (const file of jsFiles) {
    const importRe = /\bimport\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}\s*from\s*(["'])([^"']+)\3/g;
    const defaultImportRe = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])([^"']+)\2/g;
    const problems: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = importRe.exec(file.content)) !== null) {
      const list = m[2];
      const spec = m[4];
      const cleanSpec = spec.split(/[?#]/, 1)[0];

      // Known CDN-backed library resolved through the preview import map.
      if (!cleanSpec.startsWith('.') && /^(?:three(?:\/|$)|https?:\/\/)/i.test(cleanSpec)) {
        continue;
      }

      const target = resolveStaticPreviewFileLoose(files, cleanSpec);

      if (!target) {
        problems.push(
          cleanSpec.startsWith('.')
            ? `imports "${spec}" but no project file matches that path`
            : `imports external package "${spec}" — no project file matches; games must run fully offline`,
        );

        continue;
      }

      const exported = exportsOf(target.path);

      if (exported.wildcard) {
        continue;
      }

      for (const item of list.split(',')) {
        const name = (item.trim().split(/\s+as\s+/)[0] || '').trim();

        if (!/^[A-Za-z_$][\w$]*$/.test(name) || name === 'default' || exported.names.has(name)) {
          continue;
        }

        problems.push(
          declaresModuleScopeBinding(target.content, name)
            ? `"${name}" is declared in ${target.path} without the export keyword — add a top-level \`export\` so every importer (and the published game) can use it`
            : `"${name}" is missing from ${target.path} — the file does not export it; declare it as \`export function ${name}(…)\` / \`export const ${name} = …\` at top level`,
        );
      }
    }

    while ((m = defaultImportRe.exec(file.content)) !== null) {
      const local = m[1];
      const spec = m[3];
      const cleanSpec = spec.split(/[?#]/, 1)[0];

      if (!cleanSpec.startsWith('.') || /^(?:three(?:\/|$)|https?:\/\/)/i.test(cleanSpec)) {
        continue;
      }

      const target = resolveStaticPreviewFileLoose(files, cleanSpec);

      if (!target || exportsOf(target.path).wildcard || exportsOf(target.path).hasDefault) {
        continue;
      }

      problems.push(
        `default-imports "${local}" from ${target.path}, but that file has no default export — use its named exports or add \`export default\``,
      );
    }

    if (problems.length > 0) {
      findings.push({ file: file.path, detail: problems.join('; ') });
    }
  }

  return findings;
}

export function inlineLocalModuleBlobImports(html: string, sourceFiles: StaticPreviewFile[]): string {
  if (!html || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return html;
  }

  const generation: string[] = [];
  const blobCache = new Map<string, string>();
  const inProgress = new Set<string>();

  /**
   * Normalize a relative specifier against its importer to a workdir-relative
   * key, with NO existence check. Missing-file stubs key off this so two
   * importers naming the same absent path share one stub module.
   */
  const joinRef = (importerPath: string, spec: string): string | undefined => {
    const cleanSpec = spec.split(/[?#]/, 1)[0];

    if (!cleanSpec.startsWith('.')) {
      return undefined;
    }

    const base = importerPath.includes('/') ? importerPath.slice(0, importerPath.lastIndexOf('/') + 1) : '';

    const parts: string[] = [];

    for (const seg of `${base}${cleanSpec}`.split('/')) {
      if (seg === '' || seg === '.') {
        continue;
      }

      if (seg === '..') {
        parts.pop();
      } else {
        parts.push(seg);
      }
    }

    return parts.join('/') || undefined;
  };

  const resolveRef = (importerPath: string, spec: string): string | undefined => {
    const cleanSpec = spec.split(/[?#]/, 1)[0];

    if (!cleanSpec.startsWith('.')) {
      const hit = resolveStaticPreviewFile(sourceFiles, cleanSpec);
      return hit?.path;
    }

    const key = joinRef(importerPath, spec);

    if (!key) {
      return undefined;
    }

    const hit = resolveStaticPreviewFile(sourceFiles, key);

    return hit?.path;
  };

  /*
   * Missing-file stubs. A relative specifier that names no project file — a
   * future-phase file during a phased build, or an import for a file the model
   * never wrote — used to ship raw and die against the blob base with "Invalid
   * relative url or base scheme isn't hierarchical", killing the whole module
   * graph with an error that names nothing. Importers are pre-scanned so each
   * absent path gets ONE stub module that reports the exact path to the
   * console and the repair inbox at evaluation time and exports exactly the
   * names the graph expects.
   */
  const missingModuleImports = new Map<string, { names: Set<string>; hasDefault: boolean }>();
  const stubBlobUrls = new Map<string, string>();

  const noteMissingModuleImport = (importerPath: string, spec: string, clause: string) => {
    if (!spec.startsWith('.') || resolveRef(importerPath, spec)) {
      return;
    }

    const key = joinRef(importerPath, spec);

    if (!key) {
      return;
    }

    const info = missingModuleImports.get(key) || { names: new Set<string>(), hasDefault: false };

    const brace = clause.match(/\{([^}]*)\}/);

    if (brace) {
      for (const item of brace[1].split(',')) {
        const prop = (item.trim().split(/\s+as\s+/)[0] || '').trim();

        if (prop === 'default') {
          info.hasDefault = true;
        } else if (/^[A-Za-z_$][\w$]*$/.test(prop)) {
          info.names.add(prop);
        }
      }
    }

    if (/^\s*[A-Za-z_$][\w$]*\s*(?:,|$)/.test(clause)) {
      info.hasDefault = true;
    }

    missingModuleImports.set(key, info);
  };

  /**
   * Scan one importer's source for relative import statements and record what
   * each UNRESOLVABLE specifier expects. The clause alternation only matches
   * real import-clause shapes, so scanning never walks from a side-effect
   * import into the next statement's `from`.
   */
  const IMPORT_STMT_RE =
    /\bimport\s+(?:([A-Za-z_$][\w$]*\s*,\s*\{[^}]*\}|[A-Za-z_$][\w$]*|\*\s+as\s+[A-Za-z_$][\w$]*|\{[^}]*\})\s+from\s+)?(["'])(\.[^"']+)\2/g;
  const EXPORT_FROM_RE = /\bexport\s+(?:\*|\{([^}]*)\})\s+from\s+(["'])(\.[^"']+)\3/g;
  const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(["'])(\.[^"']+)\1\s*\)/g;

  const collectMissingModuleImports = (importerPath: string, code: string) => {
    let match: RegExpExecArray | null;

    IMPORT_STMT_RE.lastIndex = 0;

    while ((match = IMPORT_STMT_RE.exec(code)) !== null) {
      noteMissingModuleImport(importerPath, match[3], match[1] || '');
    }

    EXPORT_FROM_RE.lastIndex = 0;

    while ((match = EXPORT_FROM_RE.exec(code)) !== null) {
      // `export * from` declares no names the stub must reproduce.
      const clause = match[1] === undefined ? '' : `{${match[1]}}`;

      noteMissingModuleImport(importerPath, match[3], clause);
    }

    DYNAMIC_IMPORT_RE.lastIndex = 0;

    while ((match = DYNAMIC_IMPORT_RE.exec(code)) !== null) {
      noteMissingModuleImport(importerPath, match[2], '');
    }
  };

  /**
   * Mint (once per path) the stub module for a relative specifier that names
   * no project file. Bare and absolute specifiers stay untouched — the import
   * map or a CDN may still resolve them — and a resolvable target with no URL
   * yet (an in-progress cycle) keeps its raw specifier, exactly as before.
   */
  const stubUrlFor = (importerPath: string, spec: string): string | undefined => {
    if (!spec.startsWith('.')) {
      return undefined;
    }

    const key = joinRef(importerPath, spec);

    if (!key) {
      return undefined;
    }

    const cached = stubBlobUrls.get(key);

    if (cached) {
      return cached;
    }

    const info = missingModuleImports.get(key) || { names: new Set<string>(), hasDefault: false };
    const pathLiteral = JSON.stringify(key);
    const ownerLiteral = JSON.stringify(importerPath);
    const lines = [
      `const __path = ${pathLiteral};`,
      `function __report() {` +
        ` const msg = 'Missing module: ' + __path + ' (imported by ' + ${ownerLiteral} + ' - no project file matches this path)';` +
        ` try { console.error('[Fortz preview] ' + msg); } catch (e) {}` +
        ` try { window.parent.postMessage({ type: 'thefortz-game-error', message: msg }, '*'); } catch (e) {} }`,
      '__report();',
    ];

    if (info.hasDefault) {
      lines.push('export default undefined;');
    }

    for (const name of info.names) {
      lines.push(`export const ${name} = undefined;`);
    }

    try {
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/javascript;charset=utf-8' }));

      generation.push(url);
      stubBlobUrls.set(key, url);

      return url;
    } catch {
      return undefined;
    }
  };

  const getBlobUrl = (normPath: string): string | undefined => {
    const cached = blobCache.get(normPath);

    if (cached) {
      return cached;
    }

    if (inProgress.has(normPath)) {
      return undefined;
    }

    const entry = sourceFiles.find((file) => file.path === normPath);

    if (!entry) {
      return undefined;
    }

    inProgress.add(normPath);

    let code =
      entry.path.endsWith('.js') || entry.path.endsWith('.mjs') ? balanceAndCloseJs(entry.content) : entry.content;

    code = rewriteRelativeImports(normPath, code);
    code = softenBlobImports(code, urlToPath());

    /*
     * Append planned export repairs so the plain import survives: the target
     * declared the binding but forgot `export`.
     */
    const repairs = exportRepairs.get(normPath);

    if (repairs && repairs.size > 0) {
      code += `\nexport { ${Array.from(repairs).join(', ')} };`;
    }

    inProgress.delete(normPath);

    try {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript;charset=utf-8' }));
      generation.push(url);
      blobCache.set(normPath, url);

      return url;
    } catch {
      return undefined;
    }
  };

  /**
   * Rewrite one relative specifier to its blob URL, minting a reporting stub
   * when no project file matches (see stubUrlFor). Undefined means "keep the
   * raw specifier": bare/absolute specs, or a resolvable target that has no
   * URL yet (an in-progress cycle).
   */
  const specifierBlobUrl = (importerPath: string, spec: string): string | undefined => {
    const dep = resolveRef(importerPath, spec);

    return dep ? getBlobUrl(dep) : stubUrlFor(importerPath, spec);
  };

  const rewriteDynamicImports = (importerPath: string, code: string): string =>
    code.replace(/\bimport\s*\(\s*(["'])(\.[^"']+)\1\s*\)/g, (match, quote: string, spec: string) => {
      const url = specifierBlobUrl(importerPath, spec);

      return url ? `import(${quote}${url}${quote})` : match;
    });

  const rewriteRelativeImports = (importerPath: string, code: string): string => {
    const rewriteStatic = code.replace(/\bfrom\s*(["'])(\.[^"']+)\1/g, (match, quote: string, spec: string) => {
      const url = specifierBlobUrl(importerPath, spec);

      return url ? `from ${quote}${url}${quote}` : match;
    });

    /*
     * Side-effect imports (`import "./polyfill.js";`) carry no `from` and no
     * parentheses — neither historical pattern matched them, so even an
     * EXISTING file shipped with its raw specifier and died at load with
     * "Invalid relative url or base scheme isn't hierarchical".
     */
    const withSideEffect = rewriteStatic.replace(
      /(\bimport\s*)(["'])(\.[^"']+)\2/g,
      (match, kw: string, quote: string, spec: string) => {
        const url = specifierBlobUrl(importerPath, spec);

        return url ? `${kw}${quote}${url}${quote}` : match;
      },
    );

    return rewriteDynamicImports(importerPath, withSideEffect);
  };

  const urlToPath = (): Map<string, string> => {
    const map = new Map<string, string>();

    for (const [path, url] of blobCache) {
      map.set(url, path);
    }

    return map;
  };

  const collectExportedNames = (content: string): { names: Set<string>; hasDefault: boolean; wildcard: boolean } =>
    collectModuleExportNames(content);

  /*
   * Auto-repair: when a module DECLARES a binding at top level but forgets the
   * `export` keyword, every importer of that name would die at parse time (or
   * hit our throwing stub). Plan those repairs up front — before any blob is
   * created — so the target module gets `export { name };` appended and the
   * game runs instead of showing a diagnostic.
   *
   * Only column-0 declarations are trusted (`^` with the m flag matches the
   * raw line start): exporting an inner-scope binding is a module syntax
   * error that would break the whole graph, and top-level code sits at
   * column 0 in normal formatting.
   */
  const exportRepairs = new Map<string, Set<string>>();
  let exportRepairsPlanned = false;

  const planExportRepairs = () => {
    if (exportRepairsPlanned) {
      return;
    }

    exportRepairsPlanned = true;

    for (const file of sourceFiles) {
      if (!/\.(?:m?js|jsx)$/.test(file.path)) {
        continue;
      }

      const importRe = /\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*(["'])([^"']+)\2/g;
      let m: RegExpExecArray | null;

      while ((m = importRe.exec(file.content)) !== null) {
        const list = m[1];
        const spec = m[3];
        const dep = resolveRef(file.path, spec);

        if (!dep || dep === file.path) {
          continue;
        }

        const target = sourceFiles.find((entry) => entry.path === dep);

        if (!target) {
          continue;
        }

        const exported = collectExportedNames(target.content);

        if (exported.wildcard) {
          continue;
        }

        for (const item of list.split(',')) {
          const parts = item.trim().split(/\s+as\s+/);
          const prop = (parts[0] || '').trim();

          if (!/^[A-Za-z_$][\w$]*$/.test(prop) || prop === 'default' || exported.names.has(prop)) {
            continue;
          }

          if (!declaresModuleScopeBinding(target.content, prop)) {
            continue;
          }

          const set = exportRepairs.get(dep) || new Set<string>();

          set.add(prop);
          exportRepairs.set(dep, set);
        }
      }
    }
  };

  const parseNamedList = (list: string): Array<{ prop: string; local: string }> => {
    const parsed: Array<{ prop: string; local: string }> = [];

    for (const item of list.split(',')) {
      const parts = item.trim().split(/\s+as\s+/);
      const prop = (parts[0] || '').trim();
      const local = (parts[1] || prop).trim();

      if (/^[A-Za-z_$][\w$]*$/.test(prop) && /^[A-Za-z_$][\w$]*$/.test(local)) {
        parsed.push({ prop, local });
      }
    }

    return parsed;
  };

  let nsCounter = 0;

  const softenOneImport = (
    defName: string | null,
    list: string,
    quote: string,
    url: string,
    reverse: Map<string, string>,
  ): string | null => {
    const normPath = reverse.get(url);

    if (!normPath) {
      return null;
    }

    const entry = sourceFiles.find((file) => file.path === normPath);

    if (!entry) {
      return null;
    }

    const exported = collectExportedNames(entry.content);
    const named = parseNamedList(list);
    const repairs = exportRepairs.get(normPath);
    const missingDefault = Boolean(defName) && !exported.hasDefault;
    const missingNamed = exported.wildcard
      ? []
      : named.filter((n) => !exported.names.has(n.prop) && !repairs?.has(n.prop));

    if (!missingDefault && missingNamed.length === 0) {
      return null;
    }

    nsCounter += 1;

    const ns = `__fortz_ns_${nsCounter}`;
    const decls: string[] = [];

    if (defName) {
      decls.push(`default: ${defName} = __fortz_missing(${JSON.stringify(normPath)}, "default")`);
    }

    for (const n of named) {
      const stub = `__fortz_missing(${JSON.stringify(normPath)}, ${JSON.stringify(n.prop)})`;

      decls.push(n.prop === n.local ? `${n.local} = ${stub}` : `${n.prop}: ${n.local} = ${stub}`);
    }

    return `import * as ${ns} from ${quote}${url}${quote};\nconst { ${decls.join(', ')} } = ${ns};`;
  };

  /*
   * A single missing export name aborts the ENTIRE module graph at parse time
   * ("does not provide an export named 'x'") and kills the game before it
   * boots. Soften only the broken statements into namespace imports whose
   * defaults throw a diagnostic naming the missing export and file: the game
   * boots, working systems run, and the repair loop gets an actionable error
   * instead of a cryptic "x is not a function".
   */
  const softenBlobImports = (code: string, reverse: Map<string, string>): string => {
    const softenedBefore = nsCounter;

    const combined = code.replace(
      /\bimport\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}\s*from\s*(["'])(blob:[^"']+)\3/g,
      (match, defName: string, list: string, quote: string, url: string) => {
        return softenOneImport(defName, list, quote, url, reverse) ?? match;
      },
    );

    const namedOnly = combined.replace(
      /\bimport\s*\{([^}]*)\}\s*from\s*(["'])(blob:[^"']+)\2/g,
      (match, list: string, quote: string, url: string) => {
        return softenOneImport(null, list, quote, url, reverse) ?? match;
      },
    );

    const result = namedOnly.replace(
      /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])(blob:[^"']+)\2/g,
      (match, defName: string, quote: string, url: string) => {
        return softenOneImport(defName, '', quote, url, reverse) ?? match;
      },
    );

    /*
     * Non-fatal diagnostic stub: report the missing export ONCE (console +
     * repair inbox) and return undefined so the game keeps running instead
     * of dying on a black screen. The repair loop still gets the exact
     * file/name to fix on the next attempt.
     */
    if (nsCounter > softenedBefore && !result.includes('function __fortz_missing')) {
      return (
        'function __fortz_missing(file, name) {\n' +
        '  var reported = false;\n' +
        '  return function () {\n' +
        '    if (!reported) {\n' +
        '      reported = true;\n' +
        '      var msg = "[Fortz preview] \\"" + name + "\\" is missing from " + file + " — the file does not export it; declare it at top level as export function " + name + "(…) or export const " + name + " = … in that file;\n' +
        '      try { console.error(msg); } catch (e) {}\n' +
        '      try { window.parent.postMessage({ type: "thefortz-game-error", message: msg }, "*"); } catch (e) {}\n' +
        '    }\n' +
        '    return undefined;\n' +
        '  };\n' +
        '}\n' +
        result
      );
    }

    return result;
  };

  planExportRepairs();

  /*
   * Pre-scan every importer — project files and inline script bodies — for
   * relative imports that name no project file, so each missing-path stub
   * exports exactly the names the graph expects before any blob is minted.
   */
  for (const file of sourceFiles) {
    if (/\.(?:m?js|jsx)$/.test(file.path)) {
      collectMissingModuleImports(file.path, file.content);
    }
  }

  html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs: string, content: string) => {
    const attrText = String(attrs || '');

    if (/\bsrc\s*=/i.test(attrText)) {
      return tag;
    }

    const typeAttr = attrText.match(/\btype\s*=\s*["']([^"']+)["']/i);

    if (typeAttr && !/(?:javascript|module)/i.test(typeAttr[1])) {
      return tag;
    }

    const inlined = attrText.match(/data-inlined\s*=\s*["']([^"']+)["']/i);
    const importerPath = inlined ? cleanWorkDirRelativePath(unescapeAttr(inlined[1])) : 'index.html';

    collectMissingModuleImports(importerPath, content);

    return tag;
  });

  const out = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs: string, content: string) => {
    const attrText = String(attrs || '');

    if (/\bsrc\s*=/i.test(attrText)) {
      return tag;
    }

    const typeAttr = attrText.match(/\btype\s*=\s*["']([^"']+)["']/i);

    if (typeAttr && !/(?:javascript|module)/i.test(typeAttr[1])) {
      return tag;
    }

    if (!/\b(?:from\s*["']\.|import\s*["']\.|import\s*\(\s*["']\.)/.test(content)) {
      return tag;
    }

    const isModule = /type\s*=\s*["']module["']/i.test(attrText);
    const inlined = attrText.match(/data-inlined\s*=\s*["']([^"']+)["']/i);

    /*
     * AI-authored inline module scripts carry no data-inlined path: they
     * execute from the document itself, so their relative specifiers resolve
     * against the root (index.html). Rewriting only data-inlined blocks left
     * `import "./src/boot/launch.js"` in the doc raw — the exact "Invalid
     * relative url or base scheme isn't hierarchical" boot-killer.
     */
    const importerPath = inlined ? cleanWorkDirRelativePath(unescapeAttr(inlined[1])) : 'index.html';

    /*
     * Classic scripts cannot hold static imports; only dynamic import(...) is
     * legal there, so only that gets rewritten — touching `from "./x"` text in
     * a string or comment would corrupt working code.
     */
    const rewritten = isModule
      ? softenBlobImports(rewriteRelativeImports(importerPath, content), urlToPath())
      : rewriteDynamicImports(importerPath, content);

    if (rewritten === content) {
      return tag;
    }

    return `<script${attrText}>${rewritten}</script>`;
  });

  trackModuleBlobGeneration(generation);

  return out;
}

/**
 * Publish-parity normalization for HTML served by the Studio static preview
 * server (WebContainer). This MUST stay a single self-contained plain-JS
 * function expression: no type annotations, no outer references, no imports.
 * workbench.ts embeds this exact source into the container's static server,
 * and static-preview.spec.ts executes the embedded source to prove it parses
 * as plain JavaScript and behaves identically. Keep in sync with
 * normalizeStudioGameHtml above.
 */
export type StaticPreviewModuleHint = { path: string; source: string };

/*
 * Plain-JS source text interpolated verbatim into the embedded static-server
 * scripts (workbench.ts and action-runner.ts). It walks the module scripts an
 * HTML file references (plus their small relative-import closure) so the
 * injected import map covers bare specifiers that only exist in external
 * module files. Bounded: no huge bundles, no node_modules. String.raw keeps
 * regex backslashes intact after template cooking.
 */
export const staticPreviewModuleHintsHelperSource: string = String.raw`function fortzCollectModuleHints(htmlSrc, servedFile) {
  var hints = [];
  var seen = {};
  var maxFiles = 60;
  var maxFileBytes = 1200000;

  function relKey(full) {
    try {
      return path.relative(baseDir, full).split(path.sep).join('/');
    } catch (e) {
      return full;
    }
  }

  function readHint(full, depth) {
    if (hints.length >= maxFiles || depth > 3) return;
    var key = relKey(full);
    if (!key || seen[key] || key.indexOf('node_modules') !== -1) return;
    seen[key] = 1;
    var text;
    try {
      if (fs.statSync(full).size > maxFileBytes) return;
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      return;
    }
    hints.push({ path: key, source: text.slice(0, 400000) });
    var importRe = /from\s*["'](\.[^"']+)["']|import\s*["'](\.[^"']+)["']|import\s*\(\s*["'](\.[^"']+)["']/g;
    var match;
    while ((match = importRe.exec(text)) && hints.length < maxFiles) {
      var spec = (match[1] || match[2] || match[3]).split('?')[0].split('#')[0];
      if (!spec) continue;
      var target = path.resolve(path.dirname(full), spec);
      var candidates = [target, target + '.js', target + '.mjs', path.join(target, 'index.js'), path.join(target, 'index.mjs')];
      for (var i = 0; i < candidates.length; i++) {
        try {
          if (fs.existsSync(candidates[i]) && fs.statSync(candidates[i]).isFile()) {
            readHint(candidates[i], depth + 1);
            break;
          }
        } catch (e) {}
      }
    }
  }

  var srcRe = /<script\b([^>]*)>/gi;
  var entry;
  while ((entry = srcRe.exec(htmlSrc || '')) && hints.length < maxFiles) {
    var attributes = entry[1] || '';
    var typeMatch = /\btype\s*=\s*(["'])(.*?)\1|\btype\s*=\s*([^\s>]+)/i.exec(attributes);
    var srcMatch = /\bsrc\s*=\s*(["'])(.*?)\1|\bsrc\s*=\s*([^\s>]+)/i.exec(attributes);
    if (!typeMatch || String(typeMatch[2] || typeMatch[3] || '').toLowerCase() !== 'module' || !srcMatch) continue;
    var spec = (srcMatch[2] || srcMatch[3] || '').split('?')[0].split('#')[0];
    if (!spec) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(spec)) continue;
    var target = spec.charAt(0) === '/' ? path.resolve(baseDir, spec.slice(1)) : path.resolve(path.dirname(servedFile), spec);
    var candidates = [target, target + '.js', target + '.mjs', path.join(target, 'index.js'), path.join(target, 'index.mjs')];
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (fs.existsSync(candidates[i]) && fs.statSync(candidates[i]).isFile()) {
          readHint(candidates[i], 0);
          break;
        }
      } catch (e) {}
    }
  }

  return hints;
}

/*
 * Bundler-style CSS imports (import "./style.css") are normal in Vite/webpack
 * projects but illegal in a raw browser module graph: the stylesheet comes back
 * as text/css and the browser aborts the ENTIRE entry module with a strict
 * MIME-type error, so the game never boots. Stylesheets still load through the
 * document's own <link> tags; dropping the module-side imports is safe.
 */
function fortzStripCssModuleImports(source) {
  if (!source || typeof source !== 'string') return source;
  if (source.indexOf('.css') === -1 && source.indexOf('.scss') === -1 && source.indexOf('.sass') === -1 && source.indexOf('.less') === -1 && source.indexOf('.styl') === -1 && source.indexOf('.pcss') === -1) {
    return source;
  }
  var dynamicImportRe = /\bimport\s*\(\s*(["'])[^"']*\.(?:css|scss|sass|less|styl(?:us)?|pcss|postcss)(?:\?[^"')]*)?\1\s*\)/gi;
  var namedImportRe = /\bimport\s+(?:[\w$]+\s*,\s*)?(?:\{[^{}]*\}|\*\s*as\s*[\w$]+|[\w$]+)\s*from\s*(["'])[^"']*\.(?:css|scss|sass|less|styl(?:us)?|pcss|postcss)(?:\?[^"')]*)?\1[ \t]*;?/gi;
  var sideEffectImportRe = /\bimport\s*(["'])[^"']*\.(?:css|scss|sass|less|styl(?:us)?|pcss|postcss)(?:\?[^"')]*)?\1[ \t]*;?/gi;
  return source.replace(dynamicImportRe, 'Promise.resolve()').replace(namedImportRe, '').replace(sideEffectImportRe, '');
}`;

/**
 * The function source is embedded verbatim into the runtime static-server
 * scripts (workbench.ts/action templates stringify it), so keep the body
 * plain JavaScript: no backticks, no ${…}, no parameter annotations.
 */
export const normalizeServerPreviewHtml: (html: string, moduleHints?: Array<StaticPreviewModuleHint>) => string =
  function (html, moduleHints) {
    let out = typeof html === 'string' ? html : '';
  const seenScriptSources = new Set<string>();
  out = out.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (tag, attributes) => {
    const source = /\b(?:src|data-inlined)\s*=\s*(["'])(.*?)\1/i.exec(attributes);
    if (!source) return tag;
    const key = source[2]
      .replace(/&amp;/g, '&')
      .split(/[?#]/, 1)[0]
      .replace(/\\/g, '/')
      .replace(/^(?:\.\/|\/)+/, '')
      .toLowerCase();
    if (!key || !seenScriptSources.has(key)) {
      if (key) seenScriptSources.add(key);
      return tag;
    }
    return '<!-- duplicate script source omitted -->';
  });

  // 1. Strip Puter.js: sandbox-blocked sockets/headers break game init.
  out = out.replace(/<script\b[^>]*src=["']https?:\/\/js\.puter\.com[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*src=["']https?:\/\/js\.puter\.com[^"']*["'][^>]*\/?>/gi, '');
  out = out.replace(/<script\b[^>]*>[\s\S]*?puter\.quiet[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*>[\s\S]*?window\.puter[\s\S]*?<\/script>/gi, '');

  // 2. Rewrite unpkg three.js refs to pinned jsDelivr.
  out = out.replace(/(https?:)?\/\/unpkg\.com\/three/g, 'https://cdn.jsdelivr.net/npm/three');

  // 2b. Drop bundler-only CSS module imports. A raw browser fetches the
  // stylesheet as text/css and aborts the whole module graph on the strict
  // MIME check, so inline modules must not keep `import "./style.css"`.
  if (out.indexOf('.css') !== -1 || out.indexOf('.scss') !== -1 || out.indexOf('.sass') !== -1 || out.indexOf('.less') !== -1 || out.indexOf('.styl') !== -1 || out.indexOf('.pcss') !== -1) {
    out = out
      .replace(/\bimport\s*\(\s*(["'])[^"']*\.(?:css|scss|sass|less|styl(?:us)?|pcss|postcss)(?:\?[^"')]*)?\1\s*\)/gi, 'Promise.resolve()')
      .replace(/\bimport\s+(?:[\w$]+\s*,\s*)?(?:\{[^{}]*\}|\*\s*as\s*[\w$]+|[\w$]+)\s*from\s*(["'])[^"']*\.(?:css|scss|sass|less|styl(?:us)?|pcss|postcss)(?:\?[^"')]*)?\1[ \t]*;?/gi, '')
      .replace(/\bimport\s*(["'])[^"']*\.(?:css|scss|sass|less|styl(?:us)?|pcss|postcss)(?:\?[^"')]*)?\1[ \t]*;?/gi, '');
  }

  // 3. Inject a three.js import map for every served game page. A document can
  // already contain an import map that omits three; skipping all map handling
  // in that case leaves external module graphs broken. Merge existing maps,
  // preserve their entries, and put the merged map before all game scripts.
  if (out.indexOf('data-studio-three-importmap') === -1) {
    var fortzScanSources = [out];
    var fortzHints = moduleHints || [];
    for (var hj = 0; hj < fortzHints.length; hj++) {
      var fortzHint = fortzHints[hj];
      if (fortzHint && typeof fortzHint.source === 'string' && fortzHint.source) {
        fortzScanSources.push(fortzHint.source);
      }
    }
    var fortzSpecs = [];
    var fortzPatterns = [
      /from\s*["']([^"']+)["']/g,
      /import\s*["']([^"']+)["']/g,
      /import\s*\(\s*["']([^"']+)["']/g
    ];
    for (var fs = 0; fs < fortzScanSources.length; fs++) {
      for (var fp = 0; fp < fortzPatterns.length; fp++) {
        var fortzMatch;
        fortzPatterns[fp].lastIndex = 0;
        while ((fortzMatch = fortzPatterns[fp].exec(fortzScanSources[fs]))) {
          var fortzSpecFound = fortzMatch[1];
          if (!fortzSpecFound || fortzSpecs.indexOf(fortzSpecFound) !== -1) continue;
          fortzSpecs.push(fortzSpecFound);
        }
      }
    }

    var fortzImports = {};
    // A module entry may be minified or use syntax the lightweight scanner
    // cannot recognize. The mapping is harmless when unused and guarantees
    // bare three imports resolve in every Studio preview.
    Reflect.set(fortzImports, 'three', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
    Reflect.set(fortzImports, 'three/addons/', 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/');
    var fortzPinnedThree = 'https://cdn.jsdelivr.net/npm/three@0.160.0';
    for (var specIndex = 0; specIndex < fortzSpecs.length; specIndex++) {
      var fortzSpec = String(fortzSpecs[specIndex]).split('?')[0].split('#')[0];
      if (!fortzSpec || /\s/.test(fortzSpec) || /^\.|^\/|^#|^[a-z][a-z0-9+.-]*:/i.test(fortzSpec)) continue;
      var fortzRoot;
      if (fortzSpec.charAt(0) === '@') {
        var fortzScopedSlash = fortzSpec.indexOf('/', 1);
        fortzRoot = fortzScopedSlash === -1 ? fortzSpec : fortzSpec.slice(0, fortzScopedSlash);
      } else {
        var fortzRootSlash = fortzSpec.indexOf('/');
        fortzRoot = fortzRootSlash === -1 ? fortzSpec : fortzSpec.slice(0, fortzRootSlash);
      }
      if (fortzRoot === 'three') {
        Reflect.set(fortzImports, 'three', fortzPinnedThree + '/build/three.module.js');
        Reflect.set(fortzImports, 'three/addons/', fortzPinnedThree + '/examples/jsm/');
        if (fortzSpec !== 'three' && !Reflect.get(fortzImports, fortzSpec)) {
          var fortzThreeRest = fortzSpec.slice('three/'.length);
          if (fortzThreeRest.indexOf('addons/') === 0) {
            fortzThreeRest = 'examples/jsm/' + fortzThreeRest.slice('addons/'.length);
          }
          Reflect.set(fortzImports, fortzSpec, fortzPinnedThree + '/' + fortzThreeRest);
        }
        continue;
      }
      if (!Reflect.get(fortzImports, fortzRoot)) {
        Reflect.set(fortzImports, fortzRoot, 'https://cdn.jsdelivr.net/npm/' + fortzRoot + '/+esm');
      }
      if (fortzSpec !== fortzRoot && !Reflect.get(fortzImports, fortzSpec)) {
        Reflect.set(fortzImports, fortzSpec, 'https://cdn.jsdelivr.net/npm/' + fortzSpec + '/+esm');
      }
    }

    var existingMap = {};
    var existingImports = {};
    var existingScopes = {};
    var hasImportMap = false;
    var importMapTagRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    var importMapTag;
    while ((importMapTag = importMapTagRe.exec(out))) {
      if (!/\btype\s*=\s*(["']?)importmap\1(?:\s|$)/i.test(importMapTag[1])) continue;
      hasImportMap = true;
      try {
        var parsedMap = JSON.parse(importMapTag[2]);
        if (!parsedMap || typeof parsedMap !== 'object') continue;
        var parsedImports = parsedMap.imports;
        if (parsedImports && typeof parsedImports === 'object') {
          var importKeys = Object.keys(parsedImports);
          for (var ik = 0; ik < importKeys.length; ik++) {
            Reflect.set(existingImports, importKeys[ik], Reflect.get(parsedImports, importKeys[ik]));
          }
        }
        var parsedScopes = parsedMap.scopes;
        if (parsedScopes && typeof parsedScopes === 'object') {
          var scopeKeys = Object.keys(parsedScopes);
          for (var sk = 0; sk < scopeKeys.length; sk++) {
            var scopeName = scopeKeys[sk];
            var sourceScope = Reflect.get(parsedScopes, scopeName);
            if (!sourceScope || typeof sourceScope !== 'object') continue;
            var mergedScope = Reflect.get(existingScopes, scopeName);
            if (!mergedScope || typeof mergedScope !== 'object') {
              mergedScope = {};
              Reflect.set(existingScopes, scopeName, mergedScope);
            }
            var scopedKeys = Object.keys(sourceScope);
            for (var sc = 0; sc < scopedKeys.length; sc++) {
              Reflect.set(mergedScope, scopedKeys[sc], Reflect.get(sourceScope, scopedKeys[sc]));
            }
          }
        }
        var otherKeys = Object.keys(parsedMap);
        for (var oi = 0; oi < otherKeys.length; oi++) {
          if (otherKeys[oi] !== 'imports' && otherKeys[oi] !== 'scopes' && !Reflect.get(existingMap, otherKeys[oi])) {
            Reflect.set(existingMap, otherKeys[oi], Reflect.get(parsedMap, otherKeys[oi]));
          }
        }
      } catch (e) {}
    }

    var existingImportKeys = Object.keys(existingImports);
    for (var eik = 0; eik < existingImportKeys.length; eik++) {
      if (!Reflect.get(fortzImports, existingImportKeys[eik])) {
        Reflect.set(fortzImports, existingImportKeys[eik], Reflect.get(existingImports, existingImportKeys[eik]));
      }
    }
    var finalMap = {};
    Reflect.set(finalMap, 'imports', fortzImports);
    if (Object.keys(existingScopes).length) Reflect.set(finalMap, 'scopes', existingScopes);
    var finalMapKeys = Object.keys(existingMap);
    for (var fmk = 0; fmk < finalMapKeys.length; fmk++) {
      Reflect.set(finalMap, finalMapKeys[fmk], Reflect.get(existingMap, finalMapKeys[fmk]));
    }

    var importMap =
      '<script type="importmap" data-studio-three-importmap>\n' +
      JSON.stringify(finalMap) +
      '\n</script>';
    if (hasImportMap) {
      out = out.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (tag, attributes) => {
        return /\btype\s*=\s*(["']?)importmap\1(?:\s|$)/i.test(attributes) ? '' : tag;
      });
    }
    if (/<head[\s>]/i.test(out)) {
      out = out.replace(/<head[\s>]/i, (m) => {
        return m + '\n' + importMap;
      });
    } else {
      out = importMap + '\n' + out;
    }
  }

  // 4. In-memory storage fallback for opaque origins.
  if (out.indexOf('data-studio-storage-shim') === -1) {
    const storageShim =
      '<script data-studio-storage-shim>(function(){function m(){var s={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(s,k)?s[k]:null;},setItem:function(k,v){s[k]=String(v);},removeItem:function(k){delete s[k];},clear:function(){s={};},key:function(i){return Object.keys(s)[i]||null;},get length(){return Object.keys(s).length;}};}var ls=m();var ss=m();function patch(prop,store){try{var cur=window[prop];if(cur&&typeof cur.getItem==="function"){cur.getItem("__probe__");return;}}catch(_){}var targets=[(typeof Window!=="undefined"?Window.prototype:null)];try{if(window&&Object.getPrototypeOf(window))targets.push(Object.getPrototypeOf(window));}catch(_){}if(window)targets.push(window);for(var i=0;i<targets.length;i++){var t=targets[i];if(!t)continue;try{Object.defineProperty(t,prop,{get:function(){return store;},set:function(){},configurable:true,enumerable:true});}catch(e1){try{t[prop]=store;}catch(e2){}}}}patch("localStorage",ls);patch("sessionStorage",ss);})();</script>';

    if (/<head[\s>]/i.test(out)) {
      out = out.replace(/<head[\s>]/i, (m) => {
        return m + storageShim;
      });
    } else if (/<html[\s>]/i.test(out)) {
      out = out.replace(/<html[\s>]/i, (m) => {
        return m + '<head>' + storageShim + '</head>';
      });
    } else {
      out = storageShim + out;
    }
  }

  // 4b. URL base shim: a relative new URL(...) must never kill the game.
  if (out.indexOf('data-studio-url-shim') === -1) {
    const urlShim =
      '<script data-studio-url-shim>(function(){if(window.__studioUrlShim)return;window.__studioUrlShim=true;var NativeURL=window.URL;if(!NativeURL)return;function baseUrl(){var candidates=[];try{candidates.push(document.baseURI);}catch(e){}try{candidates.push(window.location&&window.location.href);}catch(e){}try{candidates.push(document.referrer);}catch(e){}for(var i=0;i<candidates.length;i++){var v=candidates[i];if(typeof v==="string"&&/^[a-z][a-z0-9+.-]*:\\/\\//i.test(v))return v;}return "https://studio.preview.local/";}function StudioURL(url,base){if(arguments.length<2||base===undefined||base===null||base===""){base=baseUrl();}return new NativeURL(url,base);}StudioURL.prototype=NativeURL.prototype;try{StudioURL.createObjectURL=function(blob){return NativeURL.createObjectURL(blob);};}catch(e){}try{StudioURL.revokeObjectURL=function(url){return NativeURL.revokeObjectURL(url);};}catch(e){}try{StudioURL.canParse=function(url,base){if(typeof NativeURL.canParse!=="function")return true;return NativeURL.canParse(url,base===undefined?baseUrl():base);};}catch(e){}try{StudioURL.parse=function(url,base){var b=base===undefined?baseUrl():base;return typeof NativeURL.parse==="function"?NativeURL.parse(url,b):new NativeURL(url,b);};}catch(e){}try{window.URL=StudioURL;}catch(e){}})();</script>';

    if (/<head[\s>]/i.test(out)) {
      out = out.replace(/<head[\s>]/i, (m) => {
        return m + urlShim;
      });
    } else if (/<html[\s>]/i.test(out)) {
      out = out.replace(/<html[\s>]/i, (m) => {
        return m + '<head>' + urlShim + '</head>';
      });
    } else {
      out = urlShim + out;
    }
  }

  // 5. Audio unlock on real gestures + player start/mute messages.
  if (out.indexOf('data-studio-autostart') === -1) {
    const audioUnlock =
      '<script data-studio-autostart>(function(){if(window.__studioAutostartInjected)return;window.__studioAutostartInjected=true;function resumeAudio(){try{var ctxs=[window.audio,window.audioCtx,window.actx,window.AC,window.__audioCtx];ctxs.forEach(function(ac){if(ac&&typeof ac.resume==="function"&&ac.state==="suspended"){ac.resume();}});}catch(e){}}["pointerdown","touchstart","mousedown","keydown","click"].forEach(function(ev){window.addEventListener(ev,resumeAudio,{passive:true,once:true});});window.addEventListener("message",function(e){if(!e.data)return;if(e.data.type==="FORTZ_AUDIO_MUTE"){try{var shouldMute=!!e.data.muted;var ctxs=[window.audio,window.audioCtx,window.actx,window.AC,window.__audioCtx];ctxs.forEach(function(ac){if(ac&&typeof ac.suspend==="function"&&shouldMute&&ac.state==="running"){ac.suspend();}else if(ac&&typeof ac.resume==="function"&&!shouldMute&&ac.state==="suspended"){ac.resume();}});var audioEls=document.querySelectorAll("audio, video");audioEls.forEach(function(el){el.muted=shouldMute;});}catch(_){}}else if(e.data.type==="FORTZ_MINI_START"||e.data.type==="FORTZ_START_GAME"){resumeAudio();try{if(typeof window.startGame==="function")window.startGame();}catch(_){}}});})();</script>';

    if (/<head[\s>]/i.test(out)) {
      out = out.replace(/<head[\s>]/i, (m) => {
        return m + '\n' + audioUnlock;
      });
    } else if (/<body[\s>]/i.test(out)) {
      out = out.replace(/<body[\s>]/i, (m) => {
        return m + '\n' + audioUnlock;
      });
    } else {
      out = audioUnlock + '\n' + out;
    }
  }

  // 5b. Relay runtime exceptions from uploaded/static games to the Studio
  // repair loop. The blob fallback already has this listener; the WebContainer
  // HTTP preview needs the same bridge or errors like road.bounds stay local.
  if (out.indexOf('data-studio-runtime-errors') === -1) {
    const runtimeErrors =
      '<script data-studio-runtime-errors>(function(){if(window.__fortzRuntimeErrorsSent)return;window.__fortzRuntimeErrorsSent=true;function send(message){try{var text=String(message||"Unknown game runtime error").slice(0,2000);window.parent.postMessage({type:"thefortz-game-error",message:text},"*");}catch(e){}}window.addEventListener("error",function(e){send(e&&e.message);});window.addEventListener("unhandledrejection",function(e){var r=e&&e.reason;send(r&&r.message||r||"Unhandled Promise Rejection");});})();</script>';

    if (/<head[\s>]/i.test(out)) {
      out = out.replace(/<head[\s>]/i, (m) => m + '\n' + runtimeErrors);
    } else if (/<body[\s>]/i.test(out)) {
      out = out.replace(/<body[\s>]/i, (m) => m + '\n' + runtimeErrors);
    } else {
      out = runtimeErrors + '\n' + out;
    }
  }

  /*
   * 6. Silent-failure watchdog (plain-JS twin of previewWatchdogScript: no
   * backticks, no ${}, no annotations — this source is embedded verbatim).
   * Keep the two copies in sync; the spec asserts both carry the markers.
   */
  if (out.indexOf('data-studio-watchdog') === -1) {
    const watchdog =
      '<script data-studio-watchdog>(function(){if(window.__fortzWatchdogFired)return;function fire(message){if(window.__fortzWatchdogFired)return;window.__fortzWatchdogFired=true;try{console.error("[Fortz preview watchdog] "+message);}catch(e){}try{window.parent.postMessage({type:"thefortz-game-error",message:"Preview watchdog: "+message},"*");}catch(e){}try{window.dispatchEvent(new ErrorEvent("error",{message:"Preview watchdog: "+message}));}catch(e){}}function alive(){try{var d=window.__GAME_DIAGNOSTICS__;if(d&&(d.ready===true||d.simulationSteps>5||d.inputsHandled>0))return true;}catch(e){}return false;}function check(){if(alive())return;try{if(document.hidden)return;}catch(e){}var canvas=null;try{canvas=document.querySelector("canvas");}catch(e){}if(!canvas){fire("no canvas element rendered after 15s - the entry script may not run or no canvas was created; check script wiring and console.");}else{fire("canvas is present but the game never reported ready after 15s - the loop may be dead or the start path stuck; check console and wiring.");}}setTimeout(check,15000);})();</script>';

    if (/<head[\s>]/i.test(out)) {
      out = out.replace(/<head[\s>]/i, (m) => {
        return m + '\n' + watchdog;
      });
    } else if (/<body[\s>]/i.test(out)) {
      out = out.replace(/<body[\s>]/i, (m) => {
        return m + '\n' + watchdog;
      });
    } else {
      out = watchdog + '\n' + out;
    }
  }

  return out;
};

export function buildFallbackHtml(
  files: Record<string, { type: string; content?: string } | undefined>,
  imageAssets: Record<string, GeneratedAsset> = {},
): string | undefined {
  let htmlContent: string | undefined;

  for (const [path, dirent] of Object.entries(files)) {
    if (dirent?.type === 'file' && dirent.content && (path.endsWith('/index.html') || path === 'index.html')) {
      htmlContent = dirent.content;
      break;
    }
  }

  if (!htmlContent) {
    for (const [path, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && dirent.content && path.endsWith('.html')) {
        htmlContent = dirent.content;
        break;
      }
    }
  }

  if (!htmlContent) {
    const hasJs = Object.keys(files).some((p) => p.endsWith('.js') || p.endsWith('.mjs'));

    if (hasJs) {
      htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Game</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body, html { width: 100%; height: 100%; overflow: hidden; background: #0b0f19; display: flex; align-items: center; justify-content: center; }
    canvas { display: block; max-width: 100%; max-height: 100%; }
  </style>
</head>
<body>
  <canvas id="gameCanvas" width="800" height="600"></canvas>
</body>
</html>`;
    } else {
      return undefined;
    }
  }

  // Strip markdown code fences if wrapped by the model
  let cleanContent = htmlContent.trim();
  cleanContent = cleanContent
    .replace(/^```(?:html|xml)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let bundled = cleanContent;

  const sourceFiles = Object.entries(files).flatMap(([path, dirent]) =>
    dirent?.type === 'file' && dirent.content
      ? [{ path: cleanWorkDirRelativePath(path), content: dirent.content }]
      : [],
  );
  const getFileEntry = (refPath: string) => resolveStaticPreviewFileLoose(sourceFiles, refPath);
  const strippedRefs: string[] = [];

  /*
   * Self-naming syntax audit: whatever the validator missed (unchecked
   * files, exotic breakage inside import statements, broken inline HTML
   * scripts), the preview itself reports WHICH file is broken straight to
   * the repair inbox instead of dying anonymously behind the watchdog.
   */
  const syntaxIssues: string[] = [];

  for (const file of sourceFiles) {
    if (syntaxIssues.length >= 8) {
      break;
    }

    if (typeof file.content !== 'string') {
      continue;
    }

    let issue: string | undefined;

    if (/\.(?:m?js|jsx)$/.test(file.path)) {
      issue = probeModuleSyntax(file.content, file.path);
    } else if (/\.html?$/.test(file.path)) {
      issue = probeHtmlInlineScripts(file.content, file.path);
    }

    if (issue) {
      syntaxIssues.push(issue.slice(0, 500));
    }
  }

  const noteStripped = (ref: string) => {
    const clean = String(ref || '').slice(0, 160);

    if (clean && strippedRefs.length < 8 && !strippedRefs.includes(clean)) {
      strippedRefs.push(clean);
    }
  };

  // 1. Inline local stylesheets
  bundled = bundled.replace(
    /<link\b[^>]*\bhref\s*=\s*["'](?!https?:\/\/|\/\/|data:|blob:)([^"']+)["'][^>]*>/gi,
    (match, href) => {
      const css = getFileEntry(href);

      if (css !== undefined) {
        return `<style data-inlined="${css.path}">\n${css.content}\n</style>`;
      }

      noteStripped(href);

      return match;
    },
  );

  // 2. Inline local script tags in their exact declared order in the HTML
  bundled = bundled.replace(
    /<script\b([^>]*)\bsrc\s*=\s*["'](?!https?:\/\/|\/\/|data:|blob:)([^"']+)["']([^>]*)>(?:[\s\S]*?<\/script>)?/gi,
    (match, before, src, after) => {
      const js = getFileEntry(src);

      if (js !== undefined) {
        /*
         * A .js file written with import/export MUST run as a module even when
         * the HTML loads it with a classic tag — otherwise it is a certain
         * SyntaxError and the whole game dies.
         */
        const isModule =
          /type\s*=\s*["']module["']/i.test(`${before} ${after}`) ||
          js.path.endsWith('.mjs') ||
          looksLikeEsm(js.content);
        const typeAttr = isModule ? ' type="module"' : '';
        const safePath = js.path.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const safeContent =
          js.path.endsWith('.js') || js.path.endsWith('.mjs') ? balanceAndCloseJs(js.content) : js.content;

        return `<script${typeAttr} data-inlined="${safePath}">\n${escapeInlineScriptContent(safeContent)}\n</script>`;
      }

      noteStripped(src);

      return `<!-- bolt-stripped: could not resolve "${src}" in virtual filesystem -->`;
    },
  );

  // 3. Dynamic Script Discovery
  const inlinedFiles = new Set<string>();

  for (const match of bundled.matchAll(/data-inlined=["']([^"']+)["']/g)) {
    const normMatch = cleanWorkDirRelativePath(match[1]).toLowerCase();
    inlinedFiles.add(normMatch);
  }

  const isAlreadyInlined = (filename: string): boolean => {
    const clean = cleanWorkDirRelativePath(filename).toLowerCase();
    return inlinedFiles.has(clean);
  };

  const entryCandidates = [
    'main.js',
    'game.js',
    'main.mjs',
    'game.mjs',
    'src/main.js',
    'src/game.js',
    'src/main.mjs',
    'src/game.mjs',
    'index.js',
    'app.js',
    'engine.js',
    'start.js',
  ];

  const projectJsFiles: string[] = [];

  for (const [p, dirent] of Object.entries(files)) {
    if (dirent?.type === 'file' && dirent.content) {
      const norm = cleanWorkDirRelativePath(p);

      if (
        !norm.startsWith('node_modules/') &&
        !norm.startsWith('.') &&
        !norm.includes('.test.') &&
        !norm.includes('.spec.') &&
        !norm.includes('.config.') &&
        (norm.endsWith('.js') || norm.endsWith('.mjs'))
      ) {
        projectJsFiles.push(norm);
      }
    }
  }

  const unlinkedDependencies: string[] = [];
  const unlinkedEntries: string[] = [];

  for (const file of projectJsFiles) {
    if (isAlreadyInlined(file)) {
      continue;
    }

    const base = file.replace(/^.*[\\/]/, '').toLowerCase();

    if (entryCandidates.some((e) => e.toLowerCase() === base || e.toLowerCase() === file.toLowerCase())) {
      unlinkedEntries.push(file);
    } else {
      unlinkedDependencies.push(file);
    }
  }

  const getDepRank = (filename: string): number => {
    const lower = filename.toLowerCase();

    if (
      lower.includes('math') ||
      lower.includes('vec') ||
      lower.includes('util') ||
      lower.includes('const') ||
      lower.includes('config')
    ) {
      return 1;
    }

    if (lower.includes('audio') || lower.includes('sound') || lower.includes('music')) {
      return 2;
    }

    if (lower.includes('input') || lower.includes('control') || lower.includes('keyboard') || lower.includes('key')) {
      return 3;
    }

    if (
      lower.includes('particle') ||
      lower.includes('effect') ||
      lower.includes('fx') ||
      lower.includes('emitter') ||
      lower.includes('smoke') ||
      lower.includes('spark')
    ) {
      return 4;
    }

    if (lower.includes('physics') || lower.includes('collision')) {
      return 5;
    }

    if (
      lower.includes('track') ||
      lower.includes('map') ||
      lower.includes('level') ||
      lower.includes('world') ||
      lower.includes('camera') ||
      lower.includes('grid')
    ) {
      return 6;
    }

    if (
      lower.includes('car') ||
      lower.includes('vehicle') ||
      lower.includes('player') ||
      lower.includes('enemy') ||
      lower.includes('entity') ||
      lower.includes('entities') ||
      lower.includes('actor') ||
      lower.includes('ai')
    ) {
      return 7;
    }

    if (
      lower.includes('ui') ||
      lower.includes('hud') ||
      lower.includes('score') ||
      lower.includes('menu') ||
      lower.includes('shop')
    ) {
      return 8;
    }

    return 9;
  };
  unlinkedDependencies.sort((a, b) => getDepRank(a) - getDepRank(b));

  const toInlineScript = (path: string) => {
    const entry = getFileEntry(path);

    if (!entry) {
      return undefined;
    }

    const safePath = entry.path.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const typeAttr = entry.path.endsWith('.mjs') || looksLikeEsm(entry.content) ? ' type="module"' : '';
    const safeContent =
      entry.path.endsWith('.js') || entry.path.endsWith('.mjs') ? balanceAndCloseJs(entry.content) : entry.content;

    return `<script${typeAttr} data-inlined="${safePath}">\n${escapeInlineScriptContent(safeContent)}\n</script>`;
  };

  const dependencyScripts: string[] = [];
  const entryScripts: string[] = [];

  for (const dep of unlinkedDependencies) {
    const script = toInlineScript(dep);

    if (script) {
      dependencyScripts.push(script);
    }
  }

  const hasDeclaredEntry = Array.from(inlinedFiles).some((path) =>
    entryCandidates.some((candidate) => path === candidate || path.endsWith(`/${candidate}`)),
  );

  if (!hasDeclaredEntry) {
    const entry =
      entryCandidates
        .map((candidate) => unlinkedEntries.find((path) => path === candidate || path.endsWith(`/${candidate}`)))
        .find(Boolean) || unlinkedEntries[0];

    if (entry) {
      const script = toInlineScript(entry);

      if (script) {
        entryScripts.push(script);
      }
    }
  }

  bundled = injectStaticScripts(bundled, dependencyScripts, entryScripts);

  /*
   * Rewrite relative ESM imports to blob URLs so multi-file module games
   * actually load every file inside the blob/srcdoc preview iframe.
   */
  bundled = inlineLocalModuleBlobImports(bundled, sourceFiles);

  // Automatically rewrite broken / 404 Three.js URLs to rock-solid stable CDN
  bundled = bundled.replace(
    /https?:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.18[0-9]\.[0-9]+\/build\/three(?:\.min)?\.js/g,
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  );
  bundled = bundled.replace(
    /https?:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.18[0-9]\.[0-9]+\/build\/three\.module\.js/g,
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  );

  bundled = bundled.trim();

  const doctypeRegex = /<!DOCTYPE\s+html[^>]*>/i;

  if (doctypeRegex.test(bundled)) {
    bundled = '<!DOCTYPE html>\n' + bundled.replace(doctypeRegex, '').trim();
  } else {
    bundled = '<!DOCTYPE html>\n' + bundled;
  }

  /*
   * Generated images present in the workspace (paths are relative to WORK_DIR).
   * Computed before script injection because the asset resolver must be
   * installed in <head>, ahead of every line of game code.
   */
  const livePaths = new Set(
    Object.entries(files)
      .filter(([, file]) => file?.type === 'file')
      .map(([path]) => cleanWorkDirRelativePath(path)),
  );
  const liveAssets = Object.fromEntries(Object.entries(imageAssets).filter(([path]) => livePaths.has(path)));
  const assetRuntime = buildGeneratedAssetRuntimeScript(liveAssets);

  if (bundled.includes('<head>')) {
    bundled = bundled.replace('<head>', `<head>\n  <meta charset="UTF-8" />\n${mathUtilsScript}\n${assetRuntime}`);
  } else if (bundled.includes('<head ')) {
    bundled = bundled.replace(/(<head[^>]*>)/i, `$1\n  <meta charset="UTF-8" />\n${mathUtilsScript}\n${assetRuntime}`);
  } else if (bundled.includes('<html')) {
    bundled = bundled.replace(
      /(<html[^>]*>)/i,
      `$1\n<head>\n  <meta charset="UTF-8" />\n${mathUtilsScript}\n${assetRuntime}\n</head>`,
    );
  } else {
    bundled = mathUtilsScript + '\n' + assetRuntime + '\n' + bundled;
  }

  /*
   * Report genuinely unresolvable local references to the parent frame so the
   * repair loop learns the exact wrong path instead of playing a silent game.
   */
  const missingReporter =
    strippedRefs.length === 0
      ? ''
      : `<script id="bolt-game-missing-refs">(function(){try{var refs=${jsonForInlineScript(strippedRefs)};for(var i=0;i<refs.length;i++){window.parent.postMessage({type:'thefortz-game-error',message:'Missing file reference: ' + refs[i] + ' (no project file matches this path)'},'*');}}catch(e){}})();</script>`;

  /*
   * The audit companion: name the exact file and structural problem for any
   * JS source that fails the module probe, so the console and the repair
   * inbox both say "src/x.js: malformed import…" instead of an anonymous
   * SyntaxError three documents later.
   */
  const syntaxReporter =
    syntaxIssues.length === 0
      ? ''
      : `<script id="bolt-game-syntax-issues">(function(){try{var issues=${jsonForInlineScript(syntaxIssues)};for(var i=0;i<issues.length;i++){try{console.error('[Fortz preview] ' + issues[i]);}catch(e){}try{window.parent.postMessage({type:'thefortz-game-error',message:issues[i]},'*');}catch(e){}}}catch(e){}})();</script>`;

  /*
   * Watchdog for silent failures: a game that boots with zero exceptions but
   * never renders or starts still looks dead. After 15s it reports a hedged,
   * actionable diagnostic so the repair loop investigates instead of idling.
   */
  const previewWatchdogScript = `<script id="bolt-game-watchdog">
(function() {
  if (window.__fortzWatchdogFired) return;
  function fire(message) {
    if (window.__fortzWatchdogFired) return;
    window.__fortzWatchdogFired = true;
    try { console.error('[Fortz preview watchdog] ' + message); } catch (e) {}
    try { window.parent.postMessage({ type: 'thefortz-game-error', message: 'Preview watchdog: ' + message }, '*'); } catch (e) {}
    try { window.dispatchEvent(new ErrorEvent('error', { message: 'Preview watchdog: ' + message })); } catch (e) {}
  }
  function alive() {
    try {
      var d = window.__GAME_DIAGNOSTICS__;
      if (d && (d.ready === true || d.simulationSteps > 5 || d.inputsHandled > 0)) return true;
    } catch (e) {}
    return false;
  }
  function check() {
    if (alive()) return;
    try {
      if (document.hidden) return;
    } catch (e) {}
    var canvas = null;
    try { canvas = document.querySelector('canvas'); } catch (e) {}
    if (!canvas) {
      fire('no canvas element rendered after 15s — the entry script may not run or no canvas was created; check script wiring and console.');
    } else {
      fire('canvas is present but the game never reported ready after 15s — the loop may be dead or the start path stuck; check console and wiring.');
    }
  }
  setTimeout(check, 15000);
})();
</script>`;

  if (bundled.includes('</body>')) {
    bundled = bundled.replace(
      '</body>',
      `${focusHelper}\n${errorOverlayScript}\n${missingReporter}\n${syntaxReporter}\n${previewWatchdogScript}\n</body>`,
    );
  } else {
    bundled =
      bundled +
      '\n' +
      focusHelper +
      '\n' +
      errorOverlayScript +
      '\n' +
      missingReporter +
      '\n' +
      syntaxReporter +
      '\n' +
      previewWatchdogScript;
  }

  /*
   * Publish parity: run the same normalization the published build receives
   * (Puter strip, unpkg->jsDelivr, three import map, storage shim, audio
   * unlock) so the Studio preview runs exactly like thefortz.me copy.
   */
  return inlineGeneratedAssetUrls(normalizeStudioGameHtml(bundled), liveAssets);
}

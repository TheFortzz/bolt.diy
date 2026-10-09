import { cleanWorkDirRelativePath } from '~/utils/diff';
import { inlineGeneratedAssetUrls, type GeneratedAsset } from '~/lib/stores/generated-assets';

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
  ]);

  let patched = src.replace(/\)(\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)/g, (match, space, ident) => {
    if (reservedWords.has(ident)) return match;
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
      if (char === '{') openBraces++;
      else if (char === '}') openBraces = Math.max(0, openBraces - 1);
      else if (char === '(') openParens++;
      else if (char === ')') openParens = Math.max(0, openParens - 1);
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
    }

    let patch = '';
    if (inString) patch += inString;
    if (openBrackets > 0) patch += ']'.repeat(openBrackets);
    if (openParens > 0) patch += ')'.repeat(openParens);
    patch += ';';
    if (openBraces > 0) patch += '\n' + '}'.repeat(openBraces);

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

  if (/<script\b[^>]*type\s*=\s*["']importmap["']/i.test(html)) {
    return html;
  }

  const needsThree = /(?:from\s+|import\s*\(\s*|import\s+)["']three(?:\/[^"']*)?["']/i.test(html);

  if (!needsThree) {
    return html;
  }

  const importMap = `<script type="importmap" data-studio-three-importmap>\n{"imports":{"three":"${PINNED_THREE_MODULE}","three/addons/":"${PINNED_THREE_ADDONS}"}}\n</script>`;

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head[\s>]/i, (m) => `${m}\n${importMap}`);
  }

  return `${importMap}\n${html}`;
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

/** Run the full publish-parity normalization over Studio fallback HTML. */
export function normalizeStudioGameHtml(html: string): string {
  let out = html || '';

  out = stripBlockedSdkScripts(out);
  out = rewriteUnpkgThreeToJsdelivr(out);
  out = ensureThreeImportMap(out);
  out = ensurePreviewStorageShim(out);
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
 * Detect ES-module syntax (import/export statements) in source, ignoring
 * strings and comments. A .js file full of `import` lines that is loaded with
 * a classic `<script src>` MUST still run as a module — inlining it as a
 * classic script is a certain SyntaxError and a dead game.
 */
export function looksLikeEsm(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false;
  }

  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\w$])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  return /^\s*import[\s('"{]|^\s*export[\s{*]/m.test(stripped);
}

/**
 * Rewrite relative ES-module imports inside inlined module scripts to blob:
 * URLs minted from the actual project files. Separate inline
 * `<script type="module">` blocks cannot resolve `./x.js` against each other
 * inside a blob:/srcdoc iframe ("base scheme isn't hierarchical"), which kills
 * every multi-file module game. Blob URLs preserve real module semantics
 * (named/default/namespace imports, cycles via live bindings) with no
 * bundler. Bare specifiers ('three', CDN URLs) are left for the import map.
 */
export function inlineLocalModuleBlobImports(html: string, sourceFiles: StaticPreviewFile[]): string {
  if (!html || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return html;
  }

  const generation: string[] = [];
  const blobCache = new Map<string, string>();
  const inProgress = new Set<string>();

  const resolveRef = (importerPath: string, spec: string): string | undefined => {
    const cleanSpec = spec.split(/[?#]/, 1)[0];

    if (!cleanSpec.startsWith('.')) {
      const hit = resolveStaticPreviewFile(sourceFiles, cleanSpec);
      return hit?.path;
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

    const hit = resolveStaticPreviewFile(sourceFiles, parts.join('/'));

    return hit?.path;
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

  const rewriteRelativeImports = (importerPath: string, code: string): string => {
    const rewriteStatic = code.replace(/\bfrom\s*(["'])(\.[^"']+)\1/g, (match, quote: string, spec: string) => {
      const dep = resolveRef(importerPath, spec);
      const url = dep ? getBlobUrl(dep) : undefined;

      return url ? `from ${quote}${url}${quote}` : match;
    });
    return rewriteStatic.replace(/\bimport\s*\(\s*(["'])(\.[^"']+)\1\s*\)/g, (match, quote: string, spec: string) => {
      const dep = resolveRef(importerPath, spec);
      const url = dep ? getBlobUrl(dep) : undefined;

      return url ? `import(${quote}${url}${quote})` : match;
    });
  };

  const urlToPath = (): Map<string, string> => {
    const map = new Map<string, string>();

    for (const [path, url] of blobCache) {
      map.set(url, path);
    }

    return map;
  };

  const collectExportedNames = (content: string): { names: Set<string>; hasDefault: boolean; wildcard: boolean } => {
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
    const missingDefault = Boolean(defName) && !exported.hasDefault;
    const missingNamed = exported.wildcard ? [] : named.filter((n) => !exported.names.has(n.prop));

    if (!missingDefault && missingNamed.length === 0) {
      return null;
    }

    nsCounter += 1;

    const ns = `__fortz_ns_${nsCounter}`;
    const decls: string[] = [];

    if (defName) {
      decls.push(`default: ${defName} = undefined`);
    }

    for (const n of named) {
      decls.push(n.prop === n.local ? `${n.local} = undefined` : `${n.prop}: ${n.local} = undefined`);
    }

    return `import * as ${ns} from ${quote}${url}${quote};\nconst { ${decls.join(', ')} } = ${ns};`;
  };

  /*
   * A single missing export name aborts the ENTIRE module graph at parse time
   * ("does not provide an export named 'x'") and kills the game before it
   * boots. Soften only the broken statements into namespace imports with
   * undefined defaults: the game boots, working systems run, and the real
   * error surfaces only if the missing path executes.
   */
  const softenBlobImports = (code: string, reverse: Map<string, string>): string => {
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

    return namedOnly.replace(
      /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])(blob:[^"']+)\2/g,
      (match, defName: string, quote: string, url: string) => {
        return softenOneImport(defName, '', quote, url, reverse) ?? match;
      },
    );
  };

  const out = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs: string, content: string) => {
    const attrText = String(attrs || '');

    const isModule = /type\s*=\s*["']module["']/i.test(attrText);

    const inlined = attrText.match(/data-inlined\s*=\s*["']([^"']+)["']/i);

    if (!isModule || !inlined) {
      return tag;
    }

    if (!/\b(?:from\s*["']\.|import\s*\(\s*["']\.)/.test(content)) {
      return tag;
    }

    const importerPath = cleanWorkDirRelativePath(unescapeAttr(inlined[1]));

    const rewritten = softenBlobImports(rewriteRelativeImports(importerPath, content), urlToPath());

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
export const normalizeServerPreviewHtml: (html: string) => string = function (html) {
  let out = typeof html === 'string' ? html : '';

  // 1. Strip Puter.js: sandbox-blocked sockets/headers break game init.
  out = out.replace(/<script\b[^>]*src=["']https?:\/\/js\.puter\.com[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*src=["']https?:\/\/js\.puter\.com[^"']*["'][^>]*\/?>/gi, '');
  out = out.replace(/<script\b[^>]*>[\s\S]*?puter\.quiet[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*>[\s\S]*?window\.puter[\s\S]*?<\/script>/gi, '');

  // 2. Rewrite unpkg three.js refs to pinned jsDelivr.
  out = out.replace(/(https?:)?\/\/unpkg\.com\/three/g, 'https://cdn.jsdelivr.net/npm/three');

  // 3. Pinned three.js import map for bare imports without one.
  if (out.indexOf('data-studio-three-importmap') === -1 && !/<script\b[^>]*type\s*=\s*["']importmap["']/i.test(out)) {
    if (/(?:from\s+|import\s*\(\s*|import\s+)["']three(?:\/[^"']*)?["']/i.test(out)) {
      const importMap =
        '<script type="importmap" data-studio-three-importmap>\n{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}\n</script>';

      if (/<head[\s>]/i.test(out)) {
        out = out.replace(/<head[\s>]/i, (m) => {
          return m + '\n' + importMap;
        });
      } else {
        out = importMap + '\n' + out;
      }
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
  const getFileEntry = (refPath: string) => resolveStaticPreviewFile(sourceFiles, refPath);

  // 1. Inline local stylesheets
  bundled = bundled.replace(
    /<link\b[^>]*\bhref\s*=\s*["'](?!https?:\/\/|\/\/|data:|blob:)([^"']+)["'][^>]*>/gi,
    (match, href) => {
      const css = getFileEntry(href);
      if (css !== undefined) {
        return `<style data-inlined="${css.path}">\n${css.content}\n</style>`;
      }
      return match;
    },
  );

  // 2. Inline local script tags in their exact declared order in the HTML
  bundled = bundled.replace(
    /<script\b([^>]*)\bsrc\s*=\s*["'](?!https?:\/\/|\/\/|data:|blob:)([^"']+)["']([^>]*)>(?:[\s\S]*?<\/script>)?/gi,
    (match, before, src, after) => {
      const js = getFileEntry(src);
      if (js !== undefined) {
        // A .js file written with import/export MUST run as a module even when
        // the HTML loads it with a classic tag — otherwise it is a certain
        // SyntaxError and the whole game dies.
        const isModule =
          /type\s*=\s*["']module["']/i.test(`${before} ${after}`) ||
          js.path.endsWith('.mjs') ||
          looksLikeEsm(js.content);
        const typeAttr = isModule ? ' type="module"' : '';
        const safePath = js.path.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const safeContent =
          js.path.endsWith('.js') || js.path.endsWith('.mjs') ? balanceAndCloseJs(js.content) : js.content;
        return `<script${typeAttr} data-inlined="${safePath}">\n${safeContent}\n</script>`;
      }
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
    if (isAlreadyInlined(file)) continue;

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
    )
      return 1;
    if (lower.includes('audio') || lower.includes('sound') || lower.includes('music')) return 2;
    if (lower.includes('input') || lower.includes('control') || lower.includes('keyboard') || lower.includes('key'))
      return 3;
    if (
      lower.includes('particle') ||
      lower.includes('effect') ||
      lower.includes('fx') ||
      lower.includes('emitter') ||
      lower.includes('smoke') ||
      lower.includes('spark')
    )
      return 4;
    if (lower.includes('physics') || lower.includes('collision')) return 5;
    if (
      lower.includes('track') ||
      lower.includes('map') ||
      lower.includes('level') ||
      lower.includes('world') ||
      lower.includes('camera') ||
      lower.includes('grid')
    )
      return 6;
    if (
      lower.includes('car') ||
      lower.includes('vehicle') ||
      lower.includes('player') ||
      lower.includes('enemy') ||
      lower.includes('entity') ||
      lower.includes('entities') ||
      lower.includes('actor') ||
      lower.includes('ai')
    )
      return 7;
    if (
      lower.includes('ui') ||
      lower.includes('hud') ||
      lower.includes('score') ||
      lower.includes('menu') ||
      lower.includes('shop')
    )
      return 8;
    return 9;
  };
  unlinkedDependencies.sort((a, b) => getDepRank(a) - getDepRank(b));

  const toInlineScript = (path: string) => {
    const entry = getFileEntry(path);
    if (!entry) return undefined;
    const safePath = entry.path.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const typeAttr = entry.path.endsWith('.mjs') || looksLikeEsm(entry.content) ? ' type="module"' : '';
    const safeContent =
      entry.path.endsWith('.js') || entry.path.endsWith('.mjs') ? balanceAndCloseJs(entry.content) : entry.content;
    return `<script${typeAttr} data-inlined="${safePath}">\n${safeContent}\n</script>`;
  };

  const dependencyScripts: string[] = [];
  const entryScripts: string[] = [];

  for (const dep of unlinkedDependencies) {
    const script = toInlineScript(dep);
    if (script) dependencyScripts.push(script);
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
      if (script) entryScripts.push(script);
    }
  }

  bundled = injectStaticScripts(bundled, dependencyScripts, entryScripts);

  // Rewrite relative ESM imports to blob URLs so multi-file module games
  // actually load every file inside the blob/srcdoc preview iframe.
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

  if (bundled.includes('<head>')) {
    bundled = bundled.replace('<head>', `<head>\n  <meta charset="UTF-8" />\n${mathUtilsScript}`);
  } else if (bundled.includes('<head ')) {
    bundled = bundled.replace(/(<head[^>]*>)/i, `$1\n  <meta charset="UTF-8" />\n${mathUtilsScript}`);
  } else if (bundled.includes('<html')) {
    bundled = bundled.replace(/(<html[^>]*>)/i, `$1\n<head>\n  <meta charset="UTF-8" />\n${mathUtilsScript}\n</head>`);
  } else {
    bundled = mathUtilsScript + '\n' + bundled;
  }

  if (bundled.includes('</body>')) {
    bundled = bundled.replace('</body>', `${focusHelper}\n${errorOverlayScript}\n</body>`);
  } else {
    bundled = bundled + '\n' + focusHelper + '\n' + errorOverlayScript;
  }

  const livePaths = new Set(
    Object.entries(files)
      .filter(([, file]) => file?.type === 'file')
      .map(([path]) => cleanWorkDirRelativePath(path)),
  );
  const liveAssets = Object.fromEntries(Object.entries(imageAssets).filter(([path]) => livePaths.has(path)));

  // Publish parity: run the same normalization the published build receives
  // (Puter strip, unpkg->jsDelivr, three import map, storage shim, audio
  // unlock) so the Studio preview runs exactly like thefortz.me copy.
  return inlineGeneratedAssetUrls(normalizeStudioGameHtml(bundled), liveAssets);
}

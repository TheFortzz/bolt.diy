import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore } from '~/lib/stores/workbench';
import { registerPreviewValidator, type PreviewValidationResult } from '~/lib/runtime/preview-validation';
import { cleanWorkDirRelativePath } from '~/utils/diff';
import { PortDropdown } from './PortDropdown';

type ResizeSide = 'left' | 'right' | null;

export const Preview = memo(({ isStreaming = false }: { isStreaming?: boolean }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [isPortDropdownOpen, setIsPortDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hasSelectedPreview = useRef(false);
  const previews = useStore(workbenchStore.previews);
  const files = useStore(workbenchStore.files);
  const activePreview = previews[activePreviewIndex] ?? previews.find((preview) => preview.ready) ?? previews[0];

  const fallbackHtml = useMemo(() => {
    let htmlContent: string | undefined;
    for (const [path, dirent] of Object.entries(files)) {
      if (
        dirent?.type === 'file' &&
        dirent.content &&
        (path.endsWith('/index.html') || path === 'index.html' || path.endsWith('index.html'))
      ) {
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

    // Helper to find file content from path
    const getFileContent = (refPath: string): string | undefined => {
      const clean = cleanWorkDirRelativePath(refPath);
      for (const [p, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file' && dirent.content) {
          const normP = cleanWorkDirRelativePath(p);
          if (normP === clean || normP.endsWith(`/${clean}`) || clean.endsWith(`/${normP}`)) {
            return dirent.content;
          }
        }
      }
      return undefined;
    };

    // 1. Inline local stylesheets
    bundled = bundled.replace(
      /<link\b[^>]*\bhref\s*=\s*["'](?!https?:\/\/|\/\/|data:|blob:)([^"']+)["'][^>]*>/gi,
      (match, href) => {
        const css = getFileContent(href);
        if (css !== undefined) {
          return `<style data-inlined="${href}">\n${css}\n</style>`;
        }
        return match;
      }
    );

    // 2. Inline local script tags in their exact declared order in the HTML
    bundled = bundled.replace(
      /<script\b([^>]*)\bsrc\s*=\s*["'](?!https?:\/\/|\/\/|data:|blob:)([^"']+)["']([^>]*)>[\s\S]*?<\/script>/gi,
      (match, before, src, after) => {
        const js = getFileContent(src);
        if (js !== undefined) {
          const isModule = /type\s*=\s*["']module["']/i.test(`${before} ${after}`);
          const typeAttr = isModule ? ' type="module"' : '';
          const normSrc = cleanWorkDirRelativePath(src);
          return `<script${typeAttr} data-inlined="${normSrc}">\n${js}\n</script>`;
        }
        // File not found in virtual FS — strip rather than leave a broken src= that 404s in blob context
        return `<!-- bolt-stripped: could not resolve "${src}" in virtual filesystem -->`;
      }
    );

    // 3. Dynamic Script Discovery (Bugs 1 & 2):
    // Scan project files for any unlinked .js files. Never use a hardcoded whitelist.
    // Inject all dependency modules (car.js, physics.js, etc.) FIRST, followed by
    // the entry point (main.js/game.js) LAST so main.js always has all classes defined.
    const inlinedFiles = new Set<string>();
    for (const match of bundled.matchAll(/data-inlined=["']([^"']+)["']/g)) {
      const normMatch = cleanWorkDirRelativePath(match[1]).toLowerCase();
      inlinedFiles.add(normMatch);
      inlinedFiles.add(normMatch.replace(/^.*[\\/]/, ''));
    }

    const isAlreadyInlined = (filename: string): boolean => {
      const clean = cleanWorkDirRelativePath(filename).toLowerCase();
      const base = clean.replace(/^.*[\\/]/, '');
      return inlinedFiles.has(clean) || inlinedFiles.has(base);
    };

    const entryCandidates = [
      'main.js', 'game.js', 'src/main.js', 'src/game.js',
      'index.js', 'app.js', 'engine.js', 'start.js',
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

    // Rank dependencies so foundational math/physics/utilities load before entities and gameplay
    const getDepRank = (filename: string): number => {
      const lower = filename.toLowerCase();
      if (lower.includes('math') || lower.includes('vec') || lower.includes('util') || lower.includes('const') || lower.includes('config')) return 1;
      if (lower.includes('audio') || lower.includes('sound')) return 2;
      if (lower.includes('input') || lower.includes('control') || lower.includes('keyboard')) return 3;
      if (lower.includes('physics') || lower.includes('collision')) return 4;
      if (lower.includes('track') || lower.includes('map') || lower.includes('level') || lower.includes('world') || lower.includes('camera')) return 5;
      if (lower.includes('car') || lower.includes('player') || lower.includes('enemy') || lower.includes('entity') || lower.includes('particle')) return 6;
      if (lower.includes('ui') || lower.includes('hud') || lower.includes('score') || lower.includes('menu')) return 7;
      return 10;
    };
    unlinkedDependencies.sort((a, b) => getDepRank(a) - getDepRank(b));

    const scriptsToInject: string[] = [];
    // Inject all dependencies first
    for (const dep of unlinkedDependencies) {
      const js = getFileContent(dep);
      if (js) {
        scriptsToInject.push(`<script data-inlined="${dep}">\n${js}\n</script>`);
      }
    }

    // Inject entry point last
    for (const entry of unlinkedEntries) {
      const js = getFileContent(entry);
      if (js) {
        scriptsToInject.push(`<script data-inlined="${entry}">\n${js}\n</script>`);
        break;
      }
    }

    if (scriptsToInject.length > 0) {
      const injectionBlock = '\n' + scriptsToInject.join('\n') + '\n';
      if (bundled.includes('</body>')) {
        bundled = bundled.replace('</body>', `${injectionBlock}</body>`);
      } else {
        bundled = bundled + injectionBlock;
      }
    }

    // Standard game math & vector helper polyfills so common helper functions never crash at runtime
    const mathUtilsScript = `<script id="bolt-game-math-utils">
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
})();
</script>`;

    // CRITICAL: Guarantee Strict Standards Mode (Never Quirks Mode)
    // <!DOCTYPE html> MUST be at index 0 of the document.
    bundled = bundled.trim();
    const doctypeRegex = /<!DOCTYPE\s+html[^>]*>/i;
    if (doctypeRegex.test(bundled)) {
      bundled = '<!DOCTYPE html>\n' + bundled.replace(doctypeRegex, '').trim();
    } else {
      bundled = '<!DOCTYPE html>\n' + bundled;
    }

    // Ensure <meta charset="UTF-8"> and math utilities exist before scripts execute
    if (bundled.includes('<head>')) {
      bundled = bundled.replace('<head>', `<head>\n  <meta charset="UTF-8" />\n${mathUtilsScript}`);
    } else if (bundled.includes('<head ')) {
      bundled = bundled.replace(/(<head[^>]*>)/i, `$1\n  <meta charset="UTF-8" />\n${mathUtilsScript}`);
    } else if (bundled.includes('<html')) {
      bundled = bundled.replace(/(<html[^>]*>)/i, `$1\n<head>\n  <meta charset="UTF-8" />\n${mathUtilsScript}\n</head>`);
    } else {
      bundled = mathUtilsScript + '\n' + bundled;
    }

    // Focus the actual game surface without fabricating key presses. The
    // parent forwards real keyboard events, so clicks only restore focus.
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

    if (bundled.includes('</body>')) {
      bundled = bundled.replace('</body>', `${focusHelper}\n${errorOverlayScript}\n</body>`);
    } else {
      bundled = bundled + '\n' + focusHelper + '\n' + errorOverlayScript;
    }

    return bundled;
  }, [files]);

  const fallbackIncomplete = useMemo(() => {
    if (!fallbackHtml) {
      return false;
    }

    const openHtml = (fallbackHtml.match(/<html\b/gi) || []).length;
    const closeHtml = (fallbackHtml.match(/<\/html>/gi) || []).length;
    const openBody = (fallbackHtml.match(/<body\b/gi) || []).length;
    const closeBody = (fallbackHtml.match(/<\/body>/gi) || []).length;
    const openScript = (fallbackHtml.match(/<script\b/gi) || []).length;
    const closeScript = (fallbackHtml.match(/<\/script>/gi) || []).length;

    if (openHtml > closeHtml || openBody > closeBody || openScript > closeScript) {
      return true;
    }

    // If streaming and document doesn't have closing </html>, it is still being written
    if (isStreaming && !fallbackHtml.includes('</html>')) {
      return true;
    }

    return false;
  }, [fallbackHtml, isStreaming]);

  // Keep last good preview while AI is streaming incomplete files.
  const lastGoodHtmlRef = useRef<string | undefined>();
  const displayFallbackHtml = useMemo(() => {
    if (activePreview) {
      return undefined;
    }

    // While AI is actively writing/streaming files, hold onto the last known good preview.
    // NEVER mount half-streamed syntax-broken code into the iframe.
    if (isStreaming) {
      return lastGoodHtmlRef.current;
    }

    if (fallbackHtml && !fallbackIncomplete) {
      lastGoodHtmlRef.current = fallbackHtml;
      return fallbackHtml;
    }

    if (fallbackIncomplete) {
      return lastGoodHtmlRef.current;
    }

    return fallbackHtml;
  }, [activePreview, fallbackHtml, fallbackIncomplete, isStreaming]);

  useEffect(() => {
    return registerPreviewValidator(async (): Promise<PreviewValidationResult> => {
      if (fallbackIncomplete) {
        return { ok: false, error: 'Preview is still incomplete.' };
      }

      let serverUrl = workbenchStore.previews.get().find((preview) => preview.ready)?.baseUrl;
      const projectHasPackage = Object.entries(workbenchStore.files.get()).some(
        ([path, file]) => path.endsWith('/package.json') && file?.type === 'file',
      );
      if (!serverUrl && !fallbackHtml) {
        for (let attempt = 0; attempt < 20 && !serverUrl; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          serverUrl = workbenchStore.previews.get().find((preview) => preview.ready)?.baseUrl;
        }
      }
      if (!serverUrl && !fallbackHtml) {
        return { ok: false, error: 'No runnable preview was produced.' };
      }

      if (serverUrl) {
        try {
          const response = await fetch(serverUrl, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) return { ok: false, error: `Preview returned HTTP ${response.status}.` };
        } catch (error) {
          return { ok: false, error: `Could not reach preview: ${(error as Error).message}` };
        }
      }

      // Run the same assembled static HTML the user sees, in an isolated offscreen
      // iframe. This catches synchronous errors and unhandled promise rejections.
      // Cross-origin dev-server console output cannot be observed from here.
      return new Promise<PreviewValidationResult>((resolve) => {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:800px;height:600px;visibility:visible;pointer-events:none';
        const token = crypto.randomUUID();
        let finished = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (result: PreviewValidationResult) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          frame.remove();
          resolve(result);
        };
        const onMessage = (event: MessageEvent) => {
          if (event.source !== frame.contentWindow || event.data?.token !== token) return;
          if (event.data.type === 'preview-error') {
            finish({ ok: false, error: `Preview runtime error: ${String(event.data.error).slice(0, 1200)}` });
          } else if (event.data.type === 'preview-loaded') {
            setTimeout(() => finish({ ok: true }), 1200);
          }
        };
        window.addEventListener('message', onMessage);
        timer = setTimeout(() => finish({ ok: false, error: 'Preview did not load within 12 seconds.' }), 12000);
        if (serverUrl && (projectHasPackage || !fallbackHtml)) {
          frame.onload = () => setTimeout(() => finish({ ok: true }), 1200);
          frame.onerror = () => finish({ ok: false, error: 'Preview failed to load.' });
          frame.src = serverUrl;
        } else {
          const instrumentation = `<script>
(function() {
  var token = ${JSON.stringify(token)};
  window.addEventListener('error', function(e) {
    parent.postMessage({ token: token, type: 'preview-error', error: e.message || 'Script error' }, '*');
  });
  window.addEventListener('unhandledrejection', function(e) {
    parent.postMessage({ token: token, type: 'preview-error', error: String(e.reason?.message || e.reason) }, '*');
  });
  window.addEventListener('load', function() {
    var frameCount = 0;
    function checkFrames() {
      frameCount++;
      if (frameCount < 4) {
        requestAnimationFrame(checkFrames);
      } else {
        parent.postMessage({ token: token, type: 'preview-loaded' }, '*');
      }
    }
    requestAnimationFrame(checkFrames);

    setTimeout(function() {
      try {
        var canvas = document.querySelector('canvas');
        if (canvas) {
          canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
        var btn = document.querySelector('button');
        if (btn) {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      } catch (e) {}
    }, 50);
  });
})();
</script>`;
          frame.srcdoc = fallbackHtml!.replace(/(<!doctype[^>]*>)/i, `$1${instrumentation}`);
        }
        document.body.appendChild(frame);
      });
    });
  }, [activePreview, fallbackHtml, fallbackIncomplete, isStreaming]);

  const [url, setUrl] = useState('');
  const [iframeUrl, setIframeUrl] = useState<string | undefined>();
  const [fallbackBlobUrl, setFallbackBlobUrl] = useState<string | undefined>();
  const fallbackBlobUrlRef = useRef<string | undefined>();

  // Serve fallback preview safely as a text/html blob without revoking active URLs under the iframe
  useEffect(() => {
    if (!displayFallbackHtml || activePreview) {
      if (fallbackBlobUrlRef.current) {
        const toRevoke = fallbackBlobUrlRef.current;
        fallbackBlobUrlRef.current = undefined;
        setFallbackBlobUrl(undefined);
        setTimeout(() => URL.revokeObjectURL(toRevoke), 500);
      }
      return;
    }

    const blob = new Blob([displayFallbackHtml], { type: 'text/html;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const oldUrl = fallbackBlobUrlRef.current;

    fallbackBlobUrlRef.current = objectUrl;
    setFallbackBlobUrl(objectUrl);

    if (oldUrl && oldUrl !== objectUrl) {
      setTimeout(() => URL.revokeObjectURL(oldUrl), 1000);
    }
  }, [displayFallbackHtml, activePreview]);

  // Clear cached blob when project is empty and idle.
  useEffect(() => {
    const hasFiles = Object.values(files).some((d) => d?.type === 'file' && Boolean(d.content));

    if (!hasFiles && !isStreaming && !activePreview) {
      lastGoodHtmlRef.current = undefined;

      if (fallbackBlobUrlRef.current) {
        const toRevoke = fallbackBlobUrlRef.current;
        fallbackBlobUrlRef.current = undefined;
        setTimeout(() => URL.revokeObjectURL(toRevoke), 500);
      }

      setFallbackBlobUrl(undefined);
    }
  }, [files, isStreaming, activePreview]);

  // Start a real project server after generation. Do not race Vite by
  // occupying port 5173 while the model's start action is still pending.
  useEffect(() => {
    if (isStreaming || activePreview) {
      return;
    }

    const projectFiles = Object.entries(files).filter(
      ([, dirent]) => dirent?.type === 'file' && Boolean(dirent.content),
    );
    if (projectFiles.length === 0) {
      return;
    }

    const hasPackageJson = projectFiles.some(([filePath]) => filePath.endsWith('package.json'));
    const latestMessageId = workbenchStore.artifactIdList[workbenchStore.artifactIdList.length - 1];
    const latestArtifact = latestMessageId ? workbenchStore.artifacts.get()[latestMessageId] : undefined;
    const hasStartAction = latestArtifact
      ? Object.values(latestArtifact.runner.actions.get()).some((action) => action.type === 'start')
      : false;

    if (hasPackageJson && hasStartAction) {
      return;
    }

    let cancelled = false;
    workbenchStore
      .waitForExecutionQueue()
      .then(() => {
        if (!cancelled && workbenchStore.previews.get().length === 0) {
          return workbenchStore.startStaticPreviewServer();
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isStreaming, activePreview, files]);

  // Forward keyboard events to iframe so user can play immediately without hunting for iframe focus
  useEffect(() => {
    const forwardKeyEvent = (type: 'keydown' | 'keyup') => (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) {
        return;
      }

      try {
        const eventInit: KeyboardEventInit = {
          key: e.key,
          code: e.code,
          location: e.location,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          repeat: e.repeat,
          bubbles: true,
          cancelable: true,
        };
        const evt = new KeyboardEvent(type, eventInit);
        iframe.contentWindow.dispatchEvent(evt);
        if (iframe.contentWindow.document) {
          iframe.contentWindow.document.dispatchEvent(evt);
        }
      } catch (err) {
        try {
          iframe.focus();
          iframe.contentWindow.focus();
        } catch (_) {}
      }
    };

    const onKeyDown = forwardKeyEvent('keydown');
    const onKeyUp = forwardKeyEvent('keyup');

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Toggle between responsive mode and device mode
  const [isDeviceModeOn, setIsDeviceModeOn] = useState(false);

  // Use percentage for width
  const [widthPercent, setWidthPercent] = useState<number>(37.5); // 375px assuming 1000px window width initially

  const resizingState = useRef({
    isResizing: false,
    side: null as ResizeSide,
    startX: 0,
    startWidthPercent: 37.5,
    windowWidth: window.innerWidth,
  });

  // Define the scaling factor
  const SCALING_FACTOR = 2; // Adjust this value to increase/decrease sensitivity

  useEffect(() => {
    if (activePreview) {
      const { baseUrl } = activePreview;
      setUrl(baseUrl);
      setIframeUrl(baseUrl);
    } else if (fallbackBlobUrl) {
      setUrl('http://localhost:5173/ (Live Game Preview)');
      setIframeUrl(fallbackBlobUrl);
    } else {
      setUrl('');
      setIframeUrl(undefined);
    }
  }, [activePreview, fallbackBlobUrl]);

  const validateUrl = useCallback(
    (value: string) => {
      if (!activePreview) {
        return false;
      }

      const { baseUrl } = activePreview;

      if (value === baseUrl) {
        return true;
      } else if (value.startsWith(baseUrl)) {
        return ['/', '?', '#'].includes(value.charAt(baseUrl.length));
      }

      return false;
    },
    [activePreview],
  );

  const findMinPortIndex = useCallback(
    (minIndex: number, preview: { port: number }, index: number, array: { port: number }[]) => {
      return preview.port < array[minIndex].port ? index : minIndex;
    },
    [],
  );

  // Keep the selected port valid and prefer a server that has reported ready.
  useEffect(() => {
    if (previews.length === 0) {
      if (activePreviewIndex !== 0) {
        setActivePreviewIndex(0);
      }
      return;
    }

    if (!previews[activePreviewIndex]) {
      const readyIndex = previews.findIndex((preview) => preview.ready);
      setActivePreviewIndex(readyIndex >= 0 ? readyIndex : 0);
      return;
    }

    if (previews.length > 1 && !hasSelectedPreview.current) {
      const readyIndex = previews.findIndex((preview) => preview.ready);
      const minPortIndex = previews.reduce(findMinPortIndex, 0);
      setActivePreviewIndex(readyIndex >= 0 ? readyIndex : minPortIndex);
    }
  }, [previews, activePreviewIndex, findMinPortIndex]);

  const reloadPreview = () => {
    if (iframeRef.current) {
      if (activePreview) {
        iframeRef.current.src = iframeUrl || activePreview.baseUrl;
      } else if (fallbackBlobUrl) {
        iframeRef.current.src = fallbackBlobUrl;
      } else if (displayFallbackHtml) {
        iframeRef.current.srcdoc = displayFallbackHtml;
      }
    }
  };

  const toggleFullscreen = async () => {
    if (!isFullscreen && containerRef.current) {
      await containerRef.current.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleDeviceMode = () => {
    setIsDeviceModeOn((prev) => !prev);
  };

  const startResizing = (e: React.MouseEvent, side: ResizeSide) => {
    if (!isDeviceModeOn) {
      return;
    }

    // Prevent text selection
    document.body.style.userSelect = 'none';

    resizingState.current.isResizing = true;
    resizingState.current.side = side;
    resizingState.current.startX = e.clientX;
    resizingState.current.startWidthPercent = widthPercent;
    resizingState.current.windowWidth = window.innerWidth;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    e.preventDefault(); // Prevent any text selection on mousedown
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!resizingState.current.isResizing) {
      return;
    }

    const dx = e.clientX - resizingState.current.startX;
    const windowWidth = resizingState.current.windowWidth;

    // Apply scaling factor to increase sensitivity
    const dxPercent = (dx / windowWidth) * 100 * SCALING_FACTOR;

    let newWidthPercent = resizingState.current.startWidthPercent;

    if (resizingState.current.side === 'right') {
      newWidthPercent = resizingState.current.startWidthPercent + dxPercent;
    } else if (resizingState.current.side === 'left') {
      newWidthPercent = resizingState.current.startWidthPercent - dxPercent;
    }

    // Clamp the width between 10% and 90%
    newWidthPercent = Math.max(10, Math.min(newWidthPercent, 90));

    setWidthPercent(newWidthPercent);
  };

  const onMouseUp = () => {
    resizingState.current.isResizing = false;
    resizingState.current.side = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    // Restore text selection
    document.body.style.userSelect = '';
  };

  // Handle window resize to ensure widthPercent remains valid
  useEffect(() => {
    const handleWindowResize = () => {
      /*
       * Optional: Adjust widthPercent if necessary
       * For now, since widthPercent is relative, no action is needed
       */
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  // A small helper component for the handle's "grip" icon
  const GripIcon = () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          color: 'rgba(0,0,0,0.5)',
          fontSize: '10px',
          lineHeight: '5px',
          userSelect: 'none',
          marginLeft: '1px',
        }}
      >
        ••• •••
      </div>
    </div>
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col relative"
      onMouseEnter={() => {
        try {
          iframeRef.current?.focus();
          iframeRef.current?.contentWindow?.focus();
        } catch (e) {}
      }}
      onClick={() => {
        try {
          iframeRef.current?.focus();
          iframeRef.current?.contentWindow?.focus();
        } catch (e) {}
      }}
    >
      {isPortDropdownOpen && (
        <div className="z-iframe-overlay w-full h-full absolute" onClick={() => setIsPortDropdownOpen(false)} />
      )}
      <div className="bg-bolt-elements-background-depth-2 p-2 flex items-center gap-1.5">
        <IconButton icon="i-ph:arrow-clockwise" onClick={reloadPreview} />

        <div
          className="flex items-center gap-1 flex-grow bg-bolt-elements-preview-addressBar-background border border-bolt-elements-borderColor text-bolt-elements-preview-addressBar-text rounded-full px-3 py-1 text-sm hover:bg-bolt-elements-preview-addressBar-backgroundHover hover:focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within:bg-bolt-elements-preview-addressBar-backgroundActive
        focus-within-border-bolt-elements-borderColorActive focus-within:text-bolt-elements-preview-addressBar-textActive"
        >
          <input
            ref={inputRef}
            id="preview-address-bar"
            name="previewAddress"
            aria-label="Preview address bar"
            className="w-full bg-transparent outline-none"
            type="text"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && validateUrl(url)) {
                setIframeUrl(url);

                if (inputRef.current) {
                  inputRef.current.blur();
                }
              }
            }}
          />
        </div>

        {previews.length > 1 && (
          <PortDropdown
            activePreviewIndex={activePreviewIndex}
            setActivePreviewIndex={setActivePreviewIndex}
            isDropdownOpen={isPortDropdownOpen}
            setHasSelectedPreview={(value) => (hasSelectedPreview.current = value)}
            setIsDropdownOpen={setIsPortDropdownOpen}
            previews={previews}
          />
        )}

        {/* Device mode toggle button */}
        <IconButton
          icon="i-ph:devices"
          onClick={toggleDeviceMode}
          title={isDeviceModeOn ? 'Switch to Responsive Mode' : 'Switch to Device Mode'}
        />

        {/* Fullscreen toggle button */}
        <IconButton
          icon={isFullscreen ? 'i-ph:arrows-in' : 'i-ph:arrows-out'}
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
        />
      </div>

      <div className="flex-1 border-t border-bolt-elements-borderColor flex justify-center items-center overflow-auto">
        <div
          style={{
            width: isDeviceModeOn ? `${widthPercent}%` : '100%',
            height: '100%', // Always full height
            overflow: 'visible',
            background: '#fff',
            position: 'relative',
            display: 'flex',
          }}
        >
          {activePreview || fallbackBlobUrl || displayFallbackHtml ? (
            <>
              <iframe
                ref={iframeRef}
                className="border-none w-full h-full bg-white"
                src={activePreview ? iframeUrl : fallbackBlobUrl}
                srcDoc={!activePreview && !fallbackBlobUrl ? displayFallbackHtml : undefined}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-pointer-lock"
                allow="cross-origin-isolated; autoplay; camera; microphone; clipboard-write; clipboard-read; fullscreen; encrypted-media; display-capture; geolocation"
                onLoad={() => {
                  try {
                    iframeRef.current?.focus();
                    iframeRef.current?.contentWindow?.focus();
                  } catch (e) {}
                }}
              />
              {isStreaming && (
                <div className="absolute top-3 right-3 z-10 flex items-center gap-2 px-3 py-1.5 bg-[#0c1f36]/95 border border-[#38bdf8]/40 text-sky-200 text-xs font-semibold shadow-lg select-none">
                  <span className="w-3.5 h-3.5 border-2 border-sky-300 border-t-transparent rounded-full animate-spin" />
                  AI updating…
                </div>
              )}
            </>
          ) : isStreaming ? (
            <div className="flex flex-col w-full h-full justify-center items-center bg-[#0d1527] text-slate-300 gap-3 p-6 text-center select-none">
              <div className="w-10 h-10 border-2 border-[#38bdf8] border-t-transparent animate-spin rounded-full" />
              <div className="text-sm font-semibold text-white">AI is building your game…</div>
              <div className="text-xs text-slate-400 max-w-sm">
                Preview will appear here as soon as the first playable files are ready.
              </div>
            </div>
          ) : (
            <div className="flex flex-col w-full h-full justify-center items-center bg-[#0d1527] text-slate-300 gap-4 p-6 text-center select-none">
              <div className="w-14 h-14 border border-[#38bdf8]/35 bg-[#0c1f36] flex items-center justify-center">
                <div className="i-ph:play-circle text-3xl text-[#38bdf8]" />
              </div>
              <div className="space-y-1.5">
                <div className="text-sm font-semibold text-white">Preview ready</div>
                <div className="text-xs text-slate-400 max-w-sm leading-relaxed">
                  Describe a game in chat and Fortz AI will build it here. No loading until generation starts.
                </div>
              </div>
            </div>
          )}

          {isDeviceModeOn && (
            <>
              {/* Left handle */}
              <div
                onMouseDown={(e) => startResizing(e, 'left')}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '15px',
                  marginLeft: '-15px',
                  height: '100%',
                  cursor: 'ew-resize',
                  background: 'rgba(255,255,255,.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                  userSelect: 'none',
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.5)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.2)')}
                title="Drag to resize width"
              >
                <GripIcon />
              </div>

              {/* Right handle */}
              <div
                onMouseDown={(e) => startResizing(e, 'right')}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: '15px',
                  marginRight: '-15px',
                  height: '100%',
                  cursor: 'ew-resize',
                  background: 'rgba(255,255,255,.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                  userSelect: 'none',
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.5)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.2)')}
                title="Drag to resize width"
              >
                <GripIcon />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

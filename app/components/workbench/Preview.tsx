import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore } from '~/lib/stores/workbench';
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
    if (activePreview) {
      return undefined;
    }

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
      return undefined;
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
      const clean = refPath.replace(/^\.?\/+/, '').replace(/^home\/project\/+/, '').trim();
      for (const [p, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file' && dirent.content) {
          const normP = p.replace(/^\.?\/+/, '').replace(/^home\/project\/+/, '').trim();
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
          return `<script${typeAttr} data-inlined="${src}">\n${js}\n</script>`;
        }
        // File not found in virtual FS — strip rather than leave a broken src= that 404s in blob context
        return `<!-- bolt-stripped: could not resolve "${src}" in virtual filesystem -->`;
      }
    );

    // 3. Dynamic Script Discovery (Bugs 1 & 2):
    // Scan project files for any unlinked .js files. Never use a hardcoded whitelist.
    // Inject all dependency modules (car.js, physics.js, etc.) FIRST, followed by
    // the entry point (main.js/game.js) LAST so main.js always has all classes defined.
    const isAlreadyInlined = (filename: string): boolean => {
      const base = filename.replace(/^.*[\\/]/, '');
      return bundled.includes(`data-inlined="${filename}"`) || bundled.includes(`data-inlined="${base}"`);
    };

    const entryCandidates = [
      'main.js', 'game.js', 'src/main.js', 'src/game.js',
      'index.js', 'app.js', 'engine.js', 'start.js',
    ];

    const projectJsFiles: string[] = [];
    for (const [p, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && dirent.content) {
        const norm = p.replace(/^\.?\/+/, '').replace(/^home\/project\/+/, '').trim();
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

    // CRITICAL: Guarantee Strict Standards Mode (Never Quirks Mode)
    // <!DOCTYPE html> MUST be at index 0 of the document.
    bundled = bundled.trim();
    const doctypeRegex = /<!DOCTYPE\s+html[^>]*>/i;
    if (doctypeRegex.test(bundled)) {
      bundled = '<!DOCTYPE html>\n' + bundled.replace(doctypeRegex, '').trim();
    } else {
      bundled = '<!DOCTYPE html>\n' + bundled;
    }

    // Ensure <meta charset="UTF-8"> exists
    if (!bundled.toLowerCase().includes('charset=')) {
      if (bundled.includes('<head>')) {
        bundled = bundled.replace('<head>', '<head>\n  <meta charset="UTF-8" />');
      } else if (bundled.includes('<head ')) {
        bundled = bundled.replace(/(<head[^>]*>)/i, '$1\n  <meta charset="UTF-8" />');
      } else if (bundled.includes('<html')) {
        bundled = bundled.replace(/(<html[^>]*>)/i, '$1\n<head>\n  <meta charset="UTF-8" />\n</head>');
      }
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

    if (bundled.includes('</body>')) {
      bundled = bundled.replace('</body>', `${focusHelper}\n</body>`);
    } else {
      bundled = bundled + '\n' + focusHelper;
    }

    return bundled;
  }, [activePreview, files]);

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

    if (fallbackHtml && !fallbackIncomplete) {
      lastGoodHtmlRef.current = fallbackHtml;
      return fallbackHtml;
    }

    // While AI works or if current HTML is incomplete, show last good build if available;
    // NEVER mount half-streamed syntax-broken code into the iframe.
    if (isStreaming || fallbackIncomplete) {
      return lastGoodHtmlRef.current;
    }

    return fallbackHtml;
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

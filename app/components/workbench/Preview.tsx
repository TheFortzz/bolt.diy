import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore } from '~/lib/stores/workbench';
import { PortDropdown } from './PortDropdown';

type ResizeSide = 'left' | 'right' | null;

export const Preview = memo(() => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [isPortDropdownOpen, setIsPortDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hasSelectedPreview = useRef(false);
  const previews = useStore(workbenchStore.previews);
  const files = useStore(workbenchStore.files);
  const activePreview = previews[activePreviewIndex];

  const fallbackHtml = useMemo(() => {
    if (activePreview) {
      return undefined;
    }

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

    // If no HTML file is found, but code files exist, synthesize an HTML5 canvas game container
    const hasCode = Object.entries(files).some(
      ([p, d]) => d?.type === 'file' && Boolean(d.content) && (p.endsWith('.js') || p.endsWith('.ts') || p.endsWith('.css')),
    );
    if (!htmlContent && hasCode) {
      htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Game Preview</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0b0f19; display: flex; align-items: center; justify-content: center; color: #fff; font-family: sans-serif; }
    canvas { display: block; max-width: 100%; max-height: 100%; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
</body>
</html>`;
    }

    if (!htmlContent) {
      return undefined;
    }

    let bundled = htmlContent;
    const handledCss = new Set<string>();
    const handledJs = new Set<string>();

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. Process CSS files and replace matching <link> tags or inject them
    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type !== 'file' || !dirent.content || !filePath.endsWith('.css')) {
        continue;
      }
      const fileName = filePath.replace(/^\/+/, '').replace(/^home\/project\//, '');
      const baseName = fileName.split('/').pop() || '';
      if (!baseName) continue;

      const linkRegex = new RegExp(
        `<link[^>]*href=["'][^"']*?(${escapeRegex(fileName)}|${escapeRegex(baseName)})["'][^>]*\\/?>`,
        'gi',
      );
      const prevCssBundled = bundled;
      bundled = bundled.replace(linkRegex, `<style data-file="${baseName}">\n${dirent.content}\n</style>`);
      if (bundled !== prevCssBundled) {
        handledCss.add(filePath);
      }
    }

    // Inject any CSS files not yet included in the HTML
    let extraCss = '';
    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type !== 'file' || !dirent.content || !filePath.endsWith('.css')) {
        continue;
      }
      if (!handledCss.has(filePath)) {
        extraCss += `<style data-file="${filePath.split('/').pop()}">\n${dirent.content}\n</style>\n`;
      }
    }
    if (extraCss) {
      if (bundled.includes('</head>')) {
        bundled = bundled.replace('</head>', `${extraCss}</head>`);
      } else {
        bundled = extraCss + bundled;
      }
    }

    // 2. Process JS / TS files and replace matching <script> tags
    for (const [filePath, dirent] of Object.entries(files)) {
      if (
        dirent?.type !== 'file' ||
        !dirent.content ||
        (!filePath.endsWith('.js') && !filePath.endsWith('.ts') && !filePath.endsWith('.mjs'))
      ) {
        continue;
      }
      const fileName = filePath.replace(/^\/+/, '').replace(/^home\/project\//, '');
      const baseName = fileName.split('/').pop() || '';
      if (!baseName) continue;

      const scriptRegex = new RegExp(
        `<script[^>]*src=["'][^"']*?(${escapeRegex(fileName)}|${escapeRegex(baseName)})["'][^>]*>(?:\\s*<\\/script>)?`,
        'gi',
      );
      const prevJsBundled = bundled;
      bundled = bundled.replace(
        scriptRegex,
        `<script type="module" data-file="${baseName}">\n${dirent.content}\n</script>`,
      );
      if (bundled !== prevJsBundled) {
        handledJs.add(filePath);
      }
    }

    // Inject any main JS files not yet included
    let extraJs = '';
    for (const [filePath, dirent] of Object.entries(files)) {
      if (
        dirent?.type !== 'file' ||
        !dirent.content ||
        (!filePath.endsWith('.js') && !filePath.endsWith('.ts') && !filePath.endsWith('.mjs'))
      ) {
        continue;
      }
      if (!handledJs.has(filePath)) {
        const base = filePath.split('/').pop() || '';
        if (
          base === 'main.js' ||
          base === 'index.js' ||
          base === 'game.js' ||
          base === 'app.js' ||
          Object.keys(files).length < 6
        ) {
          extraJs += `<script type="module" data-file="${base}">\n${dirent.content}\n</script>\n`;
        }
      }
    }
    if (extraJs) {
      if (bundled.includes('</body>')) {
        bundled = bundled.replace('</body>', `${extraJs}</body>`);
      } else {
        bundled = bundled + extraJs;
      }
    }

    // 3. Neutralize any dangling local relative scripts or links that would 404 against the host
    bundled = bundled.replace(
      /<script[^>]*src=["'](?!https?:\/\/|\/\/|data:|blob:)[^"']+["'][^>]*>(?:\s*<\/script>)?/gi,
      '<!-- removed missing local script -->',
    );
    bundled = bundled.replace(
      /<link[^>]*href=["'](?!https?:\/\/|\/\/|data:|blob:)[^"']+["'][^>]*\/?>/gi,
      '<!-- removed missing local stylesheet -->',
    );

    return bundled;
  }, [activePreview, files]);

  const [url, setUrl] = useState('');
  const [iframeUrl, setIframeUrl] = useState<string | undefined>();

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
    } else if (fallbackHtml) {
      setUrl('http://localhost:5173/ (Live Game Preview)');
      setIframeUrl(undefined);
    } else {
      setUrl('');
      setIframeUrl(undefined);
    }
  }, [activePreview, fallbackHtml]);

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

  // When previews change, display the lowest port if user hasn't selected a preview
  useEffect(() => {
    if (previews.length > 1 && !hasSelectedPreview.current) {
      const minPortIndex = previews.reduce(findMinPortIndex, 0);
      setActivePreviewIndex(minPortIndex);
    }
  }, [previews, findMinPortIndex]);

  const reloadPreview = () => {
    if (iframeRef.current) {
      if (activePreview) {
        iframeRef.current.src = iframeRef.current.src;
      } else if (fallbackHtml) {
        iframeRef.current.srcdoc = fallbackHtml;
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
    <div ref={containerRef} className="w-full h-full flex flex-col relative">
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
          {activePreview ? (
            <iframe
              ref={iframeRef}
              className="border-none w-full h-full bg-white"
              src={iframeUrl}
              allow="cross-origin-isolated; autoplay; camera; microphone; clipboard-write; clipboard-read; fullscreen; encrypted-media; display-capture; geolocation"
              allowFullScreen
            />
          ) : fallbackHtml ? (
            <iframe
              ref={iframeRef}
              className="border-none w-full h-full bg-white"
              srcDoc={fallbackHtml}
              allow="cross-origin-isolated; autoplay; camera; microphone; clipboard-write; clipboard-read; fullscreen; encrypted-media; display-capture; geolocation"
              allowFullScreen
            />
          ) : (
            <div className="flex flex-col w-full h-full justify-center items-center bg-[#0d1527] text-slate-300 gap-3 p-6 text-center select-none">
              <div className="w-10 h-10 border-2 border-[#38bdf8] border-t-transparent animate-spin rounded-full" />
              <div className="text-sm font-semibold text-white">Starting Game Preview…</div>
              <div className="text-xs text-slate-400 max-w-sm">Generating game code and launching preview server. Your game will appear here automatically.</div>
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

import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore } from '~/lib/stores/workbench';
import { registerPreviewValidator, type PreviewValidationResult } from '~/lib/runtime/preview-validation';
import { cleanWorkDirRelativePath } from '~/utils/diff';
import { PortDropdown } from './PortDropdown';
import { generatedAssets } from '~/lib/stores/generated-assets';
import { CookingStatus } from '~/components/chat/CookingStatus';
import { runStaticPreviewProbe } from '~/lib/runtime/preview-probe';
import { buildFallbackHtml } from '~/lib/runtime/static-preview';
import { getWebContainer } from '~/lib/webcontainer';

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
  const imageAssets = useStore(generatedAssets);
  const activePreview = previews[activePreviewIndex] ?? previews.find((preview) => preview.ready) ?? previews[0];

  // Rehydrate binary URLs after a saved checkpoint or a page reload. Binary
  // file-tree entries intentionally do not contain their payloads.
  useEffect(() => {
    let cancelled = false;
    const missing = Object.entries(files).filter(
      ([path, file]) =>
        file?.type === 'file' &&
        file.isBinary &&
        /\.png$/i.test(path) &&
        !generatedAssets.get()[cleanWorkDirRelativePath(path)],
    );

    if (!missing.length) {
      return undefined;
    }

    const restore = async () => {
      const container = await getWebContainer();

      for (const [rawPath] of missing.slice(0, 40)) {
        try {
          const path = cleanWorkDirRelativePath(rawPath);
          const bytes = await container.fs.readFile(path);
          if (cancelled) {
            return;
          }
          if (bytes.length > 5 * 1024 * 1024) {
            continue;
          }
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 32768) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
          }
          generatedAssets.setKey(path, {
            id: path,
            path,
            byteLength: bytes.length,
            dataUrl: `data:image/png;base64,${btoa(binary)}`,
          });
        } catch {
          // Leave missing images unresolved so the runtime probe reports them.
        }
      }
    };
    void restore();

    return () => {
      cancelled = true;
    };
  }, [files]);

  const fallbackHtml = useMemo(() => buildFallbackHtml(files, imageAssets), [files, imageAssets]);

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

  // Track active artifact ID to clear old game cache when a new project starts
  const currentArtifactIdRef = useRef<string | undefined>();
  const latestMessageId = workbenchStore.artifactIdList[workbenchStore.artifactIdList.length - 1];
  const latestArtifact = latestMessageId ? workbenchStore.artifacts.get()[latestMessageId] : undefined;
  const currentArtifactId = latestArtifact?.id;

  useEffect(() => {
    if (currentArtifactId && currentArtifactId !== currentArtifactIdRef.current) {
      currentArtifactIdRef.current = currentArtifactId;
      lastGoodHtmlRef.current = undefined;
      if (fallbackBlobUrlRef.current) {
        const toRevoke = fallbackBlobUrlRef.current;
        fallbackBlobUrlRef.current = undefined;
        setTimeout(() => URL.revokeObjectURL(toRevoke), 500);
      }
      setFallbackBlobUrl(undefined);
    }
  }, [currentArtifactId]);

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
    return registerPreviewValidator(async (verification): Promise<PreviewValidationResult> => {
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

      if (serverUrl && (projectHasPackage || !fallbackHtml)) {
        return {
          ok: false,
          error:
            'Dev-server preview is reachable, but runtime verification needs a browser worker or an authenticated preview bridge. Load events alone cannot verify this build.',
        };
      }

      return runStaticPreviewProbe(fallbackHtml!, verification);
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

  const reloadPreview = useCallback(() => {
    if (iframeRef.current) {
      if (activePreview) {
        const targetUrl = iframeUrl || activePreview.baseUrl;
        const sep = targetUrl.includes('?') ? '&' : '?';
        iframeRef.current.src = `${targetUrl}${sep}_cb=${Date.now()}`;
      } else if (fallbackBlobUrl) {
        iframeRef.current.src = fallbackBlobUrl;
      } else if (displayFallbackHtml) {
        iframeRef.current.srcdoc = displayFallbackHtml;
      }
    }
  }, [activePreview, iframeUrl, fallbackBlobUrl, displayFallbackHtml]);

  useEffect(() => {
    const handleReload = () => {
      reloadPreview();
    };

    window.addEventListener('fortz-play-while-building', handleReload);
    window.addEventListener('thefortz-build-finished', handleReload);

    return () => {
      window.removeEventListener('fortz-play-while-building', handleReload);
      window.removeEventListener('thefortz-build-finished', handleReload);
    };
  }, [reloadPreview]);

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
                sandbox={
                  !activePreview && !fallbackBlobUrl
                    ? 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock'
                    : 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-pointer-lock'
                }
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
                  <CookingStatus variant="compact" intervalMs={2400} />
                </div>
              )}
            </>
          ) : isStreaming ? (
            <div className="flex flex-col w-full h-full justify-center items-center bg-[#0d1527] text-slate-300 gap-3 p-6 text-center select-none">
              <div className="w-10 h-10 border-2 border-[#38bdf8] border-t-transparent animate-spin rounded-full" />
              <div className="text-sm font-semibold text-white">
                <CookingStatus variant="headline" />
              </div>
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

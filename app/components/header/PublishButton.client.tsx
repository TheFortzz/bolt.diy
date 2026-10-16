import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { generatedAssets } from '~/lib/stores/generated-assets';
import { chatId } from '~/lib/persistence';
import { toast } from 'react-toastify';

function buildGameVisualContext(files: Record<string, unknown>, assetPaths: string[]) {
  const assetNames = assetPaths
    .map((path) => path.replace(/\\/g, '/').split('/').pop())
    .filter(Boolean)
    .slice(0, 16);
  const sourceFiles = Object.entries(files)
    .filter(([path, content]) =>
      typeof content === 'string' &&
      /\.(?:html?|(?:m|c)?js|tsx?|css|md)$/i.test(path) &&
      !/(?:node_modules|\.min\.|\.env|dist\/|build\/|vendor\/)/i.test(path),
    )
    .sort(([left], [right]) => Number(/(?:index|main|game|scene|readme)/i.test(right)) - Number(/(?:index|main|game|scene|readme)/i.test(left)))
    .slice(0, 5)
    .map(([path, content]) => {
      const excerpt = String(content)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('//') && !line.startsWith('*') && line.length < 260)
        .slice(0, 12)
        .join(' ')
        .replace(/((?:api[_-]?key|secret|token|password)\s*[:=]\s*)["'][^"']+["']/gi, '$1"[redacted]"')
        .slice(0, 650);
      return excerpt ? `${path}: ${excerpt}` : '';
    })
    .filter(Boolean);

  return [
    assetNames.length ? `Generated game art/assets: ${assetNames.join(', ')}.` : '',
    sourceFiles.length ? `Game code context: ${sourceFiles.join(' ')}` : '',
  ].filter(Boolean).join('\n').slice(0, 3800);
}

export function PublishButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [publishStep, setPublishStep] = useState<'details' | 'cover'>('details');
  const [coverStatus, setCoverStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [coverError, setCoverError] = useState('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('ACTION');
  const [description, setDescription] = useState('');
  const [previewThumb, setPreviewThumb] = useState<string>('');
  const thumbnailRequestRef = useRef<AbortController | null>(null);
  const files = useStore(workbenchStore.files);
  const currentChatId = useStore(chatId);
  const projectIdentity = currentChatId || workbenchStore.firstArtifact?.id || 'default-project';
  const publishStorageKey = `thefortz:published:${projectIdentity}`;
  const [publishedStorageKey, setPublishedStorageKey] = useState<string | null>(null);
  const isPublished = publishedStorageKey === publishStorageKey;

  const hasFiles = Object.keys(files || {}).length > 0;

  useEffect(() => {
    if (!isOpen) {
      thumbnailRequestRef.current?.abort();
      thumbnailRequestRef.current = null;
      setIsGeneratingThumbnail(false);
      return;
    }
    setPublishStep('details');
    setCoverStatus('idle');
    setCoverError('');
    setPreviewThumb('');

    return () => {
      thumbnailRequestRef.current?.abort();
      thumbnailRequestRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    const refreshPublishedState = () => {
      try {
        setPublishedStorageKey(localStorage.getItem(publishStorageKey) ? publishStorageKey : null);
      } catch {
        setPublishedStorageKey(null);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === publishStorageKey) {
        refreshPublishedState();
      }
    };

    refreshPublishedState();
    window.addEventListener('storage', onStorage);

    return () => window.removeEventListener('storage', onStorage);
  }, [publishStorageKey]);

  // Auto-detect project title when modal opens or files change
  useEffect(() => {
    try {
      const artifacts = workbenchStore.artifacts.get();
      const latestId = workbenchStore.artifactIdList[workbenchStore.artifactIdList.length - 1];
      const latestArtifact = latestId ? artifacts[latestId] : undefined;

      if (latestArtifact?.title && !title) {
        setTitle(latestArtifact.title);
      }
    } catch (e) {}
  }, [isOpen, files]);

  const generateThumbnail = async () => {
    const finalTitle = title.trim();
    if (!finalTitle) return;

    setPublishStep('cover');
    setCoverStatus('generating');
    setCoverError('');
    setPreviewThumb('');
    setIsGeneratingThumbnail(true);
    thumbnailRequestRef.current?.abort();
    const controller = new AbortController();
    thumbnailRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 65_000);

    try {
      const projectFiles = (workbenchStore as any).files?.get?.() ?? files ?? {};
      const visualContext = buildGameVisualContext(
        projectFiles,
        Object.values(generatedAssets.get()).map((asset) => asset.path),
      );
      const response = await fetch('/api/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: finalTitle,
          genre,
          description: description.trim(),
          gameContext: visualContext,
        }),
        signal: controller.signal,
      });
      let result: { dataUrl?: string; error?: string } = {};
      try {
        result = (await response.json()) as { dataUrl?: string; error?: string };
      } catch {
        // The status below is more useful than a JSON parsing exception.
      }

      if (!response.ok || !result.dataUrl?.startsWith('data:image/')) {
        throw new Error(result.error || `AI cover generation returned HTTP ${response.status}.`);
      }

      setPreviewThumb(result.dataUrl);
      setCoverStatus('ready');
    } catch (error) {
      setCoverStatus('error');
      setCoverError(error instanceof Error ? error.message : 'The AI cover could not be generated.');
    } finally {
      window.clearTimeout(timeout);
      if (thumbnailRequestRef.current === controller) {
        thumbnailRequestRef.current = null;
        setIsGeneratingThumbnail(false);
      }
    }
  };

  const handleExportZip = async () => {
    try {
      setIsExporting(true);
      await workbenchStore.downloadZip();
      toast.success('Game package downloaded! Ready to publish.', { autoClose: 6000 });
    } catch (error) {
      toast.error(`Failed to package game files: ${(error as Error)?.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const executePublish = async () => {
    const finalTitle = title.trim();
    const finalGenre = genre || 'ACTION';

    if (!hasFiles) {
      toast.error('Build a game before publishing it.');
      return;
    }
    if (!finalTitle) {
      setPublishStep('details');
      toast.info('Enter a game name before continuing.');
      return;
    }
    if (coverStatus !== 'ready' || !previewThumb) {
      toast.info('Generate the game cover before publishing.');
      return;
    }

    try {
      if (isPublished || localStorage.getItem(publishStorageKey)) {
        setPublishedStorageKey(publishStorageKey);
        toast.info('This game has already been published.');

        return;
      }
    } catch {
      if (isPublished) {
        toast.info('This game has already been published.');
        return;
      }
    }

    try {
      setIsExporting(true);
      const thumbDataUrl = previewThumb;

      // Collect project files from the workbench store
      const projectFiles = (workbenchStore as any).files?.get?.() ?? files ?? {};

      /*
       * Binary assets (sprites, audio, 3D models) are not project source, so
       * they travel separately as data URLs. Without this a published game
       * keeps its assets/hero.png reference with nothing behind it.
       */
      const activeAssetPaths = new Set(
        Object.keys(projectFiles).map((path) =>
          path.replace(/^(?:\/home\/project\/|\/project\/|home\/project\/|project\/|\/|\.\/)+/, ''),
        ),
      );
      const assetPayloads = Object.fromEntries(
        Object.values(generatedAssets.get())
          .filter((asset) => activeAssetPaths.has(asset.path))
          .map((asset) => [asset.path, asset.dataUrl]),
      );
      let publicationStatus = 'live';

      if (window.parent !== window) {
        let parentOrigin = '';

        try {
          parentOrigin = new URL(document.referrer).origin;
        } catch {
          throw new Error('Could not securely connect to thefortz.me. Open the Studio from the site and try again.');
        }

        if (!parentOrigin || parentOrigin === 'null') {
          throw new Error('Could not securely connect to thefortz.me. Open the Studio from the site and try again.');
        }

        const requestId = crypto.randomUUID();
        publicationStatus = await new Promise<string>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            window.removeEventListener('message', onResult);
            reject(new Error('The site did not confirm the publish. Please try again.'));
          }, 120_000);
          const onResult = (event: MessageEvent) => {
            if (
              event.source !== window.parent ||
              event.origin !== parentOrigin ||
              event.data?.type !== 'thefortz-publish-result' ||
              event.data?.requestId !== requestId
            ) {
              return;
            }

            window.clearTimeout(timeout);
            window.removeEventListener('message', onResult);

            if (event.data.success) {
              resolve(typeof event.data.status === 'string' ? event.data.status : 'live');
            } else {
              reject(new Error(event.data.error || 'The site could not publish this game.'));
            }
          };

          window.addEventListener('message', onResult);
          window.parent.postMessage(
            {
              type: 'thefortz-publish-game',
              requestId,
              payload: {
                title: finalTitle,
                genre: finalGenre,
                description: description.trim(),
                thumbDataUrl,
                files: projectFiles,
                assets: assetPayloads,
              },
            },
            parentOrigin,
          );
        });
      } else {
        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: finalTitle,
            genre: finalGenre,
            description: description.trim(),
            thumbDataUrl,
            files: projectFiles,
            assets: assetPayloads,
          }),
        });
        const data = (await res.json()) as { success?: boolean; status?: string; error?: string };

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'The publish service did not confirm the game was saved.');
        }

        publicationStatus = data.status || 'live';
      }

      try {
        localStorage.setItem(publishStorageKey, JSON.stringify({ title: finalTitle, publishedAt: Date.now() }));
      } catch {
        // Keep the current button locked even if browser storage is unavailable.
      }
      setPublishedStorageKey(publishStorageKey);
      toast.success(`"${finalTitle}" published successfully!`);
      setIsOpen(false);
    } catch (err: any) {
      toast.error('Publish failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 publish-glow-container">
        <button
          type="button"
          onClick={() => !isPublished && setIsOpen(true)}
          className="publish-glow-button"
          disabled={isPublished}
          title={isPublished ? 'This game is already published' : 'Publish your game to thefortz.me'}
        >
          <div
            className={
              isPublished
                ? 'i-ph:check-circle-fill text-emerald-300 text-xs'
                : 'i-ph:rocket-launch text-orange-300 text-xs'
            }
          />
          <span>{isPublished ? 'PUBLISHED' : 'PUBLISH'}</span>
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-orange-400/60 bg-gradient-to-br from-[#123b72] via-[#102746] to-[#17213a] p-6 text-white relative shadow-[0_24px_90px_rgba(4,13,32,0.72)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-orange-300/25 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎮</span>
                <h3 className="font-extrabold text-lg tracking-wider uppercase text-orange-300 font-['Anton',sans-serif]">
                  Publish Game
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/70 hover:text-white px-2 py-1 text-sm rounded-none border border-transparent hover:border-white/20 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-sky-100/65">
              <span className={publishStep === 'details' ? 'text-orange-300' : ''}>1 · Game details</span>
              <span className="text-white/25">—</span>
              <span className={publishStep === 'cover' ? 'text-orange-300' : ''}>2 · AI cover</span>
            </div>

            {publishStep === 'details' ? (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">
                  Game name <span className="text-orange-300">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Cyber Runner"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                  className="w-full p-2 bg-[#0b1c35] border border-orange-300/35 focus:border-orange-300 focus:outline-none rounded-lg text-white text-sm"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">
                  Genre
                </label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full p-2 bg-[#0b1c35] border border-orange-300/35 focus:border-orange-300 focus:outline-none rounded-lg text-white text-sm"
                >
                  <option value="ACTION">Action</option>
                  <option value="ADVENTURE">Adventure</option>
                  <option value="PUZZLE">Puzzle</option>
                  <option value="RPG">RPG</option>
                  <option value="RACING">Racing</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">
                  Description (optional)
                </label>
                <textarea
                  placeholder="Tell players about your game..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1200}
                  className="w-full p-2 bg-[#0b1c35] border border-orange-300/35 focus:border-orange-300 focus:outline-none rounded-lg text-white text-sm"
                  rows={2}
                />
              </div>

              <div className="mt-1 flex flex-col items-stretch gap-2">
                <span className="text-[10px] text-sky-100/55">The cover will be based on your game files and generated art.</span>
                <button
                  onClick={() => void generateThumbnail()}
                  disabled={isGeneratingThumbnail || isExporting || !title.trim() || !hasFiles || isPublished}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-orange-200/60 bg-gradient-to-r from-orange-500 to-amber-400 px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-[#1c2230] transition-colors hover:from-orange-400 hover:to-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>Continue · Create cover</span>
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  onClick={() => void handleExportZip()}
                  disabled={isExporting || !hasFiles}
                  className="self-end rounded-lg border border-sky-300/25 bg-[#12315b]/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-100/75 transition-colors hover:bg-[#19447a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export ZIP backup
                </button>
              </div>
              {!hasFiles && <div className="text-[11px] text-sky-200/70">Add a game to this workspace before publishing.</div>}
            </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-orange-200/30 bg-[#06152b] shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                  {previewThumb ? (
                    <img src={previewThumb} alt={`${title} AI-generated game cover`} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-3 px-6 text-center">
                      <span className={isGeneratingThumbnail ? 'i-svg-spinners:90-ring-with-bg text-3xl text-orange-300' : 'i-ph:image-square text-4xl text-sky-200/50'} />
                      <span className="text-sm font-bold text-white/90">
                        {isGeneratingThumbnail ? 'Creating cover art for your game…' : 'Your generated cover will appear here'}
                      </span>
                      {isGeneratingThumbnail && <span className="text-[11px] text-sky-100/60">Using your game description, source files, and generated assets.</span>}
                    </div>
                  )}
                </div>

                {coverError && (
                  <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
                    Cover generation needs another try: {coverError}
                  </div>
                )}

                <button
                  onClick={executePublish}
                  disabled={isExporting || isGeneratingThumbnail || coverStatus !== 'ready' || !hasFiles || isPublished}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-orange-100/70 bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-300 px-4 py-3.5 text-sm font-black uppercase tracking-wider text-[#1c2230] shadow-[0_8px_24px_rgba(249,115,22,0.25)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{isExporting ? '⏳' : '🚀'}</span>
                  <span>{isExporting ? 'Publishing game and cover…' : 'Publish game'}</span>
                </button>

                {coverStatus === 'error' && !isExporting && (
                  <button
                    onClick={() => void generateThumbnail()}
                    className="self-center rounded-lg border border-orange-200/40 bg-orange-400/15 px-4 py-2 text-xs font-extrabold text-orange-100 hover:bg-orange-400/25"
                  >
                    Try cover again
                  </button>
                )}

                {isExporting && (
                  <div className="flex items-center justify-center gap-2 text-[11px] font-semibold text-sky-100/75" role="status" aria-live="polite">
                    <span className="i-svg-spinners:90-ring-with-bg text-sky-200" />
                    Uploading the cover and game files to the Games tab…
                  </div>
                )}
              </div>
            )}

            {publishStep === 'details' && (
              <div className="mt-4 flex items-start gap-1.5 border-t border-sky-200/15 pt-3 text-[11px] leading-normal text-sky-100/75">
                <span>💡</span>
                <span>Your generated game cover and game files are published together to thefortz.me.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

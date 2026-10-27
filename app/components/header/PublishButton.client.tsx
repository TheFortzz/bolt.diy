import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { generatedAssets } from '~/lib/stores/generated-assets';
import { bytesToDataUrl } from '~/lib/runtime/html5-game-import';
import { getWebContainer } from '~/lib/webcontainer';
import { chatId } from '~/lib/persistence';
import { toast } from 'react-toastify';

function prepareUploadedCover(file: File): Promise<string> {
  if (!/^image\/(?:png|jpe?g|webp)$/i.test(file.type)) {
    return Promise.reject(new Error('Choose a PNG, JPG, or WebP cover image.'));
  }

  if (file.size > 15 * 1024 * 1024) {
    return Promise.reject(new Error('Cover images must be smaller than 15 MB.'));
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;

      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('This browser could not prepare the uploaded cover.'));
        return;
      }

      const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      ctx.drawImage(image, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read that cover image.'));
    };
    image.src = objectUrl;
  });
}

export function PublishButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [publishStep, setPublishStep] = useState<'details' | 'cover'>('details');
  const [coverStatus, setCoverStatus] = useState<'idle' | 'ready'>('idle');
  const [coverError, setCoverError] = useState('');
  const [publishProgress, setPublishProgress] = useState('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('ACTION');
  const [description, setDescription] = useState('');
  const [previewThumb, setPreviewThumb] = useState<string>('');
  const coverUploadRef = useRef<HTMLInputElement>(null);
  const files = useStore(workbenchStore.files);
  const currentChatId = useStore(chatId);
  const projectIdentity = currentChatId || workbenchStore.firstArtifact?.id || 'default-project';
  const publishStorageKey = `thefortz:published:${projectIdentity}`;
  const [publishedStorageKey, setPublishedStorageKey] = useState<string | null>(null);
  const isPublished = publishedStorageKey === publishStorageKey;

  const hasFiles = Object.keys(files || {}).length > 0;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    setPublishStep('details');
    setCoverStatus('idle');
    setCoverError('');
    setPreviewThumb('');
    setPublishProgress('');

    return undefined;
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
    } catch {}
  }, [isOpen, files]);

  const uploadCover = async (file?: File) => {
    if (!file) {
      return;
    }

    setCoverError('');

    try {
      const dataUrl = await prepareUploadedCover(file);
      setPreviewThumb(dataUrl);
      setCoverStatus('ready');
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : 'Could not use that cover image.');
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
      setPublishStep('cover');
      toast.info('Upload a cover image before publishing.');

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
      setPublishProgress('Sending your game to thefortz.me…');

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

      /*
       * Collect the ACTUAL bytes for every binary file — regardless of how the
       * game arrived. Restored checkpoints keep binary Dirent entries with an
       * empty string content, so only the WebContainer filesystem (or an
       * in-memory Uint8Array payload) can supply the real data. Without this a
       * published game keeps its assets/hero.png reference with nothing behind
       * it and the Play tab renders a black screen.
       */
      {
        /*
         * Publishing source-only games must not depend on WebContainer boot
         * succeeding. Initialize it lazily only when a binary asset really
         * needs bytes from the virtual filesystem.
         */
        let webcontainer: Awaited<ReturnType<typeof getWebContainer>> | undefined;
        const mimeByExtension: Record<string, string> = {
          avif: 'image/avif',
          bin: 'application/octet-stream',
          fbx: 'application/octet-stream',
          gif: 'image/gif',
          glb: 'model/gltf-binary',
          gltf: 'model/gltf+json',
          ico: 'image/x-icon',
          jpeg: 'image/jpeg',
          jpg: 'image/jpeg',
          m4a: 'audio/mp4',
          mp3: 'audio/mpeg',
          mtl: 'text/plain',
          obj: 'model/obj',
          ogg: 'audio/ogg',
          otf: 'font/otf',
          png: 'image/png',
          svg: 'image/svg+xml',
          ttf: 'font/ttf',
          wav: 'audio/wav',
          wasm: 'application/wasm',
          webm: 'video/webm',
          webp: 'image/webp',
          woff: 'font/woff',
          woff2: 'font/woff2',
        };

        for (const [rawPath, rawEntry] of Object.entries(projectFiles as Record<string, unknown>)) {
          const entry = rawEntry as { type?: string; isBinary?: boolean; content?: unknown } | undefined;

          if (entry?.type !== 'file' || !entry.isBinary) {
            continue;
          }

          const assetPath = rawPath.replace(
            /^(?:\/home\/project\/|\/project\/|home\/project\/|project\/|\/|\.\/)+/,
            '',
          );

          if (!assetPath) {
            continue;
          }

          // The Studio's own static-server scripts are engine plumbing, not game assets.
          if (assetPath.split('/').some((part) => part.startsWith('.static_server'))) {
            continue;
          }

          if (assetPayloads[assetPath]) {
            continue;
          }

          if (entry.content instanceof Uint8Array) {
            const bytes = entry.content as Uint8Array;

            if (bytes.length > 0) {
              const extension = assetPath.split('.').pop()?.toLowerCase() || '';
              assetPayloads[assetPath] = bytesToDataUrl(
                bytes,
                mimeByExtension[extension] || 'application/octet-stream',
              );
            }

            continue;
          }

          try {
            webcontainer ||= await getWebContainer();

            const bytes = await webcontainer.fs.readFile(assetPath);

            if (!bytes || bytes.length === 0) {
              continue;
            }

            const extension = assetPath.split('.').pop()?.toLowerCase() || '';
            assetPayloads[assetPath] = bytesToDataUrl(bytes, mimeByExtension[extension] || 'application/octet-stream');
          } catch (error) {
            const detail = error instanceof Error ? ` ${error.message.slice(0, 180)}` : '';
            throw new Error(`Could not collect binary game asset "${assetPath}".${detail}`);
          }
        }
      }

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
        await new Promise<string>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            window.removeEventListener('message', onResult);
            reject(
              new Error(
                'Publishing is taking longer than expected. Check the Games tab before retrying to avoid a duplicate.',
              ),
            );
          }, 600_000);
          const onResult = (event: MessageEvent) => {
            if (
              event.source !== window.parent ||
              event.origin !== parentOrigin ||
              event.data?.requestId !== requestId
            ) {
              return;
            }

            if (event.data?.type === 'thefortz-publish-progress') {
              if (typeof event.data.status === 'string') {
                setPublishProgress(event.data.status.slice(0, 180));
              }

              return;
            }

            if (event.data?.type !== 'thefortz-publish-result') {
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
        setPublishProgress('Uploading the cover and game files…');

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
      setPublishProgress('');
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
                : 'i-ph:rocket-launch text-sky-300 text-xs'
            }
          />
          <span>{isPublished ? 'PUBLISHED' : 'PUBLISH'}</span>
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={() => {
            if (!isExporting) {
              setIsOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-sky-400/50 bg-gradient-to-br from-[#123b72] via-[#102746] to-[#0b1730] p-7 text-white relative shadow-[0_24px_90px_rgba(4,13,32,0.72)] font-['Outfit',sans-serif]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-sky-300/25 pb-4 mb-5">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="i-ph:game-controller text-2xl text-sky-300" />
                <h3 className="font-extrabold text-lg tracking-wider uppercase text-sky-100 font-['Syne',sans-serif]">
                  Publish Game
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                disabled={isExporting}
                className="text-white/70 hover:text-white px-2 py-1 text-sm rounded-none border border-transparent hover:border-white/20 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-sky-100/65">
              <span className={publishStep === 'details' ? 'text-sky-300' : ''}>1 · Game details</span>
              <span className="text-white/25">—</span>
              <span className={publishStep === 'cover' ? 'text-sky-300' : ''}>2 · Cover art</span>
            </div>

            {publishStep === 'details' ? (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">
                    Game name <span className="text-sky-300">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Cyber Runner"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    className="w-full p-2.5 bg-[#0b1c35] border border-sky-300/30 focus:border-sky-300 focus:outline-none rounded-lg text-white text-sm"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">
                    Genre
                  </label>
                  <select
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="w-full p-2.5 bg-[#0b1c35] border border-sky-300/30 focus:border-sky-300 focus:outline-none rounded-lg text-white text-sm"
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
                    className="w-full p-2.5 bg-[#0b1c35] border border-sky-300/30 focus:border-sky-300 focus:outline-none rounded-lg text-white text-sm"
                    rows={2}
                  />
                </div>

                <div className="mt-1 flex flex-col items-stretch gap-2">
                  <span className="text-[10px] text-sky-100/55">
                    Upload a PNG, JPG, or WebP cover image. A cover upload is required to publish.
                  </span>
                  <button
                    onClick={() => setPublishStep('cover')}
                    disabled={isExporting || !title.trim() || !hasFiles || isPublished}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-sky-200/60 bg-gradient-to-r from-blue-600 to-sky-500 px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-white transition-colors hover:from-blue-500 hover:to-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>Continue · Upload cover</span>
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
                {!hasFiles && (
                  <div className="text-[11px] text-sky-200/70">Add a game to this workspace before publishing.</div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div
                  role="button"
                  tabIndex={isExporting ? -1 : 0}
                  aria-label={previewThumb ? 'Replace game cover image' : 'Upload game cover image'}
                  aria-disabled={isExporting}
                  onClick={() => {
                    if (!isExporting) coverUploadRef.current?.click();
                  }}
                  onKeyDown={(event) => {
                    if (!isExporting && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      coverUploadRef.current?.click();
                    }
                  }}
                  className="group relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-sky-300/50 bg-blue-950/60 shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition-colors hover:border-sky-200 hover:bg-blue-900/60 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {previewThumb ? (
                    <img
                      src={previewThumb}
                      alt={`${title} game cover`}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 px-6 text-center">
                      <span aria-hidden="true" className="i-ph:upload-simple text-5xl text-sky-200/80 transition-transform group-hover:-translate-y-1" />
                      <span className="text-sm font-bold text-white/90">Choose a cover image</span>
                      <span className="text-[11px] text-sky-100/60">PNG, JPG, or WebP · required</span>
                    </div>
                  )}

                  {previewThumb && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/65 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <span aria-hidden="true" className="i-ph:upload-simple text-4xl text-sky-200" />
                      <span className="text-xs font-bold">Replace cover image</span>
                    </div>
                  )}
                </div>

                <input
                  ref={coverUploadRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    void uploadCover(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                {coverError && (
                  <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
                    {coverError}
                  </div>
                )}

                <button
                  onClick={executePublish}
                  disabled={isExporting || coverStatus !== 'ready' || !previewThumb || !hasFiles || isPublished}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-sky-100/70 bg-gradient-to-r from-blue-600 via-blue-500 to-sky-400 px-4 py-4 text-sm font-black uppercase tracking-wider text-white shadow-[0_8px_24px_rgba(37,99,235,0.3)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    aria-hidden="true"
                    className={isExporting ? 'i-svg-spinners:90-ring-with-bg' : 'i-ph:upload-simple'}
                  />
                  <span>{isExporting ? 'Publishing game and cover…' : 'Publish game'}</span>
                </button>

                {isExporting && (
                  <div
                    className="flex items-center justify-center gap-2 text-[11px] font-semibold text-sky-100/75"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="i-svg-spinners:90-ring-with-bg text-sky-200" />
                    {publishProgress || 'Publishing your game…'}
                  </div>
                )}
              </div>
            )}

            {publishStep === 'details' && (
              <div className="mt-4 flex items-start gap-1.5 border-t border-sky-200/15 pt-3 text-[11px] leading-normal text-sky-100/75">
                <span aria-hidden="true" className="i-ph:info text-sky-300" />
                <span>Your uploaded cover and game files are published together to thefortz.me.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

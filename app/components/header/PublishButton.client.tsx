import React, { useState, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatId } from '~/lib/persistence';
import { toast } from 'react-toastify';

function generateAutoThumbnail(gameTitle: string, gameGenre: string): string {
  if (typeof document === 'undefined') return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const colors: Record<string, [string, string]> = {
      ACTION: ['#dc2626', '#f97316'],
      ADVENTURE: ['#059669', '#10b981'],
      PUZZLE: ['#7c3aed', '#06b6d4'],
      RPG: ['#4f46e5', '#9333ea'],
      RACING: ['#eab308', '#ef4444'],
    };

    const [c1, c2] = colors[(gameGenre || 'ACTION').toUpperCase()] || ['#06b6d4', '#3b82f6'];

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 640, 360);
    grad.addColorStop(0, '#0a0f1d');
    grad.addColorStop(0.5, c1);
    grad.addColorStop(1, '#050811');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 360);

    // Decorative grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.5;
    for (let x = 0; x < 640; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 360);
      ctx.stroke();
    }
    for (let y = 0; y < 360; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(640, y);
      ctx.stroke();
    }

    // Glowing circle accent
    const radGrad = ctx.createRadialGradient(320, 180, 20, 320, 180, 220);
    radGrad.addColorStop(0, `${c2}55`);
    radGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, 640, 360);

    // Genre pill
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(40, 35, 120, 32, 16);
    } else {
      ctx.rect(40, 35, 120, 32);
    }
    ctx.fill();
    ctx.strokeStyle = c2;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((gameGenre || 'ACTION').toUpperCase(), 100, 51);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 12;
    const displayTitle = (gameTitle || 'NEW GAME').toUpperCase();
    ctx.fillText(displayTitle.length > 24 ? displayTitle.slice(0, 22) + '...' : displayTitle, 320, 180);
    ctx.shadowBlur = 0;

    // Brand tag
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('THEFORTZ.ME • STUDIO BUILT', 320, 325);

    return canvas.toDataURL('image/png');
  } catch (e) {
    return '';
  }
}

export function PublishButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('ACTION');
  const [description, setDescription] = useState('');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [previewThumb, setPreviewThumb] = useState<string>('');
  const files = useStore(workbenchStore.files);
  const currentChatId = useStore(chatId);
  const projectIdentity = currentChatId || workbenchStore.firstArtifact?.id || 'default-project';
  const publishStorageKey = `thefortz:published:${projectIdentity}`;
  const [publishedStorageKey, setPublishedStorageKey] = useState<string | null>(null);
  const isPublished = publishedStorageKey === publishStorageKey;

  const hasFiles = Object.keys(files || {}).length > 0;

  useEffect(() => {
    const refreshPublishedState = () => {
      try {
        setPublishedStorageKey(localStorage.getItem(publishStorageKey) ? publishStorageKey : null);
      } catch {
        setPublishedStorageKey(null);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === publishStorageKey) refreshPublishedState();
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

  // Update auto-generated thumbnail preview
  useEffect(() => {
    if (thumbnailFile) {
      const url = URL.createObjectURL(thumbnailFile);
      setPreviewThumb(url);
      return () => URL.revokeObjectURL(url);
    } else {
      const autoUrl = generateAutoThumbnail(title || 'My Game', genre || 'ACTION');
      setPreviewThumb(autoUrl);
    }
  }, [title, genre, thumbnailFile]);

  const handleExportZip = async () => {
    try {
      setIsExporting(true);
      await workbenchStore.downloadZip();
      toast.success('Game package downloaded! Ready to publish.', {
        autoClose: 6000,
      });
    } catch (err: any) {
      toast.error('Failed to package game files: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  const executePublish = async () => {
    const finalTitle = title.trim() || 'My Game';
    const finalGenre = genre || 'ACTION';

    if (!hasFiles) {
      toast.error('Build a game before publishing it.');
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

      // Convert thumbnail or use auto-generated thumbnail
      let thumbDataUrl = '';
      if (thumbnailFile) {
        thumbDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(thumbnailFile);
        });
      } else {
        setIsGeneratingThumbnail(true);
        try {
          const response = await fetch('/api/generate-thumbnail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: finalTitle,
              genre: finalGenre,
              description: description.trim(),
            }),
          });
          const generated = (await response.json()) as { dataUrl?: string; error?: string };

          if (!response.ok || !generated.dataUrl) {
            throw new Error(generated.error || 'The AI cover could not be generated.');
          }

          thumbDataUrl = generated.dataUrl;
          setPreviewThumb(thumbDataUrl);
        } catch (error) {
          thumbDataUrl = generateAutoThumbnail(finalTitle, finalGenre);
          const detail = error instanceof Error ? error.message : '';
          toast.info(
            detail
              ? `AI cover unavailable: ${detail} Publishing with a local fallback cover.`
              : 'AI cover unavailable; publishing with a local fallback cover.',
            { autoClose: 6500 },
          );
        } finally {
          setIsGeneratingThumbnail(false);
        }
      }

      // Collect project files from the workbench store
      const projectFiles = (workbenchStore as any).files?.get?.() ?? files ?? {};
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
          <div className={isPublished ? 'i-ph:check-circle-fill text-emerald-300 text-xs' : 'i-ph:rocket-launch text-orange-300 text-xs'} />
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
                <h3 className="font-extrabold text-lg tracking-wider uppercase text-orange-300 font-['Anton',sans-serif]">Publish Game</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/70 hover:text-white px-2 py-1 text-sm rounded-none border border-transparent hover:border-white/20 transition-all cursor-pointer"
              >✕</button>
            </div>

            <p className="text-xs text-slate-200 mb-4 leading-relaxed font-medium">
              Publish directly to <strong className="text-orange-300">thefortz.me</strong>. AI cover art is generated automatically unless you upload a custom thumbnail.
            </p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">Game Name</label>
                <input
                  type="text"
                  placeholder="e.g. Cyber Runner"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full p-2 bg-[#0b1c35] border border-orange-300/35 focus:border-orange-300 focus:outline-none rounded-lg text-white text-sm"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">Genre</label>
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
                <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide mb-1 block">Description (optional)</label>
                <textarea
                  placeholder="Tell players about your game..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-2 bg-[#0b1c35] border border-orange-300/35 focus:border-orange-300 focus:outline-none rounded-lg text-white text-sm"
                  rows={2}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-sky-100/80 uppercase tracking-wide">Thumbnail</label>
                  <span className="text-[10px] text-sky-200">AI-generated or custom</span>
                </div>

                {previewThumb && (
                  <div className="mb-2 w-full h-24 overflow-hidden rounded-lg border border-sky-200/30 bg-[#071a35] flex items-center justify-center">
                    <img src={previewThumb} alt="Game Thumbnail Preview" className="w-full h-full object-cover" />
                  </div>
                )}

                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setThumbnailFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-sky-100 file:mr-2 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-orange-500 file:text-white hover:file:bg-orange-400 cursor-pointer"
                />
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <button
                  onClick={executePublish}
                  disabled={isExporting || !hasFiles || isPublished}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-orange-200/60 bg-gradient-to-r from-orange-500 to-amber-400 px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-[#1c2230] transition-colors hover:from-orange-400 hover:to-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{isExporting ? '⏳' : '🚀'}</span>
                  <span>{isGeneratingThumbnail ? 'Creating cover…' : isExporting ? 'Publishing…' : 'Publish'}</span>
                </button>

                <button
                  onClick={handleExportZip}
                  disabled={isExporting || !hasFiles}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-sky-300/30 bg-[#12315b] px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-50 transition-colors hover:bg-[#19447a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>📥</span>
                  <span>Export ZIP Backup</span>
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-1.5 border-t border-sky-200/15 pt-3 text-[11px] leading-normal text-sky-100/75">
              <span>💡</span>
              <span>Hosting is 100% free! Published games appear live on thefortz.me instantly.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

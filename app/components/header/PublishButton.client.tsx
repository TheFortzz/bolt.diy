import React, { useState, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
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
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('ACTION');
  const [description, setDescription] = useState('');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [previewThumb, setPreviewThumb] = useState<string>('');
  const files = useStore(workbenchStore.files);

  const hasFiles = Object.keys(files || {}).length > 0;

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

  const executePublish = async (forcedTitle?: string, forcedGenre?: string) => {
    const finalTitle = (forcedTitle ?? title).trim() || 'My Game';
    const finalGenre = (forcedGenre ?? genre) || 'ACTION';

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
        thumbDataUrl = generateAutoThumbnail(finalTitle, finalGenre);
      }

      // Collect project files from the workbench store
      const projectFiles = (workbenchStore as any).files?.get?.() ?? files ?? {};

      // Post to parent (BoltStudioIframePage) which will call publishGame
      if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'thefortz-publish-game',
            payload: {
              title: finalTitle,
              genre: finalGenre,
              description: description.trim(),
              thumbDataUrl,
              files: projectFiles,
            },
          },
          '*',
        );
        toast.success(`🚀 Publishing "${finalTitle}" to thefortz.me…`);
        setIsOpen(false);
      } else {
        // Standalone — download zip as fallback
        await handleExportZip();
        window.open('https://thefortz.me', '_blank', 'noopener,noreferrer');
      }
    } catch (err: any) {
      toast.error('Publish failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  // One-click quick auto publish
  const handleQuickAutoPublish = async () => {
    let detectedTitle = title.trim();
    if (!detectedTitle) {
      try {
        const artifacts = workbenchStore.artifacts.get();
        const latestId = workbenchStore.artifactIdList[workbenchStore.artifactIdList.length - 1];
        detectedTitle = (latestId && artifacts[latestId]?.title) || 'Studio Game';
      } catch (e) {
        detectedTitle = 'Studio Game';
      }
    }
    await executePublish(detectedTitle, genre || 'ACTION');
  };

  return (
    <>
      <div className="flex items-center gap-1.5 publish-glow-container">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="publish-glow-button"
          title="Publish your game to thefortz.me"
        >
          <div className="i-ph:rocket-launch text-[#03a9f4] text-xs" />
          <span>PUBLISH GAME</span>
        </button>

        <button
          type="button"
          onClick={handleQuickAutoPublish}
          disabled={isExporting || !hasFiles}
          className="hidden sm:flex items-center gap-1 py-1.5 px-2.5 text-[11px] font-extrabold uppercase tracking-wider text-black bg-[#10b981] hover:bg-[#34d399] transition-all cursor-pointer shadow-md disabled:opacity-50"
          title="Instant 1-Click Auto-Publish to thefortz.me"
        >
          <span>⚡</span>
          <span>AUTO-PUBLISH</span>
        </button>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-md bg-[#0e1422] border border-[#10b981]/40 rounded-none p-6 text-white relative shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/15 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎮</span>
                <h3 className="font-extrabold text-lg tracking-wider uppercase text-emerald-400 font-['Anton',sans-serif]">Publish Game</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/70 hover:text-white px-2 py-1 text-sm rounded-none border border-transparent hover:border-white/20 transition-all cursor-pointer"
              >✕</button>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed font-medium">
              Publish directly to <strong className="text-emerald-300">thefortz.me</strong>. Thumbnail will be auto-generated if none is uploaded.
            </p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wide mb-1 block">Game Name</label>
                <input
                  type="text"
                  placeholder="e.g. Cyber Runner"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full p-2 bg-[#121929] border border-[#10b981]/30 rounded-none text-white text-sm"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wide mb-1 block">Genre</label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full p-2 bg-[#121929] border border-[#10b981]/30 rounded-none text-white text-sm"
                >
                  <option value="ACTION">Action</option>
                  <option value="ADVENTURE">Adventure</option>
                  <option value="PUZZLE">Puzzle</option>
                  <option value="RPG">RPG</option>
                  <option value="RACING">Racing</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wide mb-1 block">Description (optional)</label>
                <textarea
                  placeholder="Tell players about your game..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-2 bg-[#121929] border border-[#10b981]/30 rounded-none text-white text-sm"
                  rows={2}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wide">Thumbnail</label>
                  <span className="text-[10px] text-emerald-400">Auto-generated or custom</span>
                </div>

                {previewThumb && (
                  <div className="mb-2 w-full h-24 overflow-hidden border border-white/20 bg-black/40 flex items-center justify-center">
                    <img src={previewThumb} alt="Game Thumbnail Preview" className="w-full h-full object-cover" />
                  </div>
                )}

                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setThumbnailFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-white file:mr-2 file:py-1 file:px-2 file:rounded-none file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 cursor-pointer"
                />
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <button
                  onClick={() => executePublish()}
                  disabled={isExporting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 font-bold text-xs uppercase tracking-wider text-black bg-[#10b981] hover:bg-[#059669] rounded-none border border-emerald-300/60 cursor-pointer transition-all disabled:opacity-50 font-extrabold"
                >
                  <span>{isExporting ? '⏳' : '🚀'}</span>
                  <span>{isExporting ? 'Publishing to thefortz.me…' : 'Publish to thefortz.me'}</span>
                </button>

                <button
                  onClick={handleExportZip}
                  disabled={isExporting || !hasFiles}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 font-bold text-xs uppercase tracking-wider text-white bg-[#1e293b] hover:bg-[#334155] rounded-none border border-white/20 cursor-pointer transition-all disabled:opacity-50"
                >
                  <span>📥</span>
                  <span>Export ZIP Backup</span>
                </button>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-white/10 text-[11px] text-emerald-300/70 leading-normal flex items-start gap-1.5">
              <span>💡</span>
              <span>Hosting is 100% free! Published games appear live on thefortz.me instantly.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

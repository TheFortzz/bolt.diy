import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { toast } from 'react-toastify';

export function PublishButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const files = useStore(workbenchStore.files);

  const hasFiles = Object.keys(files || {}).length > 0;

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

  const handlePublish = async () => {
    if (!title.trim()) { toast.error('Game name is required.'); return; }
    if (!genre) { toast.error('Please select a genre.'); return; }
    if (!thumbnailFile) { toast.error('Thumbnail image is required.'); return; }

    try {
      setIsExporting(true);

      // Convert thumbnail to base64 data URL
      const thumbDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(thumbnailFile);
      });

      // Collect project files from the workbench store
      const projectFiles = (workbenchStore as any).files?.get?.() ?? files ?? {};

      // Post to parent (BoltStudioIframePage) which will call publishGame
      if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'thefortz-publish-game',
            payload: {
              title: title.trim(),
              genre,
              description: description.trim(),
              thumbDataUrl,
              files: projectFiles,
            },
          },
          '*',
        );
        toast.success('Publishing your game to thefortz.me…');
        setIsOpen(false);
        setTitle('');
        setGenre('');
        setDescription('');
        setThumbnailFile(null);
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

  return (
    <>
      <div className="publish-glow-container">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="publish-glow-button"
          title="Publish your game"
        >
          <div className="i-ph:rocket-launch text-[#03a9f4] text-xs" />
          <span>PUBLISH GAME</span>
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
            <p className="text-xs text-slate-300 mb-5 leading-relaxed font-medium">Enter game details and publish to thefortz.me.</p>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Game Name (required)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2 bg-[#121929] border border-[#10b981]/30 rounded-none text-white"
              />
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full p-2 bg-[#121929] border border-[#10b981]/30 rounded-none text-white"
              >
                <option value="">Select Genre (required)</option>
                <option value="ACTION">Action</option>
                <option value="ADVENTURE">Adventure</option>
                <option value="PUZZLE">Puzzle</option>
                <option value="RPG">RPG</option>
                <option value="RACING">Racing</option>
              </select>
              <textarea
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-2 bg-[#121929] border border-[#10b981]/30 rounded-none text-white"
                rows={3}
              />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setThumbnailFile(e.target.files?.[0] || null)}
                className="w-full text-white"
              />
              <button
                onClick={handlePublish}
                disabled={isExporting}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 font-bold text-xs uppercase tracking-wider text-black bg-[#10b981] hover:bg-[#059669] rounded-none border border-emerald-300/60 cursor-pointer transition-all disabled:opacity-50 font-extrabold"
              >
                <span>{isExporting ? '⏳' : '🚀'}</span>
                <span>{isExporting ? 'Publishing...' : 'Publish Game Feed'}</span>
              </button>
              <button
                onClick={handleExportZip}
                disabled={isExporting || !hasFiles}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 font-bold text-xs uppercase tracking-wider text-white bg-[#f97316] hover:bg-[#ea580c] rounded-none border border-orange-400/40 cursor-pointer transition-all disabled:opacity-50 font-extrabold"
              >
                <span>📥</span>
                <span>Export Game ZIP (.zip)</span>
              </button>
            </div>
            <div className="mt-5 pt-3 border-t border-white/10 text-[11px] text-blue-300/60 leading-normal flex items-start gap-1.5">
              <span>💡</span>
              <span>Hosting is 100% free! Games run client-side in the user's browser, so there are never any server or hosting costs.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

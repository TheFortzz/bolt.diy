import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { toast } from 'react-toastify';

export function PublishButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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

  const handlePublishToTheFortz = async () => {
    // If running in an iframe inside thefortz.me, signal the parent to open the upload modal
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'fortz-open-upload' }, '*');
    }

    // Also download the zip for them so they have the file ready to drag-and-drop
    await handleExportZip();

    // If standalone, open the live platform in a new tab
    if (typeof window !== 'undefined' && window.location.hostname !== 'thefortz.me') {
      window.open('https://thefortz.me', '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 text-xs font-extrabold text-white bg-[#10b981] hover:bg-[#059669] px-3 py-1.5 rounded-none border border-emerald-300/40 transition-all cursor-pointer uppercase tracking-wider"
        title="Publish your game"
      >
        <span>🚀</span>
        <span>PUBLISH GAME</span>
      </button>

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
                <h3 className="font-extrabold text-lg tracking-wider uppercase text-emerald-400 font-['Anton',sans-serif]">
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

            <p className="text-xs text-slate-300 mb-5 leading-relaxed font-medium">
              Publish your game to the live feed! Anyone can play it directly in their browser for free.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={handlePublishToTheFortz}
                disabled={isExporting}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 font-bold text-xs uppercase tracking-wider text-black bg-[#10b981] hover:bg-[#059669] rounded-none border border-emerald-300/60 cursor-pointer transition-all disabled:opacity-50 font-extrabold"
              >
                <span>{isExporting ? '⏳' : '🚀'}</span>
                <span>{isExporting ? 'Packaging Game...' : 'Publish Game Feed'}</span>
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
              <span>
                Hosting is 100% free! Games run client-side in the user's browser, so there are never any server or hosting costs.
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
      toast.success('Game package downloaded! Upload this ZIP on TheFortz to publish.', {
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

    // If standalone, open thefortz.me in a new tab
    if (typeof window !== 'undefined' && window.location.hostname !== 'thefortz.me') {
      window.open('https://thefortz.me', '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 text-xs font-extrabold text-white bg-gradient-to-r from-emerald-600 via-green-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-3 py-1.5 border border-emerald-400/40 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all cursor-pointer uppercase tracking-wider"
        style={{ borderRadius: '1px' }}
        title="Publish your game to TheFortz feed"
      >
        <span>🚀</span>
        <span>PUBLISH GAME</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-md bg-[#0e1957] border border-[#38bdf8]/40 shadow-[0_10px_40px_rgba(0,0,0,0.8),0_0_20px_rgba(56,189,248,0.2)] p-6 text-white relative"
            style={{ borderRadius: '1px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎮</span>
                <h3 className="font-extrabold text-lg tracking-wider uppercase text-transparent bg-clip-text bg-gradient-to-r from-white via-sky-200 to-emerald-300 font-['Anton',sans-serif]">
                  Publish to THEFORTZ
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-zinc-400 hover:text-white px-2 py-1 text-sm border border-transparent hover:border-white/20 transition-all cursor-pointer"
                style={{ borderRadius: '1px' }}
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-blue-200/80 mb-5 leading-relaxed">
              Publish your game to the live TheFortz feed! Anyone can play it directly in their browser for free.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={handlePublishToTheFortz}
                disabled={isExporting}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 font-bold text-xs uppercase tracking-wider text-white bg-gradient-to-r from-emerald-600 via-green-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border border-emerald-400/50 shadow-lg cursor-pointer transition-all disabled:opacity-50"
                style={{ borderRadius: '1px' }}
              >
                <span>{isExporting ? '⏳' : '🚀'}</span>
                <span>{isExporting ? 'Packaging Game...' : 'Publish to TheFortz Feed'}</span>
              </button>

              <button
                onClick={handleExportZip}
                disabled={isExporting || !hasFiles}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 font-bold text-xs uppercase tracking-wider text-blue-200 bg-[#1730b8]/40 hover:bg-[#1730b8]/70 border border-blue-400/30 cursor-pointer transition-all disabled:opacity-50"
                style={{ borderRadius: '1px' }}
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

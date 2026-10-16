import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { prepareHtml5GameImport, type Html5GameImport } from '~/lib/runtime/html5-game-import';
import { harnessIsBusy, harnessState } from '~/lib/stores/harness';
import { validationState } from '~/lib/runtime/build-validator';
import { workbenchStore } from '~/lib/stores/workbench';

interface GameImportModalProps {
  open: boolean;
  onClose: () => void;
}

export function GameImportModal({ open, onClose }: GameImportModalProps) {
  const zipInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<Html5GameImport>();
  const [validationError, setValidationError] = useState('');
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const harness = useStore(harnessState);
  const buildBusy = harnessIsBusy(harness.phase);

  useEffect(() => {
    if (!open) {
      setSelection(undefined);
      setValidationError('');
    }
  }, [open]);

  if (!open) return null;

  const handleSelection = async (files: File[]) => {
    setSelection(undefined);
    setValidationError('');

    if (!files.length) return;

    setValidating(true);

    try {
      setSelection(await prepareHtml5GameImport(files));
    } catch (error) {
      setValidationError((error as Error).message || 'This upload is not a supported HTML5 game.');
    } finally {
      setValidating(false);
      if (zipInput.current) zipInput.current.value = '';
      if (filesInput.current) filesInput.current.value = '';
      if (folderInput.current) folderInput.current.value = '';
    }
  };

  const handleContinue = async () => {
    if (!selection || importing || buildBusy) return;

    setImporting(true);

    try {
      await workbenchStore.importHtml5Game(selection.files);
      validationState.set({ status: 'idle', detail: 'Uploaded game is running in the Game preview.' });
      toast.success('HTML5 game imported and opened in Game preview.');
      setSelection(undefined);
      onClose();
    } catch (error) {
      setValidationError((error as Error).message || 'The game could not be copied into the workspace.');
    } finally {
      setImporting(false);
    }
  };

  const sizeLabel = selection
    ? selection.totalBytes < 1024 * 1024
      ? `${Math.max(1, Math.round(selection.totalBytes / 1024))} KB`
      : `${(selection.totalBytes / (1024 * 1024)).toFixed(1)} MB`
    : '';

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-[#050713]/80 p-4 backdrop-blur-md"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !importing) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-import-title"
        className="w-full max-w-xl overflow-hidden border border-cyan-200/20 bg-[linear-gradient(145deg,#121a32_0%,#101020_58%,#1c1030_100%)] text-white shadow-[0_28px_100px_rgba(0,0,0,.6)]"
      >
        <div className="flex items-start gap-4 border-b border-white/10 px-5 py-5 sm:px-7">
          <img src="/thefortzicon.png" alt="" className="mt-0.5 h-10 w-10 object-contain" />
          <div className="min-w-0 flex-1">
            <h2 id="game-import-title" className="text-lg font-black tracking-wide text-white">
              Import an HTML5 game
            </h2>
            <p className="mt-1 text-sm leading-5 text-slate-300">
              Choose a ZIP or the built game files. We’ll check that it can run in a browser before importing it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            aria-label="Close upload dialog"
            className="grid h-8 w-8 shrink-0 place-items-center text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <span className="i-ph:x-bold text-lg" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-7">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => zipInput.current?.click()}
              disabled={validating || importing}
              className="group flex min-h-28 flex-col items-center justify-center gap-2 border border-white/10 bg-white/[0.035] px-4 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/50 hover:bg-cyan-300/[0.07] disabled:opacity-50"
            >
              <span className="i-ph:file-zip text-2xl text-cyan-200" />
              <span>Choose a ZIP</span>
              <span className="text-xs font-normal text-slate-400">One archive, up to 24 MB unpacked</span>
            </button>
            <button
              type="button"
              onClick={() => filesInput.current?.click()}
              disabled={validating || importing}
              className="group flex min-h-28 flex-col items-center justify-center gap-2 border border-white/10 bg-white/[0.035] px-4 text-sm font-semibold text-slate-100 transition hover:border-violet-300/50 hover:bg-violet-300/[0.07] disabled:opacity-50"
            >
              <span className="i-ph:files text-2xl text-violet-200" />
              <span>Choose game files</span>
              <span className="text-xs font-normal text-slate-400">Select index.html and its files</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => folderInput.current?.click()}
            disabled={validating || importing}
            className="flex w-full items-center justify-center gap-2 border border-white/10 px-3 py-2.5 text-sm text-slate-300 transition hover:border-white/25 hover:bg-white/[0.04] hover:text-white disabled:opacity-50"
          >
            <span className="i-ph:folder-open text-lg text-amber-200" />
            Select a game folder instead
          </button>

          <input
            ref={zipInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => void handleSelection(Array.from(event.target.files || []))}
          />
          <input
            ref={filesInput}
            type="file"
            multiple
            accept=".html,.htm,.js,.mjs,.cjs,.css,.json,.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.ico,.mp3,.wav,.ogg,.m4a,.mp4,.webm,.wasm,.gltf,.glb,.bin,.woff,.woff2,.ttf,.otf"
            className="hidden"
            onChange={(event) => void handleSelection(Array.from(event.target.files || []))}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            accept=".html,.htm,.js,.mjs,.cjs,.css,.json,.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.ico,.mp3,.wav,.ogg,.m4a,.mp4,.webm,.wasm,.gltf,.glb,.bin,.woff,.woff2,.ttf,.otf"
            className="hidden"
            onChange={(event) => void handleSelection(Array.from(event.target.files || []))}
            {...({ webkitdirectory: '', directory: '' } as any)}
          />

          {validating && (
            <div
              className="flex items-center gap-2 border border-cyan-300/20 bg-cyan-300/[0.05] px-3 py-3 text-sm text-cyan-100"
              role="status"
            >
              <span className="i-svg-spinners:90-ring-with-bg text-lg" />
              Checking browser compatibility and entry files…
            </div>
          )}

          {selection && !validating && (
            <div className="flex items-start gap-3 border border-emerald-300/25 bg-emerald-400/[0.07] px-3 py-3.5">
              <span className="i-ph:check-circle-fill mt-0.5 text-lg text-emerald-300" />
              <div className="min-w-0 text-sm">
                <div className="font-semibold text-emerald-100">HTML5 game accepted</div>
                <div className="mt-1 text-xs text-emerald-100/70">
                  {selection.entryPoint} · {selection.files.length} files · {sizeLabel}
                </div>
                <div className="mt-1 text-xs text-emerald-100/60">This replaces the current workspace files.</div>
              </div>
            </div>
          )}

          {validationError && (
            <div
              className="border border-amber-300/25 bg-amber-300/[0.06] px-3 py-3 text-sm leading-5 text-amber-100"
              role="alert"
            >
              <span className="i-ph:warning-circle mr-2 align-[-2px] text-base" />
              {validationError}
            </div>
          )}

          {buildBusy && (
            <div className="border border-amber-300/25 bg-amber-300/[0.06] px-3 py-2.5 text-xs leading-5 text-amber-100">
              Stop the active build before replacing its workspace.
            </div>
          )}

          <div className="border-t border-white/10 pt-3 text-[11px] leading-5 text-slate-400">
            Supports built HTML, JavaScript, CSS and game assets. TypeScript and native C/C++ projects must be compiled
            to browser-ready HTML5 first.
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={!selection || validating || importing || buildBusy}
            className="flex items-center gap-2 bg-gradient-to-r from-cyan-300 to-violet-300 px-5 py-2 text-sm font-bold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {importing ? (
              <span className="i-svg-spinners:90-ring-with-bg" />
            ) : (
              <span className="i-ph:arrow-right-bold" />
            )}
            {importing ? 'Importing…' : 'Continue'}
          </button>
        </div>
      </section>
    </div>
  );
}

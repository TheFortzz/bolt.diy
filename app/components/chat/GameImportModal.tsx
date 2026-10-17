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
    }
  };

  const handleContinue = async () => {
    if (!selection || importing || buildBusy) return;

    setImporting(true);

    try {
      await workbenchStore.importHtml5Game(selection.files);
      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          window.clearTimeout(timeout);
          resolve();
        };
        const timeout = window.setTimeout(finish, 10_000);
        window.dispatchEvent(new CustomEvent('thefortz-html5-game-imported', { detail: { onCheckpointed: finish } }));
      });
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
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#34445f] bg-[#111827] text-[#f1f5f9] shadow-[0_32px_110px_rgba(0,0,0,.72)]"
      >
        <div className="flex items-start gap-4 border-b border-[#29364a] bg-[#151f30] px-5 py-5 sm:px-7">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[#3b6478] bg-[#132a38]">
            <img src="/thefortzicon.png" alt="" className="h-9 w-9 object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[10px] font-black uppercase tracking-[.22em] text-[#7dd3fc]">HTML5 · Game import</div>
            <h2 id="game-import-title" className="text-xl font-black tracking-wide text-[#f8fafc]">
              Import an HTML5 game
            </h2>
            <p className="mt-1 text-sm leading-5 text-[#cbd5e1]">
              Choose a ZIP or game files. Any <code className="rounded bg-[#263449] px-1 text-[#bae6fd]">.html</code> page works—we’ll make it <code className="rounded bg-[#263449] px-1 text-[#bae6fd]">index.html</code> for the Game iframe.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            aria-label="Close upload dialog"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#aab7c8] transition hover:bg-[#273449] hover:text-white disabled:opacity-40"
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
              className="group flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-[#356078] bg-[#142b39] px-4 text-sm font-bold text-[#f1f5f9] transition hover:border-[#67c6e8] hover:bg-[#19384a] disabled:opacity-50"
            >
              <span className="i-ph:file-zip text-2xl text-cyan-200" />
              <span>Choose a ZIP</span>
              <span className="text-xs font-normal text-[#c0ccda]">Finds the first HTML page inside</span>
            </button>
            <button
              type="button"
              onClick={() => filesInput.current?.click()}
              disabled={validating || importing}
              className="group flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-[#5a4e7b] bg-[#242039] px-4 text-sm font-bold text-[#f1f5f9] transition hover:border-[#a78bfa] hover:bg-[#2e284a] disabled:opacity-50"
            >
              <span className="i-ph:files text-2xl text-violet-200" />
              <span>Choose game files</span>
              <span className="text-xs font-normal text-[#c0ccda]">Select any .html page and its assets</span>
            </button>
          </div>

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
            className="hidden"
            onChange={(event) => void handleSelection(Array.from(event.target.files || []))}
          />
          {validating && (
            <div
              className="flex items-center gap-2 rounded-lg border border-[#356078] bg-[#142b39] px-3 py-3 text-sm text-[#d8f3ff]"
              role="status"
            >
              <span className="i-svg-spinners:90-ring-with-bg text-lg" />
              Checking browser compatibility and entry files…
            </div>
          )}

          {selection && !validating && (
            <div className="flex items-start gap-3 rounded-lg border border-[#34745b] bg-[#122d26] px-3 py-3.5">
              <span className="i-ph:check-circle-fill mt-0.5 text-lg text-emerald-300" />
              <div className="min-w-0 text-sm">
                <div className="font-semibold text-[#d1fae5]">HTML5 game accepted</div>
                <div className="mt-1 text-xs text-[#b7e4ce]">
                  {selection.entryPoint} · {selection.files.length} files · {sizeLabel}
                </div>
                <div className="mt-1 text-xs text-[#b7e4ce]">This replaces the current workspace files.</div>
              </div>
            </div>
          )}

          {validationError && (
            <div
              className="rounded-lg border border-[#80622d] bg-[#332816] px-3 py-3 text-sm leading-5 text-[#ffedc2]"
              role="alert"
            >
              <span className="i-ph:warning-circle mr-2 align-[-2px] text-base" />
              {validationError}
            </div>
          )}

          {buildBusy && (
            <div className="rounded-lg border border-[#80622d] bg-[#332816] px-3 py-2.5 text-xs leading-5 text-[#ffedc2]">
              Stop the active build before replacing its workspace.
            </div>
          )}

          <div className="border-t border-[#29364a] pt-3 text-[11px] leading-5 text-[#c0ccda]">
            The archive or selection must contain at least one .html file. We keep its neighboring game files and run them in the Game iframe.
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#29364a] bg-[#0f1724] px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="rounded-lg px-4 py-2 text-sm text-[#d1d9e4] transition hover:bg-[#273449] hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={!selection || validating || importing || buildBusy}
            className="flex items-center gap-2 rounded-lg bg-[#7dd3fc] px-5 py-2 text-sm font-bold text-[#0b1724] transition hover:bg-[#a5e2fb] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {importing ? (
              <span className="i-svg-spinners:90-ring-with-bg" />
            ) : (
              <span className="i-ph:arrow-right-bold" />
            )}
            {importing ? 'Opening Game…' : 'Import & run game'}
          </button>
        </div>
      </section>
    </div>
  );
}

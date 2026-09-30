import { useStore } from '@nanostores/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { toast } from 'react-toastify';
import {
  CodeMirrorEditor,
  type EditorDocument,
  type EditorSettings,
  type OnChangeCallback as OnEditorChange,
  type OnSaveCallback as OnEditorSave,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { classNames } from '~/utils/classNames';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeader } from '~/components/ui/PanelHeader';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import type { FileMap } from '~/lib/stores/files';
import { themeStore } from '~/lib/stores/theme';
import { WORK_DIR } from '~/utils/constants';
import { renderLogger } from '~/utils/logger';
import { isMobile } from '~/utils/mobile';
import { FileBreadcrumb } from './FileBreadcrumb';
import { FileTree } from './FileTree';
import { DEFAULT_TERMINAL_SIZE, TerminalTabs } from './terminal/TerminalTabs';
import { workbenchStore } from '~/lib/stores/workbench';
import { computeDiffDocument, computeStreamingDiffDocument, MAX_LIVE_DIFF_LENGTH } from '~/utils/editorDiff';
import { getWebContainer } from '~/lib/webcontainer';
import { cleanWorkDirRelativePath } from '~/utils/diff';

interface EditorPanelProps {
  files?: FileMap;
  unsavedFiles?: Set<string>;
  completedFiles?: Set<string>;
  editorDocument?: EditorDocument;
  selectedFile?: string | undefined;
  isStreaming?: boolean;
  followStream?: boolean;
  onEditorChange?: OnEditorChange;
  onEditorScroll?: OnEditorScroll;
  onFileSelect?: (value?: string) => void;
  onFileSave?: OnEditorSave;
  onFileReset?: () => void;
}

const DEFAULT_EDITOR_SIZE = 100 - DEFAULT_TERMINAL_SIZE;

const editorSettings: EditorSettings = { tabSize: 2 };

function parentFolderOf(selectedFile?: string) {
  if (!selectedFile) return WORK_DIR;
  const parts = selectedFile.replace(/\/+$/, '').split('/');
  parts.pop();
  const parent = parts.join('/');
  return parent || WORK_DIR;
}

function isImageFilePath(path?: string): boolean {
  if (!path) return false;
  return /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i.test(path);
}

interface ImageViewerProps {
  filePath: string;
}

const ImageViewer = memo(({ filePath }: ImageViewerProps) => {
  const [src, setSrc] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number; bytes?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;

    async function load() {
      setLoading(true);
      setError(null);
      setZoom(1);

      try {
        const cleanPath = cleanWorkDirRelativePath(filePath);
        const wc = await getWebContainer();
        const data = await wc.fs.readFile(cleanPath);

        if (cancelled) return;

        const ext = cleanPath.split('.').pop()?.toLowerCase() || 'png';
        const mimeTypes: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          svg: 'image/svg+xml',
          webp: 'image/webp',
          ico: 'image/x-icon',
          bmp: 'image/bmp',
        };
        const mime = mimeTypes[ext] || 'image/png';
        const blob = new Blob([data], { type: mime });
        url = URL.createObjectURL(blob);

        setSrc(url);
        setDimensions({ width: 0, height: 0, bytes: data.byteLength });
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load image');
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [filePath]);

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleDownload = () => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = filePath.split('/').pop() || 'image.png';
    a.click();
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0f1d] select-none overflow-hidden text-left font-sans">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/80 text-xs">
        <div className="flex items-center gap-3">
          {dimensions && dimensions.width > 0 && (
            <span className="font-mono text-slate-300">
              {dimensions.width} × {dimensions.height} px
            </span>
          )}
          {dimensions?.bytes !== undefined && (
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-slate-400 font-mono text-[11px]">
              {formatBytes(dimensions.bytes)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Zoom Out"
          >
            <div className="i-ph:magnifying-glass-minus text-sm" />
          </button>
          <span className="font-mono text-xs w-12 text-center text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Zoom In"
          >
            <div className="i-ph:magnifying-glass-plus text-sm" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="px-2 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/50 transition-colors"
            title="Reset Zoom"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors ml-1"
            title="Download Image"
          >
            <div className="i-ph:download-simple text-sm" />
          </button>
        </div>
      </div>

      {/* Image Preview Canvas with Checkerboard pattern */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-6 relative">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <div className="i-svg-spinners:90-ring-with-bg text-2xl text-emerald-400" />
            <span className="text-xs">Loading image…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 text-rose-400 text-xs">
            <div className="i-ph:warning-circle text-2xl" />
            <span>{error}</span>
          </div>
        ) : src ? (
          <div
            className="rounded-lg shadow-2xl p-4 border border-slate-700/60 transition-transform duration-100 ease-out flex items-center justify-center max-w-[90%] max-h-[85%]"
            style={{
              backgroundImage:
                'repeating-conic-gradient(#1e293b 0% 25%, #0f172a 0% 50%)',
              backgroundSize: '20px 20px',
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >
            <img
              src={src}
              alt={filePath}
              className="max-w-full max-h-[70vh] object-contain drop-shadow-md select-none pointer-events-none"
              onLoad={(e) => {
                const img = e.currentTarget;
                setDimensions((prev) => ({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                  bytes: prev?.bytes,
                }));
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});

export const EditorPanel = memo(
  ({
    files,
    unsavedFiles,
    completedFiles,
    editorDocument,
    selectedFile,
    isStreaming,
    followStream = isStreaming,
    onFileSelect,
    onEditorChange,
    onEditorScroll,
    onFileSave,
    onFileReset,
  }: EditorPanelProps) => {
    renderLogger.trace('EditorPanel');

    const theme = useStore(themeStore);
    const showTerminal = useStore(workbenchStore.showTerminal);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    const currentFilePath = editorDocument?.filePath || selectedFile;
    const isImage = isImageFilePath(currentFilePath) || Boolean(editorDocument?.isBinary);

    const activeFileSegments = useMemo(() => {
      if (!currentFilePath) {
        return undefined;
      }

      return currentFilePath.split('/');
    }, [currentFilePath]);

    const activeFileUnsaved = useMemo(() => {
      return !isImage && editorDocument !== undefined && unsavedFiles?.has(editorDocument.filePath);
    }, [isImage, editorDocument, unsavedFiles]);

    const [manualMode, setManualMode] = useState<{ key: string; value: 'code' | 'diff' }>();
    const diffKey = `${editorDocument?.filePath ?? ''}:${editorDocument?.aiEditMessageId ?? ''}`;

    const hasDiff = Boolean(
      editorDocument?.originalContent !== undefined &&
      editorDocument.originalContent !== editorDocument.value,
    );
    const diffTooLarge = hasDiff &&
      (editorDocument!.originalContent!.length + editorDocument!.value.length > MAX_LIVE_DIFF_LENGTH);
    const showDiff = Boolean(hasDiff && !diffTooLarge &&
      (manualMode?.key === diffKey ? manualMode.value === 'diff' : editorDocument?.aiEditMessageId && !editorDocument.aiCreated));

    const diffStats = useMemo(() => {
      if (!hasDiff || diffTooLarge || editorDocument?.originalContent === undefined) return undefined;
      return followStream
        ? computeStreamingDiffDocument(editorDocument.originalContent, editorDocument.value)
        : computeDiffDocument(editorDocument.originalContent, editorDocument.value);
    }, [hasDiff, diffTooLarge, followStream, editorDocument?.originalContent, editorDocument?.value]);

    const handleAddFile = async () => {
      const folder = parentFolderOf(selectedFile);
      const name = window.prompt('New file name', 'untitled.js');
      if (!name?.trim()) return;

      try {
        const path = await workbenchStore.createFile(`${folder}/${name.trim()}`, '');
        onFileSelect?.(path);
        toast.success(`Created ${name.trim()}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to create file');
      }
    };

    const handleAddFolder = async () => {
      const folder = parentFolderOf(selectedFile);
      const name = window.prompt('New folder name', 'new-folder');
      if (!name?.trim()) return;

      try {
        await workbenchStore.createFolder(`${folder}/${name.trim()}`);
        toast.success(`Created folder ${name.trim()}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to create folder');
      }
    };

    const handleUploadClick = () => {
      uploadInputRef.current?.click();
    };

    const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const list = event.target.files;
      if (!list || list.length === 0) return;

      try {
        const created = await workbenchStore.uploadFiles(list, parentFolderOf(selectedFile));
        if (created[0]) onFileSelect?.(created[0]);
        toast.success(created.length === 1 ? 'File uploaded' : `${created.length} files uploaded`);
      } catch (err: any) {
        toast.error(err?.message || 'Upload failed');
      } finally {
        event.target.value = '';
      }
    };

    return (
      <PanelGroup direction="horizontal" className="h-full">
        {/* Files: full height down the left of the workspace */}
        <Panel defaultSize={22} minSize={12} collapsible>
          <div className="flex flex-col border-r border-bolt-elements-borderColor h-full min-h-0">
            <PanelHeader className="justify-between gap-1 pr-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="i-ph:tree-structure-duotone shrink-0" />
                <span className="truncate">Files</span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <IconButton
                  title="Upload file"
                  className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                  onClick={handleUploadClick}
                >
                  <div className="i-ph:upload-simple text-base" />
                </IconButton>
                <IconButton
                  title="New File"
                  className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                  onClick={handleAddFile}
                >
                  <div className="i-ph:file-plus text-base" />
                </IconButton>
                <IconButton
                  title="New Folder"
                  className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
                  onClick={handleAddFolder}
                >
                  <div className="i-ph:folder-plus text-base" />
                </IconButton>
                <input
                  ref={uploadInputRef}
                  id="workspace-file-upload"
                  name="workspaceFileUpload"
                  aria-label="Upload files to workspace"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleUploadChange}
                />
              </div>
            </PanelHeader>
            <div className="flex-1 min-h-0 overflow-auto">
              <FileTree
                className="h-full"
                files={files}
                hideRoot
                unsavedFiles={unsavedFiles}
                completedFiles={completedFiles}
                rootFolder={WORK_DIR}
                selectedFile={selectedFile}
                onFileSelect={onFileSelect}
              />
            </div>
          </div>
        </Panel>
        <PanelResizeHandle />
        {/* Editor + Terminal stacked on the right */}
        <Panel defaultSize={78} minSize={30}>
          <PanelGroup direction="vertical" className="h-full">
            <Panel defaultSize={showTerminal ? DEFAULT_EDITOR_SIZE : 100} minSize={20}>
              <div className="flex flex-col h-full min-h-0">
                <PanelHeader className="overflow-x-auto">
                  {activeFileSegments?.length && (
                    <div className="flex items-center flex-1 text-sm">
                      <FileBreadcrumb pathSegments={activeFileSegments} files={files} onFileSelect={onFileSelect} />
                      {!isImage && hasDiff && !diffTooLarge && diffStats && (
                        <div className="flex items-center gap-1.5 ml-auto mr-2">
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor text-bolt-elements-textSecondary flex items-center gap-1">
                            <span className="text-emerald-400 font-bold">+{diffStats.addedCount}</span>
                            <span className="text-rose-400 font-bold">-{diffStats.deletedCount}</span>
                          </span>
                          <PanelHeaderButton
                            onClick={() => setManualMode({ key: diffKey, value: showDiff ? 'code' : 'diff' })}
                            className={classNames('text-xs', { 'text-cyan-400 font-semibold': showDiff })}
                            title={showDiff ? 'Show editable source code' : 'Show changed lines with context'}
                          >
                            <div className={showDiff ? 'i-ph:git-diff-duotone' : 'i-ph:code-duotone'} />
                            {showDiff ? (followStream ? 'Live diff' : 'Diff') : 'Code'}
                          </PanelHeaderButton>
                          <PanelHeaderButton
                            disabled={isStreaming}
                            onClick={() => {
                              if (editorDocument) {
                                workbenchStore.acceptDiff(editorDocument.filePath);
                              }
                            }}
                            className="text-xs text-emerald-400 hover:text-emerald-300"
                          >
                            <div className="i-ph:check-bold" />
                            Accept
                          </PanelHeaderButton>
                        </div>
                      )}
                      {!isImage && diffTooLarge && (
                        <span className="ml-auto mr-2 text-xs text-bolt-elements-textSecondary" title="Large file: showing code to keep the editor responsive">
                          Diff unavailable for large file
                        </span>
                      )}
                      {!isImage && activeFileUnsaved && (
                        <div className="flex gap-1 ml-auto -mr-1.5">
                          <PanelHeaderButton onClick={onFileSave}>
                            <div className="i-ph:floppy-disk-duotone" />
                            Save
                          </PanelHeaderButton>
                          <PanelHeaderButton onClick={onFileReset}>
                            <div className="i-ph:clock-counter-clockwise-duotone" />
                            Reset
                          </PanelHeaderButton>
                        </div>
                      )}
                    </div>
                  )}
                </PanelHeader>
                <div className="h-full flex-1 overflow-hidden min-h-0">
                  {isImage && currentFilePath ? (
                    <ImageViewer filePath={currentFilePath} />
                  ) : (
                    <CodeMirrorEditor
                      theme={theme}
                      editable={!isStreaming && editorDocument !== undefined && (!hasDiff || !showDiff)}
                      isStreaming={followStream}
                      showDiff={showDiff}
                      diffResult={diffStats}
                      settings={editorSettings}
                      doc={editorDocument}
                      autoFocusOnDocumentChange={!isMobile()}
                      onScroll={onEditorScroll}
                      onChange={onEditorChange}
                      onSave={onFileSave}
                    />
                  )}
                </div>
              </div>
            </Panel>
            <PanelResizeHandle />
            <TerminalTabs />
          </PanelGroup>
        </Panel>
      </PanelGroup>
    );
  },
);

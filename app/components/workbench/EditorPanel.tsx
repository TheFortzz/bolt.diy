import { useStore } from '@nanostores/react';
import { memo, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { toast } from 'react-toastify';
import {
  CodeMirrorEditor,
  computeDiffDocument,
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

    const activeFileSegments = useMemo(() => {
      if (!editorDocument) {
        return undefined;
      }

      return editorDocument.filePath.split('/');
    }, [editorDocument]);

    const activeFileUnsaved = useMemo(() => {
      return editorDocument !== undefined && unsavedFiles?.has(editorDocument.filePath);
    }, [editorDocument, unsavedFiles]);

    const [showDiff, setShowDiff] = useState(true);

    const hasDiff = Boolean(
      editorDocument?.originalContent &&
      editorDocument.originalContent !== editorDocument.value,
    );

    const diffStats = useMemo(() => {
      if (!hasDiff || !editorDocument?.originalContent) return undefined;
      return computeDiffDocument(editorDocument.originalContent, editorDocument.value);
    }, [hasDiff, editorDocument?.originalContent, editorDocument?.value]);

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
                      {hasDiff && diffStats && (
                        <div className="flex items-center gap-1.5 ml-auto mr-2">
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor text-bolt-elements-textSecondary flex items-center gap-1">
                            <span className="text-emerald-400 font-bold">+{diffStats.addedCount}</span>
                            <span className="text-rose-400 font-bold">-{diffStats.deletedCount}</span>
                          </span>
                          <PanelHeaderButton
                            onClick={() => setShowDiff(!showDiff)}
                            className={classNames('text-xs', { 'text-cyan-400 font-semibold': showDiff })}
                          >
                            <div className={showDiff ? 'i-ph:git-diff-duotone' : 'i-ph:code-duotone'} />
                            {showDiff ? 'Diff' : 'Code'}
                          </PanelHeaderButton>
                          <PanelHeaderButton
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
                      {activeFileUnsaved && (
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
                  <CodeMirrorEditor
                    theme={theme}
                    editable={!isStreaming && editorDocument !== undefined && (!hasDiff || !showDiff)}
                    isStreaming={followStream}
                    showDiff={showDiff}
                    settings={editorSettings}
                    doc={editorDocument}
                    autoFocusOnDocumentChange={!isMobile()}
                    onScroll={onEditorScroll}
                    onChange={onEditorChange}
                    onSave={onFileSave}
                  />
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

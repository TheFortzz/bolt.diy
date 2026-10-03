import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { PublishButton } from '~/components/header/PublishButton.client';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import useViewport from '~/lib/hooks';
import Cookies from 'js-cookie';
import { validationState } from '~/lib/runtime/build-validator';
import {
  applyProjectSnapshot,
  captureProject,
  checkpointBusy,
  latestCheckpoint,
  refreshLatestCheckpoint,
  restoreCheckpoint,
} from '~/lib/persistence/checkpoints';
import { chatId, dbPromise, getMessages, setMessages } from '~/lib/persistence';
import { getWebContainer } from '~/lib/webcontainer';
import { startActivity, updateActivity } from '~/lib/stores/activity';

const EditorPanel = lazy(() => import('./EditorPanel').then((module) => ({ default: module.EditorPanel })));
const Preview = lazy(() => import('./Preview').then((module) => ({ default: module.Preview })));

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
}

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: {
    value: 'code',
    text: 'Code',
  },
  right: {
    value: 'preview',
    text: 'Preview',
  },
};

function WorkspacePanelLoader({ label }: { label: string }) {
  return (
    <div
      className="grid h-full w-full place-content-center justify-items-center gap-3 bg-gradient-to-br from-blue-50 via-white to-violet-50 text-sm font-medium text-slate-600"
      role="status"
      aria-live="polite"
    >
      <span className="i-svg-spinners:90-ring-with-bg text-2xl text-blue-600" aria-hidden="true" />
      {label}
    </div>
  );
}

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

export const Workbench = memo(({ chatStarted, isStreaming }: WorkspaceProps) => {
  renderLogger.trace('Workbench');

  const [isSyncing, setIsSyncing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [pinPlayView, setPinPlayView] = useState(false);

  const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const streamingFile = useStore(workbenchStore.streamingFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const completedFiles = useStore(workbenchStore.completedFiles);
  const files = useStore(workbenchStore.files);
  const selectedView = useStore(workbenchStore.currentView);
  const [mountedViews, setMountedViews] = useState<Record<WorkbenchViewType, boolean>>(() => ({
    code: true,
    preview: true,
  }));
  const validation = useStore(validationState);
  const activeChatId = useStore(chatId);
  const checkpoint = useStore(latestCheckpoint);
  const checkpointOperation = useStore(checkpointBusy);

  useEffect(() => {
    if (!activeChatId) return;

    let cancelled = false;
    dbPromise.then(async (database) => {
      if (database && !cancelled) {
        try {
          await refreshLatestCheckpoint(database, activeChatId);
        } catch (error) {
          console.warn('Unable to load working checkpoint:', error);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  const handleRestoreCheckpoint = async () => {
    if (
      !activeChatId ||
      isStreaming ||
      validation.status === 'checking' ||
      checkpointOperation !== 'idle' ||
      isRestoring
    )
      return;

    if (
      !window.confirm('Restore the last verified build? This discards unsaved changes and removes later chat messages.')
    )
      return;

    if (checkpoint?.chatId === activeChatId) {
      startActivity(
        checkpoint.messageId,
        'checkpoint:restore',
        'Restoring working checkpoint',
        'Working checkpoint restored',
      );
    }

    setIsRestoring(true);
    let previousFiles: Record<string, Uint8Array> | undefined;
    let wc: Awaited<ReturnType<typeof getWebContainer>> | undefined;
    let restoredFiles = false;

    try {
      const database = await dbPromise;

      const chat = await getMessages(database, activeChatId);
      if (!chat) throw new Error('Project chat could not be loaded.');

      const latest =
        checkpoint?.chatId === activeChatId ? checkpoint : await refreshLatestCheckpoint(database, activeChatId);
      const messageIndex = chat.messages.findIndex((message) => message.id === latest?.messageId);
      if (messageIndex < 0) throw new Error('Checkpoint message is missing from the saved chat.');

      await workbenchStore.waitForExecutionQueue();
      wc = await getWebContainer();
      previousFiles = await captureProject(wc);
      const restored = await restoreCheckpoint(database, wc, activeChatId);
      restoredFiles = true;
      checkpointBusy.set('restoring');
      await setMessages(
        database,
        activeChatId,
        chat.messages.slice(0, messageIndex + 1),
        chat.urlId,
        chat.description,
        chat.timestamp,
      );
      const savedChat = await getMessages(database, activeChatId);
      if (
        savedChat?.messages.length !== messageIndex + 1 ||
        savedChat.messages[messageIndex]?.id !== restored.messageId
      ) {
        throw new Error('Restored chat history could not be persisted.');
      }
      workbenchStore.showRestoredCheckpoint(restored.files);
      updateActivity(restored.messageId, 'checkpoint:restore', 'complete');
      toast.success('Last working checkpoint restored. Reloading project…');
      window.location.reload();
    } catch (error) {
      if (checkpoint?.chatId === activeChatId) {
        updateActivity(checkpoint.messageId, 'checkpoint:restore', 'failed');
      }
      if (restoredFiles && wc && previousFiles) {
        try {
          await applyProjectSnapshot(wc, previousFiles);
          workbenchStore.showRestoredCheckpoint(previousFiles);
        } catch (recoveryError) {
          toast.error(`Recovery failed: ${(recoveryError as Error).message}`, { autoClose: false });
        }
      }

      toast.error(`Could not restore checkpoint: ${(error as Error).message}`, { autoClose: false });
    } finally {
      checkpointBusy.set('idle');
      setIsRestoring(false);
    }
  };

  const isSmallViewport = useViewport(768);
  const wasStreamingRef = useRef(false);

  const setSelectedView = useCallback((view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
    if (view === 'preview') {
      setPinPlayView(true);
      workbenchStore.preferPlayView.set(true);
    } else {
      workbenchStore.preferPlayView.set(false);
    }
  }, []);

  useEffect(() => {
    const onPlayWhileBuilding = () => {
      setPinPlayView(true);
      workbenchStore.preferPlayView.set(true);
      workbenchStore.showWorkbench.set(true);
      workbenchStore.currentView.set('preview');
    };

    window.addEventListener('fortz-play-while-building', onPlayWhileBuilding);
    return () => window.removeEventListener('fortz-play-while-building', onPlayWhileBuilding);
  }, []);

  useEffect(() => {
    const streaming = Boolean(isStreaming);
    const wasStreaming = wasStreamingRef.current;

    // While the AI is actively streaming, always stay on the code tab so the
    // user can watch the code being written — never yank them to preview.
    if (streaming) {
      // Reset Play pin when a new AI build starts so Code is the default again.
      if (!wasStreaming) {
        setPinPlayView(false);
        workbenchStore.preferPlayView.set(false);
      }
      if (showWorkbench && !pinPlayView) {
        setSelectedView('code');
      }
    } else if (wasStreaming) {
      // Streaming just stopped — switch to preview exactly once.
      const hasHtml = Object.values(files).some(
        (d) =>
          d?.type === 'file' && Boolean(d.content) && (d.content.includes('<html') || d.content.includes('<!DOCTYPE')),
      );

      if (validation.status === 'passed' && (hasPreview || hasHtml)) {
        setSelectedView('preview');
      }
    }

    wasStreamingRef.current = streaming;
  }, [isStreaming, showWorkbench, pinPlayView, setSelectedView]);

  useEffect(() => {
    setMountedViews((previous) => (previous[selectedView] ? previous : { ...previous, [selectedView]: true }));
  }, [selectedView]);

  useEffect(() => {
    // Streamed file chunks already update the active editor directly. Avoid
    // rebuilding every editor document from the complete file map per chunk.
    if (!streamingFile) {
      workbenchStore.setDocuments(files);
    }
  }, [files, streamingFile]);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content, update.filePath);
  }, []);

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbenchStore.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath);
  }, []);

  const onFileSave = useCallback(() => {
    workbenchStore.saveCurrentDocument().catch(() => {
      toast.error('Failed to update file content');
    });
  }, []);

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument();
  }, []);

  const handleSyncFiles = useCallback(async () => {
    setIsSyncing(true);

    try {
      const directoryHandle = await window.showDirectoryPicker();
      await workbenchStore.syncFiles(directoryHandle);
      toast.success('Files synced successfully');
    } catch (error) {
      console.error('Error syncing files:', error);
      toast.error('Failed to sync files');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return (
    (chatStarted || showWorkbench) && (
      <motion.div
        initial="closed"
        animate={showWorkbench ? 'open' : 'closed'}
        variants={workbenchVariants}
        className={classNames('z-workbench', {
          'z-30': showWorkbench && isSmallViewport,
        })}
      >
        <div
          className={classNames(
            'fixed top-3 bottom-3 w-[var(--workbench-inner-width)] z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
            {
              'w-full': isSmallViewport,
              'left-0': showWorkbench && isSmallViewport,
              'left-[var(--workbench-left)]': showWorkbench && !isSmallViewport,
              'left-[100%]': !showWorkbench,
            },
          )}
        >
          <div className="absolute inset-0 pl-1 pr-3">
            <div
              style={{
                borderRadius: 0,
                borderColor: '#3b82f6',
                boxShadow: '0 0 28px rgba(79, 70, 229, 0.22)',
              }}
              className="h-full flex flex-col bg-bolt-elements-background-depth-2 border-2 rounded-none overflow-hidden"
            >
              <div
                style={{
                  background: 'linear-gradient(100deg, #2563eb 0%, #4f46e5 55%, #7c3aed 100%)',
                  borderBottom: '2px solid #4338ca',
                }}
                className="flex items-center px-3 py-2 text-white shadow-sm"
              >
                <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                {validation.status === 'checking' && (
                  <span className="ml-2 text-xs" role="status">
                    {validation.detail || 'Checking build…'}
                  </span>
                )}
                <div className="ml-auto" />
                <div className="flex items-center overflow-x-auto no-scrollbar gap-1 mr-2">
                  <PanelHeaderButton
                    className="mr-1 text-xs sm:text-sm"
                    title="Download Code"
                    onClick={() => {
                      workbenchStore.downloadZip();
                    }}
                  >
                    <div className="i-ph:code" />
                    Download Code
                  </PanelHeaderButton>
                  <PanelHeaderButton
                    className="mr-1 text-xs sm:text-sm"
                    title="Sync Files"
                    onClick={handleSyncFiles}
                    disabled={isSyncing}
                  >
                    {isSyncing ? <div className="i-ph:spinner" /> : <div className="i-ph:cloud-arrow-down" />}
                    {isSyncing ? 'Syncing...' : 'Sync Files'}
                  </PanelHeaderButton>
                  <PanelHeaderButton
                    className="mr-1 text-xs sm:text-sm"
                    title="Toggle Terminal"
                    onClick={() => {
                      workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get());
                    }}
                  >
                    <div className="i-ph:terminal" />
                    Toggle Terminal
                  </PanelHeaderButton>
                  <PanelHeaderButton
                    className="mr-1 text-xs sm:text-sm"
                    title="Push to GitHub"
                    onClick={() => {
                      const repoName = prompt(
                        'Please enter a name for your new GitHub repository:',
                        'bolt-generated-project',
                      );

                      if (!repoName) {
                        alert('Repository name is required. Push to GitHub cancelled.');
                        return;
                      }

                      const githubUsername = Cookies.get('githubUsername');
                      const githubToken = Cookies.get('githubToken');

                      if (!githubUsername || !githubToken) {
                        const usernameInput = prompt('Please enter your GitHub username:');
                        const tokenInput = prompt('Please enter your GitHub personal access token:');

                        if (!usernameInput || !tokenInput) {
                          alert('GitHub username and token are required. Push to GitHub cancelled.');
                          return;
                        }

                        workbenchStore.pushToGitHub(repoName, usernameInput, tokenInput);
                      } else {
                        workbenchStore.pushToGitHub(repoName, githubUsername, githubToken);
                      }
                    }}
                  >
                    <div className="i-ph:github-logo" />
                    Push to GitHub
                  </PanelHeaderButton>
                  <PublishButton />
                </div>
                <IconButton
                  icon="i-ph:x-circle"
                  className="-mr-1"
                  size="xl"
                  onClick={() => {
                    workbenchStore.showWorkbench.set(false);
                  }}
                />
              </div>
              <div className="relative flex-1 overflow-hidden">
                {mountedViews.code && (
                  <div
                    className={classNames('absolute inset-0 transition-opacity duration-150', {
                      'visible opacity-100 z-10 pointer-events-auto': selectedView === 'code',
                      'invisible opacity-0 pointer-events-none -z-10': selectedView !== 'code',
                    })}
                    aria-hidden={selectedView !== 'code'}
                  >
                    <Suspense fallback={<WorkspacePanelLoader label="Opening code editor…" />}>
                      <EditorPanel
                        editorDocument={currentDocument}
                        isStreaming={Boolean(
                          isStreaming ||
                            validation.status === 'checking' ||
                            checkpointOperation !== 'idle' ||
                            isRestoring,
                        )}
                        followStream={Boolean(isStreaming && streamingFile && selectedFile === streamingFile)}
                        selectedFile={selectedFile}
                        files={files}
                        unsavedFiles={unsavedFiles}
                        completedFiles={completedFiles}
                        onFileSelect={onFileSelect}
                        onEditorScroll={onEditorScroll}
                        onEditorChange={onEditorChange}
                        onFileSave={onFileSave}
                        onFileReset={onFileReset}
                      />
                    </Suspense>
                  </div>
                )}
                {mountedViews.preview && (
                  <div
                    className={classNames('absolute inset-0 transition-opacity duration-150', {
                      'visible opacity-100 z-10 pointer-events-auto': selectedView === 'preview',
                      'invisible opacity-0 pointer-events-none -z-10': selectedView !== 'preview',
                    })}
                    aria-hidden={selectedView !== 'preview'}
                  >
                    <Suspense fallback={<WorkspacePanelLoader label="Opening preview…" />}>
                      <Preview isStreaming={isStreaming} />
                    </Suspense>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    )
  );
});

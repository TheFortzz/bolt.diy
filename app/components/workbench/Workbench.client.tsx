import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';
import useViewport from '~/lib/hooks';
import Cookies from 'js-cookie';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
}

const viewTransition = { ease: cubicEasingFn };

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

  const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);
  const selectedView = useStore(workbenchStore.currentView);

  const isSmallViewport = useViewport(1024);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  useEffect(() => {
    if (hasPreview) {
      setSelectedView('preview');
    }
  }, [hasPreview]);

  useEffect(() => {
    if (showWorkbench) {
      setSelectedView('preview');
    }
  }, [showWorkbench]);

  useEffect(() => {
    workbenchStore.setDocuments(files);
  }, [files]);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content);
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
        className="z-workbench"
      >
        <div
          className={classNames(
            'fixed top-3 bottom-3 w-[var(--workbench-inner-width)] z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
            {
              'w-full': isSmallViewport,
              'left-0': showWorkbench && isSmallViewport,
              'left-[var(--workbench-left)]': showWorkbench,
              'left-[100%]': !showWorkbench,
            },
          )}
        >
          <div className="absolute inset-0 pl-1 pr-3">
            <div
              style={{ borderRadius: 0 }}
              className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-purple-500/30 shadow-md rounded-none overflow-hidden"
            >
              <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor">
                <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
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
                  <PanelHeaderButton className="mr-1 text-xs sm:text-sm" title="Sync Files" onClick={handleSyncFiles} disabled={isSyncing}>
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
                  <PanelHeaderButton
                    className="mr-1 text-xs sm:text-sm"
                    title="Publish Game"
                    onClick={async () => {
                      try {
                        await workbenchStore.downloadZip();
                        toast.success('Game package downloaded! Upload this ZIP on TheFortz to publish.', { autoClose: 6000 });
                        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                          window.parent.postMessage({ type: 'fortz-open-upload' }, '*');
                        }
                      } catch (err: any) {
                        toast.error('Failed to package game: ' + (err?.message || 'Unknown error'));
                      }
                    }}
                  >
                    <div className="i-ph:rocket-launch" />
                    Publish Game
                  </PanelHeaderButton>
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
                <View
                  initial={{ x: selectedView === 'code' ? 0 : '-100%' }}
                  animate={{ x: selectedView === 'code' ? 0 : '-100%' }}
                >
                  <EditorPanel
                    editorDocument={currentDocument}
                    isStreaming={isStreaming}
                    selectedFile={selectedFile}
                    files={files}
                    unsavedFiles={unsavedFiles}
                    onFileSelect={onFileSelect}
                    onEditorScroll={onEditorScroll}
                    onEditorChange={onEditorChange}
                    onFileSave={onFileSave}
                    onFileReset={onFileReset}
                  />
                </View>
                <View
                  initial={{ x: selectedView === 'preview' ? 0 : '100%' }}
                  animate={{ x: selectedView === 'preview' ? 0 : '100%' }}
                >
                  <Preview />
                </View>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    )
  );
});
interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});

import { useStore } from '@nanostores/react';
import { AnimatePresence, motion } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createHighlighter, type BundledLanguage, type BundledTheme, type HighlighterGeneric } from 'shiki';
import type { ActionState } from '~/lib/runtime/action-runner';
import { workbenchStore } from '~/lib/stores/workbench';
import { activitySteps } from '~/lib/stores/activity';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { WORK_DIR } from '~/utils/constants';

const highlighterOptions = {
  langs: ['shell'],
  themes: ['light-plus', 'dark-plus'],
};

const shellHighlighter: HighlighterGeneric<BundledLanguage, BundledTheme> =
  import.meta.hot?.data.shellHighlighter ?? (await createHighlighter(highlighterOptions));

if (import.meta.hot) {
  import.meta.hot.data.shellHighlighter = shellHighlighter;
}

interface ArtifactProps {
  messageId: string;
}

function openArtifactInWorkbench(filePath: string) {
  if (workbenchStore.currentView.get() !== 'code') {
    workbenchStore.currentView.set('code');
  }

  workbenchStore.setSelectedFile(`${WORK_DIR}/${filePath}`);
  workbenchStore.showWorkbench.set(true);
}

function getFileLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'JavaScript';
    case 'ts':
      return 'TypeScript';
    case 'html':
      return 'HTML';
    case 'css':
    case 'scss':
      return 'CSS';
    case 'json':
      return 'JSON';
    default:
      return ext?.toUpperCase() || 'Code';
  }
}

function getFileIcon(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html':
      return 'i-ph:file-html-fill text-orange-400';
    case 'css':
    case 'scss':
      return 'i-ph:file-css-fill text-sky-400';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'i-ph:file-js-fill text-amber-300';
    case 'ts':
      return 'i-ph:file-ts-fill text-blue-400';
    case 'json':
      return 'i-ph:brackets-curly-bold text-emerald-400';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'webp':
      return 'i-ph:image-fill text-purple-400';
    default:
      return 'i-ph:file-code-fill text-emerald-400';
  }
}

interface FileEditBoxProps {
  filePath: string;
  content: string;
  status: ActionState['status'];
  isEdit?: boolean;
}

const FileEditBox = memo(({ filePath, content, status, isEdit }: FileEditBoxProps) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isRunning = status === 'running';

  const lines = useMemo(() => {
    if (!content) return [''];
    return content.split('\n');
  }, [content]);

  // Auto-scroll to bottom while running/streaming so the user watches code being typed
  useEffect(() => {
    if (isRunning && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isRunning]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (copied) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenWorkbench = (e: React.MouseEvent) => {
    e.stopPropagation();
    openArtifactInWorkbench(filePath);
  };

  const language = getFileLanguage(filePath);

  return (
    <div className="mt-2.5 rounded-lg border border-slate-700/60 bg-[#070b13] overflow-hidden shadow-2xl text-left font-mono">
      {/* Edit Box Sub-header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800 text-xs text-slate-300 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
          </div>
          <span className="text-slate-300 font-medium text-[11px] truncate">{filePath}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-sans shrink-0 border border-slate-700/50">
            {language}
          </span>
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 font-sans font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
              Live Editing…
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 font-sans">
              {lines.length} {lines.length === 1 ? 'line' : 'lines'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700/60 transition-colors"
            title="Copy code"
          >
            {copied ? (
              <>
                <div className="i-ph:check-bold text-emerald-400 text-xs" />
                <span className="text-emerald-400 font-sans">Copied</span>
              </>
            ) : (
              <>
                <div className="i-ph:copy-simple text-xs" />
                <span className="font-sans">Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleOpenWorkbench}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-300 hover:text-emerald-300 bg-slate-800 hover:bg-slate-700 border border-slate-700/60 transition-colors"
            title="Open in Studio Workbench"
          >
            <div className="i-ph:arrow-square-out text-xs text-emerald-400" />
            <span className="font-sans">Editor</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title={isExpanded ? 'Collapse height' : 'Expand full height'}
          >
            <div className={isExpanded ? 'i-ph:arrows-in-simple text-xs' : 'i-ph:arrows-out-simple text-xs'} />
          </button>
        </div>
      </div>

      {/* Code Viewer Body */}
      <div
        ref={scrollRef}
        className={classNames(
          'overflow-auto transition-all duration-200 select-text',
          isExpanded ? 'max-h-[640px]' : 'max-h-72 sm:max-h-80',
        )}
      >
        <div className="flex font-mono text-[12px] sm:text-[12.5px] leading-5 sm:leading-relaxed">
          {/* Line Numbers Column */}
          <div className="select-none text-slate-500 text-right pr-3.5 pl-3 py-2.5 bg-[#05080e] border-r border-slate-800 shrink-0 font-mono tracking-tighter">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          {/* Code Text Column */}
          <div className="flex-1 overflow-x-auto py-2.5 px-4 text-slate-200 font-mono">
            {lines.map((line, i) => (
              <div key={i} className="whitespace-pre hover:bg-slate-800/30 -mx-4 px-4">
                {line || '\u00A0'}
                {isRunning && i === lines.length - 1 && (
                  <span className="inline-block w-2 h-4 ml-0.5 bg-emerald-400 animate-pulse align-middle" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

interface ShellCodeBlockProps {
  className?: string;
  code: string;
}

function ShellCodeBlock({ className, code }: ShellCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (copied) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={classNames('mt-2 rounded-lg border border-slate-800 bg-[#070b13] overflow-hidden text-left', className)}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/80 border-b border-slate-800/80 text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <div className="i-ph:terminal-bold text-emerald-400 text-xs" />
          <span className="font-mono">bash</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div
        className="p-3 text-xs overflow-x-auto font-mono text-slate-200"
        dangerouslySetInnerHTML={{
          __html: shellHighlighter.codeToHtml(code, {
            lang: 'shell',
            theme: 'dark-plus',
          }),
        }}
      />
    </div>
  );
}

const actionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

interface ActionListProps {
  actions: ActionState[];
  messageId: string;
}

const ActionList = memo(({ actions, messageId }: ActionListProps) => {
  const steps = useStore(activitySteps)[messageId] ?? [];
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  // Auto-expand the file action that is actively running
  useEffect(() => {
    actions.forEach((action) => {
      if (action.type === 'file' && action.status === 'running') {
        setExpandedFiles((prev) => (prev[action.filePath] ? prev : { ...prev, [action.filePath]: true }));
      }
    });
  }, [actions]);

  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  const checkIsEdit = (action: ActionState): boolean => {
    if (action.type !== 'file') return false;
    const step = steps.find((s) => s.filePath === action.filePath);
    if (step?.label?.toLowerCase().startsWith('edit') || step?.doneLabel?.toLowerCase().startsWith('edit')) {
      return true;
    }
    const files = workbenchStore.files.get();
    return Boolean(files[action.filePath] || files[`${WORK_DIR}/${action.filePath}`]);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <ul className="list-none space-y-3">
        {actions.map((action, index) => {
          const { status, type, content } = action;
          const isFile = type === 'file';
          const isEdit = isFile ? checkIsEdit(action) : false;
          const isExpanded = isFile ? Boolean(expandedFiles[action.filePath]) : false;
          const lineCount = isFile && content ? content.split('\n').length : 0;

          return (
            <motion.li
              key={index}
              variants={actionVariants}
              initial="hidden"
              animate="visible"
              transition={{
                duration: 0.25,
                ease: cubicEasingFn,
              }}
              className="rounded-xl border border-slate-800/80 bg-slate-900/60 hover:border-slate-700/80 transition-all p-3 shadow-md"
            >
              {/* Action Item Row */}
              <div
                className={classNames(
                  'flex items-center justify-between gap-2.5 text-sm select-none',
                  isFile ? 'cursor-pointer' : '',
                )}
                onClick={() => {
                  if (isFile) {
                    toggleFile(action.filePath);
                  }
                }}
              >
                {/* Left section: status icon, file icon, path, and action badge */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {/* Status Indicator */}
                  <div className="shrink-0 flex items-center justify-center text-lg">
                    {status === 'running' ? (
                      <div className="i-svg-spinners:90-ring-with-bg text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                    ) : status === 'pending' ? (
                      <div className="i-ph:circle text-slate-500 text-base" />
                    ) : status === 'complete' ? (
                      <div className="i-ph:check-circle-fill text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
                    ) : status === 'failed' || status === 'aborted' ? (
                      <div className="i-ph:x-circle-fill text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.5)]" />
                    ) : null}
                  </div>

                  {/* Icon & File/Command Info */}
                  {isFile ? (
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={classNames('text-base shrink-0', getFileIcon(action.filePath))} />
                      <span className="font-mono font-medium text-slate-100 text-xs sm:text-[13px] truncate">
                        {action.filePath}
                      </span>
                      {/* Action Badge */}
                      <span
                        className={classNames(
                          'text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full shrink-0 border',
                          isEdit
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
                        )}
                      >
                        {status === 'running' ? (isEdit ? 'Editing' : 'Creating') : isEdit ? 'Modified' : 'Created'}
                      </span>
                    </div>
                  ) : type === 'shell' ? (
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="i-ph:terminal-window-duotone text-emerald-400 text-base shrink-0" />
                      <span className="font-sans font-medium text-slate-100 text-xs sm:text-[13px]">Run Command</span>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60 shrink-0">
                        Shell
                      </span>
                    </div>
                  ) : type === 'start' ? (
                    <div
                      className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        workbenchStore.currentView.set('preview');
                        workbenchStore.showWorkbench.set(true);
                      }}
                    >
                      <div className="i-ph:play-circle-fill text-emerald-400 text-base shrink-0" />
                      <span className="font-sans font-medium text-slate-100 text-xs sm:text-[13px]">
                        Start Application Preview
                      </span>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 shrink-0">
                        Preview
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Right section: line count, open in editor button, and code expand toggle */}
                <div className="flex items-center gap-2 shrink-0">
                  {isFile && lineCount > 0 && (
                    <span className="text-[11px] font-mono text-slate-400 hidden sm:inline-block">
                      {lineCount} {lineCount === 1 ? 'line' : 'lines'}
                    </span>
                  )}

                  {isFile && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openArtifactInWorkbench(action.filePath);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-sans text-slate-300 hover:text-emerald-300 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/50 transition-colors"
                      title="Open in Studio Workbench"
                    >
                      <div className="i-ph:arrow-square-out text-xs text-emerald-400" />
                      <span className="hidden sm:inline">Editor</span>
                    </button>
                  )}

                  {isFile && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFile(action.filePath);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-sans text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/50 transition-colors"
                    >
                      <span>{isExpanded ? 'Hide Code' : 'View Code'}</span>
                      <div className={isExpanded ? 'i-ph:caret-up-bold text-xs' : 'i-ph:caret-down-bold text-xs'} />
                    </button>
                  )}
                </div>
              </div>

              {/* The Edit Box for files */}
              {isFile && isExpanded && (
                <FileEditBox
                  filePath={action.filePath}
                  content={content}
                  status={status}
                  isEdit={isEdit}
                />
              )}

              {/* Shell & Start commands code viewer */}
              {(type === 'shell' || type === 'start') && content && (
                <ShellCodeBlock code={content} />
              )}
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
});

export const Artifact = memo(({ messageId }: ArtifactProps) => {
  const userToggledActions = useRef(false);
  const [showActions, setShowActions] = useState(true);
  const [allActionFinished, setAllActionFinished] = useState(false);

  const artifacts = useStore(workbenchStore.artifacts);
  const artifact = artifacts[messageId];

  const actionsStore = useMemo(() => {
    return computed(artifact?.runner.actions ?? workbenchStore.artifacts, (actions) => {
      if (!artifact) return [];
      return Object.values(artifact.runner.actions.get());
    });
  }, [artifact]);

  const actions = useStore(actionsStore);

  const toggleActions = () => {
    userToggledActions.current = true;
    setShowActions(!showActions);
  };

  useEffect(() => {
    if (actions.length && !showActions && !userToggledActions.current) {
      setShowActions(true);
    }

    if (actions.length !== 0) {
      const isTerminal = (status: ActionState['status']) =>
        status === 'complete' || status === 'failed' || status === 'aborted';
      const finished = actions.every((action) => isTerminal(action.status));

      if (allActionFinished !== finished) {
        setAllActionFinished(finished);
      }
    }
  }, [actions]);

  if (!artifact) {
    return null;
  }

  const fileActions = actions.filter((a) => a.type === 'file');
  const completedCount = actions.filter((a) => a.status === 'complete').length;
  const runningCount = actions.filter((a) => a.status === 'running').length;
  const isRunning = runningCount > 0 || !allActionFinished;
  const progressPct = actions.length > 0 ? Math.round((completedCount / actions.length) * 100) : 0;

  return (
    <div className="artifact my-3 flex flex-col overflow-hidden rounded-xl border border-emerald-500/35 bg-slate-950/90 shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(16,185,129,0.08)] w-full transition-all duration-200">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-slate-900/95 via-slate-900/90 to-slate-950/95 border-b border-emerald-500/20 px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-between gap-3">
        {/* Left Side: Beacon Icon, Title, and Live Subtitle */}
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
            {isRunning ? (
              <div className="i-svg-spinners:90-ring-with-bg text-emerald-400 text-xl" />
            ) : (
              <div className="i-ph:check-circle-fill text-emerald-400 text-xl drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
            )}
          </div>

          <div className="min-w-0 flex-1 text-left">
            <div className="text-slate-100 font-bold text-sm sm:text-base leading-snug truncate">
              {artifact?.title || 'Interactive Project'}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-300">
              {isRunning ? (
                <>
                  <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                    Building Game Systems…
                  </span>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-300">
                    {completedCount}/{actions.length} completed
                  </span>
                </>
              ) : (
                <>
                  <span className="text-emerald-400 font-medium">Ready to play</span>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-300">{fileActions.length} files generated</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Workbench Toggle & Actions Expand Button */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-200 hover:text-emerald-100 text-xs font-semibold shadow-sm transition-all"
            onClick={() => {
              const showWorkbench = workbenchStore.showWorkbench.get();
              workbenchStore.showWorkbench.set(!showWorkbench);
            }}
          >
            <div className="i-ph:sidebar-simple-duotone text-sm text-emerald-400" />
            <span className="hidden sm:inline">Workbench</span>
          </button>

          <button
            type="button"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-850 hover:bg-slate-800 border border-slate-700/50 transition-colors"
            onClick={toggleActions}
            title={showActions ? 'Collapse actions' : 'Expand actions'}
          >
            <div className={showActions ? 'i-ph:caret-up-bold text-sm' : 'i-ph:caret-down-bold text-sm'} />
          </button>
        </div>
      </div>

      {/* Animated Glowing Progress Bar */}
      <div className="w-full bg-slate-950 h-1 overflow-hidden">
        <div
          className={classNames(
            'h-full transition-all duration-300',
            allActionFinished
              ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]'
              : 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]',
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Action List Container */}
      <AnimatePresence>
        {showActions && actions.length > 0 && (
          <motion.div
            className="actions"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: cubicEasingFn }}
          >
            <div className="p-4 sm:p-5 text-left bg-slate-950/80">
              <ActionList actions={actions} messageId={messageId} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

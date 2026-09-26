import { useStore } from '@nanostores/react';
import { memo, useMemo } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';
import { cleanWorkDirRelativePath } from '~/utils/diff';
import { classNames } from '~/utils/classNames';
import type { ActionState } from '~/lib/runtime/action-runner';

interface ActivityTimelineProps {
  messageId?: string;
  isStreaming?: boolean;
}

function getActionLabel(action: ActionState, isExisting: boolean): { active: string; done: string } {
  if (action.type === 'file') {
    const filename = cleanWorkDirRelativePath(action.filePath);
    if (isExisting) {
      return {
        active: `Editing ${filename}...`,
        done: `Edited ${filename}`,
      };
    }
    return {
      active: `Creating ${filename}...`,
      done: `Created ${filename}`,
    };
  }

  if (action.type === 'shell') {
    const cmd = action.content.trim();
    if (cmd.includes('build') || cmd.includes('tsc')) {
      return {
        active: 'Verifying build...',
        done: 'Build verified',
      };
    }
    if (cmd.includes('install')) {
      return {
        active: 'Installing dependencies...',
        done: 'Dependencies installed',
      };
    }
    const shortCmd = cmd.length > 35 ? `${cmd.slice(0, 35)}...` : cmd;
    return {
      active: `Running: ${shortCmd}...`,
      done: `Completed: ${shortCmd}`,
    };
  }

  if (action.type === 'start') {
    return {
      active: 'Starting application...',
      done: 'Application started',
    };
  }

  return {
    active: 'Processing...',
    done: 'Finished',
  };
}

export const ActivityTimeline = memo(({ messageId, isStreaming = false }: ActivityTimelineProps) => {
  const artifacts = useStore(workbenchStore.artifacts);
  const files = useStore(workbenchStore.files);
  const completedFiles = useStore(workbenchStore.completedFiles);

  const artifact = messageId ? artifacts[messageId] : undefined;
  const actionsMap = artifact ? useStore(artifact.runner.actions) : undefined;

  const actionsList: ActionState[] = useMemo(() => {
    if (!actionsMap) return [];
    return Object.values(actionsMap);
  }, [actionsMap]);

  const hasRunningAction = actionsList.some((a) => a.status === 'running' || a.status === 'pending');

  if (!isStreaming && !hasRunningAction && actionsList.length === 0) {
    return null;
  }

  return (
    <div className="w-full my-3 px-3.5 py-3 rounded-lg border border-bolt-elements-borderColor/70 bg-bolt-elements-background-depth-2/60 backdrop-blur-md shadow-sm">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-bolt-elements-borderColor/40">
        <div className="flex items-center gap-2">
          {isStreaming || hasRunningAction ? (
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
          )}
          <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-bolt-elements-textSecondary">
            {isStreaming || hasRunningAction ? 'Live Activity' : 'Activity Summary'}
          </span>
        </div>
        {artifact?.title && (
          <span className="text-[11px] font-mono text-bolt-elements-textTertiary truncate max-w-[200px]">
            {artifact.title}
          </span>
        )}
      </div>

      <div className="space-y-2 text-xs font-mono">
        {/* If no actions started yet, show Thinking... */}
        {actionsList.length === 0 && isStreaming && (
          <div className="flex items-center gap-2 text-bolt-elements-textPrimary animate-pulse">
            <div className="i-svg-spinners:90-ring-with-bg text-cyan-400 text-sm shrink-0" />
            <span>Thinking...</span>
          </div>
        )}

        {/* If actions have started, mark initial Thinking as completed */}
        {actionsList.length > 0 && (
          <div className="flex items-center gap-2 text-bolt-elements-textSecondary">
            <div className="i-ph:check-circle-fill text-emerald-400 text-sm shrink-0" />
            <span>Plan & Architecture established</span>
          </div>
        )}

        {/* Each action appears as its own line */}
        {actionsList.map((action, idx) => {
          const isExisting =
            action.type === 'file' &&
            Boolean(
              completedFiles.has(action.filePath) ||
                (files[action.filePath] && files[action.filePath]?.type === 'file'),
            );
          const labels = getActionLabel(action, isExisting);

          return (
            <div
              key={idx}
              className={classNames('flex items-center gap-2 transition-colors', {
                'text-bolt-elements-textPrimary font-medium': action.status === 'running',
                'text-bolt-elements-textSecondary': action.status === 'complete',
                'text-rose-400': action.status === 'failed',
                'text-bolt-elements-textTertiary': action.status === 'pending' || action.status === 'aborted',
              })}
            >
              {action.status === 'running' ? (
                <div className="i-svg-spinners:90-ring-with-bg text-cyan-400 text-sm shrink-0" />
              ) : action.status === 'complete' ? (
                <div className="i-ph:check-circle-fill text-emerald-400 text-sm shrink-0" />
              ) : action.status === 'failed' ? (
                <div className="i-ph:x-circle-fill text-rose-400 text-sm shrink-0" />
              ) : (
                <div className="i-ph:circle text-bolt-elements-textTertiary text-sm shrink-0" />
              )}

              <span className="truncate">
                {action.status === 'running' || action.status === 'pending' ? labels.active : labels.done}
              </span>
            </div>
          );
        })}

        {/* If streaming follow-up after actions finished */}
        {actionsList.length > 0 && !hasRunningAction && isStreaming && (
          <div className="flex items-center gap-2 text-bolt-elements-textPrimary animate-pulse pt-1">
            <div className="i-svg-spinners:90-ring-with-bg text-cyan-400 text-sm shrink-0" />
            <span>Finalizing preview and response...</span>
          </div>
        )}
      </div>
    </div>
  );
});

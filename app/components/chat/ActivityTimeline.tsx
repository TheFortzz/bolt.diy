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
        active: `Editing ${filename}`,
        done: `Edited ${filename}`,
      };
    }
    return {
      active: `Creating ${filename}`,
      done: `Created ${filename}`,
    };
  }

  if (action.type === 'shell') {
    const cmd = action.content.trim();
    if (cmd.includes('build') || cmd.includes('tsc')) {
      return {
        active: 'Verifying build',
        done: 'Build verified',
      };
    }
    if (cmd.includes('install')) {
      return {
        active: 'Installing packages',
        done: 'Packages installed',
      };
    }
    const shortCmd = cmd.length > 30 ? `${cmd.slice(0, 30)}…` : cmd;
    return {
      active: `Running ${shortCmd}`,
      done: `Ran ${shortCmd}`,
    };
  }

  if (action.type === 'start') {
    return {
      active: 'Starting app',
      done: 'App started',
    };
  }

  return {
    active: 'Processing',
    done: 'Done',
  };
}

interface ActivityTimelineInnerProps {
  artifact: any;
  isStreaming: boolean;
}

const ActivityTimelineInner = memo(({ artifact, isStreaming }: ActivityTimelineInnerProps) => {
  const actionsMap = useStore(artifact.runner.actions);
  const files = useStore(workbenchStore.files);
  const completedFiles = useStore(workbenchStore.completedFiles);

  const actionsList: ActionState[] = useMemo(() => {
    if (!actionsMap) return [];
    return Object.values(actionsMap) as ActionState[];
  }, [actionsMap]);

  const hasRunningAction = actionsList.some((a) => a.status === 'running' || a.status === 'pending');

  if (!isStreaming && !hasRunningAction && actionsList.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 my-2">
      {actionsList.map((action, idx) => {
        const isExisting =
          action.type === 'file' &&
          Boolean(
            completedFiles.has(action.filePath) ||
              (files[action.filePath] && files[action.filePath]?.type === 'file'),
          );
        const labels = getActionLabel(action, isExisting);
        const isRunning = action.status === 'running';
        const isDone = action.status === 'complete';
        const isFailed = action.status === 'failed';

        return (
          <div
            key={idx}
            className={classNames(
              'inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono tracking-tight rounded-sm transition-all duration-200',
              {
                'text-bolt-elements-textPrimary bg-cyan-500/8': isRunning,
                'text-bolt-elements-textTertiary': isDone,
                'text-rose-400': isFailed,
                'text-bolt-elements-textTertiary opacity-60': action.status === 'pending' || action.status === 'aborted',
              },
            )}
          >
            {isRunning ? (
              <div className="i-svg-spinners:90-ring-with-bg text-cyan-400 text-xs shrink-0" />
            ) : isDone ? (
              <div className="i-ph:check text-emerald-500/70 text-xs shrink-0" />
            ) : isFailed ? (
              <div className="i-ph:x text-rose-400 text-xs shrink-0" />
            ) : (
              <div className="i-ph:circle text-bolt-elements-textTertiary text-xs shrink-0 opacity-40" />
            )}

            <span className="truncate">
              {isRunning || action.status === 'pending' ? labels.active : labels.done}
            </span>
          </div>
        );
      })}

      {isStreaming && !hasRunningAction && actionsList.length > 0 && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono tracking-tight text-bolt-elements-textSecondary animate-pulse">
          <div className="i-svg-spinners:90-ring-with-bg text-cyan-400 text-xs shrink-0" />
          <span>Finishing up…</span>
        </div>
      )}
    </div>
  );
});

export const ActivityTimeline = memo(({ messageId, isStreaming = false }: ActivityTimelineProps) => {
  const artifacts = useStore(workbenchStore.artifacts);
  const artifact = messageId ? artifacts[messageId] : undefined;

  if (artifact) {
    return <ActivityTimelineInner artifact={artifact} isStreaming={isStreaming} />;
  }

  if (!isStreaming) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 my-2">
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono tracking-tight text-bolt-elements-textSecondary animate-pulse">
        <div className="i-svg-spinners:90-ring-with-bg text-cyan-400 text-xs shrink-0" />
        <span>Thinking…</span>
      </div>
    </div>
  );
});

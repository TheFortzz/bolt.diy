import { useStore } from '@nanostores/react';
import { memo, useMemo, useState } from 'react';
import { activitySteps, type ActivityStep } from '~/lib/stores/activity';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

interface ActivityTimelineProps {
  messageId?: string;
  isStreaming?: boolean;
}

const VISIBLE_STEPS = 12;

function stepLabel(step: ActivityStep) {
  switch (step.status) {
    case 'pending':
      return `Queued: ${step.label}`;
    case 'complete':
      return step.doneLabel;
    case 'failed':
      return `Failed: ${step.label}`;
    case 'aborted':
      return `Stopped: ${step.label}`;
    default:
      return step.label;
  }
}

export const ActivityTimeline = memo(({ messageId, isStreaming = false }: ActivityTimelineProps) => {
  const messageKeys = useMemo(() => (messageId ? [messageId] : []), [messageId]);
  const stepsByMessage = useStore(activitySteps, { keys: messageKeys });
  const [showAll, setShowAll] = useState(false);
  const steps = messageId ? (stepsByMessage[messageId] ?? []) : [];
  const hiddenCount = Math.max(0, steps.length - VISIBLE_STEPS);
  const displayed = showAll ? steps : steps.slice(hiddenCount);

  if (steps.length === 0 && !isStreaming) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 my-2.5" aria-label="Build activity" role="status" aria-live="polite">
      {hiddenCount > 0 && (
        <button
          type="button"
          className="text-left text-[11px] text-bolt-elements-textSecondary hover:underline px-1"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? 'Show recent steps' : `Show ${hiddenCount} earlier steps`}
        </button>
      )}

      <div className="flex flex-wrap gap-1.5 items-center">
        {displayed.map((step) => {
          const isComplete = step.status === 'complete';
          const isRunning = step.status === 'running';
          const isFailed = step.status === 'failed';
          const isPending = step.status === 'pending' || step.status === 'aborted';

          return (
            <button
              key={step.id}
              type="button"
              disabled={!step.filePath}
              onClick={() => {
                if (!step.filePath) {
                  return;
                }

                workbenchStore.setSelectedFile(step.filePath);
                workbenchStore.showWorkbench.set(true);
                workbenchStore.preferPlayView.set(false);
                workbenchStore.currentView.set('code');
              }}
              title={step.filePath ? `Open ${step.filePath} in Code` : stepLabel(step)}
              className={classNames(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-left text-[11.5px] font-mono tracking-tight rounded-md border transition-all duration-150 disabled:cursor-default',
                {
                  'bg-emerald-950/40 border-emerald-500/35 text-emerald-300 hover:bg-emerald-900/50 hover:border-emerald-400/50 shadow-sm shadow-emerald-950/20':
                    isComplete,
                  'bg-emerald-900/50 border-emerald-400/60 text-emerald-200 animate-pulse shadow-sm shadow-emerald-950/40':
                    isRunning,
                  'bg-rose-950/40 border-rose-500/40 text-rose-300 hover:bg-rose-900/50 shadow-sm shadow-rose-950/20':
                    isFailed,
                  'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor text-bolt-elements-textTertiary opacity-60':
                    isPending,
                },
              )}
            >
              {isRunning ? (
                <div className="i-svg-spinners:90-ring-with-bg text-emerald-400 text-xs shrink-0" />
              ) : isComplete ? (
                <div className="i-ph:check-circle-fill text-emerald-400 text-xs shrink-0" />
              ) : isFailed ? (
                <div className="i-ph:x-circle-fill text-rose-400 text-xs shrink-0" />
              ) : (
                <div className="i-ph:circle text-bolt-elements-textTertiary text-xs shrink-0 opacity-40" />
              )}
              <span className="truncate max-w-[280px]">{stepLabel(step)}</span>
              {step.filePath && (
                <span className="i-ph:arrow-square-out text-[11px] opacity-60 text-emerald-400/80" aria-hidden="true" />
              )}
            </button>
          );
        })}

        {isStreaming && steps.length === 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-500/40 rounded-md shadow-sm shadow-emerald-950/30 animate-pulse">
            <div className="i-svg-spinners:90-ring-with-bg text-emerald-400 text-xs shrink-0" />
            <span>Thinking…</span>
          </div>
        )}
      </div>
    </div>
  );
});

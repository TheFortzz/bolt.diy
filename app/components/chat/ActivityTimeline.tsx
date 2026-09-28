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
                'inline-flex items-center gap-2 px-3 py-1.5 text-left text-[11.5px] font-mono tracking-tight rounded-lg border transition-all duration-200 disabled:cursor-default',
                {
                  'bg-gradient-to-r from-emerald-950/70 via-emerald-900/40 to-emerald-950/70 border-emerald-500/45 text-emerald-200 hover:border-emerald-400 hover:text-emerald-100 hover:from-emerald-900/70 hover:to-emerald-800/50 shadow-[0_2px_10px_rgba(16,185,129,0.15)] backdrop-blur-md':
                    isComplete,
                  'bg-gradient-to-r from-emerald-900/80 via-emerald-800/60 to-emerald-900/80 border-emerald-400/90 text-emerald-100 shadow-[0_0_16px_rgba(16,185,129,0.35)] animate-pulse backdrop-blur-md':
                    isRunning,
                  'bg-gradient-to-r from-rose-950/70 via-rose-900/40 to-rose-950/70 border-rose-500/40 text-rose-200 hover:border-rose-400/80 shadow-[0_2px_8px_rgba(244,63,94,0.15)] backdrop-blur-md':
                    isFailed,
                  'bg-bolt-elements-background-depth-2/80 border-bolt-elements-borderColor text-bolt-elements-textTertiary opacity-60 backdrop-blur-sm':
                    isPending,
                },
              )}
            >
              {isRunning ? (
                <div className="i-svg-spinners:90-ring-with-bg text-emerald-300 text-xs shrink-0 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
              ) : isComplete ? (
                <div className="i-ph:check-circle-fill text-emerald-400 text-xs shrink-0 drop-shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
              ) : isFailed ? (
                <div className="i-ph:x-circle-fill text-rose-400 text-xs shrink-0 drop-shadow-[0_0_6px_rgba(244,63,94,0.5)]" />
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

        {isStreaming && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-mono text-emerald-200 bg-gradient-to-r from-emerald-950/80 via-emerald-900/50 to-emerald-950/80 border border-emerald-400/60 rounded-lg shadow-[0_0_16px_rgba(16,185,129,0.25)] animate-pulse backdrop-blur-md">
            <div className="i-svg-spinners:90-ring-with-bg text-emerald-400 text-xs shrink-0 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
            <span>{steps.length === 0 ? 'Thinking…' : 'Building game systems…'}</span>
          </div>
        )}
      </div>
    </div>
  );
});

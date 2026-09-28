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
    <div className="flex flex-col gap-1 my-2" aria-label="Build activity" role="status" aria-live="polite">
      {hiddenCount > 0 && (
        <button
          type="button"
          className="text-left text-[11px] text-bolt-elements-textSecondary hover:underline px-2"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? 'Show recent steps' : `Show ${hiddenCount} earlier steps`}
        </button>
      )}

      {displayed.map((step) => (
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
            'inline-flex items-center gap-1.5 px-2 py-0.5 text-left text-[11px] font-mono tracking-tight rounded-sm disabled:cursor-default',
            {
              'text-bolt-elements-textPrimary bg-cyan-500/8': step.status === 'running',
              'text-bolt-elements-textTertiary': step.status === 'complete',
              'text-rose-400': step.status === 'failed',
              'text-bolt-elements-textTertiary opacity-60': step.status === 'pending' || step.status === 'aborted',
            },
          )}
        >
          {step.status === 'running' ? (
            <div className="i-svg-spinners:90-ring-with-bg text-cyan-400 text-xs shrink-0" />
          ) : step.status === 'complete' ? (
            <div className="i-ph:check text-emerald-500/70 text-xs shrink-0" />
          ) : step.status === 'failed' ? (
            <div className="i-ph:x text-rose-400 text-xs shrink-0" />
          ) : (
            <div className="i-ph:circle text-bolt-elements-textTertiary text-xs shrink-0 opacity-40" />
          )}
          <span className="truncate">{stepLabel(step)}</span>
          {step.filePath && <span className="i-ph:arrow-square-out text-[10px] opacity-50" aria-hidden="true" />}
        </button>
      ))}

      {isStreaming && steps.length === 0 && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono text-bolt-elements-textSecondary animate-pulse">
          <div className="i-svg-spinners:90-ring-with-bg text-cyan-400 text-xs shrink-0" />
          <span>Thinking…</span>
        </div>
      )}
    </div>
  );
});

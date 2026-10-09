import { useStore } from '@nanostores/react';
import { memo, useId, useMemo, useState } from 'react';
import { activitySteps, type ActivityStep } from '~/lib/stores/activity';
import { harnessState } from '~/lib/stores/harness';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { WORK_DIR } from '~/utils/constants';
import { cleanWorkDirRelativePath } from '~/utils/diff';
import { summarizeActivity } from '~/components/chat/activity-summary';
import styles from '~/components/chat/ChatExperience.module.scss';

interface ActivityTimelineProps {
  messageId?: string;
  isStreaming?: boolean;
  embedded?: boolean;
}

const VISIBLE_STEPS = 3;

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

export const ActivityTimeline = memo(({ messageId, isStreaming = false, embedded = false }: ActivityTimelineProps) => {
  const messageKeys = useMemo(() => (messageId ? [messageId] : []), [messageId]);
  const stepsByMessage = useStore(activitySteps, { keys: messageKeys });
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const steps = messageId ? (stepsByMessage[messageId] ?? []) : [];
  const harness = useStore(harnessState);
  const busyNow =
    harness.phase === 'planning' ||
    harness.phase === 'preparing-assets' ||
    harness.phase === 'editing' ||
    harness.phase === 'verifying';
  const summary = summarizeActivity(steps, isStreaming, busyNow);
  const important = steps.filter((step) => step.status === 'running' || step.status === 'failed');
  const displayed = embedded ? steps : showAll ? steps : important.length ? important : steps.slice(-VISIBLE_STEPS);

  if (steps.length === 0 && !isStreaming) {
    return null;
  }

  return (
    <section
      className={classNames(styles.Activity, embedded ? styles.ActivityEmbedded : undefined)}
      data-state={summary.state}
      aria-label={embedded ? 'Build checks' : 'Build activity'}
    >
      {embedded ? (
        <div className={styles.ActivityEmbeddedHeading}>
          <span>Build checks</span>
          <span>
            {summary.completedCount}/{steps.length} steps
          </span>
        </div>
      ) : (
        <button
          type="button"
          className={styles.ActivityHeader}
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((value) => !value)}
        >
          <span className={styles.ActivityIcon} aria-hidden="true">
            <span
              className={
                summary.state === 'running'
                  ? 'i-svg-spinners:90-ring-with-bg'
                  : summary.state === 'failed'
                    ? 'i-ph:warning-circle'
                    : summary.state === 'verified'
                      ? 'i-ph:shield-check'
                      : 'i-ph:stack'
              }
            />
          </span>
          <span className="min-w-0 flex-1" role="status" aria-live="polite">
            <span className={styles.ActivityTitle}>{summary.title}</span>
            <span className={classNames(styles.ActivitySubtitle, 'truncate')}>{summary.subtitle}</span>
          </span>
          <span className={styles.Expand}>
            <span>{showAll ? 'Collapse' : 'Expand'}</span>
            <span className={showAll ? 'i-ph:caret-up' : 'i-ph:caret-down'} aria-hidden="true" />
          </span>
        </button>
      )}
      {!embedded && steps.length > 0 && (
        <div className={styles.ActivityMetrics}>
          <span>
            <span className="i-ph:files" aria-hidden="true" />
            {summary.fileCount} files
          </span>
          <span>
            <span className="i-ph:check-circle" aria-hidden="true" />
            {summary.completedCount}/{steps.length} steps
          </span>
          {summary.state === 'running' && <span className="text-violet-300">Live activity</span>}
        </div>
      )}
      <ol id={listId} className={styles.StepList}>
        {displayed.map((step) => {
          const isComplete = step.status === 'complete';
          const isRunning = step.status === 'running';
          const isFailed = step.status === 'failed';

          return (
            <li key={step.id}>
              <button
                type="button"
                data-status={step.status}
                disabled={!step.filePath}
                onClick={() => {
                  if (!step.filePath) {
                    return;
                  }

                  workbenchStore.setSelectedFile(`${WORK_DIR}/${cleanWorkDirRelativePath(step.filePath)}`);
                  workbenchStore.showWorkbench.set(true);
                  workbenchStore.preferPlayView.set(false);
                  workbenchStore.currentView.set('code');
                }}
                title={step.filePath ? `Open ${step.filePath} in Code` : stepLabel(step)}
                className={styles.Step}
              >
                {isRunning ? (
                  <div className="i-svg-spinners:90-ring-with-bg text-emerald-400 text-xs shrink-0 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                ) : isComplete ? (
                  <div className="i-ph:check-circle-fill text-emerald-400 text-xs shrink-0 drop-shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
                ) : isFailed ? (
                  <div className="i-ph:x-circle-fill text-rose-400 text-xs shrink-0 drop-shadow-[0_0_6px_rgba(244,63,94,0.5)]" />
                ) : (
                  <div className="i-ph:circle text-slate-500 text-xs shrink-0" />
                )}
                <span className={styles.StepCopy}>
                  <span className={styles.StepLabel}>{stepLabel(step)}</span>
                  {step.filePath && <span className={styles.StepPath}>{cleanWorkDirRelativePath(step.filePath)}</span>}
                </span>
                {step.finishedAt !== undefined && (
                  <span className={styles.StepDuration}>
                    {Math.max(0, (step.finishedAt - step.startedAt) / 1000).toFixed(1)}s
                  </span>
                )}
                {step.filePath && (
                  <span className="i-ph:arrow-square-out text-[11px] opacity-70 text-emerald-400" aria-hidden="true" />
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {!embedded && showAll && (
        <div className={styles.ActivityFootnote}>
          Observed tool activity and progress summaries. File steps open in the editor. Passing checks does not
          guarantee every gameplay scenario.
        </div>
      )}
    </section>
  );
});

import { useStore } from '@nanostores/react';
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
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

const VISIBLE_STEPS = 8;

function stepLabel(step: ActivityStep) {
  switch (step.status) {
    case 'pending':
      return `Queued: ${step.label}`;
    case 'complete':
      return step.doneLabel;
    case 'failed':
      return step.doneLabel;
    case 'aborted':
      return `Stopped: ${step.label}`;
    case 'retrying':
      // A soft, recovered failure: never surfaces as a failure in chat.
      return step.label;
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
  const previousState = useRef(summary.state);

  useEffect(() => {
    setShowAll(false);
  }, [messageId]);

  useEffect(() => {
    if (previousState.current === 'running' && summary.state !== 'running') {
      setShowAll(false);
    }
    previousState.current = summary.state;
  }, [summary.state]);

  const visibleSteps = steps.filter((step) => step.status !== 'failed');
  const important = visibleSteps.filter((step) => step.status === 'running');
  const displayed = embedded
    ? visibleSteps
    : showAll
      ? visibleSteps
      : important.length
        ? important
        : visibleSteps.slice(-VISIBLE_STEPS);

  /*
   * Generated art is the part of a build users most want to *see*, so the real
   * images get a small always-visible strip in the collapsed feed instead of
   * hiding behind an expand click.
   */
  const imageSteps = useMemo(() => steps.filter((step) => step.imageUrl).slice(-4), [steps]);
  const imageName = (step: ActivityStep) =>
    cleanWorkDirRelativePath(step.filePath || '')
      .split('/')
      .pop() || step.label;

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
            {summary.completedCount}/{visibleSteps.length} steps
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
      {!embedded && imageSteps.length > 0 && (
        <div className={styles.AssetStrip}>
          {imageSteps.map((step) => (
            <button
              key={`asset-${step.id}`}
              type="button"
              className={styles.AssetThumb}
              onClick={() => setShowAll(true)}
              title={`${step.label} — open all build steps`}
            >
              <img src={step.imageUrl} alt={imageName(step)} loading="lazy" />
              <span>{imageName(step)}</span>
            </button>
          ))}
        </div>
      )}
      {!embedded && steps.length > 0 && (
        <div className={styles.ActivityMetrics}>
          <span>
            <span className="i-ph:files" aria-hidden="true" />
            {summary.fileCount} files
          </span>
          <span>
            <span className="i-ph:check-circle" aria-hidden="true" />
            {summary.completedCount}/{visibleSteps.length} steps
          </span>
          {summary.state === 'running' && <span className="text-violet-300">Live activity</span>}
        </div>
      )}
      <ol id={listId} className={styles.StepList}>
        {displayed.map((step) => {
          const isComplete = step.status === 'complete';
          const isRunning = step.status === 'running';
          const isRetrying = step.status === 'retrying';

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
                ) : isRetrying ? (
                  <div className="i-ph:arrow-clockwise text-amber-300 text-xs shrink-0" />
                ) : (
                  <div className="i-ph:circle text-slate-500 text-xs shrink-0" />
                )}
                {step.imageUrl && <img className={styles.StepThumb} src={step.imageUrl} alt="" loading="lazy" />}
                <span className={styles.StepCopy}>
                  <span className={styles.StepLabel}>{stepLabel(step)}</span>
                  {step.filePath && <span className={styles.StepPath}>{cleanWorkDirRelativePath(step.filePath)}</span>}
                </span>{' '}
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

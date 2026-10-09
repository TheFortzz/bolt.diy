import type { ActivityStep } from '~/lib/stores/activity';

export function summarizeActivity(steps: ActivityStep[], isStreaming: boolean, busyNow = false) {
  const failed = steps.find((step) => step.status === 'failed');
  const running = steps.find((step) => step.status === 'running');
  const pending = steps.find((step) => step.status === 'pending');
  const aborted = steps.find((step) => step.status === 'aborted');
  const verified = steps.some((step) => step.id === 'validation:result' && step.status === 'complete');
  const current = failed ?? running ?? pending ?? aborted ?? steps[steps.length - 1];

  /*
   * busyNow: the harness is still planning/building even when this particular
   * card has no running step — never claim "Activity complete" mid-run.
   */
  const busy = Boolean(running || pending || isStreaming || busyNow);
  const state = failed ? 'failed' : busy ? 'running' : aborted ? 'aborted' : verified ? 'verified' : 'complete';

  return {
    state,
    title: failed
      ? 'Needs attention'
      : busy
        ? steps.length
          ? 'Working on your game'
          : 'Thinking…'
        : aborted
          ? 'Build stopped'
          : verified
            ? 'Build checks passed'
            : 'Activity complete',
    subtitle: current
      ? current.status === 'complete'
        ? busyNow && !running && !pending
          ? `${current.doneLabel} · continuing…`
          : current.doneLabel
        : current.label
      : 'Preparing the implementation approach',
    fileCount: new Set(steps.filter((step) => step.filePath).map((step) => step.filePath)).size,
    completedCount: steps.filter((step) => step.status === 'complete').length,
  };
}

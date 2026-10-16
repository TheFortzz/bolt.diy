import type { ActivityStep } from '~/lib/stores/activity';

export function summarizeActivity(steps: ActivityStep[], isStreaming: boolean, busyNow = false) {
  const running = steps.find((step) => step.status === 'running');
  const pending = steps.find((step) => step.status === 'pending');
  const aborted = steps.find((step) => step.status === 'aborted');
  const verifiedBuild = steps.some((step) => step.id === 'cline:verified' && step.status === 'complete');
  const verified = verifiedBuild || steps.some((step) => step.id === 'validation:result' && step.status === 'complete');
  // A recovered retry may leave failed historical rows; the final completed
  // build is authoritative for the overall activity state. Terminal check
  // diagnostics remain internal instead of becoming alarming chat UI.
  const failed = verified ? undefined : steps.find((step) => step.status === 'failed');
  const visibleSteps = steps.filter((step) => step.status !== 'failed');
  const current = running ?? pending ?? aborted ?? visibleSteps[visibleSteps.length - 1];

  /*
   * busyNow: the harness is still planning/building even when this particular
   * card has no running step — never claim "Activity complete" mid-run.
   */
  const busy = Boolean(running || pending || isStreaming || busyNow);
  const state = busy ? 'running' : aborted ? 'aborted' : verified ? 'verified' : 'complete';

  return {
    state,
    title: busy
        ? steps.length
          ? 'Working on your game'
          : 'Thinking…'
        : aborted
          ? 'Build stopped'
          : verified
            ? 'Build checks passed'
            : failed
              ? 'Build update saved'
              : 'Activity complete',
    subtitle: current
      ? current.status === 'complete'
        ? busyNow && !running && !pending
          ? `${current.doneLabel} · continuing…`
          : current.doneLabel
        : current.label
      : failed
        ? 'Your workspace is saved and ready for the next prompt'
        : 'Preparing the implementation approach',
    fileCount: new Set(visibleSteps.filter((step) => step.filePath).map((step) => step.filePath)).size,
    completedCount: visibleSteps.filter((step) => step.status === 'complete').length,
  };
}

import { map } from 'nanostores';
import type { BoltAction } from '~/types/actions';
import { cleanWorkDirRelativePath } from '~/utils/diff';

/*
 * `retrying` is a soft failure: a step that did not land but is being redone
 * automatically. It never shows as a failure in chat and never leaves a
 * spinner — only a terminal failure uses `failed`.
 */
export type ActivityStatus = 'pending' | 'running' | 'complete' | 'failed' | 'aborted' | 'retrying';

export interface ActivityStep {
  id: string;
  label: string;
  doneLabel: string;
  status: ActivityStatus;
  startedAt: number;
  finishedAt?: number;
  filePath?: string;
  /** Inline preview of a generated image so the feed shows the real art. */
  imageUrl?: string;
}

export const activitySteps = map<Record<string, ActivityStep[]>>({});

export const actionStepId = (actionId: string) => `action:${actionId}`;

/**
 * Human labels for Cline tool events so the chat timeline reads like a real
 * workspace feed ("Reading src/app.js", "Wrote src/app.js") instead of raw
 * tool identifiers. Path-less tools get a plain verb pair.
 */
const CLINE_TOOL_LABELS: Record<string, { verb: string; done: string }> = {
  write_file: { verb: 'Writing', done: 'Wrote' },
  edit_file: { verb: 'Editing', done: 'Edited' },
  read_file: { verb: 'Reading', done: 'Read' },
  list_files: { verb: 'Listing files', done: 'Files listed' },
  inspect_project: { verb: 'Inspecting project', done: 'Project inspected' },
  search_files: { verb: 'Searching files', done: 'Search finished' },
  run_build: { verb: 'Running build', done: 'Build finished' },
  run_tests: { verb: 'Running tests', done: 'Tests finished' },
  finish_task: { verb: 'Finishing task', done: 'Task finished' },
  submit_plan: { verb: 'Submitting plan', done: 'Plan submitted' },
};

export function describeClineToolStep(
  tool: string,
  path?: string,
): {
  id: string;
  label: string;
  doneLabel: string;
  filePath?: string;
} {
  const labels = CLINE_TOOL_LABELS[tool] ?? { verb: tool, done: `${tool} complete` };
  const clean = path ? cleanWorkDirRelativePath(path) : '';
  const filePath = path || undefined;

  /*
   * Writes/edits share a path-keyed id so the authoritative workspace write
   * event completes the same step instead of adding a duplicate row.
   */
  const id =
    filePath && (tool === 'write_file' || tool === 'edit_file')
      ? `cline:write:${filePath}`
      : `cline:tool:${tool}:${filePath || ''}`;

  return {
    id,
    label: clean ? `${labels.verb} ${clean}` : labels.verb,
    doneLabel: clean ? `${labels.done} ${clean}` : labels.done,
    filePath,
  };
}

/*
 * The timeline is a live progress feed, so it must stay bounded: a long
 * multi-phase build with many retries used to append rows forever, which both
 * swelled the tab's memory and made the build look like an endless loop. Live
 * rows are always kept.
 */
const MAX_ACTIVITY_STEPS = 160;

function trimActivitySteps(steps: ActivityStep[]): ActivityStep[] {
  if (steps.length <= MAX_ACTIVITY_STEPS) {
    return steps;
  }

  const live = steps.filter((step) => step.status === 'running' || step.status === 'pending');
  const settled = steps.filter((step) => step.status !== 'running' && step.status !== 'pending');
  const keepSettled = Math.max(0, MAX_ACTIVITY_STEPS - live.length);
  const kept = new Set([...settled.slice(-keepSettled), ...live].map((step) => step.id));

  return steps.filter((step) => kept.has(step.id));
}

export function startActivity(
  messageId: string,
  id: string,
  label: string,
  doneLabel = label,
  status: ActivityStatus = 'running',
  filePath?: string,
) {
  const steps = activitySteps.get()[messageId] ?? [];

  if (steps.some((step) => step.id === id)) {
    return;
  }

  const startedAt = Date.now();
  activitySteps.setKey(
    messageId,
    trimActivitySteps([
      ...steps,
      { id, label, doneLabel, status, startedAt, finishedAt: status === 'complete' ? startedAt : undefined, filePath },
    ]),
  );
}

/** Settle every live row so a terminal build never leaves a spinner behind. */
/** Attach the real generated image to its activity row so chat shows the art. */
export function setActivityImage(messageId: string, id: string, imageUrl: string) {
  const steps = activitySteps.get()[messageId];

  if (!steps || !imageUrl) {
    return;
  }

  const index = steps.findIndex((step) => step.id === id);

  if (index === -1 || steps[index].imageUrl === imageUrl) {
    return;
  }

  const next = [...steps];
  next[index] = { ...steps[index], imageUrl };
  activitySteps.setKey(messageId, next);
}

export function settleActiveActivities(
  messageId: string,
  status: 'complete' | 'failed' | 'aborted',
  excludeIds: string[] = [],
) {
  const steps = activitySteps.get()[messageId];
  if (!steps?.length) return;

  const finishedAt = Date.now();
  let changed = false;
  const settled = steps.map((step) => {
    if (step.status !== 'running' && step.status !== 'pending') return step;
    if (excludeIds.includes(step.id)) return step;
    changed = true;
    return { ...step, status, finishedAt };
  });

  if (changed) activitySteps.setKey(messageId, settled);
}

export function updateActivity(messageId: string, id: string, status: ActivityStatus) {
  const steps = activitySteps.get()[messageId];

  if (!steps) {
    return;
  }

  const index = steps.findIndex((step) => step.id === id);

  if (index === -1 || steps[index].status === status) {
    return;
  }

  /*
   * Late WebContainer callbacks and replays must not turn a completed step
   * back into a spinner. A later real failure can still replace success.
   */
  if (
    (steps[index].status === 'complete' || steps[index].status === 'failed' || steps[index].status === 'aborted') &&
    (status === 'pending' || status === 'running')
  ) {
    return;
  }

  const next = [...steps];
  const now = Date.now();
  next[index] = {
    ...steps[index],
    status,
    startedAt: status === 'running' && steps[index].status === 'pending' ? now : steps[index].startedAt,
    finishedAt: status === 'pending' || status === 'running' ? undefined : now,
  };
  activitySteps.setKey(messageId, next);
}

export function startActionActivity(messageId: string, actionId: string, action: BoltAction, isExisting: boolean) {
  const id = actionStepId(actionId);

  if (action.type === 'file') {
    const name = cleanWorkDirRelativePath(action.filePath);
    startActivity(
      messageId,
      id,
      `${isExisting ? 'Editing' : 'Creating'} ${name}`,
      `${isExisting ? 'Edited' : 'Created'} ${name}`,
      'pending',
      action.filePath,
    );

    return;
  }

  if (action.type === 'start') {
    startActivity(messageId, id, 'Starting app', 'App launch requested', 'pending');

    return;
  }

  const command = action.content.trim().replace(/\s+/g, ' ').slice(0, 60);
  startActivity(messageId, id, `Running ${command}`, `Command processed: ${command}`, 'pending');
}

export async function runActivityStep<T>(
  messageId: string,
  id: string,
  label: string,
  task: () => Promise<T>,
  doneLabel = label,
): Promise<T> {
  startActivity(messageId, id, label, doneLabel);

  try {
    const result = await task();
    updateActivity(messageId, id, 'complete');

    return result;
  } catch (error) {
    updateActivity(messageId, id, 'failed');
    throw error;
  }
}

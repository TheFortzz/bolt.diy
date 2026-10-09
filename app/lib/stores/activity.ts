import { map } from 'nanostores';
import type { BoltAction } from '~/types/actions';
import { cleanWorkDirRelativePath } from '~/utils/diff';

export type ActivityStatus = 'pending' | 'running' | 'complete' | 'failed' | 'aborted';

export interface ActivityStep {
  id: string;
  label: string;
  doneLabel: string;
  status: ActivityStatus;
  startedAt: number;
  finishedAt?: number;
  filePath?: string;
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
  activitySteps.setKey(messageId, [
    ...steps,
    { id, label, doneLabel, status, startedAt, finishedAt: status === 'complete' ? startedAt : undefined, filePath },
  ]);
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

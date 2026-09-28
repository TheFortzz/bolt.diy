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
  next[index] = {
    ...steps[index],
    status,
    finishedAt: status === 'pending' || status === 'running' ? undefined : Date.now(),
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

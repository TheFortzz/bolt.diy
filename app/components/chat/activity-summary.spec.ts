import { describe, expect, it } from 'vitest';
import type { ActivityStep } from '~/lib/stores/activity';
import { summarizeActivity } from '~/components/chat/activity-summary';

const step = (id: string, status: ActivityStep['status']): ActivityStep => ({
  id,
  status,
  label: 'Applying files',
  doneLabel: 'Files applied',
  startedAt: 0,
});

describe('observed activity summary', () => {
  it('never equates completed file edits with a verified game', () => {
    expect(summarizeActivity([step('action:file', 'complete')], false).state).toBe('complete');
    expect(summarizeActivity([step('validation:result', 'complete')], false).state).toBe('verified');
  });

  it('keeps a failure visible even after other checks complete', () => {
    const result = summarizeActivity([step('assets:write', 'failed'), step('validation:result', 'complete')], false);
    expect(result.state).toBe('failed');
    expect(result.title).toBe('Needs attention');
  });

  it('does not leave aborted operations spinning', () => {
    expect(summarizeActivity([step('action:file', 'aborted')], false).state).toBe('aborted');
  });

  it('never claims completion while the harness is still working', () => {
    const result = summarizeActivity([step('manager:plan', 'complete')], false, true);

    expect(result.state).toBe('running');
    expect(result.title).toBe('Working on your game');
    expect(result.subtitle).toContain('continuing');
  });
});

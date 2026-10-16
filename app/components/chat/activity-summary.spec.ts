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

  it('shows the final successful build as verified even if a retry had an old failure', () => {
    const result = summarizeActivity([step('assets:write', 'failed'), step('cline:verified', 'complete')], false);
    expect(result.state).toBe('verified');
    expect(result.title).toBe('Build checks passed');
  });

  it('keeps terminal diagnostics out of the chat status summary', () => {
    const result = summarizeActivity([step('assets:write', 'failed'), step('validation:result', 'complete')], false);
    expect(result.state).toBe('verified');
    expect(result.title).toBe('Build checks passed');
  });

  it('shows a neutral saved-workspace status when final checks did not pass', () => {
    const result = summarizeActivity([step('assets:write', 'failed'), step('cline:failed', 'failed')], false);
    expect(result.state).toBe('complete');
    expect(result.title).toBe('Build update saved');
    expect(result.subtitle).toContain('workspace is saved');
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

import { beforeEach, describe, expect, it } from 'vitest';
import { activitySteps, runActivityStep, startActionActivity, startActivity, updateActivity } from './activity';

describe('build activity events', () => {
  beforeEach(() => activitySteps.set({}));

  it('keeps separate stable steps for each assistant message', () => {
    startActionActivity('first', '0', { type: 'file', filePath: '/home/project/car.js', content: '' }, false);
    startActionActivity('first', '0', { type: 'file', filePath: '/home/project/car.js', content: '' }, false);
    startActionActivity('second', '0', { type: 'file', filePath: '/home/project/car.js', content: '' }, true);

    expect(activitySteps.get().first).toHaveLength(1);
    expect(activitySteps.get().first[0].label).toBe('Creating car.js');
    expect(activitySteps.get().second[0].label).toBe('Editing car.js');
    updateActivity('first', 'action:0', 'running');
    updateActivity('first', 'action:0', 'complete');
    updateActivity('first', 'action:0', 'running');
    expect(activitySteps.get().first[0].status).toBe('complete');
    expect(activitySteps.get().second[0].status).toBe('pending');
  });

  it('marks a real validation failure without claiming success', async () => {
    await expect(
      runActivityStep(
        'build',
        'validation:preview',
        'Loading preview',
        async () => {
          throw new Error('Preview failed');
        },
        'Preview loaded',
      ),
    ).rejects.toThrow('Preview failed');

    expect(activitySteps.get().build[0].status).toBe('failed');
    expect(activitySteps.get().build[0].doneLabel).toBe('Preview loaded');
    expect(activitySteps.get().build[0].finishedAt).toBeTypeOf('number');
  });

  it('does not label arbitrary shell commands as verified builds', () => {
    startActionActivity('build', '0', { type: 'shell', content: 'npm run build' }, false);
    updateActivity('build', 'action:0', 'complete');
    startActivity('build', 'validation:result', 'Build verified', 'Build verified', 'complete');

    expect(activitySteps.get().build[0].doneLabel).toBe('Command processed: npm run build');
    expect(activitySteps.get().build[1].doneLabel).toBe('Build verified');
  });
});

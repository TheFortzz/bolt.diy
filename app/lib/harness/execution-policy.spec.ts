import { describe, expect, it } from 'vitest';
import { ExecutionPolicy } from '~/lib/harness/execution-policy';
import { blueprintSchema, type Blueprint } from '~/lib/harness/blueprint';
import type { BoltAction } from '~/types/actions';

const fileHash = `sha256:${'a'.repeat(64)}`;

function createBlueprint(): Blueprint {
  return blueprintSchema.parse({
    title: 'Test game',
    summary: 'A small test game.',
    engine: 'canvas2d',
    systems: ['Player movement', 'Scoring loop'],
    fileOperations: [
      { path: 'index.html', operation: 'edit', purpose: 'Load the game.', expectedHash: fileHash },
      { path: 'game.js', operation: 'create', purpose: 'Implement gameplay.', expectedHash: null },
    ],
    assetOperations: [],
    scriptOrder: ['game.js'],
    acceptanceCriteria: ['The game starts.', 'Controls respond.', 'Restart works.'],
    schemaVersion: '1.0',
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: 'workspace-test',
    baseRevision: fileHash,
    manifest: [{ path: 'index.html', hash: fileHash, bytes: 10 }],
    verification: {
      scenarios: ['startup', 'controls', 'restart', 'resize'],
      minimumSimulationSteps: 120,
      requireDiagnostics: true,
    },
    budgets: { assetAttempts: 1, maximumSourceBytes: 1048576, maximumResponseSegments: 8 },
  });
}

const fileAction = (filePath: string, content = '<!doctype html>'): BoltAction => ({ type: 'file', filePath, content });

describe('ExecutionPolicy', () => {
  it('blocks generated actions until a blueprint is approved', () => {
    const policy = new ExecutionPolicy();

    expect(() => policy.authorize('assistant-1', 'action-1', fileAction('index.html'))).toThrow(
      'current approved blueprint',
    );
  });

  it('limits an approved build to one action per planned file and one assistant message', () => {
    const policy = new ExecutionPolicy();
    policy.approve(createBlueprint());

    policy.authorize('assistant-1', 'action-1', fileAction('/home/project/index.html'));
    policy.authorize('assistant-1', 'action-2', fileAction('/home/project/game.js'));
    policy.authorize('assistant-1', 'action-1', fileAction('/home/project/index.html'), 'complete');

    expect(policy.ownsMessage('assistant-1')).toBe(true);
    expect(() => policy.authorize('assistant-1', 'action-3', fileAction('/home/project/index.html'))).toThrow(
      'already emitted',
    );
    expect(() => policy.authorize('assistant-2', 'action-3', fileAction('/home/project/game.js'))).toThrow(
      'active approved build',
    );
  });

  it('rejects unplanned paths and non-file actions', () => {
    const policy = new ExecutionPolicy();
    policy.approve(createBlueprint());

    expect(() => policy.authorize('assistant-1', 'action-1', fileAction('unplanned.js'))).toThrow('approved blueprint');
    expect(() => policy.authorize('assistant-1', 'action-2', { type: 'shell', content: 'rm -rf .' })).toThrow(
      'only change approved source files',
    );
  });

  it('checks the source budget when the complete file action arrives', () => {
    const policy = new ExecutionPolicy();
    policy.approve(createBlueprint());
    policy.authorize('assistant-1', 'action-1', fileAction('game.js'));

    expect(() =>
      policy.authorize('assistant-1', 'action-1', fileAction('game.js', 'x'.repeat(1048577)), 'complete'),
    ).toThrow('size budget');
  });

  it('exposes the approved file precondition only to the reserved build action', () => {
    const policy = new ExecutionPolicy();
    policy.approve(createBlueprint());
    policy.authorize('assistant-1', 'action-1', fileAction('index.html'));

    expect(policy.getApprovedOperation('assistant-1', 'action-1', '/home/project/index.html')).toMatchObject({
      path: 'index.html',
      expectedHash: fileHash,
    });
    expect(() => policy.getApprovedOperation('assistant-1', 'action-2', '/home/project/index.html')).toThrow(
      'not reserved',
    );
  });

  it('allows historical messages to restore their previously saved actions', () => {
    const policy = new ExecutionPolicy();
    policy.registerHistory(['saved-assistant-message']);

    expect(() =>
      policy.authorize('saved-assistant-message', 'action-1', { type: 'shell', content: 'npm run dev' }),
    ).not.toThrow();
  });

  it('revokes build permissions when the approval is cancelled', () => {
    const policy = new ExecutionPolicy();
    policy.approve(createBlueprint());
    policy.revoke();

    expect(() => policy.authorize('assistant-1', 'action-1', fileAction('game.js'))).toThrow(
      'current approved blueprint',
    );
  });
});

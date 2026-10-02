import { describe, expect, it } from 'vitest';
import {
  getHarnessSecret,
  issueCapability,
  verifyCapability,
  requireSameOrigin,
} from './capabilities';
import { blueprintSchema, revisionHash, type Blueprint } from '~/lib/harness/blueprint';

const fileHash = `sha256:${'a'.repeat(64)}`;

async function createTestBlueprint(): Promise<Blueprint> {
  const manifest = [{ path: 'index.html', hash: fileHash, bytes: 10 }];
  const baseRevision = await revisionHash(manifest);

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
    baseRevision,
    manifest,
    verification: {
      scenarios: ['startup', 'controls', 'restart', 'resize'],
      minimumSimulationSteps: 120,
      requireDiagnostics: true,
    },
    budgets: { assetAttempts: 1, maximumSourceBytes: 1048576, maximumResponseSegments: 8 },
  });
}

describe('Harness capabilities', () => {
  describe('getHarnessSecret', () => {
    it('returns the configured key if >= 32 characters', async () => {
      const customKey = 'a'.repeat(32);
      const secret = await getHarnessSecret({ FORTZ_HARNESS_SIGNING_KEY: customKey } as any);
      expect(secret).toBe(customKey);
    });

    it('derives a deterministic 64-character hex key across separate simulated isolates', async () => {
      const envA = { OPENAI_API_KEY: 'sk-test-123' };
      const envB = { OPENAI_API_KEY: 'sk-test-123' };

      const secretA = await getHarnessSecret(envA as any);
      const secretB = await getHarnessSecret(envB as any);

      expect(secretA).toHaveLength(64);
      expect(secretA).toBe(secretB);
    });

    it('derives a stable key even with empty env', async () => {
      const secret1 = await getHarnessSecret({});
      const secret2 = await getHarnessSecret(undefined);

      expect(secret1).toHaveLength(64);
      expect(secret1).toBe(secret2);
    });
  });

  describe('issueCapability & verifyCapability across isolates', () => {
    it('issues an execution capability in Isolate A and verifies in Isolate B with identical env', async () => {
      const blueprint = await createTestBlueprint();
      const audience = 'https://bolt-di.pages.dev';

      // Isolate A (e.g. /api/plan on approval)
      const secretA = await getHarnessSecret({ OPENAI_LIKE_API_KEY: 'shared-edge-key' } as any);
      const token = await issueCapability(blueprint, 'execute', secretA, audience);

      // Isolate B (e.g. /api/chat receiving executionToken)
      const secretB = await getHarnessSecret({ OPENAI_LIKE_API_KEY: 'shared-edge-key' } as any);
      const verified = await verifyCapability(token, blueprint, 'execute', secretB, audience);

      expect(verified.id).toBe(blueprint.id);
      expect(verified.workspaceId).toBe(blueprint.workspaceId);
    });

    it('works when passing Promise<string> secret directly', async () => {
      const blueprint = await createTestBlueprint();
      const audience = 'https://bolt-di.pages.dev';
      const env = { OPENAI_API_KEY: 'test-key' } as any;

      const token = await issueCapability(blueprint, 'execute', getHarnessSecret(env), audience);
      const verified = await verifyCapability(token, blueprint, 'execute', getHarnessSecret(env), audience);

      expect(verified.id).toBe(blueprint.id);
    });

    it('rejects capability when purpose mismatches', async () => {
      const blueprint = await createTestBlueprint();
      const audience = 'https://bolt-di.pages.dev';
      const secret = await getHarnessSecret();

      const token = await issueCapability(blueprint, 'review', secret, audience);

      await expect(verifyCapability(token, blueprint, 'execute', secret, audience)).rejects.toThrow(
        'The approved blueprint was changed or belongs to a different revision.',
      );
    });

    it('rejects capability when audience mismatches', async () => {
      const blueprint = await createTestBlueprint();
      const secret = await getHarnessSecret();

      const token = await issueCapability(blueprint, 'execute', secret, 'https://bolt-di.pages.dev');

      await expect(
        verifyCapability(token, blueprint, 'execute', secret, 'https://attacker.pages.dev'),
      ).rejects.toThrow();
    });

    it('rejects capability when blueprint id is tampered', async () => {
      const blueprint = await createTestBlueprint();
      const audience = 'https://bolt-di.pages.dev';
      const secret = await getHarnessSecret();

      const token = await issueCapability(blueprint, 'execute', secret, audience);

      const tampered = { ...blueprint, id: '00000000-0000-4000-8000-000000000002' };
      await expect(verifyCapability(token, tampered, 'execute', secret, audience)).rejects.toThrow();
    });
  });

  describe('requireSameOrigin', () => {
    it('accepts requests from matching origin', () => {
      const req = new Request('https://bolt-di.pages.dev/api/plan', {
        headers: { Origin: 'https://bolt-di.pages.dev', 'Sec-Fetch-Site': 'same-origin' },
      });
      expect(() => requireSameOrigin(req)).not.toThrow();
    });

    it('rejects requests from cross-site', () => {
      const req = new Request('https://bolt-di.pages.dev/api/plan', {
        headers: { Origin: 'https://evil.com', 'Sec-Fetch-Site': 'cross-site' },
      });
      expect(() => requireSameOrigin(req)).toThrow('Harness requests require the same studio origin.');
    });
  });
});

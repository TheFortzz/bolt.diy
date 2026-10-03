import { describe, expect, it } from 'vitest';
import {
  MAX_GAME_RESPONSE_SEGMENTS,
  MAX_GAME_SOURCE_BYTES,
  blueprintSchema,
  parseManagerOutput,
  type Blueprint,
} from '~/lib/harness/blueprint';

describe('blueprint harness', () => {
  describe('parseManagerOutput', () => {
    it('parses pure JSON output', () => {
      const json = JSON.stringify({
        title: 'Pixel Kart',
        summary: 'A 2D arcade kart racer',
        engine: 'canvas2d',
        systems: ['Steering and drift mechanics', 'Lap timing and checkpoint detection'],
        fileOperations: [
          { path: 'index.html', operation: 'create', purpose: 'Canvas host page' },
          { path: 'game.js', operation: 'create', purpose: 'Game logic and loops' },
        ],
        assetOperations: [],
        scriptOrder: ['game.js'],
        acceptanceCriteria: [
          'Kart responds to arrow keys.',
          'Laps are counted when passing checkpoints.',
          'Diagnostics report valid game state.',
        ],
      });

      const parsed = parseManagerOutput(json);
      expect(parsed.title).toBe('Pixel Kart');
      expect(parsed.engine).toBe('canvas2d');
      expect(parsed.fileOperations).toHaveLength(2);
      expect(parsed.systems).toHaveLength(2);
      expect(parsed.acceptanceCriteria).toHaveLength(3);
    });

    it('extracts JSON from markdown code blocks with surrounding commentary', () => {
      const text = `
Here is your build plan for the car game!

\`\`\`json
{
  "title": "Turbo Drift",
  "summary": "Fast-paced drift game with traffic",
  "engine": "canvas2d",
  "systems": ["Drift physics and steering", "Traffic spawn and collision"],
  "fileOperations": [
    { "path": "index.html", "operation": "create", "purpose": "HTML host" },
    { "path": "game.js", "operation": "create", "purpose": "Main loop" },
  ],
  "assetOperations": [],
  "scriptOrder": ["game.js"],
  "acceptanceCriteria": [
    "Car turns smoothly with WASD.",
    "Collisions reset the car.",
    "Diagnostics show ready: true.",
  ]
}
\`\`\`

Let me know if you would like any changes!
`;

      const parsed = parseManagerOutput(text);
      expect(parsed.title).toBe('Turbo Drift');
      expect(parsed.fileOperations).toHaveLength(2);
      expect(parsed.acceptanceCriteria).toHaveLength(3);
    });

    it('handles trailing commas and missing optional fields gracefully', () => {
      const text = `{
        "title": "Space Invaders",
        "summary": "Classic space shooter",
        "systems": ["Alien wave movement", "Bullet collision",],
        "fileOperations": [
          { "path": "game.js", "purpose": "Shooter loop", },
        ],
      }`;

      const parsed = parseManagerOutput(text);
      expect(parsed.title).toBe('Space Invaders');
      expect(parsed.systems.length).toBeGreaterThanOrEqual(2);
      expect(parsed.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
      expect(parsed.scriptOrder).toEqual(['game.js']);
    });
  });

  describe('blueprintSchema', () => {
    const fileHash = `sha256:${'a'.repeat(64)}`;

    it('accepts minimumSimulationSteps: 45 and minimumSimulationSteps: 120', () => {
      const basePlan = {
        title: 'Arcade Game',
        summary: 'A fast-paced test game.',
        engine: 'canvas2d' as const,
        systems: ['Player movement', 'Scoring loop'],
        fileOperations: [
          { path: 'index.html', operation: 'edit' as const, purpose: 'Load the game.', expectedHash: fileHash },
          { path: 'game.js', operation: 'create' as const, purpose: 'Implement gameplay.', expectedHash: null },
        ],
        assetOperations: [],
        scriptOrder: ['game.js'],
        acceptanceCriteria: ['The game starts.', 'Controls respond.', 'Restart works.'],
        schemaVersion: '1.0' as const,
        id: '00000000-0000-4000-8000-000000000001',
        workspaceId: 'workspace-test',
        baseRevision: fileHash,
        manifest: [{ path: 'index.html', hash: fileHash, bytes: 10 }],
        verification: {
          scenarios: ['startup', 'controls', 'restart', 'resize'] as const,
          minimumSimulationSteps: 45,
          requireDiagnostics: true as const,
        },
        budgets: {
          assetAttempts: 1 as const,
          maximumSourceBytes: MAX_GAME_SOURCE_BYTES,
          maximumResponseSegments: MAX_GAME_RESPONSE_SEGMENTS,
        },
      };

      const parsed45 = blueprintSchema.parse(basePlan);
      expect(parsed45.verification.minimumSimulationSteps).toBe(45);

      const parsed120 = blueprintSchema.parse({
        ...basePlan,
        verification: { ...basePlan.verification, minimumSimulationSteps: 120 },
      });
      expect(parsed120.verification.minimumSimulationSteps).toBe(120);
    });
  });
});

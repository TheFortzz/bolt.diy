import { describe, expect, it } from 'vitest';
import { getSystemPrompt } from './prompts';

describe('FortzAI system prompt', () => {
  it('does not prescribe the old fixed game file template', () => {
    const prompt = getSystemPrompt('/home/project', 'fortz-ai');

    expect(prompt).toContain("The user's idea is the source of truth");
    expect(prompt).toContain('Choose the architecture that best fits the idea');
    expect(prompt).not.toContain('src/player.js');
    expect(prompt).not.toContain('src/enemies.js');
    expect(prompt).not.toContain('src/bullets.js');
    expect(prompt).not.toContain('at least 6 separate');
    expect(prompt).not.toContain('2000+ lines');
  });

  it('keeps the complete-file artifact contract', () => {
    const prompt = getSystemPrompt('/home/project', 'fortz-ai');

    expect(prompt).toContain('<boltArtifact');
    expect(prompt).toContain('<boltAction type="file"');
    expect(prompt).toContain('complete, current file contents');
    expect(prompt).toContain('relative to the current working directory');
  });
});

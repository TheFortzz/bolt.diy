import { describe, expect, it } from 'vitest';
import { shouldUseBuildPlanner } from '~/lib/runtime/request-intent';

describe('Studio request intent routing', () => {
  it.each([
    'hi',
    'hello',
    'how are you?',
    'what games can you help me make?',
    'what can you build?',
    'how do I make a game?',
    'Could you tell me how to build a game?',
  ])('keeps conversational prompts out of the approval planner: %s', (prompt) => {
    expect(shouldUseBuildPlanner(prompt)).toBe(false);
  });

  it.each([
    'Build a gun game',
    'Can you make a platformer?',
    'Hey, build a car game',
    'Gun game',
    'Could you help me build a game?',
    "I'd like to make a game",
    'Add a restart button',
    'Please fix my game',
    'I want a new game about space racing',
    'My game is not working',
    'finish it then',
    'finished?',
    'finish',
    'continue',
    'keep going',
    'it stopped',
    'the build stopped',
    'why did it stop',
    'can you finish it',
    'complete the game',
  ])('uses the approval planner for clear workspace changes: %s', (prompt) => {
    expect(shouldUseBuildPlanner(prompt)).toBe(true);
  });

  it('respects an explicitly selected chat mode', () => {
    expect(shouldUseBuildPlanner('Build a game', 'chat')).toBe(false);
  });

  it('respects explicit plan/build modes', () => {
    expect(shouldUseBuildPlanner('hi', 'plan')).toBe(true);
    expect(shouldUseBuildPlanner('what is a game loop?', 'build')).toBe(true);
  });
});

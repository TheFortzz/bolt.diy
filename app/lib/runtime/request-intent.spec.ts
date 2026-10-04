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
    'finish the build',
    'buils a hide and seek game like mecachameloen',
    'ya can u build a game like that?',
    'contunue building',
    'continew building',
    'bro it lags.. fix it pleas and it always fails pleas fix build a car game',
    'can u build a car game',
    'bro please fix',
    'buils a game',
    'crate a game',
    'please fixx',
    'very nice can u now improve the view like the ui and colors use like blue and white color and make the enviroment feel real space',
    'nice can u also add sound',
    'looks great! now make the ship faster',
    'use blue and white color',
    'tweak the jump height',
    'adjust the player speed',
    'polish the controls',
    'i want blue and white colors',
    'imprve the cars design',
    'imporve the car',
    'make it realsitic',
    'upgrade the cars',
    'faster cars',
  ])('uses the approval planner for clear workspace changes: %s', (prompt) => {
    expect(shouldUseBuildPlanner(prompt)).toBe(true);
  });

  it('routes game feature prompts to the build planner when a project already exists', () => {
    expect(shouldUseBuildPlanner('cars design', 'auto', true)).toBe(true);
    expect(shouldUseBuildPlanner('traffic speed', 'auto', true)).toBe(true);
    expect(shouldUseBuildPlanner('realistic road', 'auto', true)).toBe(true);
    expect(shouldUseBuildPlanner('hi', 'auto', true)).toBe(false);
  });

  it('respects an explicitly selected chat mode', () => {
    expect(shouldUseBuildPlanner('Build a game', 'chat')).toBe(false);
  });

  it('respects explicit plan/build modes', () => {
    expect(shouldUseBuildPlanner('hi', 'plan')).toBe(true);
    expect(shouldUseBuildPlanner('what is a game loop?', 'build')).toBe(true);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ClarificationCard } from '~/components/chat/ClarificationCard';

const questions = [
  {
    question: 'What kind of driving should be the core challenge?',
    options: [
      { label: 'Arcade traffic dodging', description: 'Dodge traffic, grab boosts' },
      { label: 'Circuit racing' },
      { label: 'Checkpoint time trial' },
    ],
  },
  {
    question: 'Which camera and setting do you prefer?',
    options: [{ label: 'Top-down, neon city' }, { label: 'Behind-car, coastal road' }],
  },
];

describe('ClarificationCard', () => {
  it('renders a choice box per question with every option', () => {
    const markup = renderToStaticMarkup(<ClarificationCard questions={questions} isInteractive onSubmit={vi.fn()} />);

    expect(markup).toContain('Quick choices');
    expect(markup).toContain('What kind of driving should be the core challenge?');
    expect(markup).toContain('Arcade traffic dodging');
    expect(markup).toContain('Checkpoint time trial');
    expect(markup).toContain('Which camera and setting do you prefer?');
    expect(markup).toContain('Top-down, neon city');
  });

  it('asks for one pick per box before the build button is enabled', () => {
    const markup = renderToStaticMarkup(<ClarificationCard questions={questions} isInteractive onSubmit={vi.fn()} />);

    expect(markup).toContain('Pick one option per box');
    expect(markup).toContain('disabled');
  });

  it('locks the boxes once the card is no longer the newest message', () => {
    const markup = renderToStaticMarkup(
      <ClarificationCard questions={questions} isInteractive={false} onSubmit={vi.fn()} />,
    );

    expect(markup).toContain('Answered.');
    expect(markup).not.toContain('Build my game');
  });

  it('renders nothing without usable questions', () => {
    const markup = renderToStaticMarkup(<ClarificationCard questions={[]} isInteractive onSubmit={vi.fn()} />);

    expect(markup).toBe('');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { activitySteps, startActivity, updateActivity } from '~/lib/stores/activity';
import { ActivityTimeline } from './ActivityTimeline';

describe('chat activity timeline', () => {
  beforeEach(() => activitySteps.set({}));

  it('renders real steps for their own assistant turn only', () => {
    startActivity('first', 'validation:build', 'Running build check', 'Build check passed');
    startActivity('second', 'validation:preview', 'Loading preview', 'Preview loaded');
    updateActivity('first', 'validation:build', 'complete');

    const first = renderToStaticMarkup(<ActivityTimeline messageId="first" />);
    const second = renderToStaticMarkup(<ActivityTimeline messageId="second" />);

    expect(first).toContain('Build check passed');
    expect(first).not.toContain('Loading preview');
    expect(second).toContain('Loading preview');
    expect(second).not.toContain('Build check passed');
  });

  it('shows thinking only before any observed activity', () => {
    expect(renderToStaticMarkup(<ActivityTimeline isStreaming />)).toContain('Thinking…');
    expect(renderToStaticMarkup(<ActivityTimeline />)).toBe('');
  });

  it('exposes an accessible expansion control and real file paths', () => {
    startActivity('build', 'action:file', 'Editing game.js', 'Edited game.js', 'running', '/home/project/game.js');
    const markup = renderToStaticMarkup(<ActivityTimeline messageId="build" />);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('Expand');
    expect(markup).toContain('game.js');
    expect(markup).toContain('data-status="running"');
  });
});

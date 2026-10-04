import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/components/chat/Markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('~/components/chat/Artifact', () => ({
  Artifact: ({ messageId }: { messageId: string }) => <div data-testid="artifact" data-id={messageId} />,
}));

import { AssistantMessage } from '~/components/chat/AssistantMessage';

describe('AssistantMessage', () => {
  it('extracts <think> tags into a collapsible thought process and shows clean text', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage
        content="<think>Planning the 3D car game with Three.js</think>Here is your new 3D car game!"
      />,
    );

    expect(markup).toContain('Thought process');
    expect(markup).toContain('Here is your new 3D car game!');
    expect(markup).not.toContain('<think>');
    expect(markup).not.toContain('</think>');
  });

  it('shows thinking spinner indicator while streaming thoughts', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage
        content="<think>Analyzing road curvature and vehicle physics"
        isStreaming={true}
      />,
    );

    expect(markup).toContain('Thinking…');
    expect(markup).not.toContain('<think>');
  });

  it('extracts /* DESIGN PLAN: ... */ comment blocks into thought process', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage
        content="/* DESIGN PLAN:\n1. KEEP: render()\n2. NEW: nitroBoost()\n*/\nI added nitro boost to your car!"
      />,
    );

    expect(markup).toContain('Thought process');
    expect(markup).toContain('I added nitro boost to your car!');
    expect(markup).not.toContain('/* DESIGN PLAN:');
  });

  it('strips leaked raw boltAction and boltArtifact tags so code is not dumped into text', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage
        content="<boltArtifact id='test' title='Game'><boltAction type='file' filePath='game.js'>console.log('leaked code');</boltAction></boltArtifact>Game updated successfully!"
      />,
    );

    expect(markup).toContain('Game updated successfully!');
    expect(markup).not.toContain('console.log(\'leaked code\');');
    expect(markup).not.toContain('<boltAction');
    expect(markup).not.toContain('</boltArtifact>');
  });
});

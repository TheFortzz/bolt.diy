import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileChangePreview } from '~/components/chat/FileChangePreview';

describe('expandable file source cards', () => {
  it('keeps large source collapsed and exposes an accessible expansion button', () => {
    const markup = renderToStaticMarkup(
      <FileChangePreview path="game.js" content="const score = 42;" isStreaming={false} />,
    );
    expect(markup).toContain('View code');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('const score');
  });

  it('opens the live source preview while a file is being written', () => {
    const markup = renderToStaticMarkup(
      <FileChangePreview path="game.js" content="const score = 42;" isStreaming />,
    );

    expect(markup).toContain('Hide code');
    expect(markup).toContain('Writing live');
    expect(markup).toContain('const score = 42;');
  });
});

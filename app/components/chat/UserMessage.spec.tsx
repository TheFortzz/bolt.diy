import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/components/chat/Markdown', () => ({ Markdown: ({ children }: { children: string }) => <p>{children}</p> }));

import { UserMessage } from '~/components/chat/UserMessage';

describe('user prompt presentation', () => {
  it('shows only the original prompt instead of internal file changes', () => {
    const markup = renderToStaticMarkup(
      <UserMessage
        content={[{ type: 'text', text: 'INTERNAL_FILE_CHANGES\n[Model: fortz-ai]\nBuild a racer' }]}
        annotations={[{ type: 'user-prompt', text: 'Build a racer' }]}
      />,
    );
    expect(markup).toContain('Build a racer');
    expect(markup).not.toContain('INTERNAL_FILE_CHANGES');
    expect(markup).not.toContain('[Model:');
  });

  it('preserves prompt attachments', () => {
    const markup = renderToStaticMarkup(
      <UserMessage
        content={[
          { type: 'text', text: 'Internal text' },
          { type: 'image', image: 'https://assets.example/car.png' },
        ]}
        annotations={[{ type: 'user-prompt', text: 'Use this car' }]}
      />,
    );
    expect(markup).toContain('Use this car');
    expect(markup).toContain('https://assets.example/car.png');
  });
});

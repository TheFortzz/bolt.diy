import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiWorkingGif, AI_WORKING_GIF_SRC } from '~/components/chat/AiWorkingGif';

describe('AiWorkingGif', () => {
  it('renders the working animation at full composer width when visible', () => {
    const markup = renderToStaticMarkup(<AiWorkingGif visible />);

    expect(markup).toContain(`src="${AI_WORKING_GIF_SRC}"`);
    expect(markup).toContain('w-full');
  });

  it('renders nothing when hidden', () => {
    expect(renderToStaticMarkup(<AiWorkingGif visible={false} />)).toBe('');
  });
});

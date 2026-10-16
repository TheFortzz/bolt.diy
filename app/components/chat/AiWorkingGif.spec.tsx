import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiWorkingGif } from '~/components/chat/AiWorkingGif';
import { GAME_WORLD_ART } from '~/utils/game-world-art';

describe('AiWorkingGif', () => {
  it('renders the working animation at full composer width when visible', () => {
    const markup = renderToStaticMarkup(<AiWorkingGif visible />);

    expect(markup).toContain(`src="${GAME_WORLD_ART[0]}"`);
    expect(markup).toContain('w-full');
  });

  it('renders nothing when hidden', () => {
    expect(renderToStaticMarkup(<AiWorkingGif visible={false} />)).toBe('');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatrixRain } from '~/components/chat/MatrixRain';

describe('MatrixRain', () => {
  it('renders a code-rain canvas stage', () => {
    const markup = renderToStaticMarkup(<MatrixRain />);

    expect(markup).toContain('<canvas');
    expect(markup).toContain('w-full');
  });
});

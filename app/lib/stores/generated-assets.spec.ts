import { describe, expect, it } from 'vitest';
import { inlineGeneratedAssetUrls } from '~/lib/stores/generated-assets';

describe('generated images in static iframe bundles', () => {
  it('resolves exact JS, HTML and CSS image URLs without replacing unrelated strings', () => {
    const html = `<img src="/assets/car.png"><script>img.src = 'assets/car.png'; const unrelated = 'assets/car.png.backup';</script><style>.car { background: url(./assets/car.png) }</style>`;
    const result = inlineGeneratedAssetUrls(html, {
      'assets/car.png': {
        id: 'car',
        path: 'assets/car.png',
        dataUrl: 'data:image/png;base64,AAAA',
        byteLength: 3,
      },
    });
    expect(result.match(/data:image\/png;base64,AAAA/g)).toHaveLength(3);
    expect(result).toContain('assets/car.png.backup');
  });
});

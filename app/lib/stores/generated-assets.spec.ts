import { describe, expect, it } from 'vitest';
import { inlineGeneratedAssetUrls, type GeneratedAsset } from './generated-assets';

const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
const glbDataUrl = 'data:model/gltf-binary;base64,glTFAAAA=';
const wavDataUrl = 'data:audio/wav;base64,UklGRg==';

function asset(path: string, dataUrl: string): GeneratedAsset {
  return { id: path, path, dataUrl, byteLength: dataUrl.length };
}

describe('inlineGeneratedAssetUrls', () => {
  it('inlines an image reference in a JS string so the published game has real bytes', () => {
    const html = '<canvas></canvas><script>const hero = new Image(); hero.src = "assets/hero.png";</script>';

    const out = inlineGeneratedAssetUrls(html, { 'assets/hero.png': asset('assets/hero.png', pngDataUrl) });

    expect(out).toContain(pngDataUrl);
    expect(out).not.toContain('"assets/hero.png"');
  });

  it('inlines a 3D model reference, so a published game is not missing its geometry', () => {
    const html =
      '<script type="module">const loader = new GLTFLoader(); loader.load("assets/crate.glb", onLoad);</script>';

    const out = inlineGeneratedAssetUrls(html, { 'assets/crate.glb': asset('assets/crate.glb', glbDataUrl) });

    expect(out).toContain(glbDataUrl);
  });

  it('inlines audio references', () => {
    const html = '<script>const s = new Audio("assets/jump.wav");</script>';

    expect(inlineGeneratedAssetUrls(html, { 'assets/jump.wav': asset('assets/jump.wav', wavDataUrl) })).toContain(
      wavDataUrl,
    );
  });

  it('rewrites /path and ./path variants too', () => {
    const html = '<img src="/assets/hero.png"><img src="./assets/hero.png">';
    const out = inlineGeneratedAssetUrls(html, { 'assets/hero.png': asset('assets/hero.png', pngDataUrl) });

    expect(out.match(new RegExp(pngDataUrl.replace(/[+/=]/g, '\\$&'), 'g'))?.length).toBe(2);
  });

  it('inlines paths that have a query string or hash in the iframe document', () => {
    const html = '<script>image.src = \"./assets/hero.png?v=2#sprite\";</script>';
    const out = inlineGeneratedAssetUrls(html, { 'assets/hero.png': asset('assets/hero.png', pngDataUrl) });

    expect(out).toContain(pngDataUrl);
    expect(out).not.toContain('assets/hero.png?v=2');
  });

  it('rewrites CSS url() references', () => {
    const out = inlineGeneratedAssetUrls('<style>.hud{background:url(assets/hud.png)}</style>', {
      'assets/hud.png': asset('assets/hud.png', pngDataUrl),
    });

    expect(out).toContain(pngDataUrl);
  });

  it('leaves unrelated strings and partial matches alone', () => {
    const html = '<script>const label = "assets/hero.png.backup"; const other = "assets/nope.png";</script>';
    const out = inlineGeneratedAssetUrls(html, { 'assets/hero.png': asset('assets/hero.png', pngDataUrl) });

    expect(out).toContain('assets/hero.png.backup');
    expect(out).toContain('"assets/nope.png"');
  });

  it('returns the document untouched when there are no assets', () => {
    const html = '<img src="assets/hero.png">';

    expect(inlineGeneratedAssetUrls(html, {})).toBe(html);
  });
});

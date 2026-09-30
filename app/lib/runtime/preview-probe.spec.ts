import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreviewProbe, injectPreviewProbe, installPreviewProbe } from '~/lib/runtime/preview-probe';

describe('iframe game runtime probe', () => {
  let now: number;
  let queue: FrameRequestCallback[];
  let win: {
    requestAnimationFrame: typeof requestAnimationFrame;
    parent: { postMessage: ReturnType<typeof vi.fn> };
    Image: typeof Image;
    addEventListener: ReturnType<typeof vi.fn>;
  };
  let documentImages: Array<{ complete: boolean; naturalWidth: number; getAttribute: () => string }>;
  let context: { fillRect: () => void };

  const advance = (frames: number) => {
    for (let index = 0; index < frames; index++) {
      now += 17;
      const callbacks = queue.splice(0);
      callbacks.forEach((callback) => callback(now));
    }
  };

  beforeEach(() => {
    now = 0;
    queue = [];
    documentImages = [];
    class Context {
      fillRect() {}
    }
    class TestImage {
      addEventListener() {}
    }
    context = new Context();
    win = {
      requestAnimationFrame: (callback) => {
        queue.push(callback);
        return queue.length;
      },
      parent: { postMessage: vi.fn() },
      Image: TestImage as unknown as typeof Image,
      addEventListener: vi.fn(),
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('document', {
      readyState: 'interactive',
      images: documentImages,
      querySelector: () => ({ width: 800, height: 600 }),
      querySelectorAll: () => [],
    });
    vi.stubGlobal('console', { ...console, error: vi.fn() });
    vi.stubGlobal('CanvasRenderingContext2D', Context);
    vi.stubGlobal('WebGLRenderingContext', undefined);
    vi.stubGlobal('WebGL2RenderingContext', undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('passes only with actual application callbacks and repeated canvas rendering', () => {
    installPreviewProbe('run-token', 'https://ide.example');
    const loop = () => {
      context.fillRect();
      win.requestAnimationFrame(loop);
    };
    win.requestAnimationFrame(loop);
    advance(100);
    expect(win.parent.postMessage).not.toHaveBeenCalled();
    advance(60);
    expect(win.parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'preview-loaded', token: 'run-token' }),
      'https://ide.example',
    );
  });

  it('does not verify a loaded document whose game loop never advances', () => {
    installPreviewProbe('token', 'https://ide.example');
    advance(600);
    expect(win.parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'preview-error', error: expect.stringContaining('did not advance') }),
      'https://ide.example',
    );
    expect(win.parent.postMessage.mock.calls.some(([message]) => message.type === 'preview-loaded')).toBe(false);
  });

  it('fails on broken images rather than ignoring them after readiness', () => {
    documentImages.push({ complete: true, naturalWidth: 0, getAttribute: () => 'assets/missing.png' });
    installPreviewProbe('token', 'https://ide.example');
    advance(1);
    expect(win.parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'preview-error', error: 'Broken image: assets/missing.png' }),
      'https://ide.example',
    );
  });

  it('captures console errors while the game is being observed', () => {
    installPreviewProbe('token', 'https://ide.example');
    console.error('Unable to initialize scene');
    expect(win.parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'preview-error', error: 'Console error: Unable to initialize scene' }),
      'https://ide.example',
    );
  });

  it('captures resource failures before gameplay initialization', () => {
    installPreviewProbe('token', 'https://ide.example');
    const errorHandler = win.addEventListener.mock.calls.find(([type]) => type === 'error')?.[1];
    errorHandler({ target: { getAttribute: () => 'missing.js' } });
    expect(win.parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Resource failed to load: missing.js' }),
      'https://ide.example',
    );
  });

  it('injects instrumentation even when generated HTML has no doctype', () => {
    const probe = createPreviewProbe('token', 'https://ide.example');
    expect(injectPreviewProbe('<html><body>Game</body></html>', probe)).toBe(`${probe}<html><body>Game</body></html>`);
    expect(injectPreviewProbe('<!DOCTYPE html><html></html>', probe)).toContain(`<!DOCTYPE html>${probe}`);
  });
});

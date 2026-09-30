/** Self-contained: serialized into the sandbox before any game scripts run. */
export function installPreviewProbe(token: string, parentOrigin: string) {
  let failed = false;
  let applicationFrames = 0;
  let renderFrames = 0;
  let observationFrame = 0;
  let lastRenderFrame = -1;
  let started = false;
  const images: HTMLImageElement[] = [];
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const startedAt = performance.now();

  const report = (type: string, error?: string) => {
    window.parent.postMessage({ token, type, error, applicationFrames, renderFrames }, parentOrigin);
  };
  const fail = (error: string) => {
    if (!failed) {
      failed = true;
      report('preview-error', error);
    }
  };

  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement | null;
      const resource = target?.getAttribute?.('src') || target?.getAttribute?.('href');
      fail(resource ? `Resource failed to load: ${resource.slice(0, 180)}` : event.message || 'Script error');
    },
    true,
  );
  window.addEventListener('unhandledrejection', (event) => fail(String(event.reason?.message || event.reason)));

  const originalError = console.error.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    fail(`Console error: ${args.map(String).join(' ').slice(0, 1000)}`);
  };

  window.requestAnimationFrame = (callback) =>
    nativeFrame((time) => {
      applicationFrames++;
      callback(time);
    });

  const trackRender = () => {
    if (lastRenderFrame !== observationFrame) {
      renderFrames++;
      lastRenderFrame = observationFrame;
    }
  };
  const instrumentRendering = (prototype: object, methods: string[]) => {
    const record = prototype as Record<string, (...args: unknown[]) => unknown>;

    for (const method of methods) {
      const original = record[method];

      if (typeof original !== 'function') {
        continue;
      }

      record[method] = function (...args) {
        const result = original.apply(this, args);
        trackRender();

        return result;
      };
    }
  };

  if (typeof CanvasRenderingContext2D !== 'undefined') {
    instrumentRendering(CanvasRenderingContext2D.prototype, [
      'drawImage',
      'fill',
      'stroke',
      'fillRect',
      'fillText',
      'putImageData',
    ]);
  }

  if (typeof WebGLRenderingContext !== 'undefined') {
    instrumentRendering(WebGLRenderingContext.prototype, ['drawArrays', 'drawElements']);
  }

  if (typeof WebGL2RenderingContext !== 'undefined') {
    instrumentRendering(WebGL2RenderingContext.prototype, [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
    ]);
  }

  const nativeImageConstructor = window.Image;
  const trackedImageConstructor = function (width?: number, height?: number) {
    const image = new nativeImageConstructor(width, height);
    images.push(image);
    image.addEventListener('error', () =>
      fail(`Image failed to decode: ${(image.getAttribute('src') || '').slice(0, 180)}`),
    );

    return image;
  };
  trackedImageConstructor.prototype = nativeImageConstructor.prototype;
  window.Image = trackedImageConstructor as unknown as typeof Image;

  const ready = () => {
    if (started) {
      return;
    }

    started = true;
    images.push(...Array.from(document.images));

    // Exercise a start control, not every button (which could reset or exit).
    const start = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).find((element) =>
      /^(start|play|new game|begin)(\b|\s)/i.test(element.textContent?.trim() || ''),
    );
    start?.click();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }

  const observe = () => {
    observationFrame++;

    if (failed) {
      return;
    }

    const elapsed = performance.now() - startedAt;
    const tracked = [...images, ...Array.from(document.images)].filter((image) => image.getAttribute('src'));
    const broken = tracked.find((image) => image.complete && image.naturalWidth === 0);

    if (broken) {
      fail(`Broken image: ${(broken.getAttribute('src') || '').slice(0, 180)}`);
      return;
    }

    const imagesReady = tracked.every((image) => image.complete && image.naturalWidth > 0);
    const canvas = document.querySelector('canvas');

    if (
      started &&
      elapsed >= 2500 &&
      applicationFrames >= 90 &&
      renderFrames >= 60 &&
      imagesReady &&
      canvas?.width &&
      canvas.height
    ) {
      report('preview-loaded');
      return;
    }

    if (elapsed >= 10000) {
      fail(
        !imagesReady
          ? 'Images did not finish loading'
          : !canvas
            ? 'No game canvas found'
            : `Game loop or rendering did not advance (${applicationFrames} callbacks, ${renderFrames} rendered frames)`,
      );
      return;
    }

    nativeFrame(observe);
  };
  nativeFrame(observe);
}

export function createPreviewProbe(token: string, parentOrigin: string) {
  const args = JSON.stringify([token, parentOrigin]).replace(/</g, '\\u003c');

  return `<script>(${installPreviewProbe.toString()})(...${args});</script>`;
}

export function injectPreviewProbe(html: string, probe: string) {
  if (/<!doctype[^>]*>/i.test(html)) {
    return html.replace(/(<!doctype[^>]*>)/i, `$1${probe}`);
  }

  return `${probe}${html}`;
}

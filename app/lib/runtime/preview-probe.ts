/** Self-contained: serialized into the sandbox before any game scripts run. */
export type PreviewVerificationRequirements = {
  scenarios: readonly ('startup' | 'controls' | 'restart' | 'resize')[];
  minimumSimulationSteps: number;
  requireDiagnostics: boolean;
};

export function installPreviewProbe(
  token: string,
  parentOrigin: string,
  verification?: PreviewVerificationRequirements,
) {
  let failed = false;
  let applicationFrames = 0;
  let renderFrames = 0;
  let observationFrame = 0;
  let lastRenderFrame = -1;
  let started = false;
  const images: HTMLImageElement[] = [];
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const startedAt = performance.now();

  const readDiagnostics = () => {
    const raw = (window as Window & { __GAME_DIAGNOSTICS__?: Record<string, unknown> }).__GAME_DIAGNOSTICS__;

    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    return {
      ready: raw.ready === true,
      simulationSteps: Number(raw.simulationSteps),
      inputsHandled: Number(raw.inputsHandled),
      restartCount: Number(raw.restartCount),
      resizeCount: Number(raw.resizeCount),
      gameState: typeof raw.gameState === 'string' ? raw.gameState : '',
    };
  };
  let diagnosticsBaseline: ReturnType<typeof readDiagnostics>;
  const diagnosticsFailure = () => {
    if (!verification?.requireDiagnostics) {
      return undefined;
    }

    const diagnostics = readDiagnostics();

    if (!diagnostics) {
      return 'Game did not expose window.__GAME_DIAGNOSTICS__.';
    }

    const baseline = diagnosticsBaseline;

    if (!baseline) {
      return 'Game diagnostics were not initialized before the verification started.';
    }

    if (!diagnostics.ready) {
      return 'Game diagnostics never reported ready.';
    }

    const baselineSimulationSteps = Number.isFinite(baseline.simulationSteps) ? baseline.simulationSteps : 0;
    const simulationDelta = diagnostics.simulationSteps - baselineSimulationSteps;

    if (!Number.isFinite(simulationDelta) || simulationDelta < verification.minimumSimulationSteps) {
      return `Game simulation advanced only ${Number.isFinite(simulationDelta) ? simulationDelta : 0} of ${verification.minimumSimulationSteps} required steps during verification.`;
    }

    const baselineInputs = Number.isFinite(baseline.inputsHandled) ? baseline.inputsHandled : 0;

    if (
      verification.scenarios.includes('controls') &&
      (!Number.isFinite(diagnostics.inputsHandled) || diagnostics.inputsHandled - baselineInputs < 1)
    ) {
      return 'Game did not report handling the verification control input.';
    }

    const baselineRestarts = Number.isFinite(baseline.restartCount) ? baseline.restartCount : 0;

    if (
      verification.scenarios.includes('restart') &&
      (!Number.isFinite(diagnostics.restartCount) || diagnostics.restartCount - baselineRestarts < 1)
    ) {
      return 'Game did not report restarting after the verification input.';
    }

    const baselineResizes = Number.isFinite(baseline.resizeCount) ? baseline.resizeCount : 0;

    if (
      verification.scenarios.includes('resize') &&
      (!Number.isFinite(diagnostics.resizeCount) || diagnostics.resizeCount - baselineResizes < 1)
    ) {
      return 'Game did not report handling the verification resize event.';
    }

    if (
      verification.scenarios.includes('startup') &&
      baseline.gameState === 'menu' &&
      diagnostics.gameState === 'menu'
    ) {
      return 'Game remained at the menu after the verification start input.';
    }

    if (diagnostics.gameState.trim().length === 0) {
      return 'Game diagnostics did not report a game state.';
    }

    return undefined;
  };
  const report = (type: string, error?: string) => {
    const diagnostics = readDiagnostics();
    window.parent.postMessage({ token, type, error, applicationFrames, renderFrames, diagnostics }, parentOrigin);
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
    diagnosticsBaseline = readDiagnostics();

    // Exercise a start control, not every button (which could reset or exit).
    const start = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]')).find((element) =>
      /^(start|play|new game|begin)(\b|\s)/i.test(element.textContent?.trim() || ''),
    );
    start?.click();

    if (verification?.requireDiagnostics) {
      const dispatchKey = (key: string) => {
        const down = new Event('keydown', { bubbles: true, cancelable: true }) as KeyboardEvent;
        const up = new Event('keyup', { bubbles: true, cancelable: true }) as KeyboardEvent;
        Object.defineProperty(down, 'key', { value: key });
        Object.defineProperty(up, 'key', { value: key });
        window.dispatchEvent(down);
        window.dispatchEvent(up);
      };

      dispatchKey('Enter');

      if (verification.scenarios.includes('controls')) {
        dispatchKey('ArrowRight');
      }

      if (verification.scenarios.includes('restart')) {
        dispatchKey('r');
      }

      if (verification.scenarios.includes('resize')) {
        window.dispatchEvent(new Event('resize'));
      }
    }
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
    const diagnosticsError = diagnosticsFailure();

    if (
      started &&
      elapsed >= 2500 &&
      applicationFrames >= 90 &&
      renderFrames >= 60 &&
      imagesReady &&
      canvas?.width &&
      canvas.height &&
      !diagnosticsError
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
            : diagnosticsError ||
              `Game loop or rendering did not advance (${applicationFrames} callbacks, ${renderFrames} rendered frames)`,
      );
      return;
    }

    nativeFrame(observe);
  };
  nativeFrame(observe);
}

export function createPreviewProbe(
  token: string,
  parentOrigin: string,
  verification?: PreviewVerificationRequirements,
) {
  const args = JSON.stringify([token, parentOrigin, verification]).replace(/</g, '\\u003c');

  return `<script>(${installPreviewProbe.toString()})(...${args});</script>`;
}

export function injectPreviewProbe(html: string, probe: string) {
  if (/<!doctype[^>]*>/i.test(html)) {
    return html.replace(/(<!doctype[^>]*>)/i, `$1${probe}`);
  }

  return `${probe}${html}`;
}

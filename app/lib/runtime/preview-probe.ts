/** Self-contained: serialized into the sandbox before any game scripts run. */
export type PreviewVerificationRequirements = {
  scenarios: readonly ('startup' | 'controls' | 'restart' | 'resize')[];
  minimumSimulationSteps: number;
  requireDiagnostics: boolean;
  requireWebGL?: boolean;
};

export function installPreviewProbe(
  token: string,
  parentOrigin: string,
  verification?: PreviewVerificationRequirements,
) {
  let failed = false;
  let applicationFrames = 0;
  let renderFrames = 0;
  let webglDrawCalls = 0;
  let observationFrame = 0;
  let lastRenderFrame = -1;
  let started = false;
  const images: HTMLImageElement[] = [];
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const startedAt = performance.now();

  const win = window as any;
  try {
    Object.defineProperty(win, 'GAME_DIAGNOSTICS', {
      get: () => win.__GAME_DIAGNOSTICS__,
      set: (val) => { win.__GAME_DIAGNOSTICS__ = val; },
      configurable: true,
      enumerable: true,
    });
  } catch {
    win.GAME_DIAGNOSTICS ??= win.__GAME_DIAGNOSTICS__;
  }

  const readDiagnostics = () => {
    const raw = win.__GAME_DIAGNOSTICS__ || win.GAME_DIAGNOSTICS || win.__DIAGNOSTICS__;

    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    win.__GAME_DIAGNOSTICS__ = raw;
    win.GAME_DIAGNOSTICS = raw;

    return {
      ready: raw.ready === true || raw.ready === undefined,
      simulationSteps: Number(raw.simulationSteps ?? 0),
      inputsHandled: Number(raw.inputsHandled ?? 0),
      restartCount: Number(raw.restartCount ?? 0),
      resizeCount: Number(raw.resizeCount ?? 0),
      gameState: typeof raw.gameState === 'string' ? raw.gameState : 'playing',
    };
  };
  let diagnosticsBaseline: ReturnType<typeof readDiagnostics>;
  const diagnosticsFailure = () => {
    if (!verification?.requireDiagnostics) {
      return verification?.requireWebGL && webglDrawCalls === 0
        ? 'A 3D build must render real WebGL geometry; no WebGL draw calls were observed.'
        : undefined;
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
    let simulationDelta = diagnostics.simulationSteps - baselineSimulationSteps;

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

    if (verification.requireWebGL && webglDrawCalls === 0) {
      return 'A 3D build must render real WebGL geometry; no WebGL draw calls were observed.';
    }

    return undefined;
  };
  const report = (type: string, error?: string) => {
    const diagnostics = readDiagnostics();
    window.parent.postMessage(
      { token, type, error, applicationFrames, renderFrames, webglDrawCalls, diagnostics },
      parentOrigin,
    );
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
    const msg = args.map(String).join(' ');
    if (
      msg.includes('AudioContext') ||
      msg.includes('user gesture') ||
      msg.includes('favicon.ico') ||
      msg.includes('preload')
    ) {
      return;
    }
    fail(`Console error: ${msg.slice(0, 1000)}`);
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
  const instrumentRendering = (prototype: object, methods: string[], isWebGL = false) => {
    const record = prototype as Record<string, (...args: unknown[]) => unknown>;

    for (const method of methods) {
      const original = record[method];

      if (typeof original !== 'function') {
        continue;
      }

      record[method] = function (...args) {
        const result = original.apply(this, args);

        if (isWebGL) {
          webglDrawCalls++;
        }

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
    instrumentRendering(WebGLRenderingContext.prototype, ['drawArrays', 'drawElements'], true);
  }

  if (typeof WebGL2RenderingContext !== 'undefined') {
    instrumentRendering(
      WebGL2RenderingContext.prototype,
      ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'],
      true,
    );
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

    // Exercise start controls: button clicks, canvas pointer events, and keyboard keys
    const buttonWithLabel = (pattern: RegExp) =>
      Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a')).find((element) =>
        pattern.test(
          [element.textContent, element.getAttribute?.('aria-label'), element.getAttribute?.('title')]
            .filter(Boolean)
            .join(' '),
        ),
      );
    const startButton = buttonWithLabel(/^(start|begin|new game|start race|play(?!\s+again\b))(\b|\s)/i);
    const stateBeforeStart = diagnosticsBaseline?.gameState || '';
    const isStartState = (state: string) => /^(menu|ready|title|start)$/i.test(state);

    if (startButton) {
      const inputsBeforeButton = diagnosticsBaseline?.inputsHandled ?? 0;
      startButton.click();
      const diagnosticsAfterButton = readDiagnostics();
      const stateAfterButton = diagnosticsAfterButton?.gameState || '';
      const startWasIgnored = isStartState(stateBeforeStart)
        ? isStartState(stateAfterButton)
        : diagnosticsAfterButton?.inputsHandled === inputsBeforeButton && stateAfterButton === stateBeforeStart;
      if (startWasIgnored) {
        fail('Start button did not trigger a game action or leave the menu/ready state.');
        return;
      }
    } else if (!startButton && isStartState(stateBeforeStart)) {
      for (const canvas of Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas'))) {
        try {
          canvas.focus?.();
          canvas.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true }));
          canvas.dispatchEvent?.(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        } catch {}
      }
      const enter = new Event('keydown', { bubbles: true, cancelable: true }) as KeyboardEvent;
      Object.defineProperty(enter, 'key', { value: 'Enter' });
      window.dispatchEvent(enter);
      if (isStartState(readDiagnostics()?.gameState || '')) {
        fail('No working Start button or start-key handler left the game at its menu.');
        return;
      }
    }

    if (verification?.requireDiagnostics) {
      const dispatchKey = (key: string, code?: string, keyCode?: number) => {
        const down = new Event('keydown', { bubbles: true, cancelable: true }) as KeyboardEvent;
        const up = new Event('keyup', { bubbles: true, cancelable: true }) as KeyboardEvent;
        Object.defineProperty(down, 'key', { value: key });
        Object.defineProperty(up, 'key', { value: key });
        if (code) {
          Object.defineProperty(down, 'code', { value: code });
          Object.defineProperty(up, 'code', { value: code });
        }
        if (keyCode) {
          Object.defineProperty(down, 'keyCode', { value: keyCode });
          Object.defineProperty(down, 'which', { value: keyCode });
          Object.defineProperty(up, 'keyCode', { value: keyCode });
          Object.defineProperty(up, 'which', { value: keyCode });
        }
        window.dispatchEvent(down);
        window.dispatchEvent(up);
      };

      dispatchKey('Enter', 'Enter', 13);

      if (verification.scenarios.includes('controls')) {
        const beforeInput = readDiagnostics()?.inputsHandled ?? 0;
        dispatchKey('ArrowRight', 'ArrowRight', 39);
        if ((readDiagnostics()?.inputsHandled ?? beforeInput) <= beforeInput) {
          fail('ArrowRight did not reach a game control handler.');
          return;
        }
      }

      const pauseButton = buttonWithLabel(/^pause(\b|\s)/i);
      if (pauseButton) {
        pauseButton.click();
        if (!/^paused$/i.test(readDiagnostics()?.gameState || '')) {
          fail('Pause button did not pause the game.');
          return;
        }

        const resumeButton = buttonWithLabel(/^(resume|continue|unpause)(\b|\s)/i) || pauseButton;
        resumeButton.click();
        if (/^paused$/i.test(readDiagnostics()?.gameState || '')) {
          fail('Resume button did not resume the game.');
          return;
        }
      }

      if (verification.scenarios.includes('restart')) {
        const restartButton = buttonWithLabel(/^(restart|play again|retry|new run)(\b|\s)/i);
        if (restartButton) {
          const beforeButtonRestart = readDiagnostics()?.restartCount ?? 0;
          restartButton.click();
          if ((readDiagnostics()?.restartCount ?? beforeButtonRestart) <= beforeButtonRestart) {
            fail('Restart button did not trigger a game restart.');
            return;
          }
        }

        const beforeKeyRestart = readDiagnostics()?.restartCount ?? 0;
        dispatchKey('r', 'KeyR', 82);
        if ((readDiagnostics()?.restartCount ?? beforeKeyRestart) <= beforeKeyRestart) {
          fail('Pressing R did not trigger a game restart.');
          return;
        }
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
      elapsed >= 1800 &&
      applicationFrames >= 60 &&
      renderFrames >= 30 &&
      imagesReady &&
      canvas?.width &&
      canvas.height &&
      !diagnosticsError
    ) {
      report('preview-loaded');
      return;
    }

    if (elapsed >= 28000) {
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

export type StaticPreviewProbeResult = { ok: true } | { ok: false; error: string };

export function runStaticPreviewProbe(
  html: string,
  verification?: PreviewVerificationRequirements,
  timeoutMs = 30000,
): Promise<StaticPreviewProbeResult> {
  return new Promise<StaticPreviewProbeResult>((resolve) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return resolve({ ok: false, error: 'Document is not available for preview validation.' });
    }

    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    frame.style.cssText =
      'position:fixed;top:0;left:0;width:800px;height:600px;opacity:0.01;pointer-events:none;z-index:-1';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    const token = crypto.randomUUID();
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (result: StaticPreviewProbeResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      if (event.data.type === 'preview-error') {
        finish({ ok: false, error: `Preview runtime error: ${String(event.data.error).slice(0, 1200)}` });
      } else if (event.data.type === 'preview-loaded') {
        finish({ ok: true });
      }
    };

    window.addEventListener('message', onMessage);
    timer = setTimeout(() => finish({ ok: false, error: 'Preview did not load within 30 seconds.' }), timeoutMs);

    frame.srcdoc = injectPreviewProbe(html, createPreviewProbe(token, window.location.origin, verification));
    document.body.appendChild(frame);
  });
}

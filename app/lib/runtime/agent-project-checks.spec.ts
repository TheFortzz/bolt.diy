import { describe, expect, it } from 'vitest';
import {
  isTransientClineFailure,
  runAgentBuildCheck,
  runAgentGameplayCheck,
  runAgentQualityCheck,
} from '~/lib/runtime/agent-project-checks';

const playableFiles: Record<string, string> = {
  'index.html': `<!doctype html><html><body>
<canvas id="game"></canvas>
<script type="module" src="./game.js"></script>
</body></html>`,
  'input.js': `
export function bindInput(onKey) {
  window.addEventListener('keydown', (event) => onKey(event.key));
  window.addEventListener('keyup', (event) => onKey(event.key));
}
`,
  'game.js': `
import { bindInput } from './input.js';

window.__GAME_DIAGNOSTICS__ = {
  ready: true,
  simulationSteps: 0,
  inputsHandled: 0,
  restartCount: 0,
  resizeCount: 0,
  gameState: 'playing',
};

const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
let score = 0;

function restart() {
  score = 0;
  window.__GAME_DIAGNOSTICS__.restartCount += 1;
  window.__GAME_DIAGNOSTICS__.gameState = 'playing';
}

bindInput((key) => {
  window.__GAME_DIAGNOSTICS__.inputsHandled += 1;
  if (key === 'r') restart();
});

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  window.__GAME_DIAGNOSTICS__.resizeCount += 1;
});

function loop(now) {
  const dt = Math.min((now - (loop.last || now)) / 1000, 0.05);
  loop.last = now;
  window.__GAME_DIAGNOSTICS__.simulationSteps += 1;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e94560';
  ctx.fillRect(40, 40, 20, 20);
  score += dt;
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
`,
};

describe('agent-project-checks', () => {
  it('fails run_build on missing module exports the live audit would catch', () => {
    const result = runAgentBuildCheck({
      'index.html': '<script type="module" src="./game.js"></script>',
      'game.js': `import { missingThing } from './systems.js';\nconsole.log(missingThing);\n`,
      'systems.js': `export function otherThing() {}\n`,
    });

    expect(result.success).toBe(false);
    expect(result.issues.some((issue) => /missingThing|export/i.test(issue))).toBe(true);
  });

  it('passes gameplay and quality gates for a substantive playable shell', () => {
    expect(runAgentBuildCheck(playableFiles).success).toBe(true);
    expect(runAgentGameplayCheck(playableFiles).success).toBe(true);

    const quality = runAgentQualityCheck({
      ...playableFiles,
      'world.js': `${'const tile = 1;\n'.repeat(200)}export function paint(ctx, palette) {
  const gradient = ctx.createRadialGradient(0, 0, 10, 0, 0, 100);
  gradient.addColorStop(0, palette.glow);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 100, 100);
  spawnParticles();
  shakeCamera(4);
}
function spawnParticles() {}
function shakeCamera() {}
`,
    });

    expect(quality.success).toBe(true);
  });

  it('treats stream-ended-without-result as a transient studio failure', () => {
    expect(isTransientClineFailure('Cline Agent stream ended without a result.')).toBe(true);
    expect(isTransientClineFailure('HTTP 504 Gateway Timeout')).toBe(true);
    expect(isTransientClineFailure('SyntaxError: unexpected token')).toBe(false);
  });
});

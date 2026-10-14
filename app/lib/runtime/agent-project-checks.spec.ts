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

  it('defers planned future-phase references instead of blocking the phase run', () => {
    const phaseFiles = {
      'index.html': `<!doctype html><html><body>
<script type="module" src="./src/boot/entry.js"></script>
<script type="module" src="./src/road/course.js"></script>
</body></html>`,
      'src/boot/entry.js': `import { buildCourse } from '../road/course.js';
import { drawWorld } from '../render/world.js';

buildCourse();
drawWorld();
`,
    };
    const scope = {
      phasePaths: ['index.html', 'src/boot/entry.js'],
      plannedPaths: ['index.html', 'src/boot/entry.js', 'src/road/course.js', 'src/render/world.js'],
    };

    const result = runAgentBuildCheck(phaseFiles, scope);

    expect(result.success).toBe(true);
    expect(result.note).toMatch(/deferred/i);
  });

  it('still blocks a phase run on broken syntax or unresolvable imports in its own files', () => {
    const scope = {
      phasePaths: ['index.html', 'src/boot/entry.js'],
      plannedPaths: ['index.html', 'src/boot/entry.js', 'src/core/config.js'],
    };
    const shell = { 'index.html': '<script type="module" src="./src/boot/entry.js"></script>' };

    const syntaxBroken = runAgentBuildCheck({ ...shell, 'src/boot/entry.js': 'const x = "unterminated' }, scope);
    expect(syntaxBroken.success).toBe(false);
    expect(syntaxBroken.issues.some((issue) => issue.includes('src/boot/entry.js'))).toBe(true);

    const unresolvable = runAgentBuildCheck(
      { ...shell, 'src/boot/entry.js': `import { thing } from './nowhere.js';\nconsole.log(thing);\n` },
      scope,
    );
    expect(unresolvable.success).toBe(false);
    expect(unresolvable.issues.some((issue) => issue.includes('nowhere.js'))).toBe(true);
  });

  it('accepts approved generated images that exist on disk but not in fileOperations', () => {
    /*
     * Regression: generated images are written by the image builder, so they
     * are never in `plannedPaths`. Treating them as missing pushed the model to
     * DELETE correct image references.
     */
    const scope = {
      phasePaths: ['index.html', 'src/boot/entry.js'],
      plannedPaths: ['index.html', 'src/boot/entry.js'],
      plannedAssetPaths: ['assets/hero.png'],
    };
    const files = {
      'index.html': '<canvas id="c"></canvas><script type="module" src="./src/boot/entry.js"></script>',
      'src/boot/entry.js': `const hero = new Image();\nhero.src = 'assets/hero.png';\n`,
    };

    const result = runAgentBuildCheck(files, scope);

    expect(result.issues.filter((issue) => issue.includes('hero.png'))).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  it('blocks a reference to an image that was never approved or generated', () => {
    const scope = {
      phasePaths: ['index.html', 'src/boot/entry.js'],
      plannedPaths: ['index.html', 'src/boot/entry.js'],
      plannedAssetPaths: ['assets/hero.png'],
    };
    const files = {
      'index.html':
        '<canvas id="c"></canvas><img src="assets/ghost.png"><script type="module" src="./src/boot/entry.js"></script>',
      'src/boot/entry.js': `const img = new Image();\nimg.src = 'assets/missing-boss.png';\n`,
    };

    const result = runAgentBuildCheck(files, scope);

    expect(result.success).toBe(false);
    expect(result.issues.some((issue) => issue.includes('assets/ghost.png'))).toBe(true);
    expect(result.issues.some((issue) => issue.includes('assets/missing-boss.png'))).toBe(true);
  });

  it('catches CSS url() and srcset image references, not just img src', () => {
    const scope = {
      phasePaths: ['index.html'],
      plannedPaths: ['index.html'],
      plannedAssetPaths: [],
    };
    const result = runAgentBuildCheck(
      {
        'index.html':
          '<style>.hud { background: url("assets/hud.png"); }</style>' +
          '<img srcset="assets/hero-2x.png 2x" src="assets/hero.png">',
      },
      scope,
    );

    expect(result.success).toBe(false);
    expect(result.issues.some((issue) => issue.includes('assets/hud.png'))).toBe(true);
    expect(result.issues.some((issue) => issue.includes('assets/hero-2x.png'))).toBe(true);
  });

  it('does not flag non-image asset-looking strings or remote URLs', () => {
    const scope = {
      phasePaths: ['index.html', 'src/boot/entry.js'],
      plannedPaths: ['index.html', 'src/boot/entry.js'],
      plannedAssetPaths: [],
    };
    const files = {
      'index.html': '<img src="https://cdn.example.com/hero.png">',
      'src/boot/entry.js': `const cfg = { path: 'assets/config.json' };\nconsole.log(cfg.path);\n`,
    };

    const result = runAgentBuildCheck(files, scope);

    expect(result.success).toBe(true);
  });

  it('defers whole-game contracts and quality bars while scoped, keeping phase-file rules', () => {
    const scope = {
      phasePaths: ['foundation.js'],
      plannedPaths: ['foundation.js', 'game.js', 'render.js'],
    };

    const gameplay = runAgentGameplayCheck({}, scope);
    expect(gameplay.success).toBe(true);
    expect(gameplay.note).toMatch(/deferred/i);

    const dirty = runAgentQualityCheck({ 'foundation.js': '// TODO implement later\n' }, scope);
    expect(dirty.success).toBe(false);

    const cleanOtherPhase = runAgentQualityCheck(
      { 'foundation.js': 'export const ok = 1;\n', 'game.js': '// TODO fix later\n' },
      scope,
    );
    expect(cleanOtherPhase.success).toBe(true);
  });

  it('treats stream-ended-without-result as a transient studio failure', () => {
    expect(isTransientClineFailure('Cline Agent stream ended without a result.')).toBe(true);
    expect(isTransientClineFailure('HTTP 504 Gateway Timeout')).toBe(true);
    expect(isTransientClineFailure('SyntaxError: unexpected token')).toBe(false);
  });
});

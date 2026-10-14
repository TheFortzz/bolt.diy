import { validateJavaScriptSyntax } from '~/lib/runtime/build-validator';
import {
  auditGameModuleGraph,
  resolveStaticPreviewFileLoose,
  type StaticPreviewFile,
} from '~/lib/runtime/static-preview';

export type AgentCheckResult = {
  success: boolean;
  issues: string[];
  tests?: Array<{ name: string; pass: boolean; detail?: string }>;
  note?: string;
};

/**
 * Phased runs see an intentionally incomplete workspace: most planned files
 * belong to LATER phases. Scope the in-loop gates to this phase's files and
 * defer references to planned-but-not-yet-written modules, or finish_task
 * becomes impossible to satisfy and the run burns out chasing files it is
 * not allowed to write. The final verification still audits everything.
 */
export interface AgentCheckScope {
  /** Paths this specific run may write (the phase allowlist). */
  phasePaths: string[];

  /** Every path the approved blueprint plans, including future phases. */
  plannedPaths: string[];

  /**
   * Approved generated-image paths. They are written by the image builder
   * rather than by the agent, so they are deliberately absent from
   * `plannedPaths` — without this a correct `assets/hero.png` reference looks
   * like a broken one.
   */
  plannedAssetPaths?: string[];
}

/** Resolve a relative (or root-anchored) import/spec against its importer. */
function resolveRelativePath(fromPath: string, spec: string): string {
  if (spec.startsWith('/')) {
    return spec.slice(1);
  }

  const baseDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const parts = baseDir ? baseDir.split('/') : [];

  for (const segment of spec.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }

  return parts.join('/');
}

function toFileList(files: Record<string, string>): StaticPreviewFile[] {
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

function collectHtmlLocalRefs(html: string): string[] {
  return [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((path) => !/^https?:\/\//i.test(path) && !path.startsWith('data:'));
}

function collectJsLocalImports(code: string): string[] {
  const specs: string[] = [];
  const re = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(code)) !== null) {
    const spec = match[1] || match[2];

    if (spec && (spec.startsWith('.') || spec.startsWith('/')) && !specs.includes(spec)) {
      specs.push(spec);
    }
  }

  return specs;
}

/**
 * Binary assets the game actually loads.
 *
 * Image references were validated nowhere: `collectHtmlLocalRefs` only matches
 * `script|link`, so a game pointing at `assets/hero.png` that was never
 * generated shipped a silently broken visual. These collectors catch
 * `<img src>`, audio/video/source `src`, `srcset`, CSS `url(...)` and the
 * `assets/...` string literals used by image/audio/model/font loaders.
 */
const PROJECT_ASSET_REF_PATTERN =
  /^assets\/[a-zA-Z0-9_./-]+\.(?:png|apng|jpe?g|webp|gif|svg|bmp|glb|gltf|bin|obj|mtl|fbx|wav|mp3|ogg|ktx2|ttf|otf|woff2?)$/i;

function isImageRef(ref: string): boolean {
  return PROJECT_ASSET_REF_PATTERN.test(ref.replace(/^\.\//, '').replace(/^\//, ''));
}

export function collectHtmlAssetRefs(html: string): string[] {
  const refs: string[] = [];
  const add = (value: string) => {
    const clean = value.trim().split(/[\s,]+/)[0] || '';

    if (isImageRef(clean) && !refs.includes(clean)) {
      refs.push(clean);
    }
  };

  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    add(match[1]);
  }

  for (const match of html.matchAll(/<(?:audio|video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    add(match[1]);
  }

  for (const match of html.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const candidate of match[1].split(',')) {
      add(candidate);
    }
  }

  for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    add(match[1]);
  }

  return refs;
}

export function collectJsAssetRefs(code: string): string[] {
  const refs: string[] = [];
  const re = /["'`](\/?assets\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|gif|svg|bmp))["'`]/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(code)) !== null) {
    const ref = match[1].replace(/^\//, '');

    if (!refs.includes(ref)) {
      refs.push(ref);
    }
  }

  return refs;
}

/** Same checks the post-build pipeline uses — available inside the agent tool loop. */
export function runAgentBuildCheck(files: Record<string, string>, scope?: AgentCheckScope): AgentCheckResult {
  const fileList = toFileList(files);
  const issues: string[] = [];
  const deferred: string[] = [];
  const phaseSet = scope ? new Set(scope.phasePaths) : undefined;
  const planned = new Set(scope?.plannedPaths || []);
  const approvedAssets = new Set((scope?.plannedAssetPaths || []).map((path) => path.replace(/^\.\//, '')));
  const html = files['index.html'] || '';

  if (!html) {
    if (phaseSet && !phaseSet.has('index.html')) {
      deferred.push('index.html is planned for a later build phase.');
    } else {
      issues.push('Missing index.html.');
    }
  } else {
    for (const ref of collectHtmlLocalRefs(html)) {
      if (resolveStaticPreviewFileLoose(fileList, ref)) {
        continue;
      }

      const normalized = ref.replace(/^\.\//, '');

      if (planned.has(normalized) && (!phaseSet || !phaseSet.has(normalized))) {
        deferred.push(`index.html references ${ref} — planned for a later build phase.`);
        continue;
      }

      issues.push(`Missing local reference from index.html: ${ref}`);
    }

    /*
     * Image references must resolve too. An approved generated image is
     * written by the image builder, not by the agent, so it is absent from
     * `plannedPaths` by design - that is why the previous wording pushed the
     * model to DELETE correct image references.
     */
    for (const ref of collectHtmlAssetRefs(html)) {
      const normalized = ref.replace(/^\.\//, '');

      if (resolveStaticPreviewFileLoose(fileList, normalized) || approvedAssets.has(normalized)) {
        continue;
      }

      issues.push(`index.html loads ${ref} but no approved image exists at that path`);
    }
  }

  for (const [path, content] of Object.entries(files)) {
    if (!/\.(?:m?js|cjs)$/.test(path) || !content) {
      continue;
    }

    // Files outside this phase are gated by their own phase; do not block on them.
    if (phaseSet && !phaseSet.has(path)) {
      continue;
    }

    const syntaxErr = validateJavaScriptSyntax(content, path);

    if (syntaxErr) {
      issues.push(syntaxErr);
    }

    for (const spec of collectJsLocalImports(content)) {
      if (resolveStaticPreviewFileLoose(fileList, spec)) {
        continue;
      }

      const resolved = resolveRelativePath(path, spec);

      if (planned.has(resolved) && (!phaseSet || !phaseSet.has(resolved))) {
        deferred.push(`${path} imports "${spec}" — that module is planned for a later build phase.`);
        continue;
      }

      issues.push(`${path} imports "${spec}" but no project file matches that path`);
    }

    for (const ref of collectJsAssetRefs(content)) {
      if (resolveStaticPreviewFileLoose(fileList, ref) || approvedAssets.has(ref)) {
        continue;
      }

      issues.push(`${path} loads ${ref} but no approved image exists at that path`);
    }
  }

  if (phaseSet) {
    /*
     * Whole-graph wiring (missing exports, cross-module contracts) needs
     * every file present and full edit rights — both belong to the final
     * verification, not a phase run that cannot touch other phases' files.
     */
    deferred.push('Module-graph wiring audit deferred to final verification (phased build).');
  } else {
    for (const finding of auditGameModuleGraph(fileList)) {
      issues.push(`${finding.file} → ${finding.detail}`);
    }
  }

  const note =
    deferred.length > 0
      ? `Phase-scoped build gate. Deferred to later phases/final verification: ${deferred.slice(0, 6).join(' | ')}`
      : 'These are the same wiring/syntax checks Bolt runs before preview. Fix every issue before finish_task.';

  return {
    success: issues.length === 0,
    issues,
    note,
  };
}

/** Structural gameplay/contracts checks the agent must pass before finishing. */
export function runAgentGameplayCheck(files: Record<string, string>, scope?: AgentCheckScope): AgentCheckResult {
  if (scope) {
    /*
     * Whole-game contracts (full loop, restart, diagnostics, resize) only
     * make sense once every phase has landed; enforcing them mid-build makes
     * finish_task unreachable and kills the run. The final verification
     * owns them.
     */
    return {
      success: true,
      issues: [],
      tests: [],
      note: 'Gameplay contracts deferred to final verification (phased build).',
    };
  }

  const code = Object.values(files).join('\n');
  const tests = [
    {
      name: 'Animation loop',
      pass: /requestAnimationFrame/i.test(code),
      detail: 'Needs requestAnimationFrame-driven update/render.',
    },
    {
      name: 'Input handling',
      pass: /addEventListener\s*\(\s*["'](?:keydown|keyup|pointerdown|pointerup|touchstart|mousedown)["']/i.test(code),
      detail: 'Needs real keyboard/pointer/touch listeners.',
    },
    {
      name: 'Restart/state',
      pass: /restart|reset|gameOver|game_over|playAgain|play_again/i.test(code),
      detail: 'Needs a restart or explicit game-over/reset path.',
    },
    {
      name: 'Diagnostics contract',
      pass: /__GAME_DIAGNOSTICS__/i.test(code) && /simulationSteps/i.test(code) && /inputsHandled/i.test(code),
      detail: 'Must expose and update window.__GAME_DIAGNOSTICS__.',
    },
    {
      name: 'Delta-time clamp',
      pass: /Math\.min\s*\([\s\S]{0,120}?0\.0?5\s*\)/.test(code) || /Math\.min\s*\(\s*0\.0?5\s*,/.test(code),
      detail: 'Clamp frame delta (e.g. Math.min(dt, 0.05)) so physics stay stable.',
    },
    {
      name: 'Resize handling',
      pass: /addEventListener\s*\(\s*["']resize["']/i.test(code) || /onresize\s*=/i.test(code),
      detail: 'Must handle window resize and keep the canvas filling the viewport.',
    },
  ];

  return {
    success: tests.every((test) => test.pass),
    issues: tests.filter((test) => !test.pass).map((test) => `${test.name}: ${test.detail}`),
    tests,
    note: 'Gameplay contract checks only. Bolt still runs a live preview probe afterward.',
  };
}

/**
 * Static quality bar: catches empty shells and generic stubs before the agent
 * claims success. Not a substitute for visual playtesting.
 */
export function runAgentQualityCheck(files: Record<string, string>, scope?: AgentCheckScope): AgentCheckResult {
  if (scope) {
    /*
     * Whole-game quality bars (visual variety, feedback, minimum size) are
     * meaningless halfway through a phased build. Only the writing-quality
     * rules apply to this phase's own files.
     */
    const phaseSet = new Set(scope.phasePaths);
    const phaseCode = Object.entries(files)
      .filter(([path]) => phaseSet.has(path))
      .map(([, content]) => content)
      .join('\n');
    const scopedTests = [
      {
        name: 'No placeholder TODOs',
        pass: !/\bTODO\b|\bFIXME\b|rest of code|implement later|coming soon/i.test(phaseCode),
        detail: 'Remove placeholders; ship complete working code.',
      },
      {
        name: 'Offline-safe',
        pass: !/\b(?:fetch\s*\(|XMLHttpRequest|firebase|supabase|appwrite)\b/i.test(phaseCode),
        detail: 'Do not call network backends; the game must run fully offline in the preview.',
      },
    ];

    return {
      success: scopedTests.every((test) => test.pass),
      issues: scopedTests.filter((test) => !test.pass).map((test) => `${test.name}: ${test.detail}`),
      tests: scopedTests,
      note: 'Phase-scoped writing-quality gate (TODOs + offline safety). Full quality bar runs at final verification.',
    };
  }

  const entries = Object.entries(files).filter(([, content]) => typeof content === 'string' && content.length > 0);
  const jsEntries = entries.filter(([path]) => /\.(?:m?js|cjs)$/.test(path));
  const totalJsChars = jsEntries.reduce((sum, [, content]) => sum + content.length, 0);
  const code = entries.map(([, content]) => content).join('\n');
  const tests = [
    {
      name: 'Non-trivial source',
      pass: totalJsChars >= 4_000 || jsEntries.length >= 3,
      detail: 'Game source is too thin — flesh out real systems instead of a stub.',
    },
    {
      name: 'Visual variety',
      pass: /(gradient|shadow|particle|palette|hsl\(|hsla\(|linear-gradient|createRadialGradient|fillStyle\s*=)/i.test(
        code,
      ),
      detail: 'Add a distinct palette, lighting/gradients, or particle feedback — avoid flat single-color worlds.',
    },
    {
      name: 'Player feedback',
      pass: /(shake|flash|float|score|damage|combo|juice|trail|spark)/i.test(code),
      detail: 'Add clear feedback for score, hits, or other player actions.',
    },
    {
      name: 'No placeholder TODOs',
      pass: !/\bTODO\b|\bFIXME\b|rest of code|implement later|coming soon/i.test(code),
      detail: 'Remove placeholders; ship complete working code.',
    },
    {
      name: 'Offline-safe',
      pass: !/\b(?:fetch\s*\(|XMLHttpRequest|firebase|supabase|appwrite)\b/i.test(code),
      detail: 'Do not call network backends; the game must run fully offline in the preview.',
    },
    {
      name: 'Safe procedural audio',
      pass:
        !/\b(?:new\s+Audio\s*\(|\.play\s*\(\s*["']https?:)/i.test(code) &&
        (!/\bAudioContext\b|\bwebkitAudioContext\b/i.test(code) ||
          /resume\s*\(|click|pointerdown|touchstart|user.?gesture|unlock/i.test(code)),
      detail:
        'Prefer procedural Web Audio unlocked on a user gesture. Never load remote audio files; wrap AudioContext in try/catch with a silent fallback.',
    },
  ];

  return {
    success: tests.every((test) => test.pass),
    issues: tests.filter((test) => !test.pass).map((test) => `${test.name}: ${test.detail}`),
    tests,
    note: 'Static quality gate. Live preview still verifies rendering and controls.',
  };
}

export function isTransientClineFailure(message: string): boolean {
  return /503|502|504|429|network|fetch failed|load failed|timed out|timeout|1102|522|524|socket|econnreset|stream ended without a result|empty stream|incomplete response|cloudflare/i.test(
    message,
  );
}

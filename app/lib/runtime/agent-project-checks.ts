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
  const re =
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(code)) !== null) {
    const spec = match[1] || match[2];

    if (spec && (spec.startsWith('.') || spec.startsWith('/')) && !specs.includes(spec)) {
      specs.push(spec);
    }
  }

  return specs;
}

/** Same checks the post-build pipeline uses — available inside the agent tool loop. */
export function runAgentBuildCheck(files: Record<string, string>): AgentCheckResult {
  const fileList = toFileList(files);
  const issues: string[] = [];
  const html = files['index.html'] || '';

  if (!html) {
    issues.push('Missing index.html.');
  } else {
    for (const ref of collectHtmlLocalRefs(html)) {
      if (!resolveStaticPreviewFileLoose(fileList, ref)) {
        issues.push(`Missing local reference from index.html: ${ref}`);
      }
    }
  }

  for (const [path, content] of Object.entries(files)) {
    if (!/\.(?:m?js|cjs)$/.test(path) || !content) {
      continue;
    }

    const syntaxErr = validateJavaScriptSyntax(content, path);

    if (syntaxErr) {
      issues.push(syntaxErr);
    }

    for (const spec of collectJsLocalImports(content)) {
      if (!resolveStaticPreviewFileLoose(fileList, spec)) {
        issues.push(`${path} imports "${spec}" but no project file matches that path`);
      }
    }
  }

  for (const finding of auditGameModuleGraph(fileList)) {
    issues.push(`${finding.file} → ${finding.detail}`);
  }

  return {
    success: issues.length === 0,
    issues,
    note: 'These are the same wiring/syntax checks Bolt runs before preview. Fix every issue before finish_task.',
  };
}

/** Structural gameplay/contracts checks the agent must pass before finishing. */
export function runAgentGameplayCheck(files: Record<string, string>): AgentCheckResult {
  const code = Object.values(files).join('\n');
  const tests = [
    {
      name: 'Animation loop',
      pass: /requestAnimationFrame/i.test(code),
      detail: 'Needs requestAnimationFrame-driven update/render.',
    },
    {
      name: 'Input handling',
      pass: /addEventListener\s*\(\s*["'](?:keydown|keyup|pointerdown|pointerup|touchstart|mousedown)["']/i.test(
        code,
      ),
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
export function runAgentQualityCheck(files: Record<string, string>): AgentCheckResult {
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

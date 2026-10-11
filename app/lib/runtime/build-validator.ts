import type { WebContainer } from '@webcontainer/api';
import { atom } from 'nanostores';
import { getWebContainer } from '~/lib/webcontainer';
import { workbenchStore } from '~/lib/stores/workbench';
import { actionStepId, runActivityStep, startActivity, updateActivity } from '~/lib/stores/activity';
import { cleanWorkDirRelativePath } from '~/utils/diff';
import { validatePreview } from './preview-validation';
import { validateJavaScriptSyntax } from '~/lib/runtime/js-syntax';
import type { PreviewVerificationRequirements } from '~/lib/runtime/preview-probe';

export { validateJavaScriptSyntax } from '~/lib/runtime/js-syntax';

export type ValidationState = { status: 'idle' | 'checking' | 'passed' | 'failed'; detail: string };
export const validationState = atom<ValidationState>({ status: 'idle', detail: '' });

const MAX_OUTPUT = 2400;

function safeDiagnostic(output: string) {
  return output
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/gi, '[redacted]')
    .slice(-MAX_OUTPUT);
}

async function runCheck(
  wc: WebContainer,
  command: string,
  args: string[],
  timeoutMs = 180000,
): Promise<string | undefined> {
  try {
    const process = await wc.spawn(command, args, { cwd: wc.workdir });
    let output = '';
    const outputDone = process.output.pipeTo(
      new WritableStream<string>({
        write(chunk) {
          output = (output + chunk).slice(-MAX_OUTPUT);
        },
      }),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const code = await Promise.race([
        process.exit,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            void process.kill();
            reject(new Error(`${command} ${args.join(' ')} timed out`));
          }, timeoutMs);
        }),
      ]);
      await outputDone;

      return code === 0 ? undefined : `${command} ${args.join(' ')} failed (${code}): ${safeDiagnostic(output)}`;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  } catch (error: any) {
    return `${command} failed: ${error?.message || String(error)}`;
  }
}

export async function validateBuild(
  messageId: string,
  additionalPaths: string[] = [],
  verification?: PreviewVerificationRequirements,
): Promise<{ ok: boolean; error?: string }> {
  validationState.set({ status: 'checking', detail: 'Waiting for files…' });

  try {
    const actions = await runActivityStep(
      messageId,
      'validation:actions',
      'Applying generated files',
      async () => {
        await workbenchStore.waitForExecutionQueue();

        const artifact = workbenchStore.artifacts.get()[messageId];

        if (!artifact || !artifact.closed) {
          throw new Error('The AI response ended before its build was complete.');
        }

        const actions = Object.values(artifact.runner.actions.get());
        const failures = actions.filter((action) => action.status === 'failed' || action.status === 'aborted');

        if (failures.length) {
          throw new Error(
            safeDiagnostic(
              failures
                .map((action) => (action.status === 'failed' ? action.error : `${action.type} action was interrupted`))
                .join('\n'),
            ),
          );
        }

        if (
          actions.some(
            (action) =>
              (action.type !== 'start' && action.status === 'pending') || (action.type === 'file' && !action.executed),
          )
        ) {
          throw new Error('Some generated files were not completely written.');
        }

        return actions;
      },
      'Generated files applied',
    );

    const changedPaths = [
      ...new Set([
        ...actions.filter((action) => action.type === 'file').map((action) => action.filePath),
        ...additionalPaths,
      ]),
    ];

    if (!changedPaths.length) {
      throw new Error('No generated files were found in this build.');
    }

    const wc = await runActivityStep(
      messageId,
      'validation:container',
      'Preparing code checks',
      getWebContainer,
      'Checks ready',
    );
    validationState.set({ status: 'checking', detail: 'Checking generated code…' });

    for (const rawPath of changedPaths) {
      const name = cleanWorkDirRelativePath(rawPath);

      const content = await runActivityStep(
        messageId,
        `validation:read:${name}`,
        `Reading ${name}`,
        async () => {
          try {
            return await wc.fs.readFile(name, 'utf8');
          } catch {
            const absPath = `${wc.workdir.replace(/\/+$/, '')}/${name}`;
            return await wc.fs.readFile(absPath, 'utf8');
          }
        },
        `Read ${name}`,
      );

      if (name.endsWith('.json')) {
        await runActivityStep(
          messageId,
          `validation:syntax:${name}`,
          `Checking ${name}`,
          async () => {
            try {
              JSON.parse(content);
            } catch (error) {
              throw new Error(`${name}: ${(error as Error).message}`);
            }
          },
          `Syntax passed: ${name}`,
        );
      } else if (/\.(?:js|mjs|cjs)$/.test(name)) {
        await runActivityStep(
          messageId,
          `validation:syntax:${name}`,
          `Checking ${name}`,
          async () => {
            const syntaxErr = validateJavaScriptSyntax(content, name);

            if (syntaxErr) {
              throw new Error(syntaxErr);
            }

            const checkTarget = rawPath.startsWith(wc.workdir) ? rawPath : `${wc.workdir.replace(/\/+$/, '')}/${name}`;

            let error = await runCheck(wc, 'node', ['--check', checkTarget]);

            if (error) {
              const lower = error.toLowerCase();

              if (lower.includes('no such file or directory') || lower.includes('enoent')) {
                error = await runCheck(wc, 'node', ['--check', `./${name}`]);
              }
            }

            if (error) {
              const lower = error.toLowerCase();

              if (
                lower.includes('syntaxerror') &&
                !lower.includes('cannot use import statement') &&
                !lower.includes("unexpected token 'export'") &&
                !lower.includes('await is only valid in async functions')
              ) {
                throw new Error(error);
              }

              // In-memory syntax check already passed; ignore environment spawn/not found errors
              return;
            }
          },
          `Syntax passed: ${name}`,
        );
      } else if (name.endsWith('.html')) {
        /*
         * Inline <script> bodies inside HTML are served into the preview
         * completely raw — no bundler, no node --check. A truncated or
         * corrupt inline script therefore boots as "Invalid or unexpected
         * token" and nothing ever catches it. Probe each one here, and
         * back the probe with the REAL node parser via a temp .mjs so the
         * check is authoritative no matter how exotic the breakage.
         */
        const inlineScripts: string[] = [];

        await runActivityStep(
          messageId,
          `validation:syntax:${name}`,
          `Checking ${name}`,
          async () => {
            const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
            let match: RegExpExecArray | null;
            let index = 0;

            while ((match = scriptRe.exec(content)) !== null) {
              const attrs = match[1] || '';
              const body = (match[2] || '').trim();

              if (!body || /\bsrc\s*=/i.test(attrs)) {
                continue;
              }

              const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);

              // Only real JavaScript blocks: modules and classic scripts.
              if (typeMatch && !/(?:javascript|module)/i.test(typeMatch[1])) {
                continue;
              }

              index++;
              inlineScripts.push(body);

              const syntaxErr = validateJavaScriptSyntax(body, `${name} inline script #${index}`);

              if (syntaxErr) {
                throw new Error(syntaxErr);
              }
            }
          },
          `Syntax passed: ${name}`,
        );

        for (let index = 0; index < inlineScripts.length; index++) {
          const tmpName = `.bolt-inline-check-${index}.mjs`;

          try {
            await wc.fs.writeFile(tmpName, inlineScripts[index]);

            const checkTarget = `${wc.workdir.replace(/\/+$/, '')}/${tmpName}`;
            let error = await runCheck(wc, 'node', ['--check', checkTarget]);

            if (error && error.toLowerCase().includes('enoent')) {
              error = await runCheck(wc, 'node', ['--check', `./${tmpName}`]);
            }

            if (error) {
              const lower = error.toLowerCase();

              if (lower.includes('syntaxerror') || lower.includes('invalid or unexpected')) {
                throw new Error(`${name} inline script #${index + 1}: ${error}`);
              }
            }
          } finally {
            try {
              await wc.fs.rm(tmpName, { force: true });
            } catch {
              // Temp file never landed; nothing to clean up.
            }
          }
        }
      }
    }

    let packageJson: { scripts?: Record<string, string> } | undefined;

    try {
      packageJson = JSON.parse(await wc.fs.readFile('package.json', 'utf8'));
    } catch {
      if (changedPaths.some((path) => /\.(?:ts|tsx|jsx)$/.test(path))) {
        throw new Error('TypeScript/JSX files require a project package.json with a typecheck or build script.');
      }
    }

    const scripts = packageJson?.scripts;

    for (const script of ['typecheck', 'build']) {
      if (!scripts?.[script]) {
        continue;
      }

      validationState.set({ status: 'checking', detail: `Running ${script} check…` });

      await runActivityStep(
        messageId,
        `validation:script:${script}`,
        `Running ${script} check`,
        async () => {
          const error = await runCheck(wc, 'npm', ['run', script]);

          if (error) {
            throw new Error(error);
          }
        },
        `${script} check passed`,
      );
    }

    if (!scripts?.typecheck && !scripts?.build && changedPaths.some((path) => /\.(?:ts|tsx|jsx)$/.test(path))) {
      throw new Error('No typecheck or build script is configured for TypeScript/JSX files.');
    }

    validationState.set({ status: 'checking', detail: 'Loading preview…' });

    await runActivityStep(
      messageId,
      'validation:preview',
      'Loading preview',
      async () => {
        const preview = await validatePreview(verification);

        if (!preview.ok) {
          throw new Error(preview.error);
        }
      },
      'Preview loaded',
    );

    for (const [actionId, action] of Object.entries(workbenchStore.artifacts.get()[messageId].runner.actions.get())) {
      if (action.type === 'start' && action.status !== 'failed' && action.status !== 'aborted') {
        updateActivity(messageId, actionStepId(actionId), 'complete');
      }
    }

    startActivity(messageId, 'validation:result', 'Build verified', 'Build verified', 'complete');

    validationState.set({ status: 'passed', detail: 'Build and preview verified' });

    return { ok: true };
  } catch (error) {
    const detail = (error as Error).message || 'Build validation failed';
    validationState.set({ status: 'failed', detail });
    startActivity(messageId, 'validation:failed', 'Preview check failed', 'Preview check failed', 'failed');

    return { ok: false, error: detail };
  }
}

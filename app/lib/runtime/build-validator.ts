import type { WebContainer } from '@webcontainer/api';
import { atom } from 'nanostores';
import { getWebContainer } from '~/lib/webcontainer';
import { workbenchStore } from '~/lib/stores/workbench';
import { validatePreview } from './preview-validation';

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
  timeoutMs = 60000,
): Promise<string | undefined> {
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
}

export async function validateBuild(messageId: string): Promise<{ ok: boolean; error?: string }> {
  validationState.set({ status: 'checking', detail: 'Waiting for files…' });

  try {
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

    const changedPaths = actions.filter((action) => action.type === 'file').map((action) => action.filePath);

    if (!changedPaths.length) {
      throw new Error('No generated files were found in this build.');
    }

    const wc = await getWebContainer();
    validationState.set({ status: 'checking', detail: 'Checking generated code…' });

    for (const path of changedPaths) {
      const content = await wc.fs.readFile(path, 'utf8');

      if (path.endsWith('.json')) {
        try {
          JSON.parse(content);
        } catch (error) {
          throw new Error(`${path}: ${(error as Error).message}`);
        }
      } else if (/\.(?:js|mjs|cjs)$/.test(path)) {
        const error = await runCheck(wc, 'node', ['--check', path]);

        if (error) {
          throw new Error(error);
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

      const error = await runCheck(wc, 'npm', ['run', script]);

      if (error) {
        throw new Error(error);
      }
    }

    if (!scripts?.typecheck && !scripts?.build && changedPaths.some((path) => /\.(?:ts|tsx|jsx)$/.test(path))) {
      throw new Error('No typecheck or build script is configured for TypeScript/JSX files.');
    }

    validationState.set({ status: 'checking', detail: 'Loading preview…' });

    const preview = await validatePreview();

    if (!preview.ok) {
      throw new Error(preview.error);
    }

    validationState.set({ status: 'passed', detail: 'Build and preview verified' });

    return { ok: true };
  } catch (error) {
    const detail = (error as Error).message || 'Build validation failed';
    validationState.set({ status: 'failed', detail });

    return { ok: false, error: detail };
  }
}

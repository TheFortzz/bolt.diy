import { WebContainer } from '@webcontainer/api';
import { atom, map, type MapStore } from 'nanostores';
import * as nodePath from 'node:path';
import type { BoltAction } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';
import type { BoltShell } from '~/utils/shell';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

const STATIC_SERVER_SCRIPT = `const http = require('http');
const fs = require('fs');
const path = require('path');
const mimes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const baseDir = path.resolve(fs.existsSync('/home/project') ? '/home/project' : process.cwd());

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  let cleanUrl = (req.url || '/').split('?')[0].replace(/^\\/+/, '');
  if (!cleanUrl) cleanUrl = 'index.html';

  const requestedPath = path.resolve(baseDir, cleanUrl);
  if (requestedPath !== baseDir && !requestedPath.startsWith(baseDir + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const candidates = [
    requestedPath,
    path.resolve(baseDir, 'src', cleanUrl),
    path.resolve(baseDir, 'public', cleanUrl),
    path.resolve(baseDir, 'dist', cleanUrl),
  ].map((candidate) => path.resolve(candidate));

  let file = candidates.find((candidate) => {
    if (candidate !== baseDir && !candidate.startsWith(baseDir + path.sep)) return false;
    try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); } catch (e) { return false; }
  });

  if (!file && (cleanUrl.endsWith('.html') || !path.extname(cleanUrl))) {
    const defaultIndex = path.join(baseDir, 'index.html');
    if (fs.existsSync(defaultIndex)) file = defaultIndex;
  }

  if (file) {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(0, '0.0.0.0');
`;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #shellTerminal: () => BoltShell;
  #onStartStaticServer?: () => Promise<void>;
  #staticServerStarted = false;
  runnerId = atom<string>(`${Date.now()}`);
  actions: ActionsMap = map({});

  constructor(
    webcontainerPromise: Promise<WebContainer>,
    getShellTerminal: () => BoltShell,
    onStartStaticServer?: () => Promise<void>,
  ) {
    this.#webcontainer = webcontainerPromise;
    this.#shellTerminal = getShellTerminal;
    this.#onStartStaticServer = onStartStaticServer;
  }

  #isNpmCommand(command: string): boolean {
    const trimmed = command.trim();
    return (
      /^\s*(npm|pnpm|yarn|bun)\b/i.test(trimmed) ||
      /\b(npm|pnpm|yarn|bun)\s+(install|i|ci|run|start|build|dev|serve|test)\b/i.test(trimmed) ||
      /(^|[;&|]\s*)(npm|pnpm|yarn|bun)\b/i.test(trimmed)
    );
  }

  async #hasPackageJson(): Promise<boolean> {
    try {
      const webcontainer = await this.#webcontainer;
      if (!webcontainer) {
        return false;
      }

      for (const p of ['package.json', '/package.json', './package.json', '/home/project/package.json']) {
        try {
          const content = await webcontainer.fs.readFile(p, 'utf8');
          if (content && content.trim().length > 0) {
            return true;
          }
        } catch {}
      }

      try {
        const rootEntries = await webcontainer.fs.readdir('.');
        if (rootEntries.includes('package.json')) {
          return true;
        }
      } catch {}

      try {
        const rootEntries = await webcontainer.fs.readdir('/');
        if (rootEntries.includes('package.json')) {
          return true;
        }
      } catch {}

      return false;
    } catch {
      return false;
    }
  }

  async #startStaticServer(): Promise<void> {
    if (this.#staticServerStarted) {
      return;
    }
    this.#staticServerStarted = true;

    try {
      if (this.#onStartStaticServer) {
        await this.#onStartStaticServer();
        return;
      }

      const wc = await this.#webcontainer;
      if (!wc) return;

      await wc.fs.writeFile('/.static_server.cjs', STATIC_SERVER_SCRIPT);
      const process = await wc.spawn('node', ['/.static_server.cjs']);
      logger.info('Started .static_server.cjs for static project');

      void process.exit.then(
        () => {
          this.#staticServerStarted = false;
        },
        () => {
          this.#staticServerStarted = false;
        },
      );
    } catch (err) {
      logger.warn('Failed to start .static_server.cjs:', err);
      this.#staticServerStarted = false;
    }
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      // action already added
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.#updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return; // No return value here
    }

    if (isStreaming && action.type !== 'file') {
      return; // No return value here
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: !isStreaming });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId, isStreaming);
      })
      .catch((error) => {
        console.error('Action failed:', error);
      });

    await this.#currentExecutionPromise;

    return;
  }

  async #executeAction(actionId: string, isStreaming: boolean = false) {
    const action = this.actions.get()[actionId];

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          await this.#runShellAction(action);
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
        case 'start': {
          // making the start app non blocking

          this.#runStartAction(action)
            .then(() => this.#updateAction(actionId, { status: 'complete' }))
            .catch(() => this.#updateAction(actionId, { status: 'failed', error: 'Action failed' }));

          /*
           * adding a delay to avoid any race condition between 2 start actions
           * i am up for a better approach
           */
          await new Promise((resolve) => setTimeout(resolve, 2000));

          return;
        }
      }

      this.#updateAction(actionId, {
        status: isStreaming ? 'running' : action.abortSignal.aborted ? 'aborted' : 'complete',
      });
    } catch (error) {
      this.#updateAction(actionId, {
        status: action.abortSignal.aborted ? 'aborted' : 'failed',
        error: (error as Error)?.message || 'Action failed',
      });
      logger.error(`[${action.type}]:Action failed\n\n`, error);
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    if (this.#isNpmCommand(action.content)) {
      const hasPkg = await this.#hasPackageJson();
      if (!hasPkg) {
        logger.info(
          `[ActionRunner] No package.json found in project root. Skipping npm shell command: "${action.content}" and ensuring static server is started.`,
        );
        await this.#startStaticServer();
        return;
      }
    }

    const shell = this.#shellTerminal();
    const readyTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Shell terminal ready timeout')), 15000);
    });
    await Promise.race([shell.ready(), readyTimeout]);

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    if (action.abortSignal.aborted) {
      throw new Error('Action was aborted');
    }

    let timer: any;
    const abortPromise = new Promise<never>((_, reject) => {
      action.abortSignal.addEventListener('abort', () => {
        try {
          shell.terminal?.input('\x03');
        } catch (e) {}
        reject(new Error('Action was aborted'));
      });
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try {
          shell.terminal?.input('\x03');
        } catch (e) {}
        reject(new Error('Shell command execution timed out after 90 seconds'));
      }, 90000);
    });

    try {
      const resp = await Promise.race([
        shell.executeCommand(this.runnerId.get(), action.content),
        abortPromise,
        timeoutPromise,
      ]);

      logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

      if (resp?.exitCode != 0) {
        const errorDetail = resp?.output ? resp.output.trim().slice(-600) : '';
        throw new Error(errorDetail ? `Command failed (code ${resp?.exitCode}):\n${errorDetail}` : 'Failed To Execute Shell Command');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async #runStartAction(action: ActionState) {
    if (action.type !== 'start') {
      unreachable('Expected shell action');
    }

    if (this.#isNpmCommand(action.content)) {
      const hasPkg = await this.#hasPackageJson();
      if (!hasPkg) {
        logger.info(
          `[ActionRunner] No package.json found in project root. Skipping npm start command: "${action.content}" and starting .static_server.cjs directly.`,
        );
        await this.#startStaticServer();
        return;
      }
    }

    if (!this.#shellTerminal) {
      unreachable('Shell terminal not found');
    }

    const shell = this.#shellTerminal();
    const readyTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Shell terminal ready timeout')), 15000);
    });
    await Promise.race([shell.ready(), readyTimeout]);

    if (!shell || !shell.terminal || !shell.process) {
      unreachable('Shell terminal not found');
    }

    const resp = await shell.executeCommand(this.runnerId.get(), action.content);
    logger.debug(`${action.type} Shell Response: [exit code:${resp?.exitCode}]`);

    if (resp?.exitCode != 0) {
      throw new Error('Failed To Start Application');
    }

    return resp;
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const wcTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('WebContainer initialization timed out')), 20000);
    });

    const webcontainer = await Promise.race([this.#webcontainer, wcTimeout]);

    if (!webcontainer) {
      throw new Error('WebContainer is unavailable. Reload the studio with cross-origin isolation enabled.');
    }

    let folder = nodePath.dirname(action.filePath);

    // remove trailing slashes
    folder = folder.replace(/\/+$/g, '');

    if (folder !== '.') {
      try {
        await webcontainer.fs.mkdir(folder, { recursive: true });
        logger.debug('Created folder', folder);
      } catch (error) {
        logger.error('Failed to create folder\n\n', error);
      }
    }

    try {
      await webcontainer.fs.writeFile(action.filePath, action.content);
      logger.debug(`File written ${action.filePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
      throw error;
    }
  }
  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }
}

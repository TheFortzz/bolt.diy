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

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #shellTerminal: () => BoltShell;
  runnerId = atom<string>(`${Date.now()}`);
  actions: ActionsMap = map({});

  constructor(webcontainerPromise: Promise<WebContainer>, getShellTerminal: () => BoltShell) {
    this.#webcontainer = webcontainerPromise;
    this.#shellTerminal = getShellTerminal;
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

import type { BoltAction } from '~/types/actions';
import { WORK_DIR } from '~/utils/constants';
import { isWorkspacePath, type Blueprint } from '~/lib/harness/blueprint';

export class ExecutionPolicy {
  #plan?: Blueprint;
  #expiresAt = 0;
  #historical = new Set<string>();
  #messages = new Set<string>();
  #activeMessageId?: string;
  #reservedPaths = new Set<string>();
  #reservedActions = new Map<string, string>();
  #isRepair = false;
  #writtenPaths = new Set<string>();

  registerHistory(ids: string[]) {
    ids.forEach((id) => this.#historical.add(id));
  }

  isHistorical(messageId: string) {
    return this.#historical.has(messageId);
  }

  approve(plan: Blueprint) {
    this.#plan = plan;
    this.#expiresAt = Date.now() + 2 * 60 * 60 * 1000;
    this.#messages.clear();
    this.#activeMessageId = undefined;
    this.#reservedPaths.clear();
    this.#reservedActions.clear();
    this.#isRepair = false;
    this.#writtenPaths.clear();
  }

  revoke() {
    this.#plan = undefined;
    this.#messages.clear();
    this.#activeMessageId = undefined;
    this.#reservedPaths.clear();
    this.#reservedActions.clear();
    this.#isRepair = false;
    this.#writtenPaths.clear();
  }

  allowRepair(nextMessageId?: string) {
    this.#activeMessageId = nextMessageId;
    this.#reservedPaths.clear();
    this.#reservedActions.clear();
    this.#isRepair = true;
  }

  get isRepair() {
    return this.#isRepair;
  }

  recordWritten(filePath: string) {
    const path = filePath.startsWith(`${WORK_DIR}/`) ? filePath.slice(WORK_DIR.length + 1) : filePath;
    this.#writtenPaths.add(path);
  }

  hasWritten(filePath: string) {
    const path = filePath.startsWith(`${WORK_DIR}/`) ? filePath.slice(WORK_DIR.length + 1) : filePath;
    return this.#writtenPaths.has(path);
  }

  get plan() {
    return this.#plan;
  }

  authorize(messageId: string, actionId: string, action: BoltAction, stage: 'reserve' | 'complete' = 'reserve') {
    if (this.isHistorical(messageId)) {
      return;
    }

    if (!this.#plan || Date.now() > this.#expiresAt) {
      throw new Error('Files cannot change without a current approved blueprint.');
    }

    if (action.type !== 'file') {
      throw new Error('The Editor may only change approved source files; shell and start actions are blocked.');
    }

    const path = action.filePath.startsWith(`${WORK_DIR}/`)
      ? action.filePath.slice(WORK_DIR.length + 1)
      : action.filePath;

    if (!isWorkspacePath(path)) {
      throw new Error(`File path is not a safe workspace path: ${action.filePath}`);
    }

    if (!this.#plan.fileOperations.some((file) => file.path === path)) {
      throw new Error(`File is outside the approved blueprint: ${action.filePath}`);
    }

    if (this.#activeMessageId && this.#activeMessageId !== messageId) {
      throw new Error('Only the active approved build may emit file actions.');
    }

    const actionKey = `${messageId}:${actionId}`;

    if (stage === 'reserve') {
      const existingReservation = this.#reservedActions.get(actionKey);

      if (existingReservation === path) {
        return;
      }

      if (existingReservation || this.#reservedPaths.has(path)) {
        throw new Error(`The approved build already emitted an action for ${path}.`);
      }

      this.#activeMessageId ??= messageId;
      this.#reservedActions.set(actionKey, path);
      this.#reservedPaths.add(path);
      this.#messages.add(messageId);

      return;
    }

    if (this.#activeMessageId !== messageId || this.#reservedActions.get(actionKey) !== path) {
      throw new Error(`File action ${actionId} was not reserved by the approved build.`);
    }

    if (new TextEncoder().encode(action.content).byteLength > this.#plan.budgets.maximumSourceBytes) {
      throw new Error('Generated source exceeds the approved size budget.');
    }
  }

  getApprovedOperation(messageId: string, actionId: string, filePath: string) {
    if (this.isHistorical(messageId)) {
      return undefined;
    }

    if (!this.#plan || Date.now() > this.#expiresAt) {
      throw new Error('Files cannot change without a current approved blueprint.');
    }

    const path = filePath.startsWith(`${WORK_DIR}/`) ? filePath.slice(WORK_DIR.length + 1) : filePath;
    const actionKey = `${messageId}:${actionId}`;

    if (this.#activeMessageId !== messageId || this.#reservedActions.get(actionKey) !== path) {
      throw new Error(`File action ${actionId} was not reserved by the approved build.`);
    }

    const operation = this.#plan.fileOperations.find((file) => file.path === path);

    if (!operation) {
      throw new Error(`File is outside the approved blueprint: ${filePath}`);
    }

    return operation;
  }

  ownsMessage(messageId: string) {
    return this.#messages.has(messageId);
  }
}

export const executionPolicy = new ExecutionPolicy();

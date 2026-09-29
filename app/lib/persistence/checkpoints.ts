import type { WebContainer } from '@webcontainer/api';
import { atom } from 'nanostores';
import * as nodePath from 'node:path';
import { WORK_DIR } from '~/utils/constants';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_CHECKPOINTS = 10;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.studio-checkpoints', 'home', 'project', 'projects']);

export interface CheckpointInfo {
  id: string;
  chatId: string;
  messageId: string;
  createdAt: number;
  fileCount: number;
}

interface StoredCheckpoint extends CheckpointInfo {
  files: Record<string, Uint8Array>;
}

export const latestCheckpoint = atom<CheckpointInfo | undefined>();
export const checkpointBusy = atom<'idle' | 'saving' | 'restoring'>('idle');

function includeFile(name: string): boolean {
  return name !== '.env' && !name.startsWith('.env.');
}

function safeProjectPath(relativePath: string): string {
  const normalized = nodePath.posix.normalize(relativePath);

  if (
    !relativePath ||
    nodePath.posix.isAbsolute(relativePath) ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized !== relativePath ||
    relativePath.split('/').some((segment) => SKIPPED_DIRECTORIES.has(segment)) ||
    !includeFile(nodePath.posix.basename(relativePath))
  ) {
    throw new Error(`Invalid checkpoint path: ${relativePath}`);
  }

  return nodePath.posix.join(WORK_DIR, normalized);
}

export async function captureProject(wc: WebContainer): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;

  async function visit(directory: string) {
    const entries = await wc.fs.readdir(nodePath.posix.join(WORK_DIR, directory), { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = nodePath.posix.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await visit(relativePath);
        }
      } else if (entry.isFile() && includeFile(entry.name)) {
        const data = await wc.fs.readFile(safeProjectPath(relativePath));
        totalBytes += data.byteLength;

        if (totalBytes > MAX_BYTES) {
          throw new Error('Project exceeds the 64 MB checkpoint limit. No checkpoint was saved.');
        }

        files[relativePath] = new Uint8Array(data);
      } else if (!entry.isFile()) {
        throw new Error(`Cannot checkpoint unsupported filesystem entry: ${relativePath}`);
      }
    }
  }

  await visit('');

  return files;
}

export async function applyProjectSnapshot(wc: WebContainer, files: Record<string, Uint8Array>) {
  const target = new Set(Object.keys(files));

  for (const path of target) {
    safeProjectPath(path);
  }

  const current = await captureProject(wc);

  for (const path of Object.keys(current)) {
    if (!target.has(path)) {
      await wc.fs.rm(safeProjectPath(path));
    }
  }

  for (const [path, data] of Object.entries(files)) {
    const absolutePath = safeProjectPath(path);
    await wc.fs.mkdir(nodePath.posix.dirname(absolutePath), { recursive: true });
    await wc.fs.writeFile(absolutePath, data);
  }
}

const LOCAL_STORAGE_CHECKPOINT_PREFIX = 'fortz_checkpoint_';
const inMemoryCheckpoints = new Map<string, StoredCheckpoint>();

function saveCheckpointToLocalStorage(checkpoint: StoredCheckpoint) {
  if (typeof window === 'undefined') return;
  try {
    const serializedFiles: Record<string, { type: 'text' | 'bin'; data: string }> = {};
    const textDecoder = new TextDecoder('utf-8');

    for (const [path, bytes] of Object.entries(checkpoint.files)) {
      try {
        const text = textDecoder.decode(bytes);
        serializedFiles[path] = { type: 'text', data: text };
      } catch {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        serializedFiles[path] = { type: 'bin', data: btoa(binary) };
      }
    }

    const payload = JSON.stringify({
      id: checkpoint.id,
      chatId: checkpoint.chatId,
      messageId: checkpoint.messageId,
      createdAt: checkpoint.createdAt,
      fileCount: checkpoint.fileCount,
      files: serializedFiles,
    });

    localStorage.setItem(LOCAL_STORAGE_CHECKPOINT_PREFIX + checkpoint.chatId, payload);
  } catch (e) {
    console.warn('LocalStorage checkpoint save warning (in-memory preserved):', e);
  }
}

function getCheckpointFromLocalStorage(chatId: string): StoredCheckpoint | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_CHECKPOINT_PREFIX + chatId);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.files) return undefined;

    const files: Record<string, Uint8Array> = {};
    const textEncoder = new TextEncoder();

    for (const [path, entry] of Object.entries(parsed.files as Record<string, { type: string; data: string }>)) {
      if (entry.type === 'text') {
        files[path] = textEncoder.encode(entry.data);
      } else {
        const binary = atob(entry.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        files[path] = bytes;
      }
    }

    return {
      id: parsed.id,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      createdAt: parsed.createdAt,
      fileCount: parsed.fileCount,
      files,
    };
  } catch {
    return undefined;
  }
}

function checkpointStore(db: IDBDatabase, mode: IDBTransactionMode) {
  if (!db.objectStoreNames.contains('checkpoints')) {
    throw new Error('Checkpoint storage is unavailable. Reload Studio to update its database.');
  }

  return db.transaction('checkpoints', mode).objectStore('checkpoints');
}

export async function getLatestCheckpoint(db: IDBDatabase | undefined, chatId: string): Promise<StoredCheckpoint | undefined> {
  if (db && db.objectStoreNames?.contains('checkpoints')) {
    try {
      const idbCheckpoint = await new Promise<StoredCheckpoint | undefined>((resolve, reject) => {
        const range = IDBKeyRange.bound([chatId, 0], [chatId, Number.MAX_SAFE_INTEGER]);
        const request = checkpointStore(db, 'readonly').index('byChatAndTime').openCursor(range, 'prev');
        request.onsuccess = () => resolve(request.result?.value as StoredCheckpoint | undefined);
        request.onerror = () => reject(request.error || new Error('Could not read checkpoint.'));
      });
      if (idbCheckpoint) {
        return idbCheckpoint;
      }
    } catch (e) {
      console.warn('IDB getLatestCheckpoint warning, checking fallback storage:', e);
    }
  }

  return inMemoryCheckpoints.get(chatId) ?? getCheckpointFromLocalStorage(chatId);
}

export async function refreshLatestCheckpoint(db: IDBDatabase | undefined, chatId: string) {
  const checkpoint = await getLatestCheckpoint(db, chatId);
  const info: CheckpointInfo | undefined = checkpoint && {
    id: checkpoint.id,
    chatId: checkpoint.chatId,
    messageId: checkpoint.messageId,
    createdAt: checkpoint.createdAt,
    fileCount: checkpoint.fileCount,
  };

  latestCheckpoint.set(info);

  return info;
}

export async function saveCheckpoint(db: IDBDatabase | undefined, wc: WebContainer, chatId: string, messageId: string) {
  if (checkpointBusy.get() !== 'idle') {
    throw new Error('Another checkpoint operation is in progress.');
  }

  checkpointBusy.set('saving');

  try {
    const files = await captureProject(wc);

    if (!Object.keys(files).length) {
      throw new Error('Cannot checkpoint an empty project.');
    }

    const checkpoint: StoredCheckpoint = {
      id: crypto.randomUUID(),
      chatId,
      messageId,
      createdAt: Math.max(Date.now(), ((await getLatestCheckpoint(db, chatId))?.createdAt ?? 0) + 1),
      fileCount: Object.keys(files).length,
      files,
    };

    // 1. Immediately preserve in-memory and in LocalStorage
    inMemoryCheckpoints.set(chatId, checkpoint);
    saveCheckpointToLocalStorage(checkpoint);

    // 2. Also persist in IndexedDB if available and schema is current
    if (db && db.objectStoreNames?.contains('checkpoints')) {
      try {
        await new Promise<void>((resolve, reject) => {
          const store = checkpointStore(db, 'readwrite');
          const transaction = store.transaction;
          store.put(checkpoint);

          const index = store.index('byChatAndTime');
          const range = IDBKeyRange.bound([chatId, 0], [chatId, Number.MAX_SAFE_INTEGER]);
          let count = 0;
          const cursor = index.openCursor(range, 'prev');

          cursor.onsuccess = () => {
            if (!cursor.result) {
              return;
            }

            count++;

            if (count > MAX_CHECKPOINTS) {
              cursor.result.delete();
            }

            cursor.result.continue();
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error || new Error('Could not save checkpoint.'));
          transaction.onabort = () => reject(transaction.error || new Error('Checkpoint storage is full.'));
        });
      } catch (idbErr) {
        console.warn('IDB checkpoint save warning, preserved in LocalStorage & memory:', idbErr);
      }
    }

    await refreshLatestCheckpoint(db, chatId);

    return checkpoint;
  } finally {
    checkpointBusy.set('idle');
  }
}

export async function restoreCheckpoint(db: IDBDatabase | undefined, wc: WebContainer, chatId: string) {
  if (checkpointBusy.get() !== 'idle') {
    throw new Error('Another checkpoint operation is in progress.');
  }

  checkpointBusy.set('restoring');

  try {
    const checkpoint = await getLatestCheckpoint(db, chatId);

    if (!checkpoint) {
      throw new Error('No working checkpoint exists for this project.');
    }

    const previousFiles = await captureProject(wc);

    try {
      await applyProjectSnapshot(wc, checkpoint.files);
    } catch (error) {
      try {
        await applyProjectSnapshot(wc, previousFiles);
      } catch (recoveryError) {
        throw new Error(`Restore failed and recovery failed: ${(recoveryError as Error).message}`);
      }

      throw error;
    }

    return checkpoint;
  } finally {
    checkpointBusy.set('idle');
  }
}

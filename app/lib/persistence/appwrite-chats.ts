/**
 * Persist Studio AI chats to Appwrite (collection: studio_chats).
 * IndexedDB remains the fast local cache; Appwrite is the cloud backup.
 *
 * Embedded Studio (iframe inside thefortz.me) has NO Appwrite cookie — auth is
 * parent-synced via postMessage. Never call Account.get() there (causes endless 401s).
 * Document permissions on this collection only allow `any` / `guests`.
 */
import { Databases, ID, Query, Permission, Role } from 'appwrite';
import { getAppwriteClient, authStore } from '~/lib/auth/appwrite';
import type { Message } from 'ai';

export const STUDIO_CHATS_COLLECTION = '6ab390a600047e7f3e69';
export const STUDIO_CHATS_DATABASE = 'fortz_db';

let cloudSyncCooldownUntil = 0;

function isEmbeddedStudio(): boolean {
  return typeof window !== 'undefined' && Boolean(window.parent && window.parent !== window);
}

function getDatabases(): Databases | null {
  try {
    return new Databases(getAppwriteClient());
  } catch {
    return null;
  }
}

/** Collection only accepts any/guests document permissions. */
function guestSafePermissions() {
  return [
    Permission.read(Role.any()),
    Permission.update(Role.any()),
    Permission.delete(Role.any()),
  ];
}

export async function upsertStudioChat(_params: {
  chatId: string;
  urlId?: string;
  description?: string;
  messages: Message[];
}): Promise<void> {
  // Appwrite cloud sync is disconnected. Studio chats are saved in local storage.
  return Promise.resolve();
}

export async function listStudioChats(_limit = 40): Promise<
  Array<{ chatId: string; urlId: string; title: string; updatedAt: number; messages: Message[] }>
> {
  // Appwrite cloud sync is disconnected. Studio chats are read from local storage / IndexedDB.
  return Promise.resolve([]);
}

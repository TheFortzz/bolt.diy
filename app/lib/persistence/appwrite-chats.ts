/**
 * Persist Studio AI chats to Appwrite (collection: studio_chats).
 * IndexedDB remains the fast local cache; Appwrite is the cloud backup.
 *
 * Document-level permissions on this collection only allow `any` / `guests`
 * (not Role.user). Embedded iframe sessions are parent-synced and usually
 * have no Appwrite cookie — skip cloud writes there to avoid 401/429 spam.
 */
import { Databases, ID, Query, Permission, Role } from 'appwrite';
import { getAppwriteClient, getAppwriteAccount, authStore } from '~/lib/auth/appwrite';
import type { Message } from 'ai';

export const STUDIO_CHATS_COLLECTION = '6ab390a600047e7f3e69';
export const STUDIO_CHATS_DATABASE = 'fortz_db';

let cloudSyncCooldownUntil = 0;

function getDatabases(): Databases | null {
  try {
    return new Databases(getAppwriteClient());
  } catch {
    return null;
  }
}

async function hasRealAppwriteSession(): Promise<boolean> {
  try {
    const user = await getAppwriteAccount().get();
    return Boolean(user?.$id);
  } catch {
    return false;
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

export async function upsertStudioChat(params: {
  chatId: string;
  urlId?: string;
  description?: string;
  messages: Message[];
}): Promise<void> {
  if (Date.now() < cloudSyncCooldownUntil) {
    return;
  }

  const user = authStore.get().user;
  if (!user?.$id || user.$id === 'usr_synced') {
    return;
  }

  // Parent-synced iframe users have no Appwrite cookie — local + parent sync is enough.
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    const sessionOk = await hasRealAppwriteSession();
    if (!sessionOk) {
      return;
    }
  }

  const databases = getDatabases();
  if (!databases) return;

  const payload = {
    userId: user.$id,
    chatId: String(params.chatId).slice(0, 64),
    urlId: String(params.urlId || params.chatId).slice(0, 64),
    title: String(params.description || 'Untitled Project').slice(0, 200),
    messagesJson: JSON.stringify(params.messages).slice(0, 900_000),
    updatedAt: Date.now(),
  };

  const docId = `${user.$id}_${params.chatId}`.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 36);

  try {
    await databases.updateDocument(STUDIO_CHATS_DATABASE, STUDIO_CHATS_COLLECTION, docId, payload);
  } catch {
    try {
      await databases.createDocument(
        STUDIO_CHATS_DATABASE,
        STUDIO_CHATS_COLLECTION,
        docId.length >= 1 ? docId : ID.unique(),
        payload,
        guestSafePermissions(),
      );
    } catch (err: any) {
      const code = err?.code || err?.response?.code;
      const message = String(err?.message || err || '');

      // Back off hard on rate limits / auth / permission misconfig so AI chat isn't flooded
      if (code === 429 || /rate limit/i.test(message)) {
        cloudSyncCooldownUntil = Date.now() + 60_000;
      } else if (code === 401 || code === 403 || /Permissions must be one of/i.test(message)) {
        cloudSyncCooldownUntil = Date.now() + 120_000;
      }

      console.warn('[studio-chats] create failed:', err);
    }
  }
}

export async function listStudioChats(limit = 40): Promise<
  Array<{ chatId: string; urlId: string; title: string; updatedAt: number; messages: Message[] }>
> {
  if (Date.now() < cloudSyncCooldownUntil) {
    return [];
  }

  const user = authStore.get().user;
  if (!user?.$id || user.$id === 'usr_synced') return [];

  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    const sessionOk = await hasRealAppwriteSession();
    if (!sessionOk) return [];
  }

  const databases = getDatabases();
  if (!databases) return [];

  try {
    const res = await databases.listDocuments(STUDIO_CHATS_DATABASE, STUDIO_CHATS_COLLECTION, [
      Query.equal('userId', user.$id),
      Query.orderDesc('updatedAt'),
      Query.limit(limit),
    ]);

    return (res.documents || []).map((doc: any) => {
      let messages: Message[] = [];
      try {
        messages = JSON.parse(doc.messagesJson || '[]');
      } catch {
        messages = [];
      }
      return {
        chatId: String(doc.chatId || doc.$id),
        urlId: String(doc.urlId || doc.chatId || ''),
        title: String(doc.title || 'Untitled'),
        updatedAt: Number(doc.updatedAt) || 0,
        messages,
      };
    });
  } catch (err: any) {
    const code = err?.code || err?.response?.code;
    if (code === 429 || code === 401 || code === 403) {
      cloudSyncCooldownUntil = Date.now() + 60_000;
    }
    console.warn('[studio-chats] list failed:', err);
    return [];
  }
}

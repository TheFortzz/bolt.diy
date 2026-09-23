/**
 * Persist Studio AI chats to Appwrite (collection: studio_chats).
 * IndexedDB remains the fast local cache; Appwrite is the cloud backup.
 */
import { Databases, ID, Query, Permission, Role } from 'appwrite';
import { getAppwriteClient, authStore } from '~/lib/auth/appwrite';
import type { Message } from 'ai';

export const STUDIO_CHATS_COLLECTION = 'studio_chats';
export const STUDIO_CHATS_DATABASE = 'fortz_db';

function getDatabases(): Databases | null {
  try {
    return new Databases(getAppwriteClient());
  } catch {
    return null;
  }
}

export async function upsertStudioChat(params: {
  chatId: string;
  urlId?: string;
  description?: string;
  messages: Message[];
}): Promise<void> {
  const user = authStore.get().user;
  if (!user?.$id || user.$id === 'usr_synced') {
    return;
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
        [
          Permission.read(Role.user(user.$id)),
          Permission.update(Role.user(user.$id)),
          Permission.delete(Role.user(user.$id)),
        ],
      );
    } catch (err) {
      console.warn('[studio-chats] create failed:', err);
    }
  }
}

export async function listStudioChats(limit = 40): Promise<
  Array<{ chatId: string; urlId: string; title: string; updatedAt: number; messages: Message[] }>
> {
  const user = authStore.get().user;
  if (!user?.$id || user.$id === 'usr_synced') return [];

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
  } catch (err) {
    console.warn('[studio-chats] list failed:', err);
    return [];
  }
}

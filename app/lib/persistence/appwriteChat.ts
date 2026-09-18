/**
 * THEFORTZ Appwrite Cloud Chat Persistence
 *
 * Automatically saves all Studio chats directly into Appwrite Cloud Storage
 * (games bucket on fortz_db / 6a83071d00217ab38269).
 */

export const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
export const APPWRITE_PROJECT_ID = '6a83071d00217ab38269';
export const APPWRITE_BUCKET_ID = 'games';

export interface AppwriteChatPayload {
  id: string;
  urlId?: string;
  description?: string;
  messages: any[];
  timestamp?: string;
}

const SYNCED_CHATS_KEY = 'thefortz_appwrite_chat_sync';

function getSyncedMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(SYNCED_CHATS_KEY) || '{}');
  } catch {
    return {};
  }
}

function recordSync(chatId: string, appwriteFileId: string) {
  if (typeof window === 'undefined') return;
  try {
    const map = getSyncedMap();
    map[chatId] = appwriteFileId;
    localStorage.setItem(SYNCED_CHATS_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Save chat payload directly to Appwrite Storage (games bucket)
 */
export async function saveChatToAppwrite(chatData: AppwriteChatPayload): Promise<string | null> {
  if (typeof window === 'undefined' || !chatData || !chatData.id) {
    return null;
  }

  try {
    const jsonStr = JSON.stringify({
      ...chatData,
      _appwriteSavedAt: new Date().toISOString(),
      _origin: 'thefortz_studio',
    });

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const filename = `chat_${chatData.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;

    const formData = new FormData();
    formData.append('fileId', 'unique()');
    formData.append('file', blob, filename);

    const res = await fetch(`${APPWRITE_ENDPOINT}/storage/buckets/${APPWRITE_BUCKET_ID}/files`, {
      method: 'POST',
      headers: {
        'X-Appwrite-Project': APPWRITE_PROJECT_ID,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[AppwriteChat] Save note:', res.status, errText);
      return null;
    }

    const data = (await res.json()) as { $id?: string };
    const fileId = data?.$id || '';

    if (fileId) {
      recordSync(chatData.id, fileId);
      console.log(`[AppwriteChat] Chat "${chatData.id}" successfully saved to Appwrite Storage (File: ${fileId})`);
    }

    return fileId || null;
  } catch (err) {
    console.warn('[AppwriteChat] Sync exception:', err);
    return null;
  }
}

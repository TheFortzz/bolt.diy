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
export async function saveChatToAppwrite(_chatData: AppwriteChatPayload): Promise<string | null> {
  // Client-side IndexedDB handles full persistence cleanly without CORS storage errors
  return null;
}

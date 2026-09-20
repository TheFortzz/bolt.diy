import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { ChatHistoryItem } from './useChatHistory';
import { saveChatToAppwrite } from './appwriteChat';

const logger = createScopedLogger('ChatHistory');

// this is used at the top level and never rejects
export async function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    console.error('indexedDB is not available in this environment.');
    return undefined;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open('boltHistory', 1);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('chats')) {
        const store = db.createObjectStore('chats', { keyPath: 'id' });
        store.createIndex('id', 'id', { unique: true });
        store.createIndex('urlId', 'urlId', { unique: true });
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      resolve(undefined);
      logger.error((event.target as IDBOpenDBRequest).error);
    };
  });
}

const LOCAL_STORAGE_KEY_PREFIX = 'fortz_chat_item_';
const LOCAL_STORAGE_INDEX_KEY = 'fortz_chats_index';

function getLocalStorageIndex(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_INDEX_KEY) || '[]');
  } catch {
    return [];
  }
}

function addToLocalStorageIndex(id: string) {
  if (typeof window === 'undefined') return;
  try {
    const list = getLocalStorageIndex();
    if (!list.includes(id)) {
      list.push(id);
      localStorage.setItem(LOCAL_STORAGE_INDEX_KEY, JSON.stringify(list));
    }
  } catch {}
}

function removeFromLocalStorageIndex(id: string) {
  if (typeof window === 'undefined') return;
  try {
    const list = getLocalStorageIndex().filter((i) => i !== id);
    localStorage.setItem(LOCAL_STORAGE_INDEX_KEY, JSON.stringify(list));
    localStorage.removeItem(LOCAL_STORAGE_KEY_PREFIX + id);
  } catch {}
}

function saveToLocalStorage(chatItem: ChatHistoryItem) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_PREFIX + chatItem.id, JSON.stringify(chatItem));
    if (chatItem.urlId && chatItem.urlId !== chatItem.id) {
      localStorage.setItem(LOCAL_STORAGE_KEY_PREFIX + chatItem.urlId, JSON.stringify(chatItem));
      addToLocalStorageIndex(chatItem.urlId);
    }
    addToLocalStorageIndex(chatItem.id);
  } catch (e) {
    console.warn('LocalStorage save error:', e);
  }
}

function getFromLocalStorage(id: string): ChatHistoryItem | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_PREFIX + id);
    if (raw) return JSON.parse(raw);

    // Search through index in case id matches urlId
    const index = getLocalStorageIndex();
    for (const key of index) {
      const itemRaw = localStorage.getItem(LOCAL_STORAGE_KEY_PREFIX + key);
      if (itemRaw) {
        const parsed = JSON.parse(itemRaw);
        if (parsed.id === id || parsed.urlId === id) {
          return parsed;
        }
      }
    }
  } catch {}
  return undefined;
}

function getAllFromLocalStorage(): ChatHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const ids = getLocalStorageIndex();
    const map = new Map<string, ChatHistoryItem>();
    for (const key of ids) {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY_PREFIX + key);
      if (raw) {
        const item: ChatHistoryItem = JSON.parse(raw);
        if (item && item.id) {
          map.set(item.id, item);
        }
      }
    }
    return Array.from(map.values());
  } catch {
    return [];
  }
}

export async function getAll(db?: IDBDatabase): Promise<ChatHistoryItem[]> {
  const localItems = getAllFromLocalStorage();
  if (!db) {
    return localItems;
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction('chats', 'readonly');
      const store = transaction.objectStore('chats');
      const request = store.getAll();

      request.onsuccess = () => {
        const idbItems = (request.result as ChatHistoryItem[]) || [];
        const mergedMap = new Map<string, ChatHistoryItem>();
        for (const item of localItems) {
          mergedMap.set(item.id, item);
        }
        for (const item of idbItems) {
          mergedMap.set(item.id, item);
        }
        resolve(Array.from(mergedMap.values()));
      };
      request.onerror = () => resolve(localItems);
    } catch {
      resolve(localItems);
    }
  });
}

export async function setMessages(
  db: IDBDatabase | undefined,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
): Promise<void> {
  const chatItem: ChatHistoryItem = {
    id,
    messages,
    urlId,
    description,
    timestamp: timestamp ?? new Date().toISOString(),
  };

  // 1. Guaranteed instantaneous sync into localStorage
  saveToLocalStorage(chatItem);

  // 2. Also save to IndexedDB if available
  if (!db) {
    return;
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction('chats', 'readwrite');
      const store = transaction.objectStore('chats');

      if (timestamp && isNaN(Date.parse(timestamp))) {
        resolve();
        return;
      }

      const request = store.put(chatItem);

      request.onsuccess = () => {
        void saveChatToAppwrite(chatItem);
        resolve();
      };
      request.onerror = () => {
        console.warn('IDB put error, preserved in localStorage');
        resolve();
      };
    } catch {
      resolve();
    }
  });
}

export async function getMessages(db: IDBDatabase | undefined, id: string): Promise<ChatHistoryItem | undefined> {
  if (db) {
    try {
      const item = (await getMessagesById(db, id)) || (await getMessagesByUrlId(db, id));
      if (item && item.messages && item.messages.length > 0) {
        saveToLocalStorage(item);
        return item;
      }
    } catch (err) {
      console.warn('IndexedDB getMessages error:', err);
    }
  }

  return getFromLocalStorage(id);
}

export async function getMessagesByUrlId(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const index = store.index('urlId');
    const request = index.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesById(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteById(db: IDBDatabase | undefined, id: string): Promise<void> {
  removeFromLocalStorageIndex(id);

  if (!db) return;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction('chats', 'readwrite');
      const store = transaction.objectStore('chats');
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getNextId(db?: IDBDatabase): Promise<string> {
  const localIds = getLocalStorageIndex()
    .map((id) => parseInt(id, 10))
    .filter((n) => !isNaN(n));
  const maxLocal = localIds.length > 0 ? Math.max(...localIds) : 0;

  if (!db) {
    return String(maxLocal + 1);
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction('chats', 'readonly');
      const store = transaction.objectStore('chats');
      const request = store.getAllKeys();

      request.onsuccess = () => {
        const idbIds = (request.result as any[]).map((id) => parseInt(String(id), 10)).filter((n) => !isNaN(n));
        const highest = Math.max(maxLocal, ...idbIds, 0);
        resolve(String(highest + 1));
      };
      request.onerror = () => resolve(String(maxLocal + 1));
    } catch {
      resolve(String(maxLocal + 1));
    }
  });
}

export async function getUrlId(db: IDBDatabase | undefined, id: string): Promise<string> {
  const idList = await getUrlIds(db);

  if (!idList.includes(id)) {
    return id;
  } else {
    let i = 2;

    while (idList.includes(`${id}-${i}`)) {
      i++;
    }

    return `${id}-${i}`;
  }
}

async function getUrlIds(db?: IDBDatabase): Promise<string[]> {
  if (!db) {
    return getLocalStorageIndex();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const idList: string[] = [];

    const request = store.openCursor();

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        idList.push(cursor.value.urlId);
        cursor.continue();
      } else {
        resolve(idList);
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function forkChat(db: IDBDatabase, chatId: string, messageId: string): Promise<string> {
  const chat = await getMessages(db, chatId);

  if (!chat) {
    throw new Error('Chat not found');
  }

  // Find the index of the message to fork at
  const messageIndex = chat.messages.findIndex((msg) => msg.id === messageId);

  if (messageIndex === -1) {
    throw new Error('Message not found');
  }

  // Get messages up to and including the selected message
  const messages = chat.messages.slice(0, messageIndex + 1);

  return createChatFromMessages(db, chat.description ? `${chat.description} (fork)` : 'Forked chat', messages);
}

export async function duplicateChat(db: IDBDatabase, id: string): Promise<string> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  return createChatFromMessages(db, `${chat.description || 'Chat'} (copy)`, chat.messages);
}

export async function createChatFromMessages(
  db: IDBDatabase,
  description: string,
  messages: Message[],
): Promise<string> {
  const newId = await getNextId(db);
  const newUrlId = await getUrlId(db, newId); // Get a new urlId for the duplicated chat

  await setMessages(
    db,
    newId,
    messages,
    newUrlId, // Use the new urlId
    description,
  );

  return newUrlId; // Return the urlId instead of id for navigation
}

export async function updateChatDescription(db: IDBDatabase, id: string, description: string): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  if (!description.trim()) {
    throw new Error('Description cannot be empty');
  }

  await setMessages(db, id, chat.messages, chat.urlId, description, chat.timestamp);
}

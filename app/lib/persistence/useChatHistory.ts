import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect } from 'react';
import { atom } from 'nanostores';
import type { Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import {
  getMessages,
  getNextId,
  getUrlId,
  openDatabase,
  setMessages,
  duplicateChat,
  createChatFromMessages,
} from './db';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export let db: IDBDatabase | undefined = undefined;

export const dbPromise: Promise<IDBDatabase | undefined> = (async () => {
  if (typeof window === 'undefined' || !persistenceEnabled) {
    return undefined;
  }

  try {
    db = await openDatabase();
    return db;
  } catch (error) {
    console.error('Failed to open database:', error);
    return undefined;
  }
})();

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);

export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId } = useLoaderData<{ id?: string }>();
  const [searchParams] = useSearchParams();

  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();

  useEffect(() => {
    dbPromise.then((database) => {
      if (!database) {
        setReady(true);

        if (persistenceEnabled) {
          toast.error('Chat persistence is unavailable');
        }

        return;
      }

      if (mixedId) {
        getMessages(database, mixedId)
          .then((storedMessages) => {
            if (storedMessages && storedMessages.messages.length > 0) {
              const rewindId = searchParams.get('rewindTo');
              const filteredMessages = rewindId
                ? storedMessages.messages.slice(0, storedMessages.messages.findIndex((m) => m.id === rewindId) + 1)
                : storedMessages.messages;

              setInitialMessages(filteredMessages);
              setUrlId(storedMessages.urlId);
              description.set(storedMessages.description);
              chatId.set(storedMessages.id);
            } else {
              navigate('/', { replace: true });
            }

            setReady(true);
          })
          .catch((error) => {
            toast.error(error.message);
          });
      }
    });
  }, []);

  return {
    ready: !mixedId || ready,
    initialMessages,
    storeMessageHistory: async (messages: Message[]) => {
      const activeDb = db || (await dbPromise);
      if (!activeDb || messages.length === 0) {
        return;
      }

      const { firstArtifact } = workbenchStore;

      // Extract title from firstArtifact, or generate a punchy title from first user message
      let currentDesc = description.get();
      if (!currentDesc || currentDesc === 'Untitled Project') {
        if (firstArtifact?.title) {
          currentDesc = firstArtifact.title;
        } else {
          const firstUserMsg = messages.find((m) => m.role === 'user')?.content;
          if (firstUserMsg && typeof firstUserMsg === 'string') {
            const clean = firstUserMsg
              .replace(/<[^>]+>/g, '')
              .replace(/\n+/g, ' ')
              .trim()
              .replace(/\s+/g, ' ');
            if (clean) {
              currentDesc = clean.length > 36 ? clean.slice(0, 36).trim() + '...' : clean;
            }
          }
        }
        if (currentDesc) {
          description.set(currentDesc);
        }
      } else if (firstArtifact?.title && currentDesc !== firstArtifact.title) {
        // Upgrade title if firstArtifact provides a formal game/app name
        description.set(firstArtifact.title);
        currentDesc = firstArtifact.title;
      }

      let activeUrlId = urlId;
      if (!activeUrlId && firstArtifact?.id) {
        activeUrlId = await getUrlId(activeDb, firstArtifact.id);
        navigateChat(activeUrlId);
        setUrlId(activeUrlId);
      }

      if (initialMessages.length === 0 && !chatId.get()) {
        const nextId = await getNextId(activeDb);
        chatId.set(nextId);

        if (!activeUrlId) {
          activeUrlId = await getUrlId(activeDb, nextId);
          navigateChat(activeUrlId);
          setUrlId(activeUrlId);
        }
      }

      const effectiveId = (chatId.get() || activeUrlId) as string;
      const effectiveUrlId = activeUrlId || effectiveId;
      await setMessages(activeDb, effectiveId, messages, effectiveUrlId, currentDesc || 'Project ' + effectiveId);
    },
    duplicateCurrentChat: async (listItemId: string) => {
      const activeDb = db || (await dbPromise);
      if (!activeDb || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(activeDb, mixedId || listItemId);
        navigate(`/chat/${newId}`);
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (description: string, messages: Message[]) => {
      const activeDb = db || (await dbPromise);
      if (!activeDb) {
        return;
      }

      try {
        const newId = await createChatFromMessages(activeDb, description, messages);
        window.location.href = `/chat/${newId}`;
        toast.success('Chat imported successfully');
      } catch (error) {
        if (error instanceof Error) {
          toast.error('Failed to import chat: ' + error.message);
        } else {
          toast.error('Failed to import chat');
        }
      }
    },
    exportChat: async (id = urlId) => {
      const activeDb = db || (await dbPromise);
      if (!activeDb || !id) {
        return;
      }

      const chat = await getMessages(activeDb, id);
      const chatData = {
        messages: chat.messages,
        description: chat.description,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}

function navigateChat(nextId: string) {
  /**
   * FIXME: Using the intended navigate function causes a rerender for <Chat /> that breaks the app.
   *
   * `navigate(`/chat/${nextId}`, { replace: true });`
   */
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  window.history.replaceState({}, '', url);
}

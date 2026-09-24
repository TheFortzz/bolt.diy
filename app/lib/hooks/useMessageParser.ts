import type { Message } from 'ai';
import { useCallback, useState } from 'react';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';
import type { ActionCallbackData } from '~/lib/runtime/message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('useMessageParser');

/**
 * A single trailing throttle used to share one callback between all files can
 * replay an old partial snapshot after its file has already been closed. Keep
 * only the newest snapshot for each action and cancel it when the action closes.
 */
const pendingStreamActions = new Map<string, ActionCallbackData>();
let streamFlushTimer: ReturnType<typeof setTimeout> | undefined;

function streamActionKey(messageId: string, actionId: string) {
  return `${messageId}:${actionId}`;
}

function flushPendingStreamActions() {
  if (streamFlushTimer) {
    clearTimeout(streamFlushTimer);
    streamFlushTimer = undefined;
  }

  const actions = Array.from(pendingStreamActions.values());
  pendingStreamActions.clear();

  for (const data of actions) {
    workbenchStore.runAction(data, true);
  }
}

function scheduleStreamAction(data: ActionCallbackData) {
  pendingStreamActions.set(streamActionKey(data.messageId, data.actionId), data);

  if (!streamFlushTimer) {
    streamFlushTimer = setTimeout(flushPendingStreamActions, 120);
  }
}

function cancelStreamAction(messageId: string, actionId: string) {
  pendingStreamActions.delete(streamActionKey(messageId, actionId));
  if (pendingStreamActions.size === 0 && streamFlushTimer) {
    clearTimeout(streamFlushTimer);
    streamFlushTimer = undefined;
  }
}

function resetStreamActions() {
  pendingStreamActions.clear();
  if (streamFlushTimer) {
    clearTimeout(streamFlushTimer);
    streamFlushTimer = undefined;
  }
}

const messageParser = new StreamingMessageParser({
  callbacks: {
    onArtifactOpen: (data) => {
      logger.trace('onArtifactOpen', data);

      workbenchStore.streamingFile.set(undefined);
      workbenchStore.showWorkbench.set(true);
      workbenchStore.currentView.set('code');
      workbenchStore.addArtifact(data);
    },
    onArtifactClose: (data) => {
      logger.trace('onArtifactClose');
      workbenchStore.updateArtifact(data, { closed: true });
    },
    onActionOpen: (data) => {
      logger.trace('onActionOpen', data.action);

      // Shell actions are registered when their content is complete. File and
      // start actions need an early registration so their final close can run.
      if (data.action.type !== 'shell') {
        workbenchStore.addAction(data);
      }
    },
    onActionClose: (data) => {
      logger.trace('onActionClose', data.action);
      cancelStreamAction(data.messageId, data.actionId);

      if (data.action.type === 'shell') {
        workbenchStore.addAction(data);
      }

      // Final content always bypasses the stream scheduler and is queued for
      // the real WebContainer write by the workbench.
      workbenchStore.runAction(data);
    },
    onActionStream: (data) => {
      logger.trace('onActionStream', data.action);
      scheduleStreamAction(data);
    },
  },
});

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});

  const parseMessages = useCallback((messages: Message[], isLoading: boolean) => {
    let reset = false;

    if (import.meta.env.DEV && !isLoading) {
      reset = true;
      messageParser.reset();
      resetStreamActions();
    }

    for (const [index, message] of messages.entries()) {
      if (message.role === 'assistant') {
        const newParsedContent = messageParser.parse(message.id, message.content);

        setParsedMessages((prevParsed) => ({
          ...prevParsed,
          [index]: !reset ? (prevParsed[index] || '') + newParsedContent : newParsedContent,
        }));
      }
    }
  }, []);

  return { parsedMessages, parseMessages };
}

import type { Message } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
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
    streamFlushTimer = setTimeout(flushPendingStreamActions, 250);
  }
}

function cancelStreamAction(messageId: string, actionId: string) {
  pendingStreamActions.delete(streamActionKey(messageId, actionId));
  if (pendingStreamActions.size === 0 && streamFlushTimer) {
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

/** Flush the final chunk synchronously before the build-validation gate runs. */
export function finalizeAssistantMessage(message: Message) {
  if (typeof message.content === 'string') {
    messageParser.parse(message.id, message.content);
    messageParser.finalize(message.id, message.content);
  }
}

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});
  const pendingParsedMessages = useRef<Record<number, string>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingParse = useRef<{ messages: Message[]; isLoading: boolean }>();
  const parseTimer = useRef<ReturnType<typeof setTimeout>>();

  const flushParsedMessages = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
    }

    const updates = pendingParsedMessages.current;
    const indices = Object.keys(updates);

    if (indices.length === 0) {
      return;
    }

    pendingParsedMessages.current = {};
    setParsedMessages((previous) => {
      const next = { ...previous };

      for (const key of indices) {
        const index = Number(key);
        next[index] = `${previous[index] || ''}${updates[index]}`;
      }

      return next;
    });
  }, []);

  useEffect(
    () => () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
      }
      if (parseTimer.current) {
        clearTimeout(parseTimer.current);
      }
    },
    [],
  );

  const processMessages = useCallback(
    (messages: Message[], isLoading: boolean) => {
      // Never replay completed file actions just because streaming stopped (or
      // because React rendered again). The parser remembers each message offset.

      for (const [index, message] of messages.entries()) {
        const previousMessage = messages[index - 1];
        const isChatOnly =
          message.annotations?.some(
            (annotation) =>
              typeof annotation === 'object' &&
              annotation !== null &&
              'type' in annotation &&
              annotation.type === 'studio-chat-only',
          ) ||
          (previousMessage?.role === 'user' &&
            previousMessage.annotations?.some(
              (annotation) =>
                typeof annotation === 'object' &&
                annotation !== null &&
                'type' in annotation &&
                annotation.type === 'studio-chat-only',
            ));

        if (message.role === 'assistant' && !isChatOnly) {
          const newParsedContent = messageParser.parse(message.id, message.content);

          if (newParsedContent) {
            pendingParsedMessages.current[index] = `${pendingParsedMessages.current[index] || ''}${newParsedContent}`;

            if (!flushTimer.current) {
              flushTimer.current = setTimeout(flushParsedMessages, 100);
            }
          }
        }
      }

      if (!isLoading) {
        flushParsedMessages();
      }
    },
    [flushParsedMessages],
  );

  const parseMessages = useCallback(
    (messages: Message[], isLoading: boolean) => {
      pendingParse.current = { messages, isLoading };

      if (!isLoading) {
        if (parseTimer.current) {
          clearTimeout(parseTimer.current);
          parseTimer.current = undefined;
        }

        pendingParse.current = undefined;
        processMessages(messages, false);

        return;
      }

      if (!parseTimer.current) {
        parseTimer.current = setTimeout(() => {
          parseTimer.current = undefined;
          const pending = pendingParse.current;
          pendingParse.current = undefined;

          if (pending) {
            processMessages(pending.messages, pending.isLoading);
          }
        }, 100);
      }
    },
    [processMessages],
  );

  return { parsedMessages, parseMessages };
}

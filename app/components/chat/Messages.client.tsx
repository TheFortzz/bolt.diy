import type { Message } from 'ai';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { useLocation } from '@remix-run/react';
import { db, chatId } from '~/lib/persistence/useChatHistory';
import { forkChat } from '~/lib/persistence/db';
import { toast } from 'react-toastify';
import WithTooltip from '~/components/ui/Tooltip';
import { useStore } from '@nanostores/react';
import { authStore } from '~/lib/auth/appwrite';
import { normalizeAvatarUrl } from '~/utils/avatar';
import { ActivityTimeline } from './ActivityTimeline';
import styles from '~/components/chat/ChatExperience.module.scss';
import { BlueprintCard } from '~/components/chat/BlueprintCard';
import { blueprintSchema } from '~/lib/harness/blueprint';
import { harnessState } from '~/lib/stores/harness';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
  onApprovePlan?: () => void;
  onCancelPlan?: () => void;
}

interface ParsedBlueprintCardProps {
  blueprint: unknown;
  canApprove: boolean;
  isApproving: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}

const ParsedBlueprintCard = React.memo(
  ({ blueprint, canApprove, isApproving, onApprove, onReject }: ParsedBlueprintCardProps) => {
    const parsed = useMemo(() => blueprintSchema.safeParse(blueprint), [blueprint]);

    if (!parsed.success) {
      return null;
    }

    return (
      <BlueprintCard
        blueprint={parsed.data}
        canApprove={canApprove}
        isApproving={isApproving}
        onApprove={onApprove}
        onReject={onReject}
      />
    );
  },
);

export const Messages = React.forwardRef<HTMLDivElement, MessagesProps>((props: MessagesProps, ref) => {
  const { id, isStreaming = false, messages = [] } = props;
  const location = useLocation();
  const auth = useStore(authStore);
  const harness = useStore(harnessState);
  const rawUserPhoto = auth.user?.prefs?.photoURL || auth.user?.photoURL;
  const userPhoto = normalizeAvatarUrl(rawUserPhoto);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const scrollFrame = useRef<number>();
  const [showJump, setShowJump] = useState(false);

  const followLatest = useCallback(() => {
    const node = containerRef.current;

    if (node && followingRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, []);

  const scheduleFollowLatest = useCallback(() => {
    if (typeof requestAnimationFrame !== 'function') {
      followLatest();
      return;
    }

    if (scrollFrame.current !== undefined) {
      return;
    }

    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = undefined;
      followLatest();
    });
  }, [followLatest]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== undefined && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(scrollFrame.current);
      }
    },
    [],
  );

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;

      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [ref],
  );

  const lastMessage = messages[messages.length - 1];
  const lastMessageContent = lastMessage?.content;

  useEffect(() => {
    scheduleFollowLatest();
  }, [messages.length, lastMessageContent, isStreaming, scheduleFollowLatest]);

  useEffect(() => {
    if (!contentRef.current || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(scheduleFollowLatest);
    observer.observe(contentRef.current);

    return () => observer.disconnect();
  }, [scheduleFollowLatest]);

  const handleRewind = (messageId: string) => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.set('rewindTo', messageId);
    window.location.search = searchParams.toString();
  };

  const handleFork = async (messageId: string) => {
    try {
      if (!db || !chatId.get()) {
        toast.error('Chat persistence is not available');
        return;
      }

      const urlId = await forkChat(db, chatId.get()!, messageId);
      window.location.href = `/chat/${urlId}`;
    } catch (error) {
      toast.error('Failed to fork chat: ' + (error as Error).message);
    }
  };

  return (
    <div
      id={id}
      ref={setRefs}
      className={classNames(props.className, styles.Conversation)}
      onScroll={() => {
        const node = containerRef.current;

        if (node) {
          followingRef.current = node.scrollHeight - node.clientHeight - node.scrollTop < 80;
          setShowJump(!followingRef.current);
        }
      }}
    >
      <div ref={contentRef} className="w-full min-w-0">
        {messages.length > 0
          ? messages.map((message, index) => {
              const { role, content, id: messageId } = message;
              const isUserMessage = role === 'user';
              const isLast = index === messages.length - 1;
              const isInternalRepair =
                isUserMessage && typeof content === 'string' && content.includes('[Internal Repair Prompt');
              const isInternalBuild = message.annotations?.some(
                (annotation) =>
                  typeof annotation === 'object' &&
                  annotation !== null &&
                  'type' in annotation &&
                  annotation.type === 'harness-execution',
              );
              const rawPlan = message.annotations?.find(
                (annotation) =>
                  typeof annotation === 'object' &&
                  annotation !== null &&
                  'type' in annotation &&
                  annotation.type === 'studio-blueprint',
              );
              const planBlueprint =
                rawPlan && typeof rawPlan === 'object' && 'blueprint' in rawPlan ? rawPlan.blueprint : undefined;

              if (isInternalBuild) {
                return null;
              }

              if (isInternalRepair) {
                return (
                  <div key={index} className="w-full my-2">
                    <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-mono shadow-sm">
                      <div className="i-ph:wrench-fill text-emerald-600 text-base animate-pulse shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-emerald-700">FortzAI Auto-Repair:</span> Diagnosing runtime
                        issue and automatically repairing code…
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={messageId || index}
                  className={classNames(styles.Turn, isUserMessage ? styles.UserTurn : undefined)}
                  data-message-role={role}
                >
                  {isUserMessage && (
                    <div className={styles.Avatar}>
                      {userPhoto ? (
                        <img
                          src={userPhoto}
                          alt={auth.user?.name || 'User'}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : auth.user?.name ? (
                        <div className="w-full h-full bg-[#10b981]/25 flex items-center justify-center text-emerald-300 font-extrabold text-xs">
                          {auth.user.name.charAt(0).toUpperCase()}
                        </div>
                      ) : (
                        <div className="i-ph:user-fill text-lg text-emerald-400"></div>
                      )}
                    </div>
                  )}
                  {!isUserMessage && (
                    <div className={classNames(styles.Avatar, styles.AgentAvatar)} aria-hidden="true">
                      <span className="i-ph:sparkle-fill text-base" />
                    </div>
                  )}
                  <div className={isUserMessage ? styles.UserBody : styles.MessageBody}>
                    {isUserMessage ? (
                      <>
                        <div className={classNames(styles.MessageMeta, styles.UserMeta)}>You</div>
                        <div className={styles.UserBubble}>
                          <UserMessage content={content} annotations={message.annotations} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={styles.MessageMeta}>
                          FortzAI{' '}
                          <span className={styles.Badge}>{isStreaming && isLast ? 'Working' : 'Assistant'}</span>
                        </div>
                        <AssistantMessage content={content} isStreaming={isStreaming && isLast} />
                        {planBlueprint !== undefined && (
                          <ParsedBlueprintCard
                            blueprint={planBlueprint}
                            canApprove={
                              harness.phase === 'awaiting-approval' && harness.blueprintMessageId === messageId
                            }
                            isApproving={
                              harness.phase === 'preparing-assets' && harness.blueprintMessageId === messageId
                            }
                            onApprove={props.onApprovePlan}
                            onReject={props.onCancelPlan}
                          />
                        )}
                        <ActivityTimeline messageId={messageId} isStreaming={isStreaming && isLast} />
                        <div className={styles.MessageActions}>
                          <WithTooltip tooltip="Revert to this message">
                            {messageId && (
                              <button
                                type="button"
                                aria-label="Revert to this message"
                                onClick={() => handleRewind(messageId)}
                                key="i-ph:arrow-u-up-left"
                                className={classNames(
                                  'i-ph:arrow-u-up-left',
                                  'text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors',
                                )}
                              />
                            )}
                          </WithTooltip>

                          <WithTooltip tooltip="Fork chat from this message">
                            <button
                              type="button"
                              aria-label="Fork chat from this message"
                              onClick={() => handleFork(messageId)}
                              key="i-ph:git-fork"
                              className={classNames(
                                'i-ph:git-fork',
                                'text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors',
                              )}
                            />
                          </WithTooltip>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          : null}
        {isStreaming && messages[messages.length - 1]?.role === 'user' && (
          <div className={styles.Turn}>
            <div className={classNames(styles.Avatar, styles.AgentAvatar)} aria-hidden="true">
              <span className="i-ph:sparkle-fill" />
            </div>
            <div className={styles.MessageBody}>
              <ActivityTimeline isStreaming />
            </div>
          </div>
        )}
      </div>
      {showJump && (
        <button
          type="button"
          className={styles.JumpToLatest}
          onClick={() => {
            followingRef.current = true;
            setShowJump(false);
            followLatest();
          }}
        >
          <span className="i-ph:arrow-down" aria-hidden="true" /> Jump to latest
        </button>
      )}
    </div>
  );
});

import type { Message } from 'ai';
import React from 'react';
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

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
}

export const Messages = React.forwardRef<HTMLDivElement, MessagesProps>((props: MessagesProps, ref) => {
  const { id, isStreaming = false, messages = [] } = props;
  const location = useLocation();
  const auth = useStore(authStore);
  const userPhoto = auth.user?.prefs?.photoURL || auth.user?.photoURL;

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
    <div id={id} ref={ref} className={props.className}>
      {messages.length > 0
        ? messages.map((message, index) => {
            const { role, content, id: messageId } = message;
            const isUserMessage = role === 'user';
            const isFirst = index === 0;
            const isLast = index === messages.length - 1;

            return (
              <div
                key={index}
                className={classNames('flex gap-3 sm:gap-4 p-3.5 sm:p-4.5 w-full rounded-none border border-white/5 transition-all', {
                  'bg-[#0b121e] border-l-4 border-l-[#10b981]': isUserMessage,
                  'bg-[#0d1626] border-l-4 border-l-[#8b5cf6] shadow-sm': !isUserMessage && (!isStreaming || (isStreaming && !isLast)),
                  'bg-gradient-to-b from-[#0d1626] from-30% to-transparent border-l-4 border-l-[#8b5cf6]':
                    isStreaming && isLast,
                  'mt-3': !isFirst,
                })}
              >
                {isUserMessage && (
                  <div className="flex items-center justify-center w-[34px] h-[34px] overflow-hidden bg-[#060910] text-gray-300 rounded-none shrink-0 self-start border border-[#10b981]/40 shadow-sm">
                    {userPhoto ? (
                      <img
                        src={userPhoto}
                        alt={auth.user?.name || 'User'}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : auth.user?.name ? (
                      <div className="w-full h-full bg-[#10b981] flex items-center justify-center text-black font-extrabold text-xs">
                        {auth.user.name.charAt(0).toUpperCase()}
                      </div>
                    ) : (
                      <div className="i-ph:user-fill text-xl text-emerald-400"></div>
                    )}
                  </div>
                )}
                <div className="grid grid-col-1 w-full">
                  {isUserMessage ? <UserMessage content={content} /> : <AssistantMessage content={content} />}
                </div>
                {!isUserMessage && (
                  <div className="flex gap-2 flex-col lg:flex-row">
                    <WithTooltip tooltip="Revert to this message">
                      {messageId && (
                        <button
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
                        onClick={() => handleFork(messageId)}
                        key="i-ph:git-fork"
                        className={classNames(
                          'i-ph:git-fork',
                          'text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors',
                        )}
                      />
                    </WithTooltip>
                  </div>
                )}
              </div>
            );
          })
        : null}
      {isStreaming && (
        <div className="text-center w-full text-bolt-elements-textSecondary i-svg-spinners:3-dots-fade text-4xl mt-4"></div>
      )}
    </div>
  );
});

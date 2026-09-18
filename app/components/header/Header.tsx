import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { PublishButton } from './PublishButton.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames('flex items-center p-5 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
        <a href="/" className="flex items-center gap-2.5 group">
          <img
            src="/thefortztext.png"
            alt="THEFORTZ"
            className="h-[28px] w-auto object-contain drop-shadow-[0_2px_12px_rgba(56,189,248,0.45)] group-hover:scale-105 transition-transform"
          />
          <span className="text-[11px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-600/30 to-purple-600/30 border border-blue-400/40 text-blue-300">
            Studio
          </span>
        </a>
      </div>
      {chat.started && (
        <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
          <ClientOnly>{() => <ChatDescription />}</ClientOnly>
        </span>
      )}
      <div className="ml-auto flex items-center gap-2 z-10">
        <ClientOnly>{() => <PublishButton />}</ClientOnly>
        {chat.started && (
          <ClientOnly>
            {() => (
              <div className="mr-1">
                <HeaderActionButtons />
              </div>
            )}
          </ClientOnly>
        )}
      </div>
    </header>
  );
}

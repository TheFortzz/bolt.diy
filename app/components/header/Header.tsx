import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { PublishButton } from './PublishButton.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header className="flex items-center h-[43.8px] w-full select-none z-50 bg-[#1730b8] border-b border-white/20 p-0 overflow-hidden">
      {/* 1. Purple Section — THEFORTZ text branding */}
      <div
        className="flex items-center gap-2.5 h-full px-4 pr-7 flex-shrink-0 z-30"
        style={{
          background: 'rgb(131, 64, 237)',
          clipPath: 'polygon(0 0, calc(100% - 14px) 0, 100% 100%, 0 100%)',
        }}
      >
        <div className="i-ph:sidebar-simple-duotone text-lg text-white cursor-pointer hover:opacity-80" />
        <a
          href="https://thefortz.me"
          className="text-white hover:text-sky-200 transition-colors uppercase font-extrabold tracking-wider"
          style={{
            fontFamily: "'Lilita One', 'Anton', sans-serif",
            fontSize: '20px',
            letterSpacing: '0.04em',
            textDecoration: 'none',
          }}
        >
          THEFORTZ
        </a>
      </div>

      {/* 2. Orange Section — Navigation Buttons */}
      <div
        className="flex items-center gap-3 h-full px-5 pr-8 flex-shrink-0 z-20 -ml-[14px]"
        style={{
          background: 'linear-gradient(rgb(226, 110, 3) 0%, rgb(215, 100, 0) 55%, rgb(229, 100, 0) 100%)',
          clipPath: 'polygon(0 0, calc(100% - 14px) 0, 100% 100%, 0 100%)',
        }}
      >
        <a
          href="https://thefortz.me"
          className="text-white hover:text-blue-900 transition-colors uppercase font-bold text-[14px] flex items-center gap-1"
          style={{
            fontFamily: "'Lilita One', cursive, sans-serif",
            letterSpacing: '0.03em',
            textDecoration: 'none',
          }}
        >
          ← BACK TO GAMES
        </a>
        <a
          href="/"
          className="text-white hover:text-blue-900 transition-colors uppercase font-bold text-[14px] flex items-center gap-1 ml-2"
          style={{
            fontFamily: "'Lilita One', cursive, sans-serif",
            letterSpacing: '0.03em',
            textDecoration: 'none',
          }}
        >
          + NEW CHAT
        </a>
      </div>

      {/* 3. Green Section — Actions & Publish Button */}
      <div
        className="flex-1 flex items-center justify-between h-full px-4 -ml-[14px] z-10"
        style={{
          background: 'linear-gradient(rgb(46, 153, 0) 0%, rgb(1, 161, 19) 55%, rgb(5, 121, 0) 100%)',
          clipPath: 'polygon(0 0, 100% 0, 100% 100%, 14px 100%)',
        }}
      >
        <div className="flex-1 px-4 truncate text-center text-white font-semibold text-sm">
          {chat.started && <ClientOnly>{() => <ChatDescription />}</ClientOnly>}
        </div>
        <div className="ml-auto flex items-center gap-3">
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
      </div>
    </header>
  );
}

import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className="flex items-center h-[43.8px] w-full select-none z-50 border-b border-white/15 p-0 overflow-hidden"
      style={{
        background: 'linear-gradient(rgb(0 248 255) 0%, rgb(0 244 255) 55%, rgb(0 247 255) 100%)',
      }}
    >
      {/* Left side — logo text */}
      <div className="flex items-center gap-2.5 h-full px-5 flex-shrink-0">
        <a
          href="https://thefortz.me"
          className="text-[#0a1628] hover:text-[#1730b8] transition-colors uppercase font-extrabold tracking-wider"
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

      {/* Center — Chat description */}
      <div className="flex-1 px-4 truncate text-center text-[#0a1628] font-semibold text-sm">
        {chat.started && <ClientOnly>{() => <ChatDescription />}</ClientOnly>}
      </div>

      {/* Right side — action buttons */}
      <div className="flex items-center gap-3 px-4">
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

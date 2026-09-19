import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { SettingsWindow } from '~/components/settings/SettingsWindow';
import { SettingsButton } from '~/components/ui/SettingsButton';
import { db, deleteById, getAll, chatId, type ChatHistoryItem, useChatHistory } from '~/lib/persistence';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';
import { HistoryItem } from './HistoryItem';
import { binDates } from './date-binning';
import { useSearchFilter } from '~/lib/hooks/useSearchFilter';

const menuVariants = {
  closed: {
    opacity: 0,
    width: 0,
    x: -260,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    width: 260,
    x: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

type DialogContent = { type: 'delete'; item: ChatHistoryItem } | null;

export const Menu = () => {
  const { duplicateCurrentChat, exportChat } = useChatHistory();
  const menuRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<ChatHistoryItem[]>([]);
  // Always open all the time like Claude and ChatGPT
  const [open, setOpen] = useState(true);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [fortzBalance, setFortzBalance] = useState<number>(() => {
    if (typeof window === 'undefined') return 100;
    const saved = localStorage.getItem('thefortz_fortz_balance');
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      return isNaN(parsed) ? 100 : parsed;
    }
    return 100;
  });

  useEffect(() => {
    const handleUpdate = () => {
      const saved = localStorage.getItem('thefortz_fortz_balance');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) setFortzBalance(parsed);
      }
    };
    window.addEventListener('storage', handleUpdate);
    window.addEventListener('thefortz-balance-updated', handleUpdate);
    return () => {
      window.removeEventListener('storage', handleUpdate);
      window.removeEventListener('thefortz-balance-updated', handleUpdate);
    };
  }, []);

  const { filteredItems: filteredList, handleSearchChange } = useSearchFilter({
    items: list,
    searchFields: ['description'],
  });

  const loadEntries = useCallback(() => {
    if (db) {
      getAll(db)
        .then((list) => list.filter((item) => item.urlId && item.description))
        .then(setList)
        .catch((error) => toast.error(error.message));
    }
  }, []);

  const deleteItem = useCallback((event: React.UIEvent, item: ChatHistoryItem) => {
    event.preventDefault();

    if (db) {
      deleteById(db, item.id)
        .then(() => {
          loadEntries();

          if (chatId.get() === item.id) {
            window.location.pathname = '/';
          }
        })
        .catch((error) => {
          toast.error('Failed to delete conversation');
          logger.error(error);
        });
    }
  }, []);

  const closeDialog = () => {
    setDialogContent(null);
  };

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleDeleteClick = (event: React.UIEvent, item: ChatHistoryItem) => {
    event.preventDefault();
    setDialogContent({ type: 'delete', item });
  };

  const handleDuplicate = async (id: string) => {
    await duplicateCurrentChat(id);
    loadEntries();
  };

  return (
    <>
      {/* Floating expand button if user ever closes the sidebar */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed top-3 left-3 z-50 p-2 rounded-md bg-[#162a9c] hover:bg-[#1d37ba] text-white border border-white/20 shadow-md transition-all flex items-center justify-center cursor-pointer"
          title="Open Sidebar"
        >
          <div className="i-ph:sidebar-simple-duotone text-lg" />
        </button>
      )}

      <motion.div
        ref={menuRef}
        initial="open"
        animate={open ? 'open' : 'closed'}
        variants={menuVariants}
        style={{ borderRadius: 0 }}
        className="flex selection-accent flex-col side-menu fixed top-0 left-0 w-[260px] h-full bg-[#162a9c] border-r border-white/15 z-sidebar shadow-2xl text-sm overflow-hidden"
      >
        {/* ── Top Header Brand ── */}
        <div className="flex items-center justify-between px-3.5 py-3 border-b border-white/10 bg-[#101e74]">
          <a
            href="https://thefortz.me"
            className="flex items-center gap-2 text-white hover:text-cyan-300 transition-colors no-underline select-none"
            title="Return to TheFortz platform"
          >
            <span
              className="text-lg font-black tracking-wider uppercase text-cyan-300"
              style={{ fontFamily: "'Lilita One', 'Anton', sans-serif" }}
            >
              THEFORTZ
            </span>
            <span className="text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded bg-cyan-400/20 text-cyan-300 border border-cyan-400/30">
              STUDIO
            </span>
          </a>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Collapse Sidebar"
          >
            <div className="i-ph:sidebar-simple-duotone text-base" />
          </button>
        </div>

        {/* ── Action Buttons: Create, Created Projects, Analytics ── */}
        <div className="p-3 pb-1 flex flex-col gap-1.5 select-none">
          {/* Create Button */}
          <a
            href="/"
            className="flex items-center justify-center gap-2 bg-[#e26e03] hover:bg-[#f97316] text-white font-extrabold text-xs uppercase tracking-wider py-2 px-3 rounded-md transition-all shadow-md active:translate-y-0.5 no-underline"
          >
            <div className="i-ph:plus-bold text-sm" />
            <span>Create New Game</span>
          </a>

          {/* Analytics Button */}
          <button
            onClick={() => setIsAnalyticsOpen(true)}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white/90 font-bold text-xs py-1.5 px-3 rounded-md transition-all border border-white/15 cursor-pointer mt-1"
          >
            <div className="i-ph:chart-bar-fill text-cyan-300 text-sm" />
            <span>Studio Analytics</span>
          </button>

          {/* Fortz Balance Card */}
          <div className="mt-1 p-2 rounded-md bg-[#101e74] border border-white/10 flex items-center justify-between text-xs shadow-inner">
            <div className="flex items-center gap-1.5">
              <span className="text-base">🪙</span>
              <div className="flex flex-col leading-tight">
                <span className="text-[9px] uppercase font-bold text-cyan-300/80 tracking-wider">Fortz Balance</span>
                <span className="font-extrabold text-yellow-300 text-xs" style={{ fontFamily: "'Lilita One', Anton, sans-serif" }}>
                  {fortzBalance.toLocaleString()} FORTZ
                </span>
              </div>
            </div>
            <a
              href="https://thefortz.me"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-400/40 hover:bg-yellow-500/30 transition-all no-underline"
              title="Refill Fortz balance on TheFortz"
            >
              Refill ↗
            </a>
          </div>
        </div>

        {/* ── Search Chats ── */}
        <div className="px-3 my-1.5">
          <div className="relative w-full">
            <input
              className="w-full bg-[#101e74] text-white placeholder-blue-200/50 text-xs px-2.5 py-1.5 rounded-md border border-white/15 focus:outline-none focus:border-cyan-400 transition-all"
              type="search"
              placeholder="Search projects..."
              onChange={handleSearchChange}
              aria-label="Search projects"
            />
          </div>
        </div>

        {/* ── Section Title: Created Projects ── */}
        <div className="flex items-center justify-between px-3.5 pt-2 pb-1 text-xs font-bold text-blue-200/80 uppercase tracking-wider select-none">
          <div className="flex items-center gap-1.5">
            <div className="i-ph:folder-fill text-yellow-400 text-sm" />
            <span>Created Projects</span>
          </div>
          <span className="text-[11px] font-semibold bg-white/15 px-1.5 py-0.2 rounded text-white">
            {list.length}
          </span>
        </div>

        {/* ── Projects / History List ── */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
          {filteredList.length === 0 && (
            <div className="p-3 text-center text-xs text-blue-200/60 italic">
              {list.length === 0 ? 'No projects created yet. Start one above!' : 'No matching projects found.'}
            </div>
          )}
          <DialogRoot open={dialogContent !== null}>
            {binDates(filteredList).map(({ category, items }) => (
              <div key={category} className="mt-3 first:mt-1 space-y-1">
                <div className="text-[11px] font-bold text-blue-200/50 uppercase tracking-wider sticky top-0 z-1 bg-[#162a9c] px-2 py-0.5">
                  {category}
                </div>
                {items.map((item) => (
                  <HistoryItem
                    key={item.id}
                    item={item}
                    exportChat={exportChat}
                    onDelete={(event) => handleDeleteClick(event, item)}
                    onDuplicate={() => handleDuplicate(item.id)}
                  />
                ))}
              </div>
            ))}
            <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
              {dialogContent?.type === 'delete' && (
                <>
                  <DialogTitle>Delete Project?</DialogTitle>
                  <DialogDescription asChild>
                    <div>
                      <p>
                        You are about to delete <strong>{dialogContent.item.description}</strong>.
                      </p>
                      <p className="mt-1">Are you sure you want to permanently delete this project?</p>
                    </div>
                  </DialogDescription>
                  <div className="px-5 pb-4 bg-[#162a9c] flex gap-2 justify-end">
                    <DialogButton type="secondary" onClick={closeDialog}>
                      Cancel
                    </DialogButton>
                    <DialogButton
                      type="danger"
                      onClick={(event) => {
                        deleteItem(event, dialogContent.item);
                        closeDialog();
                      }}
                    >
                      Delete
                    </DialogButton>
                  </div>
                </>
              )}
            </Dialog>
          </DialogRoot>
        </div>

        {/* ── Bottom Section: Login/Signup, Settings, Theme ── */}
        <div className="border-t border-white/10 bg-[#101e74] p-2.5 flex flex-col gap-2 select-none">
          {/* Login / Sign Up */}
          <button
            onClick={() => setIsAuthModalOpen(true)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-semibold text-white transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-cyan-400 flex items-center justify-center text-[#101e74] font-black text-[10px]">
                F
              </div>
              <span>Login / Sign Up</span>
            </div>
            <div className="i-ph:arrow-square-out text-white/50 text-xs" />
          </button>

          <div className="flex items-center justify-between pt-0.5">
            <button
              onClick={() => {
                setSettingsTab('providers');
                setIsSettingsOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white transition-colors cursor-pointer py-1 px-1.5 rounded hover:bg-white/10"
              title="Configure AI Providers"
            >
              <div className="i-ph:gear-six text-base text-cyan-300" />
              <span>Settings</span>
            </button>
            <ThemeSwitch />
          </div>
        </div>
      </motion.div>

      {/* ── Settings Window ── */}
      <SettingsWindow
        open={isSettingsOpen}
        initialTab={settingsTab}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* ── Studio Analytics Modal ── */}
      {isAnalyticsOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsAnalyticsOpen(false)}
        >
          <div
            className="w-full max-w-md bg-[#162a9c] border border-white/30 rounded-xl p-6 text-white shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/15 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="i-ph:chart-bar-fill text-2xl text-cyan-400" />
                <h3 className="font-extrabold text-lg uppercase tracking-wider font-['Anton',sans-serif]">
                  Studio Analytics
                </h3>
              </div>
              <button
                onClick={() => setIsAnalyticsOpen(false)}
                className="text-white/70 hover:text-white px-2 py-1 text-sm rounded border border-transparent hover:border-white/20 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-3 bg-[#101e74] rounded-lg border border-white/15">
                <div className="text-[11px] text-blue-200/70 uppercase font-semibold">Total Projects</div>
                <div className="text-2xl font-black text-cyan-300 mt-0.5">{list.length}</div>
              </div>
              <div className="p-3 bg-[#101e74] rounded-lg border border-white/15">
                <div className="text-[11px] text-blue-200/70 uppercase font-semibold">Engine Runtime</div>
                <div className="text-sm font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Online
                </div>
              </div>
              <div className="p-3 bg-[#101e74] rounded-lg border border-white/15">
                <div className="text-[11px] text-blue-200/70 uppercase font-semibold">Default AI Model</div>
                <div className="text-xs font-bold text-white mt-1 truncate" title="Azure Fortz AI (gpt-oss-120b)">
                  gpt-oss-120b
                </div>
              </div>
              <div className="p-3 bg-[#101e74] rounded-lg border border-white/15">
                <div className="text-[11px] text-blue-200/70 uppercase font-semibold">Cloud Sync</div>
                <div className="text-xs font-bold text-cyan-300 mt-1 flex items-center gap-1">
                  <span>✓</span> Appwrite Live
                </div>
              </div>
            </div>

            <p className="text-xs text-blue-200/80 leading-relaxed mb-4">
              All games packaged and published here automatically sync to the public TheFortz feed for players worldwide.
            </p>

            <button
              onClick={() => setIsAnalyticsOpen(false)}
              className="w-full py-2 bg-[#e26e03] hover:bg-[#d76400] text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
            >
              Close Analytics
            </button>
          </div>
        </div>
      )}

      {/* ── Login / Sign Up Modal ── */}
      {isAuthModalOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsAuthModalOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-[#162a9c] border border-white/30 rounded-xl p-6 text-white shadow-2xl relative text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-500 mx-auto flex items-center justify-center text-xl text-white font-black mb-3">
              F
            </div>
            <h3 className="font-extrabold text-lg uppercase tracking-wider font-['Anton',sans-serif] mb-1">
              THEFORTZ Creator Account
            </h3>
            <p className="text-xs text-blue-200/80 mb-5 leading-relaxed">
              Sign in on TheFortz to publish games, gain followers, track player plays, and earn creator rewards.
            </p>

            <div className="flex flex-col gap-2.5">
              <a
                href="https://thefortz.me"
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-all no-underline block"
              >
                Open TheFortz Login
              </a>
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="w-full py-2 px-4 bg-white/10 hover:bg-white/20 text-white/80 font-semibold text-xs rounded-lg transition-all cursor-pointer"
              >
                Stay Guest
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

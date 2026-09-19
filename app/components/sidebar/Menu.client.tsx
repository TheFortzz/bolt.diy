import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { SettingsWindow } from '~/components/settings/SettingsWindow';
import { SettingsButton } from '~/components/ui/SettingsButton';
import { db, dbPromise, deleteById, getAll, chatId, type ChatHistoryItem, useChatHistory } from '~/lib/persistence';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';
import { HistoryItem } from './HistoryItem';
import { binDates } from './date-binning';
import { useSearchFilter } from '~/lib/hooks/useSearchFilter';

import { useStore } from '@nanostores/react';
import { isSidebarOpen } from '~/lib/stores/sidebar';
import { workbenchStore } from '~/lib/stores/workbench';
import { authStore, isAuthModalOpen, appwriteLogout } from '~/lib/auth/appwrite';

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
  const open = useStore(isSidebarOpen);
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const auth = useStore(authStore);

  // Auto-collapse sidebar when AI opens workbench box
  useEffect(() => {
    if (showWorkbench) {
      isSidebarOpen.set(false);
    }
  }, [showWorkbench]);

  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'chat-history' | 'providers' | 'features' | 'debug' | 'connection'>('providers');
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
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
    } else {
      dbPromise.then((database) => {
        if (database) {
          getAll(database)
            .then((list) => list.filter((item) => item.urlId && item.description))
            .then(setList)
            .catch((error) => toast.error(error.message));
        }
      });
    }
  }, []);

  const deleteItem = useCallback(async (event: React.UIEvent, item: ChatHistoryItem) => {
    event.preventDefault();

    const activeDb = db || (await dbPromise);
    if (activeDb) {
      deleteById(activeDb, item.id)
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
  }, [loadEntries]);

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
          onClick={() => isSidebarOpen.set(true)}
          className="fixed top-3 left-3 z-50 p-2.5 rounded-xl bg-[#162a9c]/90 hover:bg-[#1d37ba] text-cyan-300 hover:text-white border border-cyan-400/40 shadow-xl backdrop-blur-md transition-all flex items-center justify-center cursor-pointer active:scale-95"
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
            className="flex items-center gap-2.5 text-white hover:text-cyan-300 transition-colors no-underline select-none"
            title="Return to TheFortz platform"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-xs font-black text-white shadow-md">
              F
            </div>
            <span
              className="text-xl lowercase tracking-tight text-cyan-300"
              style={{
                fontFamily: "'Kabel', 'Syne', 'Outfit', sans-serif",
                fontWeight: 900,
                letterSpacing: '-0.03em',
                textShadow: '0 2px 12px rgba(0, 248, 255, 0.4)',
              }}
            >
              fortzstudio
            </span>
          </a>
          <button
            onClick={() => isSidebarOpen.set(false)}
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
          {auth.user ? (
            <div className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white">
              <div className="flex items-center gap-2 overflow-hidden">
                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-white font-black text-[11px] flex-shrink-0">
                  {auth.user.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold truncate text-white leading-tight">
                    {auth.user.name}
                  </span>
                  <span className="text-[10px] text-blue-200/60 truncate leading-tight">
                    {auth.user.email}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  appwriteLogout();
                  toast.info('Signed out of THEFORTZ');
                }}
                className="p-1 rounded text-white/60 hover:text-rose-300 hover:bg-white/10 transition-all cursor-pointer flex-shrink-0"
                title="Sign out of Appwrite"
              >
                <div className="i-ph:sign-out-bold text-sm" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => isAuthModalOpen.set(true)}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-600/20 hover:from-cyan-500/30 hover:to-blue-600/30 border border-cyan-400/40 text-xs font-bold text-cyan-300 hover:text-white transition-all cursor-pointer shadow-sm"
            >
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-cyan-400 flex items-center justify-center text-[#101e74] font-black text-[10px]">
                  F
                </div>
                <span>Sign In / Register</span>
              </div>
              <div className="i-ph:arrow-square-out text-cyan-300 text-xs" />
            </button>
          )}

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
    </>
  );
};


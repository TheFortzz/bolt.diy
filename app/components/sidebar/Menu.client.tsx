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
      duration: 0.12,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    width: 260,
    x: 0,
    transition: {
      duration: 0.12,
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
          className="fixed top-3 left-3 z-50 p-2.5 rounded-none bg-[#182238] hover:bg-[#202c48] text-sky-400 hover:text-white border border-[#38bdf8]/40 backdrop-blur-md transition-all flex items-center justify-center cursor-pointer active:scale-95"
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
        className="flex selection-accent flex-col side-menu fixed top-0 left-0 w-[260px] h-full bg-[#141b2d] border-r border-[#38bdf8]/25 z-sidebar text-sm overflow-hidden"
      >
        {/* ── Top Header Brand ── */}
        <div className="flex items-center justify-between px-3.5 py-3 border-b border-[#38bdf8]/20 bg-[#182238]" style={{ borderRadius: 0 }}>
          <a
            href="https://thefortz.me"
            className="flex items-center gap-2 text-white hover:text-sky-300 transition-colors no-underline select-none"
            title="Return to TheFortz platform"
          >
            <div className="w-7 h-7 bg-[#202c48] border border-[#38bdf8]/40 flex items-center justify-center" style={{ borderRadius: 0 }}>
              <img
                src="/thefortzicon.png"
                alt="TheFortz"
                className="w-5 h-5 object-contain"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
            <span
              className="text-xl lowercase tracking-tight text-[#38bdf8]"
              style={{
                fontFamily: "'Kabel', 'Syne', 'Outfit', sans-serif",
                fontWeight: 900,
                letterSpacing: '-0.03em',
              }}
            >
              studio
            </span>
            <span className="text-[9px] uppercase font-black px-1.5 py-0.5 bg-orange-500/20 text-orange-400 border border-orange-400/40" style={{ borderRadius: 0 }}>
              IDE
            </span>
          </a>
          <button
            onClick={() => isSidebarOpen.set(false)}
            className="p-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            style={{ borderRadius: 0 }}
            title="Collapse Sidebar"
          >
            <div className="i-ph:sidebar-simple-duotone text-base" />
          </button>
        </div>

        {/* ── Action Buttons: Create, Analytics ── */}
        <div className="p-3 pb-1 flex flex-col gap-1.5 select-none">
          {/* Create Button — Vibrant Replit Orange */}
          <a
            href="/"
            style={{ borderRadius: 0 }}
            className="flex items-center justify-center gap-2 bg-[#f97316] hover:bg-[#ea580c] text-white font-black text-xs uppercase tracking-wider py-2 px-3 transition-all border border-orange-400/40 active:translate-y-0.5 no-underline"
          >
            <div className="i-ph:plus-bold text-sm" />
            <span>Create New Game</span>
          </a>

          {/* Analytics Button */}
          <button
            onClick={() => setIsAnalyticsOpen(true)}
            style={{ borderRadius: 0 }}
            className="flex items-center gap-2 bg-[#1a233a] hover:bg-[#222e4c] text-sky-400 font-bold text-xs py-1.5 px-3 transition-all border border-[#38bdf8]/30 cursor-pointer mt-1"
          >
            <div className="i-ph:chart-bar-fill text-sky-400 text-sm" />
            <span>Studio Analytics</span>
          </button>
        </div>

        {/* ── Search Chats ── */}
        <div className="px-3 my-1.5">
          <div className="relative w-full">
            <input
              style={{ borderRadius: 0 }}
              className="w-full bg-[#182238] text-white placeholder-slate-400 text-xs px-2.5 py-1.5 border border-white/15 focus:outline-none focus:border-[#38bdf8] transition-all font-mono"
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
                <div className="text-[11px] font-bold text-emerald-400/80 uppercase tracking-wider sticky top-0 z-1 bg-[#0d1117] border-b border-white/5 px-2 py-0.5">
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
                  <div className="px-5 pb-4 bg-[#0e1422] flex gap-2 justify-end">
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
        <div className="border-t border-emerald-500/20 bg-[#121824] p-2.5 flex flex-col gap-2 select-none" style={{ borderRadius: 0 }}>
          {auth.user ? (
            <div className="w-full flex items-center justify-between px-2.5 py-2 bg-[#161f30] border border-emerald-500/30 text-xs text-white" style={{ borderRadius: 0 }}>
              <div className="flex items-center gap-2 overflow-hidden">
                {/* Avatar */}
                {auth.user.prefs?.photoURL || auth.user.photoURL ? (
                  <img
                    src={auth.user.prefs?.photoURL || auth.user.photoURL}
                    alt={auth.user.name}
                    className="w-7 h-7 object-cover flex-shrink-0 border border-emerald-400"
                    style={{ borderRadius: 0 }}
                    onError={(e) => {
                      const el = e.currentTarget as HTMLImageElement;
                      el.style.display = 'none';
                      const next = el.nextElementSibling as HTMLElement | null;
                      if (next) next.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className="w-7 h-7 bg-gradient-to-tr from-emerald-500 to-purple-600 flex items-center justify-center text-white font-black text-[11px] flex-shrink-0"
                  style={{ borderRadius: 0, display: (auth.user.prefs?.photoURL || auth.user.photoURL) ? 'none' : 'flex' }}
                >
                  {auth.user.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-400 animate-pulse flex-shrink-0" />
                    <span className="font-bold truncate text-white leading-tight">
                      {auth.user.name}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 truncate leading-tight font-mono">
                    {auth.user.email}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  appwriteLogout();
                  toast.info('Signed out of THEFORTZ');
                }}
                className="p-1 text-white/60 hover:text-rose-400 hover:bg-white/10 transition-all cursor-pointer flex-shrink-0"
                style={{ borderRadius: 0 }}
                title="Sign out"
              >
                <div className="i-ph:sign-out-bold text-sm" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                  window.parent.postMessage({ type: 'thefortz-open-login' }, '*');
                }
                isAuthModalOpen.set(true);
              }}
              style={{ borderRadius: 0 }}
              className="w-full flex items-center justify-between px-2.5 py-2 bg-gradient-to-r from-emerald-900/50 via-purple-900/40 to-orange-900/40 hover:from-emerald-800/60 hover:to-orange-800/50 border border-emerald-500/50 text-xs font-bold text-emerald-300 hover:text-white transition-all cursor-pointer shadow-sm"
            >
              <div className="flex items-center gap-2">
                <div className="i-ph:user-circle-bold text-lg text-emerald-400" />
                <span>Sign In / Register</span>
              </div>
              <div className="i-ph:arrow-square-out text-emerald-400 text-xs" />
            </button>
          )}

          <div className="flex items-center justify-between pt-0.5">
            <button
              onClick={() => {
                setSettingsTab('providers');
                setIsSettingsOpen(true);
              }}
              style={{ borderRadius: 0 }}
              className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors cursor-pointer py-1 px-1.5 hover:bg-white/10"
              title="Configure AI Providers"
            >
              <div className="i-ph:gear-six text-base text-emerald-400" />
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
            className="w-full max-w-md bg-[#0e1422] border border-[#10b981]/40 rounded-none p-6 text-white shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/15 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="i-ph:chart-bar-fill text-2xl text-emerald-400" />
                <h3 className="font-extrabold text-lg uppercase tracking-wider text-emerald-400 font-['Anton',sans-serif]">
                  Studio Analytics
                </h3>
              </div>
              <button
                onClick={() => setIsAnalyticsOpen(false)}
                className="text-white/70 hover:text-white px-2 py-1 text-sm rounded-none border border-transparent hover:border-white/20 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-3 bg-[#060910] rounded-none border border-white/10">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Projects</div>
                <div className="text-2xl font-black text-emerald-400 mt-0.5">{list.length}</div>
              </div>
              <div className="p-3 bg-[#060910] rounded-none border border-white/10">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Engine Runtime</div>
                <div className="text-sm font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Online
                </div>
              </div>
              <div className="p-3 bg-[#060910] rounded-none border border-white/10">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Default AI Model</div>
                <div className="text-xs font-bold text-white mt-1 truncate" title="Azure Fortz AI (gpt-oss-120b)">
                  gpt-oss-120b
                </div>
              </div>
              <div className="p-3 bg-[#060910] rounded-none border border-white/10">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Cloud Sync</div>
                <div className="text-xs font-bold text-emerald-400 mt-1 flex items-center gap-1">
                  <span>✓</span> Appwrite Live
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              All games packaged and published here automatically sync to the public TheFortz feed for players worldwide.
            </p>

            <button
              onClick={() => setIsAnalyticsOpen(false)}
              className="w-full py-2 bg-[#f97316] hover:bg-[#ea580c] text-white font-bold text-xs uppercase tracking-wider rounded-none transition-all cursor-pointer"
            >
              Close Analytics
            </button>
          </div>
        </div>
      )}
    </>
  );
};


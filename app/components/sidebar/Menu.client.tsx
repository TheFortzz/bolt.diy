import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { SettingsWindow } from '~/components/settings/SettingsWindow';
import { db, dbPromise, deleteById, getAll, chatId, type ChatHistoryItem, useChatHistory } from '~/lib/persistence';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';
import { HistoryItem } from './HistoryItem';
import { binDates } from './date-binning';
import { useStore } from '@nanostores/react';
import { isSidebarOpen, isGalleryOpen } from '~/lib/stores/sidebar';
import { workbenchStore } from '~/lib/stores/workbench';
import { authStore, isAuthModalOpen, appwriteLogout } from '~/lib/auth/appwrite';

const menuVariants = {
  closed: {
    width: 54,
    x: 0,
    opacity: 1,
    transition: {
      duration: 0.15,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 200,
    x: 0,
    opacity: 1,
    transition: {
      duration: 0.15,
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

  // Auto-collapse sidebar to slim rail when AI opens workbench box
  useEffect(() => {
    if (showWorkbench) {
      isSidebarOpen.set(false);
    }
  }, [showWorkbench]);

  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'chat-history' | 'providers' | 'features' | 'debug' | 'connection'>('providers');
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);

  const loadEntries = useCallback(() => {
    if (db) {
      getAll(db)
        .then((items) => items.filter((item) => item.urlId && item.description))
        .then(setList)
        .catch((error) => toast.error(error.message));
    } else {
      dbPromise.then((database) => {
        if (database) {
          getAll(database)
            .then((items) => items.filter((item) => item.urlId && item.description))
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

  const rawAvatarUrl = auth.user?.prefs?.photoURL || auth.user?.photoURL;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const isBrokenAvatar = !rawAvatarUrl || rawAvatarUrl.includes('ACg8ocI7E0sGHKxAEMLVFYsJCbtuiNchyDJ') || rawAvatarUrl.includes('/avatars/initials');
  const avatarUrl = isBrokenAvatar || avatarFailed ? '' : rawAvatarUrl;

  return (
    <>
      <motion.div
        ref={menuRef}
        initial={open ? 'open' : 'closed'}
        animate={open ? 'open' : 'closed'}
        variants={menuVariants}
        style={{ borderRadius: 0 }}
        className="flex selection-accent flex-col side-menu fixed top-0 left-0 h-full bg-[#14243b] border-r border-[#38bdf8]/30 z-sidebar text-xs overflow-hidden select-none"
      >
        {/* ── Top Header Brand / Toggle ── */}
        <div
          className={`flex items-center border-b border-[#38bdf8]/25 bg-[#1a3050] transition-all ${
            open ? 'justify-between px-3 py-2.5' : 'justify-center p-2'
          }`}
          style={{ borderRadius: 0, height: 42 }}
        >
          {open ? (
            <>
              <a
                href="/"
                className="flex items-center text-slate-200 hover:text-white transition-colors no-underline select-none"
                title="Studio"
              >
                <span className="text-sm font-normal tracking-wide text-slate-200">
                  Studio
                </span>
              </a>
              <button
                onClick={() => isSidebarOpen.set(false)}
                className="p-1 text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                style={{ borderRadius: 0 }}
                title="Collapse to icons"
              >
                <div className="i-ph:sidebar-simple-duotone text-base text-[#38bdf8]" />
              </button>
            </>
          ) : (
            <button
              onClick={() => isSidebarOpen.set(true)}
              className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              style={{ borderRadius: 0 }}
              title="Expand Sidebar"
            >
              <div className="i-ph:sidebar-simple-duotone text-lg text-[#38bdf8]" />
            </button>
          )}
        </div>

        {/* ── Action Buttons: New Game, Gallery, Analytics ── */}
        <div className={`flex flex-col gap-1.5 ${open ? 'p-2' : 'p-1.5 items-center'}`}>
          {/* New Game Button */}
          <a
            href="/"
            style={{ borderRadius: 0 }}
            title="Create New Game"
            className={`transition-all active:translate-y-0.5 no-underline flex items-center justify-center bg-[#f97316] hover:bg-[#ea580c] text-white font-bold border border-orange-400/40 ${
              open ? 'py-1.5 px-2 gap-1.5 text-xs' : 'w-9 h-9'
            }`}
          >
            <div className="i-ph:plus-bold text-sm" />
            {open && <span>New Game</span>}
          </a>

          {/* Community Games Gallery Button */}
          <button
            type="button"
            onClick={() => isGalleryOpen.set(true)}
            style={{ borderRadius: 0 }}
            title="Explore Community Games Gallery"
            className={`transition-all flex items-center justify-center bg-[#1a3050] hover:bg-[#213d66] text-sky-300 hover:text-white font-bold border border-[#38bdf8]/35 cursor-pointer ${
              open ? 'py-1.5 px-2 gap-1.5 text-xs' : 'w-9 h-9'
            }`}
          >
            <div className="i-ph:game-controller-fill text-sm text-[#38bdf8]" />
            {open && <span>Gallery</span>}
          </button>

          {/* Analytics Button */}
          <button
            type="button"
            onClick={() => setIsAnalyticsOpen(true)}
            style={{ borderRadius: 0 }}
            title="Studio Analytics"
            className={`transition-all flex items-center justify-center bg-[#1a3050] hover:bg-[#213d66] text-sky-300 hover:text-white font-bold border border-[#38bdf8]/35 cursor-pointer ${
              open ? 'py-1.5 px-2 gap-1.5 text-xs' : 'w-9 h-9'
            }`}
          >
            <div className="i-ph:chart-bar-fill text-sm text-[#38bdf8]" />
            {open && <span>Analytics</span>}
          </button>
        </div>

        {/* ── Projects / History List ── */}
        <div className="flex-1 overflow-y-auto px-1 pb-3 space-y-1">
          {open ? (
            <>
              <div className="flex items-center justify-between px-2 pt-2 pb-1 text-[11px] font-bold text-sky-200/80 uppercase tracking-wider select-none">
                <div className="flex items-center gap-1.5">
                  <div className="i-ph:folder-fill text-amber-400 text-xs" />
                  <span>Projects</span>
                </div>
                <span className="text-[10px] font-semibold bg-white/10 px-1.5 py-0.2 text-white">
                  {list.length}
                </span>
              </div>

              {list.length === 0 && (
                <div className="p-3 text-center text-[11px] text-sky-200/60 italic">
                  No projects yet
                </div>
              )}

              <DialogRoot open={dialogContent !== null}>
                {binDates(list).map(({ category, items }) => (
                  <div key={category} className="mt-2.5 first:mt-0 space-y-0.5">
                    <div className="text-[10px] font-bold text-[#38bdf8]/80 uppercase tracking-wider sticky top-0 z-1 bg-[#14243b] border-b border-white/5 px-2 py-0.5">
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
                          <p className="mt-1">Are you sure you want to delete this project?</p>
                        </div>
                      </DialogDescription>
                      <div className="px-5 pb-4 bg-[#14243b] flex gap-2 justify-end">
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
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 pt-2">
              <div
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-sky-300 transition-colors cursor-pointer"
                title={`${list.length} Saved Projects`}
                onClick={() => isSidebarOpen.set(true)}
              >
                <div className="i-ph:folder-fill text-base text-amber-400" />
              </div>
            </div>
          )}
        </div>

        {/* ── Bottom Section: Settings & Profile Very Under ── */}
        <div className="border-t border-[#38bdf8]/20 bg-[#172b49] flex flex-col select-none" style={{ borderRadius: 0 }}>
          {/* Settings & Theme Switch */}
          <div className={`flex items-center border-b border-white/10 ${open ? 'justify-between px-2 py-1.5' : 'justify-center p-1.5'}`}>
            <button
              onClick={() => {
                setSettingsTab('providers');
                setIsSettingsOpen(true);
              }}
              style={{ borderRadius: 0 }}
              className={`flex items-center text-slate-300 hover:text-white transition-colors cursor-pointer hover:bg-white/10 ${
                open ? 'gap-1.5 text-xs py-1 px-1.5' : 'w-8 h-8 justify-center'
              }`}
              title="Configure AI Settings"
            >
              <div className="i-ph:gear-six text-base text-[#38bdf8]" />
              {open && <span>Settings</span>}
            </button>
            {open && <ThemeSwitch />}
          </div>

          {/* Profile Box - Very Under */}
          <div className={`${open ? 'p-2' : 'p-1.5 flex justify-center'} bg-[#14243b]`}>
            {auth.user ? (
              open ? (
                <div className="w-full flex items-center justify-between px-2 py-1.5 bg-[#1a3050] border border-[#38bdf8]/35 text-xs text-white" style={{ borderRadius: 0 }}>
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={auth.user.name}
                        className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-[#38bdf8]"
                        onError={() => {
                          setAvatarFailed(true);
                        }}
                      />
                    ) : (
                      <div className="i-ph:user-circle-fill text-xl text-[#38bdf8] flex-shrink-0" />
                    )}
                    <span className="font-bold truncate text-white leading-tight text-[11px]">
                      {auth.user.name}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      appwriteLogout();
                      toast.info('Signed out');
                    }}
                    className="p-1 text-slate-400 hover:text-rose-400 hover:bg-white/10 transition-all cursor-pointer flex-shrink-0"
                    style={{ borderRadius: 0 }}
                    title="Sign out"
                  >
                    <div className="i-ph:sign-out-bold text-xs" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    appwriteLogout();
                    toast.info('Signed out');
                  }}
                  className="w-9 h-9 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer relative group"
                  title={`${auth.user.name} (Click to Sign Out)`}
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={auth.user.name}
                      className="w-7 h-7 rounded-full object-cover border border-[#38bdf8]"
                      onError={() => {
                        setAvatarFailed(true);
                      }}
                    />
                  ) : (
                    <div className="i-ph:user-circle-fill text-2xl text-[#38bdf8]" />
                  )}
                </button>
              )
            ) : open ? (
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'thefortz-open-login' }, '*');
                  }
                  isAuthModalOpen.set(true);
                }}
                style={{ borderRadius: 0 }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#1a3050] hover:bg-[#213d66] border border-[#38bdf8]/35 text-xs font-bold text-sky-300 hover:text-white transition-all cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <div className="i-ph:user-circle-fill text-base text-[#38bdf8]" />
                  <span className="text-[11px]">Sign In</span>
                </div>
                <div className="i-ph:arrow-square-out text-[#38bdf8] text-xs" />
              </button>
            ) : (
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'thefortz-open-login' }, '*');
                  }
                  isAuthModalOpen.set(true);
                }}
                className="w-9 h-9 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer"
                title="Sign In"
              >
                <div className="i-ph:user-circle-fill text-2xl text-[#38bdf8]" />
              </button>
            )}
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
            className="w-full max-w-md bg-[#152642] border border-[#38bdf8]/40 rounded-none p-6 text-white shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/15 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="i-ph:chart-bar-fill text-2xl text-[#38bdf8]" />
                <h3 className="font-extrabold text-lg uppercase tracking-wider text-white font-['Anton',sans-serif]">
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
              <div className="p-3 bg-[#101c30] rounded-none border border-white/10">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Projects</div>
                <div className="text-2xl font-black text-[#38bdf8] mt-0.5">{list.length}</div>
              </div>
              <div className="p-3 bg-[#101c30] rounded-none border border-white/10">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Engine Runtime</div>
                <div className="text-sm font-bold text-sky-300 mt-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Online
                </div>
              </div>
              <div className="p-3 bg-[#101c30] rounded-none border border-white/10">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Default AI Model</div>
                <div className="text-xs font-bold text-white mt-1 truncate" title="Azure Fortz AI (gpt-oss-120b)">
                  gpt-oss-120b
                </div>
              </div>
              <div className="p-3 bg-[#101c30] rounded-none border border-white/10">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Cloud Sync</div>
                <div className="text-xs font-bold text-[#38bdf8] mt-1 flex items-center gap-1">
                  <span>✓</span> Live Network
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              All games packaged and published here automatically sync to the live game feed for players worldwide.
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

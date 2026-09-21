import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { SettingsWindow } from '~/components/settings/SettingsWindow';
import { db, dbPromise, deleteById, getAll, getAllFromLocalStorage, chatId, type ChatHistoryItem, useChatHistory } from '~/lib/persistence';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';
import { HistoryItem } from './HistoryItem';
import { binDates } from './date-binning';
import { useStore } from '@nanostores/react';
import { isSidebarOpen, isGalleryOpen } from '~/lib/stores/sidebar';
import { workbenchStore } from '~/lib/stores/workbench';
import { authStore, isAuthModalOpen, appwriteLogout } from '~/lib/auth/appwrite';
import { getProjectIcon } from '~/utils/projectIcons';
import { StudioAnalyticsModal } from './StudioAnalyticsModal';

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
    width: 215,
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
    const processItems = (items: ChatHistoryItem[]) => {
      return items
        .filter((item) => Boolean(item.urlId || item.id))
        .map((item) => ({
          ...item,
          urlId: item.urlId || item.id,
          description: item.description || 'Project ' + (item.urlId || item.id),
        }));
    };

    // 1. Immediately hydrate from localStorage / cache so project list is never empty
    const initialItems = getAllFromLocalStorage();
    if (initialItems.length > 0) {
      setList(processItems(initialItems));
    }

    // 2. Fetch merged list from IndexedDB / Storage
    if (db) {
      getAll(db)
        .then(processItems)
        .then(setList)
        .catch(() => {});
    } else {
      dbPromise.then((database) => {
        getAll(database)
          .then(processItems)
          .then(setList)
          .catch(() => {});
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

    const handleUpdate = () => loadEntries();
    window.addEventListener('thefortz-chats-updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener('thefortz-chats-updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
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
  const isBrokenAvatar = !rawAvatarUrl || rawAvatarUrl.includes('/avatars/initials');
  const avatarUrl = isBrokenAvatar || avatarFailed ? '' : rawAvatarUrl;

  return (
    <>
      <motion.div
        ref={menuRef}
        initial={open ? 'open' : 'closed'}
        animate={open ? 'open' : 'closed'}
        variants={menuVariants}
        style={{
          borderRadius: 0,
          background: 'linear-gradient(180deg, rgb(0 166 255 / 63%) 0%, rgb(0 193 202 / 81%) 55%, rgb(0 255 255 / 75%) 100%)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
        className="flex selection-accent flex-col side-menu fixed top-0 left-0 h-full border-r-2 border-[#38bdf8] z-sidebar text-xs overflow-hidden select-none shadow-[2px_0_15px_rgba(56,189,248,0.35)] backdrop-blur-md"
      >
        {/* ── Top Header Brand / Toggle (No background box, big title, pure icon button) ── */}
        <div
          className={`flex items-center transition-all ${
            open ? 'justify-between px-3 pt-3 pb-1' : 'justify-center py-2.5'
          }`}
        >
          {open ? (
            <>
              <a
                href="/"
                className="flex items-center text-white hover:text-emerald-100 transition-colors no-underline select-none"
                title="Studio"
              >
                <span className="text-3xl sm:text-4xl font-black tracking-wide uppercase text-white font-['Anton',sans-serif] drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)] leading-none">
                  Studio
                </span>
              </a>
              <button
                onClick={() => isSidebarOpen.set(false)}
                className="p-1 flex items-center justify-center text-white/80 hover:text-white hover:scale-110 active:scale-95 transition-all cursor-pointer bg-transparent border-0"
                title="Collapse to icons"
              >
                <div className="i-ph:sidebar-simple-duotone text-2xl text-white" />
              </button>
            </>
          ) : (
            <button
              onClick={() => isSidebarOpen.set(true)}
              className="p-1.5 flex items-center justify-center text-white/80 hover:text-white hover:scale-110 active:scale-95 transition-all cursor-pointer bg-transparent border-0 group"
              title="Expand Sidebar"
            >
              <div className="i-ph:sidebar-simple-duotone text-2xl text-white group-hover:scale-110 transition-transform" />
            </button>
          )}
        </div>

        {/* ── Action Buttons: New Game, Builder Box, Created, Analytics (Styled as Button 53) ── */}
        <div className={`flex flex-col gap-3 my-2 ${open ? 'px-3 py-1' : 'py-1 items-center'}`}>
          {/* New Game Button */}
          <a
            href="/"
            role="button"
            title="Create New Game"
            className={`button-53 ${!open ? 'button-53-rail' : 'gap-2'}`}
          >
            <div className="i-ph:plus-bold text-base text-[#15803d] flex-shrink-0" />
            {open && <span className="text-[#4c1d95] font-black text-xs tracking-wide uppercase">New Game</span>}
          </a>

          {/* Builder Box (Code & Preview) Button */}
          <button
            type="button"
            role="button"
            onClick={() => {
              workbenchStore.showWorkbench.set(!showWorkbench);
            }}
            title={showWorkbench ? 'Close Builder Box' : 'Open Builder Box (Code & Preview)'}
            className={`button-53 button-53-orange ${!open ? 'button-53-rail' : 'gap-2'}`}
          >
            <div className="i-ph:code-bold text-base text-[#15803d] flex-shrink-0" />
            {open && <span className="font-black text-xs tracking-wide uppercase">{showWorkbench ? 'Close Builder' : 'Builder Box'}</span>}
          </button>

          {/* Created Projects & Showcase Button */}
          <button
            type="button"
            role="button"
            onClick={() => isGalleryOpen.set(true)}
            title="Open Created Games & Community Projects"
            className={`button-53 ${!open ? 'button-53-rail' : 'gap-2'}`}
          >
            <div className="i-ph:squares-four-fill text-base text-[#15803d] flex-shrink-0" />
            {open && <span className="text-[#4c1d95] font-black text-xs tracking-wide uppercase">Created</span>}
          </button>

          {/* Analytics Button */}
          <button
            type="button"
            role="button"
            onClick={() => setIsAnalyticsOpen(true)}
            title="Studio Analytics & Appwrite Status"
            className={`button-53 ${!open ? 'button-53-rail' : 'gap-2'}`}
          >
            <div className="i-ph:chart-bar-fill text-base text-[#15803d] flex-shrink-0" />
            {open && <span className="text-[#4c1d95] font-black text-xs tracking-wide uppercase">Analytics</span>}
          </button>
        </div>

        {/* ── Projects / History List (Orange themed, no shadows) ── */}
        <div className="flex-1 overflow-y-auto px-1 pb-3 space-y-1">
          {open ? (
            <>
              <div className="flex items-center justify-between px-2 pt-2 pb-1 text-[11px] font-bold text-orange-200 uppercase tracking-wider select-none">
                <div className="flex items-center gap-1.5">
                  <div className="i-ph:folder-fill text-[#f97316] text-xs" />
                  <span>Projects</span>
                </div>
                <span className="text-[10px] font-bold bg-[#7c2d12]/70 px-1.5 py-0.2 text-orange-300 border border-orange-500/50" style={{ borderRadius: 0 }}>
                  {list.length}
                </span>
              </div>

              {list.length === 0 && (
                <div className="p-3 text-center text-[11px] text-orange-200/70 italic">
                  No projects yet
                </div>
              )}

              <DialogRoot open={dialogContent !== null}>
                {binDates(list).map(({ category, items }) => (
                  <div key={category} className="space-y-0.5">
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
                      <div className="px-5 pb-4 bg-[#230e05] flex gap-2 justify-end" style={{ borderRadius: 0 }}>
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
            <div className="flex flex-col items-center gap-1 pt-1 overflow-y-auto no-scrollbar">
              <button
                type="button"
                className="w-9 h-9 flex items-center justify-center bg-[#431407]/90 border border-orange-500/40 text-orange-300 hover:text-white hover:bg-[#ea580c] transition-all cursor-pointer mb-1"
                style={{ borderRadius: 0 }}
                title={`${list.length} Saved Projects (Click to expand sidebar)`}
                onClick={() => isSidebarOpen.set(true)}
              >
                <div className="i-ph:folder-notch-open-fill text-base text-[#f97316]" />
              </button>
              {list.map((item) => {
                const projectTitle = item.description || 'Project ' + (item.urlId || item.id);
                const { icon } = getProjectIcon(projectTitle);
                const isCurrent =
                  chatId.get() === item.id ||
                  (item.urlId && typeof window !== 'undefined' && window.location.pathname.includes(item.urlId));

                return (
                  <a
                    key={item.id}
                    href={`/chat/${item.urlId || item.id}`}
                    title={projectTitle}
                    className={`w-9 h-9 flex items-center justify-center transition-all cursor-pointer no-underline border flex-shrink-0 ${
                      isCurrent
                        ? 'bg-[#7c2d12] border-orange-400 text-white'
                        : 'bg-black/25 border-transparent hover:bg-orange-950/60 text-orange-300 hover:text-white hover:border-orange-500/30'
                    }`}
                    style={{ borderRadius: 0 }}
                  >
                    <div className={`${icon} ${isCurrent ? 'text-white' : 'text-orange-400'} text-base`} />
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Bottom Section: Settings & Profile (No background boxes, pure icons & round avatar) ── */}
        <div className="border-t border-white/20 flex flex-col select-none bg-transparent pt-1 pb-2">
          {/* Settings & Theme Switch */}
          <div className={`flex items-center ${open ? 'justify-between px-3 py-1' : 'justify-center py-1'}`}>
            <button
              onClick={() => {
                setSettingsTab('providers');
                setIsSettingsOpen(true);
              }}
              className={`flex items-center text-white/80 hover:text-white hover:scale-105 active:scale-95 transition-all cursor-pointer bg-transparent border-0 ${
                open ? 'gap-2 text-xs font-bold py-1 px-1' : 'p-1.5 justify-center'
              }`}
              title="Configure AI Settings"
            >
              <div className={`${open ? 'text-xl' : 'text-2xl'} i-ph:gear-six text-white`} />
              {open && <span className="text-white text-xs font-semibold">Settings</span>}
            </button>
            {open && <ThemeSwitch />}
          </div>

          {/* Profile Section - No background box, round profile avatar, text as button */}
          <div className={`${open ? 'px-3 py-1' : 'py-1 flex justify-center'}`}>
            {auth.user ? (
              open ? (
                <div className="flex items-center justify-between gap-1.5 py-1">
                  <div className="flex items-center gap-2 overflow-hidden min-w-0">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={auth.user.name}
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0 border-2 border-white/60 shadow-md"
                        onError={() => {
                          setAvatarFailed(true);
                        }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center text-white flex-shrink-0 shadow-md font-bold text-xs uppercase">
                        {auth.user.name?.charAt(0) || <div className="i-ph:user-bold text-sm" />}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        toast.info(`Signed in as ${auth.user?.name || 'User'}`);
                      }}
                      className="font-bold truncate text-white hover:text-emerald-100 text-xs text-left bg-transparent border-0 cursor-pointer transition-colors p-0"
                      title={auth.user?.name}
                    >
                      {auth.user.name}
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      appwriteLogout();
                      toast.info('Signed out');
                    }}
                    className="p-1 text-white/70 hover:text-rose-300 hover:scale-110 transition-all cursor-pointer bg-transparent border-0 flex-shrink-0"
                    title="Sign out"
                  >
                    <div className="i-ph:sign-out-bold text-base" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    appwriteLogout();
                    toast.info('Signed out');
                  }}
                  className="w-8 h-8 flex items-center justify-center hover:scale-105 transition-transform cursor-pointer relative bg-transparent border-0 p-0"
                  title={`${auth.user.name} (Click to Sign Out)`}
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={auth.user.name}
                      className="w-8 h-8 rounded-full object-cover border-2 border-white/60 shadow-md"
                      onError={() => {
                        setAvatarFailed(true);
                      }}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center text-white flex-shrink-0 shadow-md font-bold text-xs uppercase">
                      {auth.user.name?.charAt(0) || <div className="i-ph:user-bold text-sm" />}
                    </div>
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
                className="flex items-center gap-2 py-1 px-1 text-white/90 hover:text-white font-bold text-xs transition-all cursor-pointer bg-transparent border-0 hover:translate-x-0.5"
              >
                <div className="w-7 h-7 rounded-full bg-white/20 border border-white/50 flex items-center justify-center text-white flex-shrink-0 shadow-sm">
                  <div className="i-ph:user-bold text-xs" />
                </div>
                <span className="text-white font-bold text-xs">Sign In</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'thefortz-open-login' }, '*');
                  }
                  isAuthModalOpen.set(true);
                }}
                className="w-8 h-8 flex items-center justify-center hover:scale-110 text-white transition-transform cursor-pointer bg-transparent border-0 p-0"
                title="Sign In"
              >
                <div className="w-8 h-8 rounded-full bg-white/20 border border-white/50 flex items-center justify-center text-white shadow-sm">
                  <div className="i-ph:user-bold text-xs" />
                </div>
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

      {/* ── Studio Analytics & Appwrite Full Dashboard ── */}
      <StudioAnalyticsModal
        open={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        projectsCount={list.length}
        projects={list}
      />
    </>
  );
};

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
    const processItems = (items: ChatHistoryItem[]) => {
      return items
        .filter((item) => Boolean(item.urlId || item.id))
        .map((item) => ({
          ...item,
          urlId: item.urlId || item.id,
          description: item.description || 'Project ' + (item.urlId || item.id),
        }));
    };

    if (db) {
      getAll(db)
        .then(processItems)
        .then(setList)
        .catch((error) => toast.error(error.message));
    } else {
      dbPromise.then((database) => {
        if (database) {
          getAll(database)
            .then(processItems)
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
        style={{
          borderRadius: 0,
          background: 'linear-gradient(180deg, rgb(46, 153, 0) 0%, rgb(1, 161, 19) 55%, rgb(5, 121, 0) 100%)',
        }}
        className="flex selection-accent flex-col side-menu fixed top-0 left-0 h-full border-r border-[#4ade80]/40 z-sidebar text-xs overflow-hidden select-none shadow-2xl"
      >
        {/* ── Top Header Brand / Toggle ── */}
        <div
          className={`flex items-center border-b border-[#4ade80]/30 bg-[#083000]/75 backdrop-blur-sm transition-all ${
            open ? 'justify-between px-3 py-2.5' : 'justify-center p-2'
          }`}
          style={{ borderRadius: 0, height: 42 }}
        >
          {open ? (
            <>
              <a
                href="/"
                className="flex items-center text-emerald-100 hover:text-white transition-colors no-underline select-none"
                title="Studio"
              >
                <span className="text-sm font-bold tracking-wider uppercase text-white font-['Anton',sans-serif]">
                  Studio
                </span>
              </a>
              <button
                onClick={() => isSidebarOpen.set(false)}
                className="p-1 text-emerald-200/80 hover:text-white hover:bg-black/20 transition-colors cursor-pointer"
                style={{ borderRadius: 0 }}
                title="Collapse to icons"
              >
                <div className="i-ph:sidebar-simple-duotone text-base text-[#4ade80]" />
              </button>
            </>
          ) : (
            <button
              onClick={() => isSidebarOpen.set(true)}
              className="w-8 h-8 flex items-center justify-center text-emerald-200 hover:text-white hover:bg-black/20 transition-colors cursor-pointer"
              style={{ borderRadius: 0 }}
              title="Expand Sidebar"
            >
              <div className="i-ph:sidebar-simple-duotone text-lg text-[#4ade80]" />
            </button>
          )}
        </div>

        {/* ── Action Buttons: New Game, Builder Box, Created, Analytics ── */}
        <div className={`flex flex-col gap-1.5 ${open ? 'p-2' : 'p-1.5 items-center'}`}>
          {/* New Game Button */}
          <a
            href="/"
            style={{ borderRadius: 0 }}
            title="Create New Game"
            className={`transition-all active:translate-y-0.5 no-underline flex items-center justify-center bg-[#f97316] hover:bg-[#ea580c] text-white font-bold border border-orange-300/40 shadow-sm ${
              open ? 'py-1.5 px-2 gap-1.5 text-xs' : 'w-9 h-9'
            }`}
          >
            <div className="i-ph:plus-bold text-sm" />
            {open && <span>New Game</span>}
          </a>

          {/* Builder Box (Code & Preview) Button */}
          <button
            type="button"
            onClick={() => {
              workbenchStore.showWorkbench.set(!showWorkbench);
            }}
            style={{ borderRadius: 0 }}
            title={showWorkbench ? 'Close Builder Box' : 'Open Builder Box (Code & Preview)'}
            className={`transition-all flex items-center justify-center font-bold cursor-pointer border ${
              showWorkbench
                ? 'bg-[#8b5cf6] hover:bg-[#7c3aed] text-white border-purple-300/50 shadow-sm'
                : 'bg-[#062400]/70 hover:bg-[#0c4000] text-purple-200 hover:text-white border-[#4ade80]/35'
            } ${
              open ? 'py-1.5 px-2 gap-1.5 text-xs' : 'w-9 h-9'
            }`}
          >
            <div className={`i-ph:code-bold text-sm ${showWorkbench ? 'text-white' : 'text-purple-300'}`} />
            {open && <span>{showWorkbench ? 'Close Builder' : 'Builder Box'}</span>}
          </button>

          {/* Created Projects & Showcase Button */}
          <button
            type="button"
            onClick={() => isGalleryOpen.set(true)}
            style={{ borderRadius: 0 }}
            title="Open Created Games & Community Projects"
            className={`transition-all flex items-center justify-center bg-[#062400]/70 hover:bg-[#0c4000] text-emerald-100 hover:text-white font-bold border border-[#4ade80]/35 cursor-pointer ${
              open ? 'py-1.5 px-2 gap-1.5 text-xs' : 'w-9 h-9'
            }`}
          >
            <div className="i-ph:squares-four-fill text-sm text-[#4ade80]" />
            {open && <span>Created</span>}
          </button>

          {/* Analytics Button */}
          <button
            type="button"
            onClick={() => setIsAnalyticsOpen(true)}
            style={{ borderRadius: 0 }}
            title="Studio Analytics & Appwrite Status"
            className={`transition-all flex items-center justify-center bg-[#062400]/70 hover:bg-[#0c4000] text-emerald-100 hover:text-white font-bold border border-[#4ade80]/35 cursor-pointer ${
              open ? 'py-1.5 px-2 gap-1.5 text-xs' : 'w-9 h-9'
            }`}
          >
            <div className="i-ph:chart-bar-fill text-sm text-[#4ade80]" />
            {open && <span>Analytics</span>}
          </button>
        </div>

        {/* ── Projects / History List ── */}
        <div className="flex-1 overflow-y-auto px-1 pb-3 space-y-1">
          {open ? (
            <>
              <div className="flex items-center justify-between px-2 pt-2 pb-1 text-[11px] font-bold text-emerald-100/90 uppercase tracking-wider select-none">
                <div className="flex items-center gap-1.5">
                  <div className="i-ph:folder-fill text-amber-300 text-xs" />
                  <span>Projects</span>
                </div>
                <span className="text-[10px] font-semibold bg-black/30 px-1.5 py-0.2 text-emerald-200 border border-[#4ade80]/30" style={{ borderRadius: 0 }}>
                  {list.length}
                </span>
              </div>

              {list.length === 0 && (
                <div className="p-3 text-center text-[11px] text-emerald-200/70 italic">
                  No projects yet
                </div>
              )}

              <DialogRoot open={dialogContent !== null}>
                {binDates(list).map(({ category, items }) => (
                  <div key={category} className="mt-2.5 first:mt-0 space-y-0.5">
                    <div className="text-[10px] font-bold text-[#bbf7d0] uppercase tracking-wider sticky top-0 z-1 bg-[#093500]/95 border-b border-white/10 px-2 py-0.5">
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
                      <div className="px-5 pb-4 bg-[#0a2612] flex gap-2 justify-end" style={{ borderRadius: 0 }}>
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
                className="w-8 h-8 flex items-center justify-center text-emerald-200 hover:text-white transition-colors cursor-pointer mb-1 border-b border-white/10 pb-1"
                title={`${list.length} Saved Projects (Click to expand sidebar)`}
                onClick={() => isSidebarOpen.set(true)}
              >
                <div className="i-ph:folder-fill text-base text-amber-300" />
              </button>
              {list.map((item) => {
                const projectTitle = item.description || 'Project ' + (item.urlId || item.id);
                const { icon, color } = getProjectIcon(projectTitle);
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
                        ? 'bg-[#062400] border-[#4ade80] text-white shadow-sm'
                        : 'bg-transparent border-transparent hover:bg-black/25 text-emerald-100 hover:text-white'
                    }`}
                    style={{ borderRadius: 0 }}
                  >
                    <div className={`${icon} ${color} text-base`} />
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Bottom Section: Settings & Profile Very Under ── */}
        <div className="border-t border-[#4ade80]/30 bg-[#062400]/85 backdrop-blur-sm flex flex-col select-none" style={{ borderRadius: 0 }}>
          {/* Settings & Theme Switch */}
          <div className={`flex items-center border-b border-white/10 ${open ? 'justify-between px-2 py-1.5' : 'justify-center p-1.5'}`}>
            <button
              onClick={() => {
                setSettingsTab('providers');
                setIsSettingsOpen(true);
              }}
              style={{ borderRadius: 0 }}
              className={`flex items-center text-emerald-100 hover:text-white transition-colors cursor-pointer hover:bg-black/20 ${
                open ? 'gap-1.5 text-xs py-1 px-1.5' : 'w-8 h-8 justify-center'
              }`}
              title="Configure AI Settings"
            >
              <div className="i-ph:gear-six text-base text-[#4ade80]" />
              {open && <span>Settings</span>}
            </button>
            {open && <ThemeSwitch />}
          </div>

          {/* Profile Box - Very Under */}
          <div className={`${open ? 'p-2' : 'p-1.5 flex justify-center'} bg-[#041a00]`}>
            {auth.user ? (
              open ? (
                <div className="w-full flex items-center justify-between px-2 py-1.5 bg-[#093500] border border-[#4ade80]/40 text-xs text-white" style={{ borderRadius: 0 }}>
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={auth.user.name}
                        className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-[#4ade80]"
                        onError={() => {
                          setAvatarFailed(true);
                        }}
                      />
                    ) : (
                      <div className="i-ph:user-circle-fill text-xl text-[#4ade80] flex-shrink-0" />
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
                    className="p-1 text-emerald-300/70 hover:text-rose-400 hover:bg-black/20 transition-all cursor-pointer flex-shrink-0"
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
                  className="w-9 h-9 flex items-center justify-center hover:bg-black/20 transition-colors cursor-pointer relative group"
                  title={`${auth.user.name} (Click to Sign Out)`}
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={auth.user.name}
                      className="w-7 h-7 rounded-full object-cover border border-[#4ade80]"
                      onError={() => {
                        setAvatarFailed(true);
                      }}
                    />
                  ) : (
                    <div className="i-ph:user-circle-fill text-2xl text-[#4ade80]" />
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
                className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#093500] hover:bg-[#0f4d02] border border-[#4ade80]/40 text-xs font-bold text-emerald-200 hover:text-white transition-all cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <div className="i-ph:user-circle-fill text-base text-[#4ade80]" />
                  <span className="text-[11px]">Sign In</span>
                </div>
                <div className="i-ph:arrow-square-out text-[#4ade80] text-xs" />
              </button>
            ) : (
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'thefortz-open-login' }, '*');
                  }
                  isAuthModalOpen.set(true);
                }}
                className="w-9 h-9 flex items-center justify-center hover:bg-black/20 transition-colors cursor-pointer"
                title="Sign In"
              >
                <div className="i-ph:user-circle-fill text-2xl text-[#4ade80]" />
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

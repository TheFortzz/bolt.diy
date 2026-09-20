/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import type { Message } from 'ai';
import React, { type RefCallback, useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { IconButton } from '~/components/ui/IconButton';
import { Workbench } from '~/components/workbench/Workbench.client';
import { classNames } from '~/utils/classNames';
import { MODEL_LIST, PROVIDER_LIST, initializeModelList } from '~/utils/constants';
import { Messages } from './Messages.client';
import { SendButton } from './SendButton.client';
import { APIKeyManager } from './APIKeyManager';
import Cookies from 'js-cookie';
import * as Tooltip from '@radix-ui/react-tooltip';

import styles from './BaseChat.module.scss';
import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import { toast } from 'react-toastify';
import { SettingsWindow } from '~/components/settings/SettingsWindow';
import { StudioLandingSection } from './StudioLandingSection';
import { CommunityGalleryModal } from '~/components/gallery/CommunityGalleryModal';
import { workbenchStore } from '~/lib/stores/workbench';
import useViewport from '~/lib/hooks';

import { isSidebarOpen, isGalleryOpen } from '~/lib/stores/sidebar';
import { authStore, isAuthModalOpen, checkAuthSession } from '~/lib/auth/appwrite';
import { AppwriteAuthModal } from '~/components/auth/AppwriteAuthModal';

import FilePreview from './FilePreview';
import { ModelSelector } from '~/components/chat/ModelSelector';
import { SpeechRecognitionButton } from '~/components/chat/SpeechRecognition';
import type { IProviderSetting, ProviderInfo } from '~/types/model';

const TEXTAREA_MIN_HEIGHT = 76;

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  messages?: Message[];
  description?: string;
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  providerList?: ProviderInfo[];
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  importChat?: (description: string, messages: Message[]) => Promise<void>;
  exportChat?: () => void;
  uploadedFiles?: File[];
  setUploadedFiles?: (files: File[]) => void;
  imageDataList?: string[];
  setImageDataList?: (dataList: string[]) => void;
}

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      messageRef,
      scrollRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      model,
      setModel,
      provider,
      setProvider,
      providerList,
      input = '',
      enhancingPrompt,
      handleInputChange,
      promptEnhanced,
      enhancePrompt,
      sendMessage,
      handleStop,
      importChat,
      exportChat,
      uploadedFiles = [],
      setUploadedFiles,
      imageDataList = [],
      setImageDataList,
      messages,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;
    const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
      const savedKeys = Cookies.get('apiKeys');

      if (savedKeys) {
        try {
          return JSON.parse(savedKeys);
        } catch (error) {
          console.error('Failed to parse API keys from cookies:', error);
          return {};
        }
      }

      return {};
    });
    const [modelList, setModelList] = useState(MODEL_LIST);
    const [isModelSettingsCollapsed, setIsModelSettingsCollapsed] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [recognition, setRecognition] = useState<any>(null);
    const [transcript, setTranscript] = useState('');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    // Use safe SSR defaults; real values are hydrated client-side via useEffect
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [showWorkbench, setShowWorkbench] = useState(false);
    const [auth, setAuth] = useState<{ user: any }>({ user: null });
    const isSmallViewport = useViewport(1024);

    useEffect(() => {
      // Subscribe to nanostores after hydration to avoid SSR mismatch (#418/#425)
      setSidebarOpen(isSidebarOpen.get());
      setGalleryOpen(isGalleryOpen.get());
      setShowWorkbench(workbenchStore.showWorkbench.get());
      setAuth(authStore.get());
      const unsubSidebar = isSidebarOpen.subscribe((v) => setSidebarOpen(v));
      const unsubGallery = isGalleryOpen.subscribe((v) => setGalleryOpen(v));
      const unsubWorkbench = workbenchStore.showWorkbench.subscribe((v) => setShowWorkbench(v));
      const unsubAuth = authStore.subscribe((v) => setAuth(v));
      // Kick off auth session check (client-only)
      checkAuthSession();
      return () => {
        unsubSidebar();
        unsubGallery();
        unsubWorkbench();
        unsubAuth();
      };
    }, []);

    const FORTZ_PROMPT_COST = 10;
    // Safe initializer: never read localStorage during SSR
    const [fortzBalance, setFortzBalance] = useState<number>(100);

    // Read persisted balance from localStorage after client hydration
    useEffect(() => {
      const saved = localStorage.getItem('thefortz_fortz_balance');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) setFortzBalance(parsed);
      } else {
        localStorage.setItem('thefortz_fortz_balance', '100');
      }
    }, []);

    // Update balance when Appwrite user profile changes
    useEffect(() => {
      if (auth.user?.prefs?.fortz_balance !== undefined) {
        const userBal = auth.user.prefs.fortz_balance;
        if (typeof userBal === 'number') {
          setFortzBalance(userBal);
          localStorage.setItem('thefortz_fortz_balance', String(userBal));
        }
      }
    }, [auth.user]);

    useEffect(() => {
      console.log(transcript);
    }, [transcript]);

    useEffect(() => {
      // Load API keys from cookies on component mount
      try {
        const storedApiKeys = Cookies.get('apiKeys');

        if (storedApiKeys) {
          const parsedKeys = JSON.parse(storedApiKeys);

          if (typeof parsedKeys === 'object' && parsedKeys !== null) {
            setApiKeys(parsedKeys);
          }
        }
      } catch (error) {
        console.error('Error loading API keys from cookies:', error);

        // Clear invalid cookie data
        Cookies.remove('apiKeys');
      }

      let providerSettings: Record<string, IProviderSetting> | undefined = undefined;

      try {
        const savedProviderSettings = Cookies.get('providers');

        if (savedProviderSettings) {
          const parsedProviderSettings = JSON.parse(savedProviderSettings);

          if (typeof parsedProviderSettings === 'object' && parsedProviderSettings !== null) {
            providerSettings = parsedProviderSettings;
          }
        }
      } catch (error) {
        console.error('Error loading Provider Settings from cookies:', error);

        // Clear invalid cookie data
        Cookies.remove('providers');
      }

      initializeModelList(providerSettings).then((modelList) => {
        setModelList(modelList);
      });

      if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognitionInstance = new SpeechRecognitionAPI();
        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;

        recognitionInstance.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0])
            .map((result: any) => result.transcript)
            .join('');

          setTranscript(transcript);

          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: transcript },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        };

        recognitionInstance.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };

        setRecognition(recognitionInstance);
      }
    }, []);

    const startListening = () => {
      if (recognition) {
        recognition.start();
        setIsListening(true);
      }
    };

    const stopListening = () => {
      if (recognition) {
        recognition.stop();
        setIsListening(false);
      }
    };

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      const text = messageInput || input;
      if (!text || !text.trim()) return;

      const currentAuth = authStore.get();
      if (!currentAuth.user) {
        toast.info('🔒 Please sign in to start building your game!');
        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'thefortz-open-login' }, '*');
        }
        isAuthModalOpen.set(true);
        return;
      }

      if (fortzBalance < FORTZ_PROMPT_COST) {
        toast.error('⚠️ Insufficient balance to send prompt (requires 10F).');
        return;
      }

      // Deduct Fortz prompt cost
      const newBalance = Math.max(0, fortzBalance - FORTZ_PROMPT_COST);
      setFortzBalance(newBalance);
      if (typeof window !== 'undefined') {
        localStorage.setItem('thefortz_fortz_balance', String(newBalance));
        try {
          const rawAuth = localStorage.getItem('fortz_auth_v2');
          if (rawAuth) {
            const authObj = JSON.parse(rawAuth);
            authObj.fortz = newBalance;
            localStorage.setItem('fortz_auth_v2', JSON.stringify(authObj));
            window.dispatchEvent(new CustomEvent('fortz-auth-updated'));
          }
        } catch (e) {}
        window.dispatchEvent(new CustomEvent('thefortz-balance-updated', { detail: { balance: newBalance } }));
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'thefortz-balance-deducted', cost: FORTZ_PROMPT_COST, balance: newBalance }, '*');
        }
      }
      toast.info(`🪙 -${FORTZ_PROMPT_COST} Fortz • Balance: ${newBalance} Fortz`, { autoClose: 3500 });

      if (sendMessage) {
        sendMessage(event, messageInput);

        if (recognition) {
          recognition.abort(); // Stop current recognition
          setTranscript(''); // Clear transcript
          setIsListening(false);

          // Clear the input by triggering handleInputChange with empty value
          if (handleInputChange) {
            const syntheticEvent = {
              target: { value: '' },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            handleInputChange(syntheticEvent);
          }
        }
      }
    };

    const handleSelectTemplate = (templatePrompt: string) => {
      if (handleInputChange) {
        const syntheticEvent = {
          target: { value: templatePrompt },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      }
      if (textareaRef?.current) {
        textareaRef.current.focus();
        textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    const handleLaunchTemplate = (event: React.UIEvent, templatePrompt: string) => {
      if (handleInputChange) {
        const syntheticEvent = {
          target: { value: templatePrompt },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      }
      handleSendMessage?.(event, templatePrompt);
    };

    const handleFileUpload = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];

        if (file) {
          const reader = new FileReader();

          reader.onload = (e) => {
            const base64Image = e.target?.result as string;
            setUploadedFiles?.([...uploadedFiles, file]);
            setImageDataList?.([...imageDataList, base64Image]);
          };
          reader.readAsDataURL(file);
        }
      };

      input.click();
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();

          const file = item.getAsFile();

          if (file) {
            const reader = new FileReader();

            reader.onload = (e) => {
              const base64Image = e.target?.result as string;
              setUploadedFiles?.([...uploadedFiles, file]);
              setImageDataList?.([...imageDataList, base64Image]);
            };
            reader.readAsDataURL(file);
          }

          break;
        }
      }
    };

    const isWorkbenchActive = showWorkbench && !isSmallViewport;
    const sidebarWidth = sidebarOpen ? 200 : 54;
    const chatCompactWidth = 340;

    const baseChat = (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex h-full w-full overflow-hidden')}
        data-chat-visible={showChat}
        style={{
          '--sidebar-width': `${sidebarWidth}px`,
          '--chat-compact-width': `${chatCompactWidth}px`,
          '--workbench-inner-width': isSmallViewport
            ? '100%'
            : `calc(100% - ${sidebarWidth}px - ${chatCompactWidth}px - 0.75rem)`,
          '--workbench-left': isSmallViewport
            ? '0px'
            : `${sidebarWidth + chatCompactWidth}px`,
        } as React.CSSProperties}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>
        <div
          ref={scrollRef}
          className={classNames(
            'flex flex-row overflow-y-auto w-full h-full transition-[padding] duration-200 ease-in-out',
            sidebarOpen ? 'pl-[200px]' : 'pl-[54px]',
          )}
        >
          <div
            className={classNames(
              styles.Chat,
              'flex flex-col h-full relative transition-[width,max-width] duration-200 ease-in-out',
              isWorkbenchActive
                ? 'w-[340px] max-w-[340px] min-w-[340px] flex-shrink-0 border-r border-purple-500/20'
                : 'w-full flex-grow',
            )}
          >
            {!chatStarted && (
              <StudioLandingSection
                onSelectTemplate={handleSelectTemplate}
                onLaunchTemplate={handleLaunchTemplate}
                onOpenSettings={() => setIsSettingsOpen(true)}
                fortzBalance={fortzBalance}
              />
            )}
            <div
              className={classNames('pt-2 px-2 sm:px-4 flex-1 flex flex-col', {
                'h-full': chatStarted,
                'justify-center pb-8': !chatStarted,
              })}
            >
              <ClientOnly>
                {() => {
                  return chatStarted ? (
                    <Messages
                      ref={messageRef}
                      className={classNames(
                        'flex flex-col w-full flex-1 pb-6 mx-auto z-1',
                        isWorkbenchActive ? 'max-w-full px-1' : 'max-w-chat',
                      )}
                      messages={messages}
                      isStreaming={isStreaming}
                    />
                  ) : null;
                }}
              </ClientOnly>

              <div
                className={classNames(
                  'relative w-full mx-auto z-prompt mb-4 px-2 sm:px-0 transition-all duration-300',
                  {
                    'sticky bottom-2': chatStarted,
                    'mt-4 sm:mt-6': !chatStarted,
                  },
                )}
                style={{
                  maxWidth: isWorkbenchActive ? '100%' : (chatStarted ? '42rem' : '48rem'),
                }}
              >
                <div className={isModelSettingsCollapsed ? 'hidden' : ''}>
                  {/* Hidden model selector — auto-configured */}
                  <div className="hidden">
                    <ModelSelector
                      key={provider?.name + ':' + modelList.length}
                      model={model}
                      setModel={setModel}
                      modelList={modelList}
                      provider={provider}
                      setProvider={setProvider}
                      providerList={providerList || PROVIDER_LIST}
                      apiKeys={apiKeys}
                    />
                  </div>
                </div>
                <FilePreview
                  files={uploadedFiles}
                  imageDataList={imageDataList}
                  onRemove={(index) => {
                    setUploadedFiles?.(uploadedFiles.filter((_, i) => i !== index));
                    setImageDataList?.(imageDataList.filter((_, i) => i !== index));
                  }}
                />
                <div
                  style={{
                    borderRadius: 0,
                    boxShadow: '0 5px 0 0 #0f071f, 0 12px 28px rgba(0,0,0,0.45)',
                    background: '#1a0e2e',
                  }}
                  className={classNames(
                    'relative border border-purple-500/40 border-r-2 border-b-[5px] border-r-[#0f071f] border-b-[#0f071f] focus-within:border-purple-400 focus-within:ring-1 focus-within:ring-purple-500/30 transition-all',
                  )}
                >
                  <textarea
                    ref={textareaRef}
                    className={classNames(
                      'w-full pl-4 pt-4 pr-16 focus:outline-none resize-none text-white placeholder-purple-300/40 bg-transparent text-sm',
                      'transition-all duration-200',
                    )}
                    onDragEnter={(e) => {
                      e.preventDefault();
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();

                      const files = Array.from(e.dataTransfer.files);
                      files.forEach((file) => {
                        if (file.type.startsWith('image/')) {
                          const reader = new FileReader();

                          reader.onload = (e) => {
                            const base64Image = e.target?.result as string;
                            setUploadedFiles?.([...uploadedFiles, file]);
                            setImageDataList?.([...imageDataList, base64Image]);
                          };
                          reader.readAsDataURL(file);
                        }
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        if (event.shiftKey) {
                          return;
                        }

                        event.preventDefault();

                        if (isStreaming) {
                          handleStop?.();
                          return;
                        }

                        handleSendMessage?.(event);
                      }
                    }}
                    value={input}
                    onChange={(event) => {
                      handleInputChange?.(event);
                    }}
                    onPaste={handlePaste}
                    style={{
                      minHeight: TEXTAREA_MIN_HEIGHT,
                      maxHeight: TEXTAREA_MAX_HEIGHT,
                    }}
                    placeholder="What do you want to build today?"
                    translate="no"
                  />
                  <ClientOnly>
                    {() => (
                      <SendButton
                        show={input.length > 0 || isStreaming || uploadedFiles.length > 0}
                        isStreaming={isStreaming}
                        disabled={!providerList || providerList.length === 0}
                        onClick={(event) => {
                          if (isStreaming) {
                            handleStop?.();
                            return;
                          }

                          if (input.length > 0 || uploadedFiles.length > 0) {
                            handleSendMessage?.(event);
                          }
                        }}
                      />
                    )}
                  </ClientOnly>
                  <div className="flex justify-between items-center text-sm p-3 pt-1 border-t border-purple-500/15">
                    <div className="flex gap-1 items-center">
                      <IconButton title="Upload file" className="transition-all text-purple-300 hover:text-white" onClick={() => handleFileUpload()}>
                        <div className="i-ph:paperclip text-xl"></div>
                      </IconButton>
                      <IconButton
                        title="Enhance prompt"
                        disabled={input.length === 0 || enhancingPrompt}
                        className={classNames(
                          'transition-all text-purple-300 hover:text-white',
                          enhancingPrompt ? 'opacity-100' : '',
                          promptEnhanced ? 'text-purple-300 pr-1.5' : '',
                          promptEnhanced ? 'enabled:hover:bg-purple-900/40' : '',
                        )}
                        onClick={() => enhancePrompt?.()}
                      >
                        {enhancingPrompt ? (
                          <>
                            <div className="i-svg-spinners:90-ring-with-bg text-purple-400 text-xl animate-spin"></div>
                            <div className="ml-1.5 text-purple-300">Enhancing prompt...</div>
                          </>
                        ) : (
                          <>
                            <div className="i-bolt:stars text-xl text-purple-300"></div>
                            {promptEnhanced && <div className="ml-1.5 text-purple-300">Prompt enhanced</div>}
                          </>
                        )}
                      </IconButton>

                      <SpeechRecognitionButton
                        isListening={isListening}
                        onStart={startListening}
                        onStop={stopListening}
                        disabled={isStreaming}
                      />
                      {chatStarted && <ClientOnly>{() => <ExportChatButton exportChat={exportChat} />}</ClientOnly>}

                      {/* Community Games Gallery icon button */}
                      <IconButton
                        title="Community Games Gallery"
                        className="transition-all text-purple-300 hover:text-white hover:bg-purple-900/30"
                        onClick={() => isGalleryOpen.set(true)}
                      >
                        <div className="i-ph:game-controller-duotone text-xl text-[#c084fc]" />
                      </IconButton>

                      {/* Configure AI icon button */}
                      <IconButton
                        title="Configure AI & Providers"
                        className="transition-all text-purple-300 hover:text-white hover:bg-purple-900/30"
                        onClick={() => setIsSettingsOpen(true)}
                      >
                        <div className="i-ph:gear-six text-xl text-[#c084fc]" />
                      </IconButton>

                      <IconButton
                        title="Model Settings"
                        className={classNames('rounded-none transition-all flex items-center gap-1 border border-purple-500/25 bg-[#25133e] text-purple-200 hover:bg-purple-900/50 px-2 py-0.5', {
                          'opacity-80': isModelSettingsCollapsed,
                          'bg-purple-900/70 border-purple-400/40': !isModelSettingsCollapsed,
                        })}
                        onClick={() => setIsModelSettingsCollapsed(!isModelSettingsCollapsed)}
                        disabled={!providerList || providerList.length === 0}
                      >
                        <div className={`i-ph:caret-${isModelSettingsCollapsed ? 'right' : 'down'} text-lg`} />
                        {isModelSettingsCollapsed ? <span className="text-xs">{model}</span> : <span />}
                      </IconButton>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-purple-200/70 select-none">
                      <span
                        style={{ borderRadius: 0 }}
                        className="px-2 py-0.5 font-mono font-bold bg-[#261442] border border-purple-400/30 text-amber-400 flex items-center gap-1"
                        title="10 Tokens per prompt"
                      >
                        <span>🪙</span>
                        <span>10F</span>
                      </span>
                      {input.length > 3 && (
                        <>
                          <span className="text-purple-400/30">•</span>
                          <span>
                            <kbd className="kdb px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-500/30 text-purple-200">Shift</kbd> +{' '}
                            <kbd className="kdb px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-500/30 text-purple-200">Return</kbd> for new line
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <ClientOnly>{() => <Workbench chatStarted={chatStarted || showWorkbench} isStreaming={isStreaming} />}</ClientOnly>
        </div>
        <AppwriteAuthModal />
        <SettingsWindow
          open={isSettingsOpen}
          initialTab="providers"
          onClose={() => setIsSettingsOpen(false)}
        />
        <CommunityGalleryModal
          open={galleryOpen}
          onClose={() => isGalleryOpen.set(false)}
          onSelectPrompt={(prompt) => {
            handleSelectTemplate(prompt);
          }}
        />
      </div>
    );

    return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
  },
);

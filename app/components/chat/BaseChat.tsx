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
import { ImportButtons } from '~/components/chat/chatExportAndImport/ImportButtons';
import { ExamplePrompts } from '~/components/chat/ExamplePrompts';
import GitCloneButton from './GitCloneButton';
import { toast } from 'react-toastify';
import { SettingsWindow } from '~/components/settings/SettingsWindow';
import { HeaderActionButtons } from '~/components/header/HeaderActionButtons.client';
import { StudioLandingSection, StudioLandingFooter } from './StudioLandingSection';

import { isSidebarOpen } from '~/lib/stores/sidebar';
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
    const [auth, setAuth] = useState<{ user: any }>({ user: null });

    useEffect(() => {
      // Subscribe to nanostores after hydration to avoid SSR mismatch (#418/#425)
      setSidebarOpen(isSidebarOpen.get());
      setAuth(authStore.get());
      const unsubSidebar = isSidebarOpen.subscribe((v) => setSidebarOpen(v));
      const unsubAuth = authStore.subscribe((v) => setAuth(v));
      // Kick off auth session check (client-only)
      checkAuthSession();
      return () => {
        unsubSidebar();
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
        toast.info('🔒 Please sign in or create an account with THEFORTZ to start building your game!');
        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'thefortz-open-login' }, '*');
        }
        isAuthModalOpen.set(true);
        return;
      }

      if (fortzBalance < FORTZ_PROMPT_COST) {
        toast.error(
          `⚠️ Insufficient Fortz! Each AI game prompt costs ${FORTZ_PROMPT_COST} Fortz. Your balance is ${fortzBalance} Fortz. Visit TheFortz to refill your balance.`,
          { autoClose: 7000 }
        );
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

    const baseChat = (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex h-full w-full overflow-hidden')}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>
        <div
          ref={scrollRef}
          className={classNames(
            'flex flex-col lg:flex-row overflow-y-auto w-full h-full transition-[padding] duration-200 ease-in-out',
            sidebarOpen ? 'lg:pl-[260px]' : 'lg:pl-0',
          )}
        >
          <div className={classNames(styles.Chat, 'flex flex-col flex-grow lg:min-w-[var(--chat-min-width)] h-full relative')}>
            {chatStarted && (
              <div className="absolute top-3 right-4 z-20">
                <ClientOnly>{() => <HeaderActionButtons />}</ClientOnly>
              </div>
            )}
            {!chatStarted && (
              <StudioLandingSection
                onSelectTemplate={handleSelectTemplate}
                onLaunchTemplate={handleLaunchTemplate}
                onOpenSettings={() => setIsSettingsOpen(true)}
                fortzBalance={fortzBalance}
              />
            )}
            <div
              className={classNames('pt-6 px-2 sm:px-6', {
                'h-full flex flex-col': chatStarted,
              })}
            >
              <ClientOnly>
                {() => {
                  return chatStarted ? (
                    <Messages
                      ref={messageRef}
                      className="flex flex-col w-full flex-1 max-w-chat pb-6 mx-auto z-1"
                      messages={messages}
                      isStreaming={isStreaming}
                    />
                  ) : null;
                }}
              </ClientOnly>

              {/* ── Lane of action/import buttons directly on top of the prompt input ── */}
              {!chatStarted && (
                <div className="flex justify-center items-center gap-2.5 flex-wrap max-w-[54rem] mx-auto mb-3.5 px-2 select-none animate-fade-in">
                  {ImportButtons(importChat)}
                  <GitCloneButton importChat={importChat} />
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    style={{ borderRadius: 0 }}
                    className="px-3.5 py-1.5 border border-emerald-500/40 bg-[#161f30] hover:bg-[#1f2b42] text-emerald-300 transition-all flex items-center gap-2 cursor-pointer text-xs font-bold shadow-sm active:translate-y-0.5"
                    title="Configure Claude, OpenAI, Ollama and other AI providers"
                  >
                    <div className="i-ph:gear-six-fill text-sm text-emerald-400" />
                    <span>Configure AI</span>
                  </button>
                </div>
              )}

              <div
                className={classNames(
                  'p-3.5 relative w-full mx-auto z-prompt mb-6 transition-all duration-300',
                  {
                    'sticky bottom-2': chatStarted,
                  },
                )}
                style={{
                  maxWidth: chatStarted ? '42rem' : '54rem',
                  borderRadius: 0,
                  background: '#0d1117',
                  border: '1px solid #232d3f',
                  borderTop: '3px solid #10b981',
                  boxShadow: '0 20px 50px rgba(0, 0, 0, 0.75), 0 0 25px rgba(16, 185, 129, 0.15)',
                }}
              >
                <svg className={classNames(styles.PromptEffectContainer)}>
                  <defs>
                    <linearGradient
                      id="line-gradient"
                      x1="20%"
                      y1="0%"
                      x2="-14%"
                      y2="10%"
                      gradientUnits="userSpaceOnUse"
                      gradientTransform="rotate(-45)"
                    >
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0%"></stop>
                      <stop offset="40%" stopColor="#10b981" stopOpacity="80%"></stop>
                      <stop offset="50%" stopColor="#10b981" stopOpacity="80%"></stop>
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0%"></stop>
                    </linearGradient>
                    <linearGradient id="shine-gradient">
                      <stop offset="0%" stopColor="white" stopOpacity="0%"></stop>
                      <stop offset="40%" stopColor="#ffffff" stopOpacity="80%"></stop>
                      <stop offset="50%" stopColor="#ffffff" stopOpacity="80%"></stop>
                      <stop offset="100%" stopColor="white" stopOpacity="0%"></stop>
                    </linearGradient>
                  </defs>
                  <rect className={classNames(styles.PromptEffectLine)} pathLength="100" strokeLinecap="round"></rect>
                  <rect className={classNames(styles.PromptShine)} x="48" y="24" width="70" height="1"></rect>
                </svg>
                <div>
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
                </div>
                <FilePreview
                  files={uploadedFiles}
                  imageDataList={imageDataList}
                  onRemove={(index) => {
                    setUploadedFiles?.(uploadedFiles.filter((_, i) => i !== index));
                    setImageDataList?.(imageDataList.filter((_, i) => i !== index));
                  }}
                />
                {/* ── TheFortz Prompt Balance & Token HUD ── */}
                <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10 px-1 select-none">
                  <div className="flex items-center gap-2">
                    <div
                      style={{ borderRadius: 0 }}
                      className="flex items-center gap-1.5 px-3 py-1 bg-[#161f30] border border-amber-400/50 text-amber-300 shadow-sm text-xs font-bold tracking-wide"
                    >
                      <span className="text-sm">🪙</span>
                      <span style={{ fontFamily: '"Lilita One", Anton, sans-serif' }}>
                        {fortzBalance.toLocaleString()} FORTZ
                      </span>
                    </div>
                    <span
                      style={{ borderRadius: 0 }}
                      className="text-[11px] font-bold text-emerald-300 bg-[#0f241a] px-2 py-0.5 border border-emerald-500/40"
                    >
                      ⚡ 10 Fortz / Prompt
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href="https://thefortz.me"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-amber-400 hover:text-amber-200 transition-colors flex items-center gap-1 hover:underline"
                      title="Refill Fortz tokens on TheFortz"
                    >
                      <span>Refill</span>
                      <span className="text-xs">↗</span>
                    </a>
                  </div>
                </div>

                {fortzBalance < FORTZ_PROMPT_COST && (
                  <div
                    style={{ borderRadius: 0 }}
                    className="mb-2.5 px-3 py-1.5 bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs font-semibold flex items-center justify-between shadow-inner"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <span>Insufficient Fortz (requires 10 Fortz per prompt). Balance: {fortzBalance}</span>
                    </div>
                    <a
                      href="https://thefortz.me"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-amber-300 font-bold hover:text-white"
                    >
                      Get Fortz →
                    </a>
                  </div>
                )}

                <div
                  style={{ borderRadius: 0 }}
                  className={classNames(
                    'relative border border-[#232d3f] bg-[#090d16] focus-within:border-emerald-500 transition-colors',
                  )}
                >
                  <textarea
                    ref={textareaRef}
                    className={classNames(
                      'w-full pl-4 pt-4 pr-16 focus:outline-none resize-none text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary bg-transparent text-sm',
                      'transition-all duration-200',
                      'hover:border-bolt-elements-focus',
                    )}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.currentTarget.style.border = '2px solid #1488fc';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.style.border = '2px solid #1488fc';
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.currentTarget.style.border = '1px solid var(--bolt-elements-borderColor)';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.style.border = '1px solid var(--bolt-elements-borderColor)';

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
                    placeholder="How can THEFORTZ help you build a game today?"
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
                  <div className="flex justify-between items-center text-sm p-4 pt-2">
                    <div className="flex gap-1 items-center">
                      <IconButton title="Upload file" className="transition-all" onClick={() => handleFileUpload()}>
                        <div className="i-ph:paperclip text-xl"></div>
                      </IconButton>
                      <IconButton
                        title="Enhance prompt"
                        disabled={input.length === 0 || enhancingPrompt}
                        className={classNames(
                          'transition-all',
                          enhancingPrompt ? 'opacity-100' : '',
                          promptEnhanced ? 'text-bolt-elements-item-contentAccent' : '',
                          promptEnhanced ? 'pr-1.5' : '',
                          promptEnhanced ? 'enabled:hover:bg-bolt-elements-item-backgroundAccent' : '',
                        )}
                        onClick={() => enhancePrompt?.()}
                      >
                        {enhancingPrompt ? (
                          <>
                            <div className="i-svg-spinners:90-ring-with-bg text-bolt-elements-loader-progress text-xl animate-spin"></div>
                            <div className="ml-1.5">Enhancing prompt...</div>
                          </>
                        ) : (
                          <>
                            <div className="i-bolt:stars text-xl"></div>
                            {promptEnhanced && <div className="ml-1.5">Prompt enhanced</div>}
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
                      <IconButton
                        title="Model Settings"
                        className={classNames('transition-all flex items-center gap-1', {
                          'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent':
                            isModelSettingsCollapsed,
                          'bg-bolt-elements-item-backgroundDefault text-bolt-elements-item-contentDefault':
                            !isModelSettingsCollapsed,
                        })}
                        onClick={() => setIsModelSettingsCollapsed(!isModelSettingsCollapsed)}
                        disabled={!providerList || providerList.length === 0}
                      >
                        <div className={`i-ph:caret-${isModelSettingsCollapsed ? 'right' : 'down'} text-lg`} />
                        {isModelSettingsCollapsed ? <span className="text-xs">{model}</span> : <span />}
                      </IconButton>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-blue-200/70">
                      <span className="font-semibold text-yellow-300/90 flex items-center gap-1">
                        <span>🪙</span>
                        <span>10 Fortz</span>
                      </span>
                      {input.length > 3 && (
                        <>
                          <span className="text-white/20">•</span>
                          <span>
                            <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2">Shift</kbd> +{' '}
                            <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2">Return</kbd> for new line
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <ClientOnly>{() => <Workbench chatStarted={chatStarted} isStreaming={isStreaming} />}</ClientOnly>
        </div>
        <AppwriteAuthModal />
        <SettingsWindow
          open={isSettingsOpen}
          initialTab="providers"
          onClose={() => setIsSettingsOpen(false)}
        />
      </div>
    );

    return <Tooltip.Provider delayDuration={200}>{baseChat}</Tooltip.Provider>;
  },
);

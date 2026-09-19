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
    const FORTZ_PROMPT_COST = 10;
    const [fortzBalance, setFortzBalance] = useState<number>(() => {
      if (typeof window === 'undefined') return 100;
      const saved = localStorage.getItem('thefortz_fortz_balance');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        return isNaN(parsed) ? 100 : parsed;
      }
      localStorage.setItem('thefortz_fortz_balance', '100');
      return 100;
    });

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
        <div ref={scrollRef} className="flex flex-col lg:flex-row overflow-y-auto w-full h-full lg:pl-[260px]">
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
              <div
                className={classNames(
                  'p-3.5 rounded-2xl relative w-full mx-auto z-prompt mb-6 transition-all duration-300',
                  {
                    'sticky bottom-2': chatStarted,
                  },
                )}
                style={{
                  maxWidth: chatStarted ? '42rem' : '54rem',
                  background: 'linear-gradient(180deg, rgba(28, 54, 186, 0.95) 0%, rgba(16, 32, 120, 0.98) 100%)',
                  boxShadow: '0 16px 40px -6px rgba(0, 0, 0, 0.65), 0 8px 16px -4px rgba(0, 0, 0, 0.5), inset 0 1.5px 0 rgba(255, 255, 255, 0.35), inset 0 -3px 0 rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  borderTop: '1.5px solid rgba(255, 255, 255, 0.4)',
                  borderBottom: '2.5px solid rgba(0, 0, 0, 0.6)',
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
                      <stop offset="0%" stopColor="#b44aff" stopOpacity="0%"></stop>
                      <stop offset="40%" stopColor="#b44aff" stopOpacity="80%"></stop>
                      <stop offset="50%" stopColor="#b44aff" stopOpacity="80%"></stop>
                      <stop offset="100%" stopColor="#b44aff" stopOpacity="0%"></stop>
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
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500/20 via-yellow-400/20 to-amber-500/10 border border-yellow-400/40 text-yellow-300 shadow-sm text-xs font-bold tracking-wide">
                      <span className="text-sm">🪙</span>
                      <span style={{ fontFamily: '"Lilita One", Anton, sans-serif' }}>
                        {fortzBalance.toLocaleString()} FORTZ
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-cyan-200/90 bg-[#101e74] px-2 py-0.5 rounded border border-cyan-400/30">
                      ⚡ 10 Fortz / Prompt
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href="https://thefortz.me"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-yellow-300 hover:text-yellow-100 transition-colors flex items-center gap-1 hover:underline"
                      title="Refill Fortz tokens on TheFortz"
                    >
                      <span>Refill</span>
                      <span className="text-xs">↗</span>
                    </a>
                  </div>
                </div>

                {fortzBalance < FORTZ_PROMPT_COST && (
                  <div className="mb-2.5 px-3 py-1.5 rounded-lg bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs font-semibold flex items-center justify-between shadow-inner">
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <span>Insufficient Fortz (requires 10 Fortz per prompt). Balance: {fortzBalance}</span>
                    </div>
                    <a
                      href="https://thefortz.me"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-yellow-300 font-bold hover:text-white"
                    >
                      Get Fortz →
                    </a>
                  </div>
                )}

                <div
                  className={classNames(
                    'relative border border-bolt-elements-borderColor backdrop-blur rounded-lg',
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
            {!chatStarted && (
              <>
                <div className="flex justify-center items-center gap-2.5 flex-wrap max-w-3xl mx-auto mt-2 px-4 select-none">
                  {ImportButtons(importChat)}
                  <GitCloneButton importChat={importChat} />
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="px-4 py-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 transition-all flex items-center gap-2 cursor-pointer text-sm font-semibold shadow-md active:translate-y-0.5"
                    title="Configure Claude, OpenAI, Ollama and other AI providers"
                  >
                    <div className="i-ph:gear-six-fill text-base text-cyan-300" />
                    <span>Configure AI / Add Your Own</span>
                  </button>
                </div>
                <StudioLandingFooter
                  onSelectTemplate={handleSelectTemplate}
                  onLaunchTemplate={handleLaunchTemplate}
                />
              </>
            )}

          </div>
          <ClientOnly>{() => <Workbench chatStarted={chatStarted} isStreaming={isStreaming} />}</ClientOnly>
        </div>
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

/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { chatId, dbPromise, description, useChatHistory } from '~/lib/persistence';
import { applyProjectSnapshot, checkpointBusy, getLatestCheckpoint, saveCheckpoint } from '~/lib/persistence/checkpoints';
import { getWebContainer } from '~/lib/webcontainer';
import { runActivityStep, startActivity } from '~/lib/stores/activity';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST, type StudioAgentMode } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { authStore, isAuthModalOpen } from '~/lib/auth/appwrite';
import { finalizeAssistantMessage } from '~/lib/hooks/useMessageParser';
import { validateBuild, validationState } from '~/lib/runtime/build-validator';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]); // Move here
    const [imageDataList, setImageDataList] = useState<string[]>([]); // Move here
    const [agentMode, setAgentMode] = useState<StudioAgentMode>('auto');
    const lastAgentModeRef = useRef<StudioAgentMode>('auto');
    const repairAttemptsRef = useRef(0);
    const { activeProviders } = useSettings();

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return (!savedModel || savedModel === 'claude-3-5-sonnet-latest' || savedModel === 'gpt-oss-120b' || savedModel === 'gpt-4.1-mini') ? DEFAULT_MODEL : savedModel;
    });

    useEffect(() => {
      const savedModel = Cookies.get('selectedModel');
      if (savedModel === 'gpt-oss-120b' || savedModel === 'claude-3-5-sonnet-latest' || savedModel === 'gpt-4.1-mini') {
        Cookies.set('selectedModel', DEFAULT_MODEL);
        setModel(DEFAULT_MODEL);
      }
    }, []);

    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      if (!savedProvider || savedProvider === 'Anthropic') {
        return DEFAULT_PROVIDER;
      }
      return PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER;
    });

    const { showChat } = useStore(chatStore);

    const [animationScope, animate] = useAnimate();

    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

    const scrollToBottomRef = useRef<((smooth?: boolean) => void) | null>(null);

    const { messages, isLoading, input, handleInputChange, setInput, stop, append } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
      },
      onError: (error) => {
        logger.error('Request failed\n\n', error);
        validationState.set({ status: 'failed', detail: `AI request failed: ${error.message}` });
        workbenchStore.finishPendingActions();
        toast.error(
          'There was an error processing your request: ' + (error.message ? error.message : 'No details were returned'),
        );
      },
      onFinish: async (message) => {
        logger.debug('Finished streaming');
        finalizeAssistantMessage(message);
        scrollToBottomRef.current?.(true);
        const finalMessages = messages.some((entry) => entry.id === message.id)
          ? messages.map((entry) => entry.id === message.id ? message : entry)
          : [...messages, message];
        const historySave = storeMessageHistory(finalMessages);
        void historySave.catch((error) => console.warn('Final save error:', error));

        const content = typeof message?.content === 'string' ? message.content : '';
        const builtFiles = content.includes('boltArtifact') || content.includes('boltAction');
        const mode = lastAgentModeRef.current;

        if (mode === 'plan' && !builtFiles) {
          workbenchStore.finishPendingActions();
          toast.info('📋 Plan ready — ask FortzAI to build it, or send again in Build mode.', {
            autoClose: 5500,
            position: 'top-right',
          });
          return;
        }

        if (!builtFiles) {
          workbenchStore.finishPendingActions();
          if (repairAttemptsRef.current > 0) {
            startActivity(message.id, 'repair:missing', 'No corrected files returned', 'No corrected files returned', 'failed');
            validationState.set({ status: 'failed', detail: 'Automatic repair did not return any corrected files.' });
            toast.error('Automatic repair did not produce a corrected build.', { autoClose: false });
          }
          return;
        }

        const result = await validateBuild(message.id);
        workbenchStore.finishPendingActions();
        if (!result.ok) {
          if (repairAttemptsRef.current < 2) {
            repairAttemptsRef.current++;
            validationState.set({ status: 'checking', detail: `Repairing build (${repairAttemptsRef.current}/2)…` });
            toast.info(`Build check failed — attempting repair (${repairAttemptsRef.current}/2)…`);
            const attemptId = `repair:attempt:${repairAttemptsRef.current}`;
            try {
              await runActivityStep(message.id, attemptId, `Requesting repair (${repairAttemptsRef.current}/2)`, () => append({
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\nAutomatic validation failed (repair attempt ${repairAttemptsRef.current}/2):\n${result.error?.slice(-1800)}\n\nFix only the affected files. Keep the existing project and artifact id. Return complete corrected file actions and do not claim the build passed until it is checked again.`,
                }), 'Repair response received');
            } catch (error) {
              validationState.set({ status: 'failed', detail: `Automatic repair failed: ${(error as Error).message}` });
              toast.error('Automatic repair could not be started. The build is not verified.');
            }
          } else {
            startActivity(message.id, 'repair:exhausted', 'Repair attempts exhausted', 'Repair attempts exhausted', 'failed');
            toast.error(`Build could not be verified after two repairs: ${result.error}`, { autoClose: false });
          }
          return;
        }

        repairAttemptsRef.current = 0;
        validationState.set({ status: 'checking', detail: 'Saving working checkpoint…' });

        try {
          await runActivityStep(message.id, 'checkpoint:save', 'Saving working checkpoint', async () => {
            await historySave;
            const database = await dbPromise;
            const projectId = chatId.get();

            if (!database || !projectId) {
              throw new Error('Local checkpoint storage is unavailable.');
            }

            await saveCheckpoint(database, await getWebContainer(), projectId, message.id);
          }, 'Working checkpoint saved');
        } catch (error) {
          toast.error(`Build verified, but checkpoint could not be saved: ${(error as Error).message}`, { autoClose: false });
        } finally {
          validationState.set({ status: 'passed', detail: 'Build verified' });
        }

        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
          window.parent.postMessage(
            {
              type: 'thefortz-build-finished',
              mode,
              builtFiles,
              title: 'FortzAI build',
            },
            '*',
          );
        }

        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('preview');
        window.dispatchEvent(new CustomEvent('fortz-play-while-building'));

        toast.success('🎮 Build verified — open Preview to try your game!', {
          autoClose: 6000,
          position: 'top-right',
        });

        if (typeof window !== 'undefined' && 'Notification' in window) {
          try {
            if (Notification.permission === 'granted') {
              new Notification('FortzAI', { body: 'Your game build is ready to play!' });
            } else if (Notification.permission === 'default') {
              Notification.requestPermission().then((perm) => {
                if (perm === 'granted') {
                  new Notification('FortzAI', { body: 'Your game build is ready to play!' });
                }
              });
            }
          } catch (e) {}
        }
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      parseMessages(messages, isLoading);

      if (messages.length > initialMessages.length) {
        storeMessageHistory(messages).catch((error) => console.warn('Auto save error:', error));
      }
    }, [messages, isLoading, parseMessages]);

    useEffect(() => {
      if (!initialMessages.length) return;

      let cancelled = false;
      const restoreVerifiedFiles = async () => {
        const database = await dbPromise;
        const projectId = chatId.get();
        if (!database || !projectId) return;

        const checkpoint = await getLatestCheckpoint(database, projectId);
        if (!checkpoint || initialMessages[initialMessages.length - 1]?.id !== checkpoint.messageId) return;

        await workbenchStore.waitForExecutionQueue();
        if (cancelled) return;

        const wc = await getWebContainer();
        await applyProjectSnapshot(wc, checkpoint.files);
        if (!cancelled) workbenchStore.showRestoredCheckpoint(checkpoint.files);
      };

      void restoreVerifiedFiles().catch((error) => console.warn('Could not reload working checkpoint:', error));
      return () => { cancelled = true; };
    }, [initialMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();
      workbenchStore.finishPendingActions();
    };

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const _input = messageInput || input;

      if (_input.length === 0 || isLoading || validationState.get().status === 'checking' || checkpointBusy.get() !== 'idle') {
        return;
      }

      repairAttemptsRef.current = 0;
      lastAgentModeRef.current = agentMode;
      validationState.set({ status: 'idle', detail: '' });

      const auth = authStore.get();
      if (!auth.user) {
        if (typeof window !== 'undefined') {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'thefortz-open-login' }, '*');
          } else {
            window.dispatchEvent(new CustomEvent('thefortz-open-login'));
          }
        }
        return;
      }

      /**
       * @note (delm) Usually saving files shouldn't take long but it may take longer if there
       * many unsaved files. In that case we need to block user input and show an indicator
       * of some kind so the user is aware that something is happening. But I consider the
       * happy case to be no unsaved files and I would expect users to save their changes
       * before they send another message.
       */
      await workbenchStore.saveAllFiles();

      const fileModifications = workbenchStore.getFileModifcations();

      chatStore.setKey('aborted', false);

      runAnimation();

      // Collect any failed actions from workbench to inform AI of recent errors
      let failedActionContext = '';
      try {
        const artifacts = workbenchStore.artifacts.get();
        for (const art of Object.values(artifacts)) {
          const runnerActions = art.runner?.actions?.get();
          if (runnerActions) {
            for (const act of Object.values(runnerActions)) {
              if (act.status === 'failed') {
                failedActionContext += `\n[Recent Action Failure: ${act.type} action "${(act as any).content?.slice(0, 160) || ''}" failed with error: "${(act as any).error || 'Execution failed'}"]`;
              }
            }
          }
        }
      } catch (e) {
        /* ignore */
      }

      let textPayload = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n[Studio Mode: ${agentMode.toUpperCase()}]\n\n${_input}`;

      if (failedActionContext) {
        textPayload = `${failedActionContext}\n\n${textPayload}`;
      }

      if (fileModifications !== undefined) {
        textPayload = `${fileModifications}\n\n${textPayload}`;
      }

      append({
        role: 'user',
        content: [
          {
            type: 'text',
            text: textPayload,
          },
          ...imageDataList.map((imageData) => ({
            type: 'image',
            image: imageData,
          })),
        ] as any, // Type assertion to bypass compiler check
      });

      if (fileModifications !== undefined) {
        workbenchStore.resetAllFileModifications();
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      // Add file cleanup here
      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    const [messageRef, scrollRef, scrollToBottom] = useSnapScroll(isLoading);
    scrollToBottomRef.current = scrollToBottom;

    useEffect(() => {
      if (messages.length > 0) {
        scrollToBottom(true);
      }
    }, [messages.length, scrollToBottom]);

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        messageRef={messageRef}
        scrollRef={scrollRef}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          const parsed = parsedMessages[i];
          // While streaming, keep showing prior parsed content rather than flashing empty/raw dumps.
          const content =
            typeof parsed === 'string' && parsed.length > 0
              ? parsed
              : typeof message.content === 'string' && !message.content.includes('<boltArtifact')
                ? message.content
                : parsed || '';

          return {
            ...message,
            content,
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        agentMode={agentMode}
        setAgentMode={setAgentMode}
      />
    );
  },
);

/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { chatId, dbPromise, description, useChatHistory } from '~/lib/persistence';
import {
  applyProjectSnapshot,
  checkpointBusy,
  getLatestCheckpoint,
  saveCheckpoint,
} from '~/lib/persistence/checkpoints';
import { getWebContainer } from '~/lib/webcontainer';
import { runActivityStep, startActivity } from '~/lib/stores/activity';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  PROMPT_COOKIE_KEY,
  PROVIDER_LIST,
  type StudioAgentMode,
} from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { authStore, isAuthModalOpen } from '~/lib/auth/appwrite';
import { finalizeAssistantMessage } from '~/lib/hooks/useMessageParser';
import { validationState } from '~/lib/runtime/build-validator';
import { verifyGameBuild } from '~/lib/runtime/game-build-pipeline';
import { useCognitiveHarness } from '~/lib/hooks/useCognitiveHarness';
import { shouldUseBuildPlanner } from '~/lib/runtime/request-intent';
import { executionPolicy } from '~/lib/harness/execution-policy';
import { harnessIsBusy, harnessState, transitionHarness } from '~/lib/stores/harness';

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
    const lastUserPromptRef = useRef('');
    const { activeProviders } = useSettings();

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return !savedModel ||
        savedModel === 'fortz-ai' ||
        savedModel === 'claude-3-5-sonnet-latest' ||
        savedModel === 'gpt-oss-120b' ||
        savedModel === 'gpt-4.1-mini'
        ? DEFAULT_MODEL
        : savedModel;
    });

    useEffect(() => {
      const savedModel = Cookies.get('selectedModel');

      if (
        savedModel === 'fortz-ai' ||
        savedModel === 'gpt-oss-120b' ||
        savedModel === 'claude-3-5-sonnet-latest' ||
        savedModel === 'gpt-4.1-mini'
      ) {
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
    const historySaveTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const latestMessagesRef = useRef<Message[]>(initialMessages);
    const storeMessageHistoryRef = useRef(storeMessageHistory);
    storeMessageHistoryRef.current = storeMessageHistory;

    const persistMessages = useCallback((nextMessages: Message[], immediate = false) => {
      latestMessagesRef.current = nextMessages;

      if (immediate) {
        if (historySaveTimerRef.current) {
          clearTimeout(historySaveTimerRef.current);
          historySaveTimerRef.current = undefined;
        }

        return storeMessageHistoryRef.current(nextMessages);
      }

      if (!historySaveTimerRef.current) {
        historySaveTimerRef.current = setTimeout(() => {
          historySaveTimerRef.current = undefined;
          void storeMessageHistoryRef
            .current(latestMessagesRef.current)
            .catch((error) => console.warn('Auto save error:', error));
        }, 1000);
      }

      return Promise.resolve();
    }, []);

    useEffect(
      () => () => {
        if (historySaveTimerRef.current) {
          clearTimeout(historySaveTimerRef.current);
          historySaveTimerRef.current = undefined;
          void storeMessageHistoryRef
            .current(latestMessagesRef.current)
            .catch((error) => console.warn('Final chat save error:', error));
        }
      },
      [],
    );

    const { messages, isLoading, input, handleInputChange, setInput, stop, append, setMessages } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
      },
      onError: (error) => {
        logger.error('Request failed\n\n', error);
        void persistMessages(latestMessagesRef.current, true).catch((saveError) =>
          console.warn('Error chat save failed:', saveError),
        );
        validationState.set({ status: 'failed', detail: `AI request failed: ${error.message}` });
        workbenchStore.finishPendingActions();

        const currentHarness = harnessState.get();

        if (currentHarness.phase === 'editing' || currentHarness.phase === 'verifying') {
          executionPolicy.revoke();
          transitionHarness('failed', { detail: `AI request failed: ${error.message}` });
        }

        toast.error(
          'There was an error processing your request: ' + (error.message ? error.message : 'No details were returned'),
        );
      },
      onFinish: async (message) => {
        logger.debug('Finished streaming');
        const activeHarness = harnessState.get();
        const managedBlueprint = activeHarness.blueprint || executionPolicy.plan || undefined;
        const lastUserMessage = [...messages].reverse().find((entry) => entry.role === 'user');
        const hasChatOnlyAnnotation =
          message.annotations?.some(
            (annotation: any) =>
              typeof annotation === 'object' &&
              annotation !== null &&
              'type' in annotation &&
              annotation.type === 'studio-chat-only',
          ) ||
          lastUserMessage?.annotations?.some(
            (annotation: any) =>
              typeof annotation === 'object' &&
              annotation !== null &&
              'type' in annotation &&
              annotation.type === 'studio-chat-only',
          );
        const mode = managedBlueprint ? 'build' : lastAgentModeRef.current;
        const isConversationOnly = mode === 'chat' || Boolean(hasChatOnlyAnnotation);
        const completedMessage = isConversationOnly
          ? {
              ...message,
              annotations: [...(message.annotations || []), { type: 'studio-chat-only' }],
            }
          : message;

        if (!isConversationOnly) {
          finalizeAssistantMessage(completedMessage);
        }
        scrollToBottomRef.current?.(true);

        const finalMessages = messages.some((entry) => entry.id === message.id)
          ? messages.map((entry) => (entry.id === message.id ? completedMessage : entry))
          : [...messages, completedMessage];
        const historySave = persistMessages(finalMessages, true);
        void historySave.catch((error) => console.warn('Final save error:', error));

        if (isConversationOnly) {
          setMessages((previous) => previous.map((entry) => (entry.id === message.id ? completedMessage : entry)));
          workbenchStore.finishPendingActions();

          return;
        }

        const content = typeof completedMessage.content === 'string' ? completedMessage.content : '';
        const builtFiles = content.includes('boltArtifact') || content.includes('boltAction');

        if (managedBlueprint) {
          transitionHarness('verifying', { detail: 'Checking the approved build…' });
        }

        if (mode === 'plan' && !builtFiles && !managedBlueprint) {
          workbenchStore.finishPendingActions();
          toast.info('📋 Plan ready — ask FortzAI to build it, or send again in Build mode.', {
            autoClose: 5500,
            position: 'top-right',
          });

          return;
        }

        if (!builtFiles) {
          workbenchStore.finishPendingActions();

          if (managedBlueprint) {
            const detail = 'Editor did not return the approved game files. No build was verified.';
            executionPolicy.revoke();
            transitionHarness('failed', { detail });
            validationState.set({ status: 'failed', detail });
            toast.error(detail);
          }

          if (repairAttemptsRef.current > 0) {
            startActivity(
              message.id,
              'repair:missing',
              'No corrected files returned',
              'No corrected files returned',
              'failed',
            );
            validationState.set({ status: 'failed', detail: 'Automatic repair did not return any corrected files.' });
            toast.error('Automatic repair did not produce a corrected build.', { autoClose: false });
          }

          return;
        }

        const userPrompt = lastUserPromptRef.current;
        const result = await verifyGameBuild(message.id, {
          userPrompt,
          model,
          provider: provider.name,
          apiKeys,
          approvedBlueprint: managedBlueprint,
        });
        workbenchStore.finishPendingActions();

        if (!result.ok) {
          if (repairAttemptsRef.current < 2 && !result.error?.includes('runtime verification needs')) {
            repairAttemptsRef.current++;
            executionPolicy.allowRepair();
            if (managedBlueprint) {
              transitionHarness('editing', {
                detail: `Auto-repairing build (${repairAttemptsRef.current}/2)…`,
              });
            }
            validationState.set({
              status: 'checking',
              detail: `Auto-repairing build (${repairAttemptsRef.current}/2)…`,
            });
            toast.info(
              `⚠️ Build issue detected — automatically diagnosing and repairing (${repairAttemptsRef.current}/2)…`,
              {
                autoClose: 5000,
              },
            );

            try {
              const rawFiles = workbenchStore.files.get();
              const workspaceSources: Record<string, string> = {};
              for (const [path, dirent] of Object.entries(rawFiles)) {
                if (dirent?.type === 'file' && typeof dirent.content === 'string') {
                  const cleanPath = path.startsWith('/home/project/') ? path.slice('/home/project/'.length) : path;
                  if (!managedBlueprint || managedBlueprint.manifest.some((f) => f.path === cleanPath)) {
                    workspaceSources[cleanPath] = dirent.content.slice(0, 200000);
                  }
                }
              }

              const artifactId =
                workbenchStore.firstArtifact?.id ||
                (managedBlueprint ? `game-${managedBlueprint.workspaceId}` : 'default_project');
              const token = activeHarness.executionToken || harnessState.get().executionToken;
              await append(
                {
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n[Studio Mode: BUILD]\n\n[Internal Repair Prompt - Attempt ${repairAttemptsRef.current}/2]\n\nAutomatic build preview verification found runtime issue:\n${result.error?.slice(-1800)}\n\nCRITICAL FIX INSTRUCTIONS:\n1. Fix the error directly in the affected file(s). Emit the COMPLETE, fully closed, syntactically valid file inside <boltAction type="file" filePath="...">.\n2. Ensure all scripts are loaded in index.html in correct order and classes attached to window.\n3. Keep existing artifact id="${artifactId}" and close with </boltArtifact>.\n4. Output corrected file actions immediately with zero conversational fluff.`,
                  annotations: managedBlueprint
                    ? [{ type: 'harness-execution', planId: managedBlueprint.id }]
                    : undefined,
                },
                managedBlueprint && token
                  ? {
                      body: {
                        approvedBlueprint: managedBlueprint,
                        executionToken: token,
                        workspaceSources,
                      },
                    }
                  : { body: { chatOnly: true } },
              );
              return;
            } catch (error) {
              if (managedBlueprint) {
                executionPolicy.revoke();
                transitionHarness('failed', { detail: `Automatic repair failed: ${(error as Error).message}` });
              }
              validationState.set({ status: 'failed', detail: `Automatic repair failed: ${(error as Error).message}` });
              toast.error('Automatic repair could not be started. The build is not verified.');
            }
          }

          if (managedBlueprint) {
            executionPolicy.revoke();
            transitionHarness('failed', { detail: result.error || 'Build validation failed.' });
          }

          validationState.set({ status: 'failed', detail: result.error || 'Build validation failed' });
          toast.error(`Build validation issue: ${result.error?.slice(0, 160)}`, { autoClose: 8000 });

          // Inform directly in this chat message when auto-repairs are exhausted
          const errorNotice = managedBlueprint
            ? `\n\n> ⚠️ **Build not verified:**\n> ${result.error?.slice(-1800)}\n>\n> Describe the repair you want; FortzAI will propose a new blueprint for your approval.`
            : result.error?.includes('runtime verification needs')
              ? `\n\n> ⚠️ **Runtime verification unavailable:**\n> ${result.error?.slice(-1800)}\n>\n> A browser verification worker or preview bridge must be configured before this build can be marked verified.`
              : `\n\n> ⚠️ **Build Issue Detected:**\n> ${result.error?.slice(-1800)}\n>\n> *Ask for a targeted repair to address these checks.*`;
          setMessages((prev) =>
            prev.map((entry) =>
              entry.id === message.id ? { ...entry, content: `${entry.content}${errorNotice}` } : entry,
            ),
          );

          const updatedMessage = {
            ...message,
            content: `${message.content}${errorNotice}`,
          };
          void persistMessages(
            messages.map((entry) => (entry.id === message.id ? updatedMessage : entry)),
            true,
          ).catch((error) => console.warn('Verification notice save error:', error));

          return;
        }

        repairAttemptsRef.current = 0;
        validationState.set({ status: 'checking', detail: 'Saving working checkpoint…' });

        try {
          await runActivityStep(
            message.id,
            'checkpoint:save',
            'Saving working checkpoint',
            async () => {
              await historySave;

              const database = await dbPromise;
              const projectId =
                chatId.get() ||
                workbenchStore.firstArtifact?.id ||
                workbenchStore.artifactIdList[0] ||
                'default_project';

              await saveCheckpoint(database, await getWebContainer(), projectId, message.id);
            },
            'Working checkpoint saved',
          );
        } catch (error) {
          logger.warn('Non-fatal checkpoint save warning:', error);
        } finally {
          validationState.set({ status: 'passed', detail: 'Build verified' });
        }

        if (managedBlueprint) {
          executionPolicy.revoke();
          transitionHarness('verified', { detail: 'Build checks passed and a working checkpoint was saved.' });
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
    latestMessagesRef.current = messages;

    const harnessWorkspaceIdRef = useRef<string>();

    if (!harnessWorkspaceIdRef.current) {
      harnessWorkspaceIdRef.current =
        chatId.get() || workbenchStore.firstArtifact?.id || `workspace-${crypto.randomUUID()}`;
    }

    const { requestPlan, approvePlan, cancelPlan } = useCognitiveHarness({
      model,
      provider: provider.name,
      apiKeys,
      workspaceId: harnessWorkspaceIdRef.current,
      setMessages,
      append,
    });

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      executionPolicy.registerHistory(
        initialMessages.filter((message) => message.role === 'assistant').map((message) => message.id),
      );
    }, [initialMessages]);

    useEffect(() => {
      parseMessages(messages, isLoading);

      if (!isLoading && messages.length > initialMessages.length) {
        void persistMessages(messages).catch((error) => console.warn('Auto save error:', error));
      }
    }, [messages, isLoading, parseMessages, persistMessages, initialMessages.length]);

    useEffect(() => {
      if (!initialMessages.length) {
        return;
      }

      let cancelled = false;
      const restoreVerifiedFiles = async () => {
        const database = await dbPromise;
        const projectId = chatId.get() || workbenchStore.firstArtifact?.id || 'default_project';

        const checkpoint = await getLatestCheckpoint(database, projectId);

        if (!checkpoint || initialMessages[initialMessages.length - 1]?.id !== checkpoint.messageId) {
          return;
        }

        await workbenchStore.waitForExecutionQueue();

        if (cancelled) {
          return;
        }

        const wc = await getWebContainer();
        await applyProjectSnapshot(wc, checkpoint.files);

        if (!cancelled) {
          workbenchStore.showRestoredCheckpoint(checkpoint.files);
        }
      };

      void restoreVerifiedFiles().catch((error) => console.warn('Could not reload working checkpoint:', error));

      return () => {
        cancelled = true;
      };
    }, [initialMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      cancelPlan();
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

      if (
        !_input.trim() ||
        isLoading ||
        validationState.get().status === 'checking' ||
        checkpointBusy.get() !== 'idle' ||
        harnessIsBusy(harnessState.get().phase)
      ) {
        return;
      }

      lastUserPromptRef.current = _input;
      repairAttemptsRef.current = 0;
      const shouldPlan = shouldUseBuildPlanner(_input, agentMode);
      lastAgentModeRef.current = shouldPlan ? agentMode : 'chat';

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

      chatStore.setKey('aborted', false);
      void runAnimation();

      if (shouldPlan) {
        const fileModifications = workbenchStore.getFileModifcations();
        void requestPlan(_input, imageDataList);

        if (fileModifications !== undefined) {
          workbenchStore.resetAllFileModifications();
        }
      } else {
        const conversationalMessage: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: _input,
          annotations: [{ type: 'studio-chat-only' }],
          ...(imageDataList.length
            ? {
                experimental_attachments: imageDataList.map((url) => ({
                  url,
                  contentType: /^data:(image\/[^;]+);/i.exec(url)?.[1] || 'image/png',
                })),
              }
            : {}),
        };

        void append(conversationalMessage, { body: { chatOnly: true } });
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);
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

    const displayMessages = useMemo(() => {
      return messages.map((message, i) => {
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
      });
    }, [messages, parsedMessages]);

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
        messages={displayMessages}
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
        onApprovePlan={approvePlan}
        onCancelPlan={cancelPlan}
      />
    );
  },
);

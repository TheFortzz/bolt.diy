import { convertToCoreMessages, streamText as _streamText } from 'ai';
import { getModel } from '~/lib/.server/llm/model';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { MAX_TOKENS } from './constants';
import { getSystemPrompt } from './prompts';
import { trimMessagesForSmallModel } from './context-trimmer';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  getModelList,
  MODEL_REGEX,
  PROVIDER_REGEX,
  STUDIO_MODE_REGEX,
  STUDIO_MODE_INSTRUCTIONS,
  type StudioAgentMode,
} from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';

interface ToolResult<Name extends string, Args, Result> {
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolResult<string, unknown, unknown>[];
  model?: string;
}

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

function extractPropertiesFromMessage(message: Message): {
  model: string;
  provider: string;
  content: string;
  studioMode?: StudioAgentMode;
} {
  const textContent = Array.isArray(message.content)
    ? message.content.find((item: any) => item.type === 'text')?.text || ''
    : message.content;

  const modelMatch = textContent.match(MODEL_REGEX);
  const providerMatch = textContent.match(PROVIDER_REGEX);
  const modeMatch = textContent.match(STUDIO_MODE_REGEX);

  const model = modelMatch ? modelMatch[1] : DEFAULT_MODEL;
  const provider = providerMatch ? providerMatch[1] : DEFAULT_PROVIDER.name;
  const studioMode = modeMatch ? (modeMatch[1].toLowerCase() as StudioAgentMode) : undefined;

  const stripMeta = (text: string) =>
    text.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '').replace(STUDIO_MODE_REGEX, '').trim();

  const cleanedContent = Array.isArray(message.content)
    ? message.content.map((item: any) => {
        if (item.type === 'text') {
          let text = stripMeta(item.text || '');
          if (studioMode && STUDIO_MODE_INSTRUCTIONS[studioMode]) {
            text = `${STUDIO_MODE_INSTRUCTIONS[studioMode]}\n\n${text}`;
          }
          return { type: 'text', text };
        }
        return item;
      })
    : (() => {
        let text = stripMeta(textContent);
        if (studioMode && STUDIO_MODE_INSTRUCTIONS[studioMode]) {
          text = `${STUDIO_MODE_INSTRUCTIONS[studioMode]}\n\n${text}`;
        }
        return text;
      })();

  return { model, provider, content: cleanedContent as any, studioMode };
}

export async function streamText(props: {
  messages: Messages;
  env: Env;
  options?: StreamingOptions;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
}) {
  const { messages, env, options, apiKeys, providerSettings } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  const MODEL_LIST = await getModelList(apiKeys || {}, providerSettings);
  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);

      if (MODEL_LIST.find((m) => m.name === model)) {
        currentModel = model;
      }

      currentProvider = provider;

      return { ...message, content };
    }

    return message;
  });

  const hasKey = getAPIKey(env, currentProvider, apiKeys);
  if (!hasKey && currentProvider !== 'OpenAILike') {
    currentProvider = 'OpenAILike';
    currentModel = 'fortz-ai';
  }

  const modelDetails = MODEL_LIST.find((m) => m.name === currentModel);

  // Trim messages for smaller models to fit context window
  const trimmedMessages = trimMessagesForSmallModel(processedMessages, currentModel, modelDetails);

  const dynamicMaxTokens = modelDetails && modelDetails.maxTokenAllowed ? modelDetails.maxTokenAllowed : MAX_TOKENS;

  return _streamText({
    model: getModel(currentProvider, currentModel, env, apiKeys, providerSettings) as any,
    system: getSystemPrompt(undefined, currentModel, modelDetails),
    maxTokens: dynamicMaxTokens,
    messages: convertToCoreMessages(trimmedMessages as any),
    ...options,
  });
}

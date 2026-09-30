/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { getAPIKey, getBaseURL } from '~/lib/.server/llm/api-key';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { ollama } from 'ollama-ai-provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createMistral } from '@ai-sdk/mistral';
import { createCohere } from '@ai-sdk/cohere';
import type { LanguageModelV1 } from 'ai';
import type { IProviderSetting } from '~/types/model';
import { createAzureResponsesModel } from '~/lib/.server/llm/azure-responses-model';
import { getFortzDeploymentConfig } from '~/lib/.server/llm/deployment-config';

export const DEFAULT_NUM_CTX = process.env.DEFAULT_NUM_CTX ? parseInt(process.env.DEFAULT_NUM_CTX, 10) : 32768;

type OptionalApiKey = string | undefined;

export function getAnthropicModel(apiKey: OptionalApiKey, model: string) {
  const anthropic = createAnthropic({
    apiKey,
  });

  return anthropic(model);
}
export function getOpenAILikeModel(baseURL: string, apiKey: OptionalApiKey, model: string) {
  const openai = createOpenAI({
    baseURL,
    apiKey,
  });

  return openai(model);
}

export function getCohereAIModel(apiKey: OptionalApiKey, model: string) {
  const cohere = createCohere({
    apiKey,
  });

  return cohere(model);
}

export function getOpenAIModel(apiKey: OptionalApiKey, model: string) {
  const openai = createOpenAI({
    apiKey,
  });

  return openai(model);
}

export function getMistralModel(apiKey: OptionalApiKey, model: string) {
  const mistral = createMistral({
    apiKey,
  });

  return mistral(model);
}

export function getGoogleModel(apiKey: OptionalApiKey, model: string) {
  const google = createGoogleGenerativeAI({
    apiKey,
  });

  return google(model);
}

export function getGroqModel(apiKey: OptionalApiKey, model: string) {
  const openai = createOpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey,
  });

  return openai(model);
}

export function getHuggingFaceModel(apiKey: OptionalApiKey, model: string) {
  const openai = createOpenAI({
    baseURL: 'https://api-inference.huggingface.co/v1/',
    apiKey,
  });

  return openai(model);
}

export function getOllamaModel(baseURL: string, model: string) {
  const ollamaInstance = ollama(model, {
    numCtx: DEFAULT_NUM_CTX,
  }) as LanguageModelV1 & { config: any };

  ollamaInstance.config.baseURL = `${baseURL}/api`;

  return ollamaInstance;
}

export function getDeepseekModel(apiKey: OptionalApiKey, model: string) {
  const openai = createOpenAI({
    baseURL: 'https://api.deepseek.com/beta',
    apiKey,
  });

  return openai(model);
}

export function getOpenRouterModel(apiKey: OptionalApiKey, model: string) {
  const openRouter = createOpenRouter({
    apiKey,
  });

  return openRouter.chat(model);
}

export function getLMStudioModel(baseURL: string, model: string) {
  const lmstudio = createOpenAI({
    baseUrl: `${baseURL}/v1`,
    apiKey: '',
  });

  return lmstudio(model);
}

export function getXAIModel(apiKey: OptionalApiKey, model: string) {
  const openai = createOpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey,
  });

  return openai(model);
}

export function getModel(
  provider: string,
  model: string,
  env: Env,
  apiKeys?: Record<string, string>,
  providerSettings?: Record<string, IProviderSetting>,
) {
  /*
   * let apiKey; // Declare first
   * let baseURL;
   */

  let apiKey = getAPIKey(env, provider, apiKeys);
  if (!apiKey && provider !== 'OpenAILike') {
    provider = 'OpenAILike';
    model = 'gpt-6-luna';
    apiKey = getAPIKey(env, provider, apiKeys);
  }
  const baseURL = (providerSettings?.[provider]?.baseUrl || '').trim() || getBaseURL(env, provider);

  switch (provider) {
    case 'Anthropic':
      return getAnthropicModel(apiKey, model);
    case 'OpenAI':
      return getOpenAIModel(apiKey, model);
    case 'Groq':
      return getGroqModel(apiKey, model);
    case 'HuggingFace':
      return getHuggingFaceModel(apiKey, model);
    case 'OpenRouter':
      return getOpenRouterModel(apiKey, model);
    case 'Google':
      return getGoogleModel(apiKey, model);
    case 'OpenAILike': {
      const deploymentConfig = getFortzDeploymentConfig({
        deployment: process.env.FORTZ_AI_DEPLOYMENT || env.FORTZ_AI_DEPLOYMENT,
        responsesUrl: process.env.FORTZ_AI_RESPONSES_URL || env.FORTZ_AI_RESPONSES_URL,
      });
      const targetModel =
        model === 'fortz-ai' || model === 'Fortz AI' || model === 'gpt-6-luna' || model === 'gpt-oss-120b' || !model
          ? deploymentConfig.deployment
          : model === 'gpt-4.1-mini'
            ? deploymentConfig.deployment
            : model;

      // Use Azure Responses API (not legacy chat/completions) for Fortz AI.
      return createAzureResponsesModel(apiKey || '', targetModel, deploymentConfig.responsesUrl);
    }
    case 'Together':
      return getOpenAILikeModel(baseURL, apiKey, model);
    case 'Deepseek':
      return getDeepseekModel(apiKey, model);
    case 'Mistral':
      return getMistralModel(apiKey, model);
    case 'LMStudio':
      return getLMStudioModel(baseURL, model);
    case 'xAI':
      return getXAIModel(apiKey, model);
    case 'Cohere':
      return getCohereAIModel(apiKey, model);
    default:
      return getOllamaModel(baseURL, model);
  }
}

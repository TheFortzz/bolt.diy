import { describe, expect, it } from 'vitest';
import { getFortzDeploymentConfig } from '~/lib/.server/llm/deployment-config';

describe('workspace model deployment configuration', () => {
  it('keeps the actual existing model as the explicit default', () => {
    expect(getFortzDeploymentConfig({}).deployment).toBe('gpt-6-luna');
  });

  it('accepts a server-configured deployment without guessing a provider model ID', () => {
    expect(
      getFortzDeploymentConfig({
        deployment: 'workspace-sol-deployment',
        responsesUrl: 'https://models.services.ai.azure.com/openai/v1/responses',
      }),
    ).toEqual({
      deployment: 'workspace-sol-deployment',
      responsesUrl: 'https://models.services.ai.azure.com/openai/v1/responses',
    });
  });

  it('derives the Responses endpoint from the OpenAILike base URL', () => {
    expect(
      getFortzDeploymentConfig({
        openAILikeBaseUrl: 'https://models.services.ai.azure.com/openai/v1/',
      }),
    ).toEqual({
      deployment: 'gpt-6-luna',
      responsesUrl: 'https://models.services.ai.azure.com/openai/v1/responses',
    });
  });

  it('adds the OpenAI v1 route to a Foundry project endpoint', () => {
    expect(
      getFortzDeploymentConfig({
        openAILikeBaseUrl: 'https://models.services.ai.azure.com/api/projects/game-studio',
      }).responsesUrl,
    ).toBe('https://models.services.ai.azure.com/api/projects/game-studio/openai/v1/responses');
  });

  it('prefers the explicit Responses URL over the OpenAILike base URL', () => {
    expect(
      getFortzDeploymentConfig({
        responsesUrl: 'https://primary.services.ai.azure.com/openai/v1/responses',
        openAILikeBaseUrl: 'https://ignored.services.ai.azure.com/openai/v1',
      }).responsesUrl,
    ).toBe('https://primary.services.ai.azure.com/openai/v1/responses');
  });

  it('rejects unsafe endpoint and deployment values', () => {
    expect(() => getFortzDeploymentConfig({ responsesUrl: 'http://models.example/responses' })).toThrow('HTTPS');
    expect(() => getFortzDeploymentConfig({ deployment: 'invalid deployment' })).toThrow('deployment identifier');
    expect(() => getFortzDeploymentConfig({ responsesUrl: 'https://azure.com/responses' })).toThrow(
      'Azure AI Foundry or Azure OpenAI hostname',
    );
  });
});

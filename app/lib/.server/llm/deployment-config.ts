import { FORTZ_DEPLOYMENT_MODEL, FORTZ_RESPONSES_URL } from '~/lib/.server/llm/azure-responses-model';

export function getFortzDeploymentConfig(values: { deployment?: string; responsesUrl?: string }) {
  const deployment = values.deployment?.trim() || FORTZ_DEPLOYMENT_MODEL;
  const responsesUrl = values.responsesUrl?.trim() || FORTZ_RESPONSES_URL;

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deployment)) {
    throw new Error('FORTZ_AI_DEPLOYMENT must be an actual Azure deployment identifier.');
  }

  const endpoint = new URL(responsesUrl);

  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('FORTZ_AI_RESPONSES_URL must be a trusted HTTPS Responses API endpoint.');
  }

  return { deployment, responsesUrl: endpoint.toString() };
}

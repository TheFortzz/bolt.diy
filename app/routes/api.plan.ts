import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { z } from 'zod';
import { getFluxApiKey } from '~/lib/.server/flux/flux-client';
import { runManagerAgent } from '~/lib/.server/harness/agents';
import { getBaseURL } from '~/lib/.server/llm/api-key';
import { getFortzChatCompletionsUrl, getFortzDeploymentConfig } from '~/lib/.server/llm/deployment-config';
import {
  getHarnessSecret,
  issueCapability,
  requireSameOrigin,
  verifyCapability,
} from '~/lib/.server/harness/capabilities';
import { blueprintSchema, managerBlueprintSchema, workspaceManifestSchema } from '~/lib/harness/blueprint';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '~/utils/constants';

const sourceSchema = z
  .record(z.string().max(6000))
  .refine(
    (files) => Object.values(files).reduce((size, source) => size + source.length, 0) <= 24000,
    'Source context exceeds the planning budget.',
  );
const referenceImageSchema = z
  .string()
  .max(2000000)
  .regex(
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i,
    'Reference images must be PNG, JPEG, WebP, or GIF data URLs.',
  );
const planRequestSchema = z
  .object({
    intent: z.literal('plan'),
    request: z.string().min(1).max(16000),
    workspaceId: z.string().min(1).max(100),
    manifest: workspaceManifestSchema,
    systemContext: z.string().max(4000),
    sources: sourceSchema,
    images: z.array(referenceImageSchema).max(4).default([]),
    model: z.string().max(128).optional(),
    provider: z.string().max(60).optional(),
    apiKeys: z.record(z.string()).optional(),
    proposedPlan: managerBlueprintSchema.optional(),
  })
  .strict();
const approvalSchema = z
  .object({
    intent: z.literal('approve'),
    blueprint: blueprintSchema,
    reviewToken: z.string().max(4096),
    currentRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  })
  .strict();

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    requireSameOrigin(request);

    const env = context.cloudflare.env;
    const secret = await getHarnessSecret(env);
    const audience = new URL(request.url).origin;
    const payload: unknown = await request.json();

    if (typeof payload === 'object' && payload !== null && 'intent' in payload && payload.intent === 'approve') {
      const approval = approvalSchema.parse(payload);
      const blueprint = await verifyCapability(approval.reviewToken, approval.blueprint, 'review', secret, audience);

      if (approval.currentRevision !== blueprint.baseRevision) {
        return json(
          { error: 'Workspace changed after planning. Request a fresh plan before building.' },
          { status: 409 },
        );
      }

      return json(
        { executionToken: await issueCapability(blueprint, 'execute', secret, audience) },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const input = planRequestSchema.parse(payload);

    if (Object.keys(input.sources).some((path) => !input.manifest.some((file) => file.path === path))) {
      throw new Error('Source excerpts must belong to the workspace manifest.');
    }

    let blueprint;

    try {
      blueprint = await runManagerAgent({
        ...input,
        model: DEFAULT_MODEL,
        provider: DEFAULT_PROVIDER.name,
        apiKeys: input.apiKeys,
        env,
        imagesAvailable: Boolean(getFluxApiKey(env)),
        proposedPlan: input.proposedPlan,
        signal: request.signal,
      });
    } catch (error) {
      console.error('Manager planning request failed:', error);

      const upstreamMessage = (error as Error).message || 'no error details returned';
      const rateLimited = /rate.?limit|too many requests|http 429/i.test(upstreamMessage);
      let configuration = 'deployment configuration could not be read';

      try {
        const modelConfig = getFortzDeploymentConfig({
          deployment: process.env.FORTZ_AI_DEPLOYMENT || env.FORTZ_AI_DEPLOYMENT,
          responsesUrl: process.env.FORTZ_AI_RESPONSES_URL || env.FORTZ_AI_RESPONSES_URL,
          openAILikeBaseUrl: getBaseURL(env, 'OpenAILike'),
        });
        const endpoint = new URL(getFortzChatCompletionsUrl(modelConfig.responsesUrl));
        configuration = `deployment "${modelConfig.deployment}" at ${endpoint.host}${endpoint.pathname}`;
      } catch (configurationError) {
        configuration = `invalid Azure configuration: ${(configurationError as Error).message}`;
      }

      return json(
        {
          error: rateLimited
            ? `Azure token quota is exceeded for ${configuration}. Wait for the deployment quota to reset or request more TPM capacity. Upstream: ${upstreamMessage}`
            : `Manager request failed (${configuration}). Check the server-side OPENAI_LIKE_API_KEY or saved OpenAILike key and Azure deployment settings. Upstream: ${upstreamMessage}`,
        },
        { status: rateLimited ? 429 : 502 },
      );
    }

    return json(
      { blueprint, reviewToken: await issueCapability(blueprint, 'review', secret, audience) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = (error as Error).message || 'Could not validate the blueprint.';
    const status =
      error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : message.includes('same studio origin')
          ? 403
          : 500;

    return json({ error: message }, { status });
  }
}

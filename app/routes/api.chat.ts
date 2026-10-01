import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';
import { z } from 'zod';
import { blueprintSchema, type Blueprint } from '~/lib/harness/blueprint';
import { getHarnessSecret, requireSameOrigin, verifyCapability } from '~/lib/.server/harness/capabilities';

const MAX_RESPONSE_SEGMENTS = 8;

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

function parseCookies(cookieHeader: string) {
  const cookies: any = {};

  // Split the cookie string by semicolons and spaces
  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      // Decode the name and value, and join value parts in case it contains '='
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const {
    messages,
    systemContext,
    approvedBlueprint: rawBlueprint,
    executionToken,
    workspaceSources: rawSources,
    chatOnly = false,
  } = await request.json<{
    messages: Messages;
    model: string;
    chatOnly?: boolean;
    systemContext?: string;
    approvedBlueprint?: unknown;
    executionToken?: string;
    workspaceSources?: unknown;
  }>();
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  const hasChatOnlyAnnotation = lastUserMessage?.annotations?.some(
    (annotation: any) =>
      typeof annotation === 'object' &&
      annotation !== null &&
      'type' in annotation &&
      annotation.type === 'studio-chat-only',
  );
  const conversationOnly = chatOnly === true || Boolean(hasChatOnlyAnnotation);
  let approvedBlueprint: Blueprint | undefined;
  let workspaceSources: Record<string, string> = {};

  try {
    requireSameOrigin(request);

    if (!conversationOnly) {
      approvedBlueprint = await verifyCapability(
        executionToken || '',
        blueprintSchema.parse(rawBlueprint),
        'execute',
        getHarnessSecret(context.cloudflare.env),
        new URL(request.url).origin,
      );
      workspaceSources = z.record(z.string().max(200000)).parse(rawSources || {});

      if (
        Object.entries(workspaceSources).some(
          ([path]) => !approvedBlueprint?.manifest.some((file) => file.path === path),
        ) ||
        Object.values(workspaceSources).reduce((size, text) => size + text.length, 0) > 300000
      ) {
        throw new Error('Editor context is outside the approved workspace or exceeds its budget.');
      }
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: `Plan approval required: ${(error as Error).message}` }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const workspaceContext =
    !conversationOnly && typeof systemContext === 'string' ? systemContext.slice(0, 12000) : undefined;

  const cookieHeader = request.headers.get('Cookie');

  // Parse the cookie's value (returns an object or null if no cookie exists)
  const apiKeys = JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(
    parseCookies(cookieHeader || '').providers || '{}',
  );

  const stream = new SwitchableStream();
  let fullContent = '';

  try {
    const options: StreamingOptions = {
      toolChoice: 'none',
      abortSignal: request.signal,
      onFinish: async ({ text: content, finishReason }) => {
        try {
          fullContent += content;

          if (conversationOnly) {
            return stream.close();
          }

          const hasUnclosedArtifact = fullContent.includes('<boltArtifact') && !fullContent.includes('</boltArtifact>');
          const hasUnclosedAction =
            fullContent.includes('<boltAction') &&
            fullContent.lastIndexOf('<boltAction') > fullContent.lastIndexOf('</boltAction>');
          const shouldContinue = finishReason === 'length' || hasUnclosedArtifact || hasUnclosedAction;

          if (!shouldContinue || !content || content.trim().length === 0) {
            return stream.close();
          }

          if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
            console.log(`Maximum continuation segments reached (${MAX_RESPONSE_SEGMENTS}), closing stream.`);
            return stream.close();
          }

          const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;
          console.log(
            `Continuing response for big build (${switchesLeft} switches left): reason=${finishReason}, unclosedArtifact=${hasUnclosedArtifact}, unclosedAction=${hasUnclosedAction}`,
          );

          stream.markSwitchPending();

          messages.push({ role: 'assistant', content });
          messages.push({ role: 'user', content: CONTINUE_PROMPT });

          const result = await streamText({
            messages,
            env: context.cloudflare.env,
            options,
            apiKeys,
            providerSettings,
            systemContext: workspaceContext,
            approvedBlueprint,
            workspaceSources,
            conversationOnly,
          });

          return stream.switchSource(result.toAIStream());
        } catch (err) {
          console.error('Error during onFinish stream continuation:', err);
          return stream.close();
        }
      },
    };

    const result = await streamText({
      messages,
      env: context.cloudflare.env,
      options,
      apiKeys,
      providerSettings,
      systemContext: workspaceContext,
      approvedBlueprint,
      workspaceSources,
      conversationOnly,
    });

    stream.switchSource(result.toAIStream());

    return new Response(stream.readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error: any) {
    console.error('Chat error in api.chat:', error);

    if (error.message?.includes('API key')) {
      return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        statusText: 'Unauthorized',
      });
    }

    const errorMessage = error?.message || error?.toString() || 'Internal Server Error';

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      statusText: 'Internal Server Error',
    });
  }
}

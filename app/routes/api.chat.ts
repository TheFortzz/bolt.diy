import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { MAX_RESPONSE_SEGMENTS } from '~/lib/.server/llm/constants';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';
import { z } from 'zod';
import { blueprintSchema, type Blueprint } from '~/lib/harness/blueprint';
import { getHarnessSecret, requireSameOrigin, verifyCapability } from '~/lib/.server/harness/capabilities';

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
  const conversationOnly = chatOnly === true || Boolean(hasChatOnlyAnnotation) || !rawBlueprint;
  let approvedBlueprint: Blueprint | undefined;
  let workspaceSources: Record<string, string> = {};

  try {
    requireSameOrigin(request);

    if (!conversationOnly) {
      if (!rawBlueprint) {
        throw new Error('An approved blueprint is required for workspace builds.');
      }

      approvedBlueprint = await verifyCapability(
        executionToken || '',
        blueprintSchema.parse(rawBlueprint),
        'execute',
        await getHarnessSecret(context.cloudflare.env),
        new URL(request.url).origin,
      );
      workspaceSources = z.record(z.string().max(200000)).parse(rawSources || {});

      const authorizedSourcePaths = new Set([
        ...approvedBlueprint.manifest.map((file) => file.path),
        ...approvedBlueprint.fileOperations.map((file) => file.path),
      ]);

      if (
        Object.keys(workspaceSources).some((path) => !authorizedSourcePaths.has(path)) ||
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
  const generationMessages = approvedBlueprint
    ? messages.filter((message) => message.role === 'user').slice(-1)
    : messages;
  const responseSegmentBudget = approvedBlueprint?.budgets.maximumResponseSegments ?? MAX_RESPONSE_SEGMENTS;

  const cookieHeader = request.headers.get('Cookie');

  // Parse the cookie's value (returns an object or null if no cookie exists)
  const apiKeys = JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(
    parseCookies(cookieHeader || '').providers || '{}',
  );

  const stream = new SwitchableStream();
  let responseTagTail = '';
  let artifactOpen = false;
  let actionOpen = false;
  let currentActionFilePath: string | undefined;
  const completedFilePaths = new Set<string>();

  try {
    const options: StreamingOptions = {
      toolChoice: 'none',
      abortSignal: request.signal,
      onFinish: async ({ text: content, finishReason }) => {
        try {
          if (conversationOnly) {
            return stream.close();
          }

          const normalized = content
            .replace(/\[boltArtifact(\s[^\]]*?)?\]/gi, (_, attrs = '') => `<boltArtifact${attrs}>`)
            .replace(/\[boltAction(\s[^\]]*?)?\]/gi, (_, attrs = '') => `<boltAction${attrs}>`)
            .replace(/\[\/boltArtifact\]/gi, '</boltArtifact>')
            .replace(/\[\/boltAction\]/gi, '</boltAction>');

          const tagInput = responseTagTail + normalized;
          const previousTailLength = responseTagTail.length;
          const tagPattern = /(<|\[)(\/?)bolt(Artifact|Action)\b([^>\]]*)(>|\])/gi;

          for (const match of tagInput.matchAll(tagPattern)) {
            if ((match.index ?? 0) + match[0].length <= previousTailLength) {
              continue;
            }

            const closing = Boolean(match[2]);
            const tagName = match[3].toLowerCase();
            const attributes = match[4];

            if (actionOpen) {
              if (tagName === 'action' && closing) {
                if (currentActionFilePath) {
                  completedFilePaths.add(currentActionFilePath);
                }

                actionOpen = false;
                currentActionFilePath = undefined;
              }

              continue;
            }

            if (tagName === 'artifact') {
              artifactOpen = !closing;
            } else if (tagName === 'action' && artifactOpen && !closing) {
              actionOpen = true;

              const isFileAction = /\btype\s*=\s*["']?file\b/i.test(attributes);
              currentActionFilePath = isFileAction
                ? attributes.match(/\bfilePath\s*=\s*["']?([^"'\s>\]]+)/i)?.[1]
                : undefined;
            }
          }

          responseTagTail = tagInput.slice(-1024);

          const partialTag = /(?:<|\[)\/?bolt(?:Artifact|Action)\b[^>\]]*$/i.test(tagInput.slice(-256));
          const hasUnclosedArtifact = artifactOpen;
          const hasUnclosedAction = actionOpen || partialTag;
          const shouldContinue = finishReason === 'length' || hasUnclosedArtifact || hasUnclosedAction;

          if (!shouldContinue || !content || content.trim().length === 0) {
            return stream.close();
          }

          if (stream.switches >= responseSegmentBudget) {
            console.log(`Maximum continuation segments reached (${responseSegmentBudget}), closing stream.`);
            return stream.close();
          }

          const switchesLeft = responseSegmentBudget - stream.switches;
          console.log(
            `Continuing response for big build (${switchesLeft} switches left): reason=${finishReason}, unclosedArtifact=${hasUnclosedArtifact}, unclosedAction=${hasUnclosedAction}`,
          );

          stream.markSwitchPending();

          const alreadyWritten = completedFilePaths.size
            ? `\n\nFiles already emitted and applied (do not repeat): ${Array.from(completedFilePaths).join(', ')}`
            : '';
          const continuationMessages: Messages = [
            ...generationMessages,
            { role: 'assistant', content: content.slice(-48000) },
            { role: 'user', content: `${CONTINUE_PROMPT}${alreadyWritten}` },
          ];

          const result = await streamText({
            messages: continuationMessages,
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
          return stream.fail(err);
        }
      },
    };

    const result = await streamText({
      messages: generationMessages,
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
        'X-Vercel-AI-Data-Stream': 'v1',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
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

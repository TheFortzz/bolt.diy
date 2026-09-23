import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';

const MAX_TOKENS = 8000;
const MAX_RESPONSE_SEGMENTS = 2;

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
  const { messages } = await request.json<{
    messages: Messages;
    model: string;
  }>();

  const cookieHeader = request.headers.get('Cookie');

  // Parse the cookie's value (returns an object or null if no cookie exists)
  const apiKeys = JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(
    parseCookies(cookieHeader || '').providers || '{}',
  );

  const stream = new SwitchableStream();

  try {
    const options: StreamingOptions = {
      toolChoice: 'none',
      onFinish: async ({ text: content, finishReason }) => {
        try {
          if (finishReason !== 'length' || !content || content.trim().length === 0) {
            return stream.close();
          }

          if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
            console.log(`Maximum continuation segments reached (${MAX_RESPONSE_SEGMENTS}), closing stream.`);
            return stream.close();
          }

          const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;
          console.log(`Reached max token limit: Continuing message (${switchesLeft} switches left)`);

          messages.push({ role: 'assistant', content });
          messages.push({ role: 'user', content: CONTINUE_PROMPT });

          const result = await streamText({ messages, env: context.cloudflare.env, options, apiKeys, providerSettings });

          return stream.switchSource(result.toAIStream());
        } catch (err) {
          console.error('Error during onFinish stream continuation:', err);
          stream.close();
        }
      },
    };

    const result = await streamText({ messages, env: context.cloudflare.env, options, apiKeys, providerSettings });

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

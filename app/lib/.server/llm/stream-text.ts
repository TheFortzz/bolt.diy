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

const DYNAMIC_CREATIVE_CATALYSTS = [
  'CREATIVE ARCHETYPE: Pseudo-3D Horizon Road Racer (OutRun / Rad Racer style) — featuring road curvature projection, rolling hill crests, roadside scaling scenery (palm trees, neon signposts, cyber structures), gear shifts, and oncoming traffic dodging.',
  'CREATIVE ARCHETYPE: Cyberpunk Anti-Gravity Wipeout Hovercraft — sleek glowing anti-grav gliders floating over a neon magnetic pipe track, with boost pads, energy shields, and pulse cannons.',
  'CREATIVE ARCHETYPE: Micro-Machines Tabletop Desk Derby — miniature RC cars racing across kitchen countertops, office desks, or pool tables with giant household obstacles (pencil ramps, spilled coffee puddles, cereal box tunnels).',
  'CREATIVE ARCHETYPE: Post-Apocalyptic Mad-Max Wasteland Combat — armored pursuit buggies with ramming spikes, oil slicks, nitro pickups, and hostile raider war-rig convoys across a dynamic desert terrain.',
  'CREATIVE ARCHETYPE: Midnight City Drift & Taxi Rush — bustling city street grid with passenger pickup fares, traffic lights, destructible fire hydrants, alley shortcuts, and police pursuit cruiser chases.',
  'CREATIVE ARCHETYPE: Isometric 2.5D Stunt & Demolition Arena — isometric stadium with ramps, loops, mud physics, vehicle deformation, and destructive derby combo scoring.',
  'CREATIVE ARCHETYPE: Side-Scrolling Physics Stunt Buggy (Hill Climb style) — dynamic spring suspension, deformable hills, airborne backflips, coin collection, and fuel canister management.',
  'CREATIVE ARCHETYPE: Neon Synthwave Highway Traffic Dodger — infinite neon highway at dusk, weaving through heavy traffic lanes, near-miss combo multipliers, and retro electronic synth audio.',
  'CREATIVE ARCHETYPE: Mountain Touge Tandem Drift — twisty narrow mountain hairpins at night with cherry blossom trees, tandem drift rival ghost AI, and drift angle multiplier gauges.',
  'CREATIVE ARCHETYPE: Monster Truck Arena Mayhem — heavy physics with giant bouncy tires, crushing scrap cars, stadium jump ramps, explosive barrels, and massive airtime boosts.',
];

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

  const dynamicMaxTokens = Math.max(
    modelDetails && modelDetails.maxTokenAllowed ? modelDetails.maxTokenAllowed : MAX_TOKENS,
    MAX_TOKENS,
  );

  const lastUserMessage = [...processedMessages].reverse().find((m) => m.role === 'user');
  const userText = lastUserMessage
    ? typeof lastUserMessage.content === 'string'
      ? lastUserMessage.content
      : Array.isArray(lastUserMessage.content)
        ? (lastUserMessage.content as any[]).map((p) => p.text || '').join(' ')
        : ''
    : '';

  let creativeCatalyst: string | undefined = undefined;
  const isGameOrCarBuild =
    /\b(car|race|racing|drive|driving|vehicle|game|play|arcade|drift|kart|runner|platformer|rpg|shoot|action|puzzle|roguelite|rogue|metroidvania|space|defense|arena|sim|simulator|physics|craft|build|level|levels|track|tracks)\b/i.test(
      userText,
    );

  if (isGameOrCarBuild) {
    const randomIndex = Math.floor(Math.random() * DYNAMIC_CREATIVE_CATALYSTS.length);
    creativeCatalyst = DYNAMIC_CREATIVE_CATALYSTS[randomIndex];
  }

  return _streamText({
    model: getModel(currentProvider, currentModel, env, apiKeys, providerSettings) as any,
    system: getSystemPrompt(undefined, currentModel, modelDetails, creativeCatalyst),
    maxTokens: dynamicMaxTokens,
    temperature: 0.85,
    messages: convertToCoreMessages(trimmedMessages as any),
    ...options,
  });
}

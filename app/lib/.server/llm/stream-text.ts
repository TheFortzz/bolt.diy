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

const VEHICLE_RACING_CATALYSTS = [
  'CREATIVE ARCHETYPE: Pseudo-3D Horizon Road Racer (OutRun / Rad Racer style) — road curvature projection, rolling hill crests, roadside scaling scenery, gear shifts, and oncoming traffic dodging.',
  'CREATIVE ARCHETYPE: Cyberpunk Anti-Gravity Wipeout Hovercraft — sleek glowing anti-grav gliders floating over a neon magnetic pipe track, with boost pads, energy shields, and pulse cannons.',
  'CREATIVE ARCHETYPE: Micro-Machines Tabletop Desk Derby — miniature RC cars racing across kitchen countertops, office desks, or pool tables with giant household obstacles (pencil ramps, spilled coffee puddles, cereal box tunnels).',
  'CREATIVE ARCHETYPE: Post-Apocalyptic Mad-Max Wasteland Combat — armored pursuit buggies with ramming spikes, oil slicks, nitro pickups, and hostile raider war-rig convoys across a dynamic desert terrain.',
  'CREATIVE ARCHETYPE: Mountain Touge Tandem Drift — twisty narrow mountain hairpins at night with cherry blossom trees, tandem drift rival ghost AI, and drift angle multiplier gauges.',
  'CREATIVE ARCHETYPE: Monster Truck Arena Mayhem — heavy physics with giant bouncy tires, crushing scrap cars, stadium jump ramps, explosive barrels, and massive airtime boosts.',
];

const RPG_METROIDVANIA_CATALYSTS = [
  'CREATIVE ARCHETYPE: Dark Fantasy Metroidvania Dungeon — subterranean labyrinth with locked elemental doors, collectible artifact keys, wall-climb boots, shadow beasts, and an epic multi-phase gargoyle boss.',
  'CREATIVE ARCHETYPE: Pixel Adventure Action-RPG — village hub, quest board, dense monster forest with secret grottos, sword slash combos, fire/ice spellcasting, chest loot, and an upgradeable blacksmith shop.',
  'CREATIVE ARCHETYPE: Cyber-Ninja Neon Infiltration — grappling hook mechanics, wall-running, shuriken throws, laser security tripwires, corporate mainframe hacking terminals, and shadow dash takedowns.',
];

const ROGUE_BULLET_HELL_CATALYSTS = [
  'CREATIVE ARCHETYPE: Cosmic Survivor Bullet-Hell Rogue-lite — 360-degree arena swarm with procedurally scaling monster hordes, orbital plasma blades, chain lightning upgrades, xp gem drops, and 3-choice level-up perk drafts.',
  'CREATIVE ARCHETYPE: Twin-Stick Cyberpunk Mech Destroyer — heavy dual-wielding mech brawler, dash thrusters, thermal rockets, screen-clearing EMP bombs, destructible barricades, and colossal spider-tank boss battles.',
  'CREATIVE ARCHETYPE: Void Spellcraft Arena — arcane wizard casting bouncing chaotic magic orbs, time-dilation fields, summonable elemental totems, and cascading combo explosions.',
];

const TOWER_DEFENSE_STRATEGY_CATALYSTS = [
  'CREATIVE ARCHETYPE: Sci-Fi Orbital Defense & Turret Strategy — strategic grid placement, branching turret upgrade trees (Gatling, Cryo Beam, Plasma Mortar, Tesla Arc), creeping alien waves, and mineral harvester economy.',
  'CREATIVE ARCHETYPE: Kingdom Siege Defense — medieval castle battlements, archer towers, boiling oil traps, catapult strikes, battering ram goblins, and siege boss giants.',
];

const PHYSICS_PLATFORMER_CATALYSTS = [
  'CREATIVE ARCHETYPE: Kinetic Impulse Physics Platformer — gravitational polarity flipping, bouncy gelatin pads, swinging pendulum spikes, momentum sling mechanics, and squash-and-stretch fluid animation.',
  'CREATIVE ARCHETYPE: Steam-Powered Grappling Hook Adventure — precision momentum grappling, crumbling clockwork gear platforms, steam vent jet boosts, and collectible golden cogs.',
  'CREATIVE ARCHETYPE: Portal Shift Puzzle Platformer — dual spatial teleport portals, momentum conservation physics, laser redirection prisms, and pressure switch puzzle doors.',
];

const SPACE_ODYSSEY_CATALYSTS = [
  'CREATIVE ARCHETYPE: Deep Space Galaxy Odyssey — asteroid mining, shield deflectors, hyperdrive jumps, dogfighting pirate starfighters, modular laser hardpoints, and derelict alien mothership exploration.',
];

const RETRO_ARCADE_CATALYSTS = [
  'CREATIVE ARCHETYPE: Hyper-Pinball & Brick Breaker Fusion — multi-ball frenzy, explosive bumpers, laser paddles, gravity wells, cascading gem drops, and retro CRT screen glow.',
  'CREATIVE ARCHETYPE: Street Brawler Arena Beat-Em-Up — dynamic martial arts combos, grab & throw physics, breakable street crates, weapon pickups (pipes, batons), and street gang boss encounters.',
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

      const textContent = Array.isArray(message.content)
        ? message.content.find((item: any) => item.type === 'text')?.text || ''
        : message.content;

      if (MODEL_REGEX.test(textContent) && MODEL_LIST.find((m) => m.name === model)) {
        currentModel = model;
      }

      if (PROVIDER_REGEX.test(textContent)) {
        currentProvider = provider;
      }

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

  // Use the primary user prompt (excluding internal continuation prompts) to pick the creative direction
  const primaryUserMessage = [...processedMessages].find(
    (m) =>
      m.role === 'user' &&
      typeof m.content === 'string' &&
      !m.content.includes('Continue the response immediately') &&
      !m.content.includes('Continue the current response'),
  ) || [...processedMessages].reverse().find((m) => m.role === 'user');

  const userText = primaryUserMessage
    ? typeof primaryUserMessage.content === 'string'
      ? primaryUserMessage.content
      : Array.isArray(primaryUserMessage.content)
        ? (primaryUserMessage.content as any[]).map((p) => p.text || '').join(' ')
        : ''
    : '';

  let creativeCatalyst: string | undefined = undefined;

  const isCarBuild = /\b(car|race|racing|drive|driving|vehicle|drift|kart|racer|highway)\b/i.test(userText);
  const isRpgBuild = /\b(rpg|roleplay|metroidvania|dungeon|sword|magic|spell|knight|fantasy|adventure)\b/i.test(userText);
  const isRogueBuild = /\b(rogue|roguelite|bullet|hell|survivor|horde|swarm|mech|twinstick)\b/i.test(userText);
  const isDefenseBuild = /\b(tower|defense|strategy|rts|base|turret|creep)\b/i.test(userText);
  const isPlatformerBuild = /\b(platform|platformer|jump|physics|puzzle|gravity|portal|grapple)\b/i.test(userText);
  const isSpaceBuild = /\b(space|galaxy|ship|star|starship|asteroid|alien|cosmic)\b/i.test(userText);
  const isGeneralGame = /\b(game|play|arcade|fun|action|make|create|build)\b/i.test(userText);

  if (isCarBuild || isRpgBuild || isRogueBuild || isDefenseBuild || isPlatformerBuild || isSpaceBuild || isGeneralGame) {
    let pool: string[];
    if (isCarBuild) {
      pool = VEHICLE_RACING_CATALYSTS;
    } else if (isRpgBuild) {
      pool = RPG_METROIDVANIA_CATALYSTS;
    } else if (isRogueBuild) {
      pool = ROGUE_BULLET_HELL_CATALYSTS;
    } else if (isDefenseBuild) {
      pool = TOWER_DEFENSE_STRATEGY_CATALYSTS;
    } else if (isPlatformerBuild) {
      pool = PHYSICS_PLATFORMER_CATALYSTS;
    } else if (isSpaceBuild) {
      pool = SPACE_ODYSSEY_CATALYSTS;
    } else {
      // General fun game request: draw from all creative genres!
      pool = [
        ...RPG_METROIDVANIA_CATALYSTS,
        ...ROGUE_BULLET_HELL_CATALYSTS,
        ...PHYSICS_PLATFORMER_CATALYSTS,
        ...TOWER_DEFENSE_STRATEGY_CATALYSTS,
        ...SPACE_ODYSSEY_CATALYSTS,
        ...RETRO_ARCADE_CATALYSTS,
        ...VEHICLE_RACING_CATALYSTS,
      ];
    }

    const randomIndex = Math.floor(Math.random() * pool.length);
    creativeCatalyst = pool[randomIndex];
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

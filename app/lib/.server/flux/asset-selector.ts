/**
 * Visual Element Selector
 *
 * Selects 2-4 key visual elements from the generated game project to produce
 * high-impact graphic assets using FLUX.2-pro.
 */

import { generateText } from 'ai';
import type { LanguageModelV1 } from 'ai';

export interface VisualElement {
  id: string;
  fileName: string;
  description: string;
  prompt: string;
  isSprite: boolean;
  width?: number;
  height?: number;
}

export function getHeuristicVisualElements(
  userPrompt: string,
  gameCode: string,
): VisualElement[] {
  const lowerPrompt = (userPrompt + ' ' + gameCode).toLowerCase();

  // Space / Galaxy
  if (lowerPrompt.includes('space') || lowerPrompt.includes('galaxy') || lowerPrompt.includes('asteroid') || lowerPrompt.includes('ship')) {
    return [
      {
        id: 'player',
        fileName: 'assets/player.png',
        description: 'Player hero spaceship',
        prompt: 'Futuristic sci-fi fighter starship sprite, top-down view, glowing neon blue and titanium wings, energy cockpit, transparent background',
        isSprite: true,
      },
      {
        id: 'enemy',
        fileName: 'assets/enemy.png',
        description: 'Alien fighter craft',
        prompt: 'Alien invader warship sprite, menacing crimson spikes, glowing plasma engines, top-down view, transparent background',
        isSprite: true,
      },
      {
        id: 'projectile',
        fileName: 'assets/laser.png',
        description: 'Plasma laser bolt',
        prompt: 'Glowing cyan laser bolt projectile sprite, energy flare trail, transparent background',
        isSprite: true,
      },
    ];
  }

  // Racing / Car
  if (lowerPrompt.includes('car') || lowerPrompt.includes('race') || lowerPrompt.includes('racing') || lowerPrompt.includes('drift')) {
    return [
      {
        id: 'player',
        fileName: 'assets/player_car.png',
        description: 'Player sports racing car',
        prompt: 'High-performance neon sports supercar sprite, top-down view, sleek aerodynamic body, detailed rims and windshield, transparent background',
        isSprite: true,
      },
      {
        id: 'rival',
        fileName: 'assets/rival_car.png',
        description: 'Rival competitor car',
        prompt: 'Aggressive muscle racing car sprite, top-down view, black and flame red decals, transparent background',
        isSprite: true,
      },
      {
        id: 'background',
        fileName: 'assets/track_background.png',
        description: 'Asphalt race track surface environment',
        prompt: 'Top-down asphalt race track surface texture, dark weathered asphalt with white lane dashes and red-and-white rumble strip curbs, seamless game background',
        isSprite: false,
      },
      {
        id: 'pickup',
        fileName: 'assets/nitro.png',
        description: 'Nitro boost powerup bottle',
        prompt: 'Glowing blue nitro nitrous canister bottle sprite, electric lightning sparks, transparent background',
        isSprite: true,
      },
    ];
  }

  // RPG / Fantasy / Dungeon
  if (lowerPrompt.includes('rpg') || lowerPrompt.includes('dungeon') || lowerPrompt.includes('sword') || lowerPrompt.includes('knight')) {
    return [
      {
        id: 'player',
        fileName: 'assets/hero.png',
        description: 'Hero knight character',
        prompt: 'Fantasy knight hero warrior sprite, holding gleaming sword and shield, 2D game asset, transparent background',
        isSprite: true,
      },
      {
        id: 'enemy',
        fileName: 'assets/monster.png',
        description: 'Dungeon goblin/orc monster',
        prompt: 'Menacing dungeon monster beast sprite, glowing red eyes, jagged claws, 2D game asset, transparent background',
        isSprite: true,
      },
      {
        id: 'background',
        fileName: 'assets/dungeon_bg.png',
        description: 'Stone dungeon floor background',
        prompt: 'Top-down ancient stone dungeon cobblestone floor texture, cracked flagstones and moss, seamless game background',
        isSprite: false,
      },
      {
        id: 'item',
        fileName: 'assets/potion.png',
        description: 'Magic health potion flask',
        prompt: 'Glowing crimson magic potion in glass vial bottle sprite, sparkling bubbles, transparent background',
        isSprite: true,
      },
    ];
  }

  // Default Arcade / Action
  return [
    {
      id: 'player',
      fileName: 'assets/player.png',
      description: 'Player avatar sprite',
      prompt: 'Vibrant 2D arcade video game hero character sprite, iconic design, crisp outlines, transparent background',
      isSprite: true,
    },
    {
      id: 'enemy',
      fileName: 'assets/enemy.png',
      description: 'Primary obstacle or enemy sprite',
      prompt: 'Arcade robotic enemy drone sprite, glowing red sensor eye, armored chassis, transparent background',
      isSprite: true,
    },
    {
      id: 'background',
      fileName: 'assets/arena_bg.png',
      description: 'Arcade battle arena floor',
      prompt: 'Top-down futuristic arena floor grid backdrop with subtle neon circuit lines, seamless video game background',
      isSprite: false,
    },
    {
      id: 'collectible',
      fileName: 'assets/coin.png',
      description: 'Gold bonus coin / star',
      prompt: 'Golden arcade power-up coin star sprite, sparkling specular shine, 2D game asset, transparent background',
      isSprite: true,
    },
  ];
}

/**
 * Uses the model to analyze game code and select 2 to 4 prominent visual elements.
 */
export async function selectVisualElementsWithModel(
  userPrompt: string,
  gameFiles: Record<string, string>,
  model: LanguageModelV1,
): Promise<VisualElement[]> {
  const codeSummary = Object.entries(gameFiles)
    .filter(([path]) => path.endsWith('.js') || path.endsWith('.html'))
    .map(([path, content]) => `// File: ${path}\n${content.slice(0, 3000)}`)
    .join('\n\n');

  const systemInstruction = `You are a senior game art director. Analyze the user request and game source code, then select exactly 2 to 4 key visual elements that will be generated as PNG assets using FLUX.2-pro.
Focus on high-impact visual assets: include gameplay sprites (such as player vehicle/character, enemies/rivals, items/projectiles) and an environment background or track/terrain texture.

Return ONLY a valid JSON array of 2 to 4 elements matching this exact schema:
[
  {
    "id": "player",
    "fileName": "assets/player.png",
    "description": "Short element description",
    "prompt": "Detailed image prompt describing the visual appearance, styling, and colors",
    "isSprite": true
  }
]
Rules:
- fileName MUST start with "assets/" and end with ".png".
- Set isSprite: true for any character, enemy, vehicle, projectile, or collectible so transparent background is enforced.
- Set isSprite: false for full-screen game backgrounds, racetracks, dungeon floors, or arena backdrop textures.
- Select at least 2 and at most 4 items.
- Output ONLY the JSON array, no commentary or markdown code fences.`;

  try {
    const { text } = await generateText({
      model,
      prompt: `User Prompt: ${userPrompt}\n\nGame Code:\n${codeSummary}`,
      system: systemInstruction,
      maxTokens: 1000,
      temperature: 0.7,
    });

    const cleanText = text.trim().replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleanText);

    if (Array.isArray(parsed) && parsed.length >= 2) {
      const sanitized: VisualElement[] = parsed.slice(0, 4).map((item, index) => ({
        id: String(item.id || `element_${index + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, ''),
        fileName: String(item.fileName || `assets/asset_${index + 1}.png`).replace(/^[/\\]+/, ''),
        description: String(item.description || 'Visual asset'),
        prompt: String(item.prompt || userPrompt),
        isSprite: item.isSprite !== false,
      }));

      // Ensure fileName paths start with assets/
      return sanitized.map((elem) => ({
        ...elem,
        fileName: elem.fileName.startsWith('assets/') ? elem.fileName : `assets/${elem.fileName}`,
      }));
    }
  } catch (err) {
    // If model selection fails or returns invalid JSON, gracefully fall back to heuristics
  }

  const primaryCode = Object.values(gameFiles).join('\n');
  return getHeuristicVisualElements(userPrompt, primaryCode);
}

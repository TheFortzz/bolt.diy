import React from 'react';

interface StudioLandingSectionProps {
  onSelectTemplate: (prompt: string) => void;
  onLaunchTemplate: (event: React.UIEvent, prompt: string) => void;
  onOpenSettings: () => void;
  fortzBalance?: number;
}

interface TemplateCard {
  id: string;
  title: string;
  genre: string;
  badge: string;
  badgeColor: string;
  icon: string;
  description: string;
  features: string[];
  prompt: string;
}

const TEMPLATES: TemplateCard[] = [
  {
    id: 'platformer',
    title: 'Cyberpunk 2D Platformer',
    genre: 'PLATFORMER',
    badge: 'POPULAR',
    badgeColor: '#06b6d4',
    icon: '🕹️',
    description: 'Smooth run & double-jump physics, moving platforms, collectible coins, hazard traps, and enemy stomping.',
    features: ['Double Jump & Wall Slide', 'Moving Obstacles & Traps', 'Web Audio Synth FX'],
    prompt:
      'Create a complete retro 2D platformer game in HTML5 canvas and modern JavaScript. Include player physics (smooth run acceleration, gravity, double jump, wall slide), 3 distinct platform types (solid, bouncy, moving), collectible gold coins, dangerous hazard spikes, stomping enemies with patrol AI, a live HUD with score, health, and lives, sound effects using Web Audio API synth, and level transition when reaching the golden flag.',
  },
  {
    id: 'space-shooter',
    title: 'Orbital Bullet Hell',
    genre: 'ACTION • ARCADE',
    badge: 'HIGH INTENSITY',
    badgeColor: '#8b5cf6',
    icon: '🚀',
    description: '360° mouse-aim spaceship combat, laser upgrades, procedural waves, intense screen shake, and boss fight.',
    features: ['Laser & Missile Upgrades', 'Procedural Wave AI', 'Screen Shake & Particles'],
    prompt:
      'Build a high-intensity retro top-down space bullet hell shooter in HTML5 canvas. Include 360-degree player movement with thruster particle trails, mouse aim shooting with multiple weapon upgrades (spread shot, laser beam, homing missiles), procedural wave spawning of alien ships, intense screen shake on explosions, glowing particle effects, sound synthesis, and an epic multi-phase boss fight with bullet patterns.',
  },
  {
    id: 'metroidvania',
    title: 'Dungeon Crawler RPG',
    genre: 'ADVENTURE • RPG',
    badge: 'DEEP GAMEPLAY',
    badgeColor: '#10b981',
    icon: '⚔️',
    description: 'Melee sword combo attacks, enemy AI pathfinding, keys & locked doors, chest loot, and boss chamber.',
    features: ['Melee Combos & Dash', 'Keys & Door Puzzles', 'Minimap & Boss AI'],
    prompt:
      'Create a rich 2D top-down dungeon crawler adventure RPG. Feature player combat (sword slash attack, dash dodge with invulnerability frames), health and mana HUD, multiple enemy types (slime, skeleton archer), inventory system with key pickups to unlock sealed doors, chest loot with weapon upgrades, minimap display, and an ominous dungeon boss.',
  },
  {
    id: 'physics-puzzle',
    title: 'Kinematic Physics Sandbox',
    genre: 'PUZZLE • PHYSICS',
    badge: 'BRAIN TEASER',
    badgeColor: '#f59e0b',
    icon: '🧩',
    description: 'Impulse forces, bouncy trampolines, gravity flip switches, laser obstacles, and progressive puzzle stages.',
    features: ['Rigid Body Collisions', 'Gravity Inversion Switch', '5 Star-Rated Levels'],
    prompt:
      'Build an interactive physics-based puzzle game with realistic gravity, collision restitution, and impulse forces. Include movable rigid body blocks, bouncy trampolines, gravity flip switches, laser obstacle beams, portal trigger zones, and 5 progressively challenging brain-teaser levels with star ratings.',
  },
];

const QUICK_PILLS = [
  { icon: '🕹️', label: '2D Platformer', id: 'platformer' },
  { icon: '🚀', label: 'Space Shooter', id: 'space-shooter' },
  { icon: '⚔️', label: 'Dungeon RPG', id: 'metroidvania' },
  { icon: '🧩', label: 'Physics Puzzle', id: 'physics-puzzle' },
  {
    icon: '🏎️',
    label: 'Pixel Racer',
    id: 'racer',
    prompt:
      'Create an arcade top-down pixel drift racing game. Feature authentic vehicle physics with tire drift friction, boost pads, oil slicks, checkpoint lap timing, competitive AI opponent cars, dynamic tire smoke particle trails, mini-map circuit radar, and a championship leaderboard.',
  },
  {
    icon: '🏓',
    label: 'Cyber Pong',
    id: 'pong',
    prompt:
      'Build a vibrant neon cyber brick breaker arcade game with smooth mouse paddle control, multi-ball powerups, explosive laser bricks, sound synthesizer audio, glowing neon trail effects, combo score multiplier, and satisfying particle bursts when bricks shatter.',
  },
];

export function StudioLandingSection({
  onSelectTemplate,
  onLaunchTemplate,
  onOpenSettings,
  fortzBalance,
}: StudioLandingSectionProps) {
  return (
    <div className="w-full flex flex-col items-center select-none pb-12">
      {/* ── 1. Hero Brand Header ── */}
      <div className="text-center px-4 pt-10 pb-4 max-w-4xl mx-auto">

        {/* Hero Title with Luckiest Guy Font */}
        <h1
          className="animate-fade-in leading-tight tracking-wider uppercase text-cyan-300 mb-3"
          style={{
            fontFamily: "'Luckiest Guy', cursive, sans-serif",
            fontSize: 'clamp(34px, 6vw, 64px)',
            textShadow: '0 4px 0 #0a1450, 0 8px 0 #070e38, 0 12px 30px rgba(0, 248, 255, 0.45)',
          }}
        >
          Make Your Game Possible
        </h1>

        {/* Hero Subtitle */}
        <p className="text-sm sm:text-base text-blue-100/85 max-w-2xl mx-auto leading-relaxed font-medium">
          Create, code, and test complete 2D &amp; 3D browser games with instant AI code generation.
          100% free client-side WebAssembly hosting with 1-click publishing to the live TheFortz feed.
        </p>
      </div>

      {/* Note: The Prompt Input is rendered directly below this in BaseChat */}
    </div>
  );
}

export function StudioLandingFooter({
  onSelectTemplate,
  onLaunchTemplate,
}: {
  onSelectTemplate: (prompt: string) => void;
  onLaunchTemplate: (event: React.UIEvent, prompt: string) => void;
}) {
  return null;
}

